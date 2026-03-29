"""
EngageTrack API – MobileNetV2 + StudentAttentionModelV4 pipeline
──────────────────────────────────────────────────────────────────
"""

import os
import tempfile
import numpy as np
import cv2
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.models as models
import torchvision.transforms as T

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from google.cloud import storage

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────
NUM_SEGMENTS    = 30
FRAMES_PER_SEG  = 1
FRAME_SIZE      = 224
NUM_CLASSES     = 4
CLASS_NAMES     = ['Disengage', 'Highly Disengage', 'Engage', 'Highly Engage']

CNN_MODEL     = None
STUDENT_MODEL = None

TRANSFORM = T.Compose([
    T.ToPILImage(), T.Resize((224,224)), T.ToTensor(),
    T.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])
])

# ─────────────────────────────────────────────────────────────────────────────
# Model Definitions
# ─────────────────────────────────────────────────────────────────────────────

class FeatureProjector(nn.Module):
    def __init__(self, inp, emb, drop):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(inp, emb*2), nn.LayerNorm(emb*2), nn.GELU(), nn.Dropout(drop),
            nn.Linear(emb*2, emb), nn.LayerNorm(emb), nn.GELU()
        )
    def forward(self, x):
        B,T,D = x.shape
        return self.net(x.reshape(B*T,D)).reshape(B,T,-1)

class AttentionPooling(nn.Module):
    def __init__(self, h):
        super().__init__()
        self.attn = nn.Sequential(nn.Linear(h,64), nn.Tanh(), nn.Linear(64,1))
    def forward(self, x):
        return (x * torch.softmax(self.attn(x), dim=1)).sum(dim=1)

class StudentAttentionModelV4(nn.Module):
    def __init__(self, inp, hid, layers, nc, drop):
        super().__init__()
        self.projector  = FeatureProjector(inp, hid, drop)
        self.lstm       = nn.LSTM(hid, hid, layers, batch_first=True,
                                  bidirectional=True, dropout=drop if layers>1 else 0.)
        self.attention  = AttentionPooling(hid*2)
        self.classifier = nn.Sequential(
            nn.Linear(hid*2, hid), nn.GELU(), nn.Dropout(drop), nn.Linear(hid, nc)
        )
    def forward(self, x):
        x, _ = self.lstm(self.projector(x))
        return self.classifier(self.attention(x))

# ─────────────────────────────────────────────────────────────────────────────
# GCS helpers
# ─────────────────────────────────────────────────────────────────────────────

def _download_from_gcs(bucket_name: str, blob_name: str, local_path: str):
    print(f"⬇  Downloading gs://{bucket_name}/{blob_name} → {local_path}")
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    client = storage.Client()
    client.bucket(bucket_name).blob(blob_name).download_to_filename(local_path)
    print(f"✅ Downloaded {blob_name}")


def _ensure_file(env_key: str, default_local: str, gcs_blob: str) -> str:
    path   = os.environ.get(env_key, default_local)
    bucket = os.environ.get("GCS_BUCKET_NAME", "ngagetrack-models")
    if not os.path.exists(path):
        _download_from_gcs(bucket, gcs_blob, path)
    return path


# ─────────────────────────────────────────────────────────────────────────────
# Model loading
# ─────────────────────────────────────────────────────────────────────────────

def load_models():
    global CNN_MODEL, STUDENT_MODEL
    if CNN_MODEL is not None and STUDENT_MODEL is not None:
        return

    device = torch.device("cpu")

    print("Loading MobileNetV2 backbone …")
    backbone = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.IMAGENET1K_V1)
    cnn = nn.Sequential(backbone.features, nn.AdaptiveAvgPool2d((1,1))).to(device).eval()
    CNN_MODEL = cnn
    print("✅ MobileNetV2 loaded")

    student_path = _ensure_file(
        "STUDENT_LOCAL_PATH",
        "/app/models/v4_student_attention_best.pt",
        "v4_student_attention_best.pt",
    )
    print("Loading StudentAttentionModelV4 …")
    
    # Initialize architecture
    HIDDEN = 256
    LAYERS = 2
    DROPOUT = 0.0
    model = StudentAttentionModelV4(1280, HIDDEN, LAYERS, NUM_CLASSES, DROPOUT).to(device)
    
    ckpt = torch.load(student_path, map_location=device, weights_only=False)
    model.load_state_dict(ckpt["model_state"])
    model.eval()
    
    STUDENT_MODEL = model
    print("✅ StudentAttentionModel loaded")


# ─────────────────────────────────────────────────────────────────────────────
# Video / frame preprocessing utilities
# ─────────────────────────────────────────────────────────────────────────────

