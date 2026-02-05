import os
import tempfile
import numpy as np
import cv2

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import tensorflow as tf
from google.cloud import storage

class CompatibleBatchNormalization(tf.keras.layers.BatchNormalization):
    """Custom BatchNormalization layer that handles axis as list or int"""
    
    def __init__(self, axis=-1, **kwargs):
        # Convert axis from list to int if needed
        if isinstance(axis, list):
            axis = axis[0] if len(axis) > 0 else -1
        super().__init__(axis=axis, **kwargs)
    
    @classmethod
    def from_config(cls, config):
        # Convert axis from list to int before calling parent from_config
        if 'axis' in config and isinstance(config['axis'], list):
            config = config.copy()  # Don't modify the original
            config['axis'] = config['axis'][0] if len(config['axis']) > 0 else -1
        return cls(**config)
    
    def get_config(self):
        config = super().get_config()
        # Ensure axis is always an int in the config
        if isinstance(config.get('axis'), list):
            config['axis'] = config['axis'][0] if len(config['axis']) > 0 else -1
        return config


app = FastAPI()

origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL = None

NUM_FRAMES = 10
FRAME_HEIGHT = 224
FRAME_WIDTH = 224

def load_model():
    """Load the TensorFlow model (lazy loading)"""
    global MODEL
    if MODEL is None:
        try:
            print("="*50)
            print("Loading attention detection model...")
            
            # Configure TensorFlow threading
            tf.config.threading.set_inter_op_parallelism_threads(1)
            tf.config.threading.set_intra_op_parallelism_threads(1)
            
            # Determine model path
            model_local_path_env = os.environ.get("MODEL_LOCAL_PATH")
            if model_local_path_env:
                model_path = model_local_path_env
            else:
                model_path = os.path.join(
                    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 
                    "saved_models", "1", "model.h5"
                )
            
            print(f"Model path: {model_path}")
            
            # Check if model exists locally, if not try to download from GCS
            if not os.path.exists(model_path):
                print(f"Model not found at {model_path}")
                bucket_name = os.environ.get("GCS_BUCKET_NAME")
                blob_name = os.environ.get("GCS_MODEL_BLOB", "model.h5")
                
                if bucket_name:
                    print(f"Attempting to download from GCS bucket: {bucket_name}, blob: {blob_name}")
                    try:
                        # Ensure directory exists
                        os.makedirs(os.path.dirname(model_path), exist_ok=True)
                        
                        client = storage.Client()
                        bucket = client.bucket(bucket_name)
                        blob = bucket.blob(blob_name)
                        blob.download_to_filename(model_path)
                        print("✓ Model downloaded from GCS successfully!")
                    except Exception as e:
                        print(f"✗ ERROR downloading from GCS: {str(e)}")
                        # Don't raise here, let the load_model fail normally if file still missing
                else:
                    print("! GCS_BUCKET_NAME environment variable not set. Skipping GCS download.")
            
            print(f"File exists: {os.path.exists(model_path)}")
            
            # Load the model (should work now that it's been fixed)
            MODEL = tf.keras.models.load_model(model_path, compile=False)
            
            print("✓ Model loaded successfully!")
            print(f"Model has {len(MODEL.layers)} layers")
            print("="*50)
            
        except Exception as e:
            print(f"✗ ERROR loading model: {str(e)}")
            import traceback
            traceback.print_exc()
            raise RuntimeError(f"Failed to load model: {str(e)}")
    
    return MODEL

@app.get("/ping")
async def ping():
    return "Hello, I am alive"

def process_video_file(video_bytes) -> np.ndarray:
    with tempfile.NamedTemporaryFile(delete=False, suffix='.avi') as tmp_file:
        tmp_file.write(video_bytes)
        tmp_file_path = tmp_file.name
    
    try:
        cap = cv2.VideoCapture(tmp_file_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        if total_frames == 0:
            raise ValueError("Could not read video or video has no frames")
        
        frame_indices = np.linspace(0, total_frames - 1, NUM_FRAMES, dtype=int)
        frames = []
        
        for idx in frame_indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ret, frame = cap.read()
            
            if ret:
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                frame_resized = cv2.resize(frame_rgb, (FRAME_WIDTH, FRAME_HEIGHT))
                frame_normalized = frame_resized.astype(np.float32) / 255.0
                frames.append(frame_normalized)
            else:
                if len(frames) > 0:
                    frames.append(frames[-1])
                else:
                    raise ValueError(f"Failed to read frame at index {idx}")
        
        cap.release()
        
        while len(frames) < NUM_FRAMES:
            frames.append(frames[-1])
        
        video_array = np.array(frames[:NUM_FRAMES])
        return video_array
    
    finally:
        if os.path.exists(tmp_file_path):
            os.remove(tmp_file_path)

@app.post("/predict_frame")
async def predict_frame(file: UploadFile = File(...)):
    """Predict from a single frame for real-time analysis"""
    try:
        # Read the image
        image_bytes = await file.read()
        nparr = np.frombuffer(image_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is None:
            return {
                'error': 'Invalid image',
                'message': 'Could not decode image'
            }
        
        # Process single frame - duplicate it to match NUM_FRAMES requirement
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        frame_resized = cv2.resize(frame_rgb, (FRAME_WIDTH, FRAME_HEIGHT))
        frame_normalized = frame_resized.astype(np.float32) / 255.0
        
        # Create a sequence by duplicating the frame
        frames = [frame_normalized] * NUM_FRAMES
        video_array = np.array(frames)
        video_batch = np.expand_dims(video_array, 0)
        
        model = load_model()
        predictions = model.predict(video_batch, verbose=0)
        
        boredom_pred, engagement_pred, confusion_pred, frustration_pred, attention_pred = predictions
        
        boredom_level = int(np.argmax(boredom_pred[0]))
        engagement_level = int(np.argmax(engagement_pred[0]))
        confusion_level = int(np.argmax(confusion_pred[0]))
        frustration_level = int(np.argmax(frustration_pred[0]))
        attention_score = float(attention_pred[0][0])
        
        return {
            'boredom': {
                'level': boredom_level,
                'confidence': float(np.max(boredom_pred[0])),
                'probabilities': boredom_pred[0].tolist()
            },
            'engagement': {
                'level': engagement_level,
                'confidence': float(np.max(engagement_pred[0])),
                'probabilities': engagement_pred[0].tolist()
            },
            'confusion': {
                'level': confusion_level,
                'confidence': float(np.max(confusion_pred[0])),
                'probabilities': confusion_pred[0].tolist()
            },
            'frustration': {
                'level': frustration_level,
                'confidence': float(np.max(frustration_pred[0])),
                'probabilities': frustration_pred[0].tolist()
            },
            'attention_score': attention_score,
            'model_type': 'real-time'
        }
    
    except Exception as e:
        import traceback
        return {
            'error': str(e),
            'message': 'Failed to process frame',
            'traceback': traceback.format_exc()
        }

@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    try:
        if not file.filename.lower().endswith(('.mp4', '.avi')):
            return {
                'error': 'Invalid file type',
                'message': 'Please upload either an MP4 or AVI video file'
            }
            
        video_bytes = await file.read()
        video_frames = process_video_file(video_bytes)
        video_batch = np.expand_dims(video_frames, 0)
        
        model = load_model()
        predictions = model.predict(video_batch)
        
        boredom_pred, engagement_pred, confusion_pred, frustration_pred, attention_pred = predictions
        
        boredom_level = int(np.argmax(boredom_pred[0]))
        engagement_level = int(np.argmax(engagement_pred[0]))
        confusion_level = int(np.argmax(confusion_pred[0]))
        frustration_level = int(np.argmax(frustration_pred[0]))
        attention_score = float(attention_pred[0][0])
        
        return {
            'boredom': {
                'level': boredom_level,
                'confidence': float(np.max(boredom_pred[0])),
                'probabilities': boredom_pred[0].tolist()
            },
            'engagement': {
                'level': engagement_level,
                'confidence': float(np.max(engagement_pred[0])),
                'probabilities': engagement_pred[0].tolist()
            },
            'confusion': {
                'level': confusion_level,
                'confidence': float(np.max(confusion_pred[0])),
                'probabilities': confusion_pred[0].tolist()
            },
            'frustration': {
                'level': frustration_level,
                'confidence': float(np.max(frustration_pred[0])),
                'probabilities': frustration_pred[0].tolist()
            },
            'attention_score': attention_score,
            'frames_processed': NUM_FRAMES,
            'model_type': 'original',
            'model_info': {
                'total_params': 51608529,
                'model_size_mb': 196.87,
                'architecture': 'CNN + LSTM + Dense layers'
            }
        }
    
    except Exception as e:
        import traceback
        return {
            'error': str(e),
            'message': 'Failed to process video file',
            'traceback': traceback.format_exc()
        }

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False, workers=1, loop="asyncio")