def _crop_face(frames: list[np.ndarray]) -> list[np.ndarray]:
    if not frames:
        return frames

    face_cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
    
    gray = cv2.cvtColor(frames[0], cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, 1.1, 5, minSize=(30, 30))
    if len(faces) == 0:
        return frames

    fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
    px = int(fw * 0.2)
    py = int(fh * 0.2)
    h, w = frames[0].shape[:2]

    new_fx = max(0, fx - px)
    new_fy = max(0, fy - py)
    new_fw = min(w - new_fx, fw + 2 * px)
    new_fh = min(h - new_fy, fh + 2 * py)

    cropped_frames = []
    for frame in frames:
        cropped = frame[new_fy:new_fy+new_fh, new_fx:new_fx+new_fw]
        cropped_frames.append(cropped)
    return cropped_frames

def _extract_frames_from_video(video_bytes: bytes) -> list[np.ndarray]:
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp:
        tmp.write(video_bytes)
        tmp_path = tmp.name
    try:
        cap   = cv2.VideoCapture(tmp_path)
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total == 0:
            raise ValueError("Video has no frames")
        target = NUM_SEGMENTS * FRAMES_PER_SEG
        indices = np.linspace(0, total - 1, target, dtype=int)
        frames  = []
        for idx in indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
            ret, frame = cap.read()
            if ret:
                frames.append(frame)
            elif frames:
                frames.append(frames[-1])
            else:
                raise ValueError(f"Could not read frame {idx}")
        cap.release()
        while len(frames) < target:
            frames.append(frames[-1])
        return frames[:target]
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

def _frames_to_embeddings(frames: list) -> torch.Tensor:
    try:
        cnn = app.state.cnn_model
    except Exception:
        cnn = CNN_MODEL

    embeddings = []
    device = torch.device("cpu")
    for frame in frames:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img = TRANSFORM(rgb).unsqueeze(0).to(device)
        with torch.no_grad():
            emb = cnn(img).view(1, -1)
        embeddings.append(emb)
    return torch.stack(embeddings, dim=1)


# ─────────────────────────────────────────────────────────────────────────────
# FastAPI app
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(title="EngageTrack API", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup_event():
    load_models()
    app.state.cnn_model     = CNN_MODEL
    app.state.student_model = STUDENT_MODEL
    print("✅ Models attached to app.state — worker ready.")


@app.get("/ping")
async def ping():
    return {"status": "alive", "version": "v4-mobilenet"}


@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    try:
        if not file.filename.lower().endswith((".mp4", ".avi", ".mov")):
            return {"error": "Invalid file type", "message": "Upload an MP4, AVI, or MOV file"}

        student = app.state.student_model
        video_bytes = await file.read()
        frames      = _extract_frames_from_video(video_bytes)
        frames      = _crop_face(frames)
        seq         = _frames_to_embeddings(frames)

        with torch.no_grad():
            logits = student(seq)
            probs  = torch.softmax(logits, dim=-1)[0].tolist()

        pred_idx  = int(np.argmax(probs))
        return {
            "engagement": {
                "level":       pred_idx,
                "label":       CLASS_NAMES[pred_idx],
                "confidence":  round(probs[pred_idx], 4),
                "probabilities": {
                    CLASS_NAMES[i]: round(probs[i], 4) for i in range(NUM_CLASSES)
                },
            },
            "frames_processed": NUM_SEGMENTS * FRAMES_PER_SEG,
            "model_type": "mobilenetv2+student_attention_v4",
        }

    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}


@app.post("/predict_frame")
async def predict_frame(file: UploadFile = File(...)):
    try:
        student = app.state.student_model

        image_bytes = await file.read()
        nparr = np.frombuffer(image_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is None:
            return {"error": "Invalid image", "message": "Could not decode image"}

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        faces    = face_cascade.detectMultiScale(gray, 1.1, 5, minSize=(30, 30))
        face_box = None
        if len(faces) > 0:
            fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
            face_box = [int(fx), int(fy), int(fw), int(fh)]
            
            px, py = int(fw * 0.2), int(fh * 0.2)
            h, w = frame.shape[:2]
            n_fx = max(0, fx - px)
            n_fy = max(0, fy - py)
            n_fw = min(w - n_fx, fw + 2 * px)
            n_fh = min(h - n_fy, fh + 2 * py)
            frame = frame[n_fy:n_fy+n_fh, n_fx:n_fx+n_fw]

        frames = [frame] * (NUM_SEGMENTS * FRAMES_PER_SEG)
        seq    = _frames_to_embeddings(frames)

        with torch.no_grad():
            logits = student(seq)
            probs  = torch.softmax(logits, dim=-1)[0].tolist()

        pred_idx = int(np.argmax(probs))
        return {
            "engagement": {
                "level":        pred_idx,
                "label":        CLASS_NAMES[pred_idx],
                "confidence":   round(probs[pred_idx], 4),
                "probabilities": {
                    CLASS_NAMES[i]: round(probs[i], 4) for i in range(NUM_CLASSES)
                },
            },
            "face_box":   face_box,
            "model_type": "mobilenetv2+student_attention_v4",
        }

    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False, workers=1)
