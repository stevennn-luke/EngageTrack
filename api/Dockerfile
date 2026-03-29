FROM python:3.10-slim

WORKDIR /app

# System deps for OpenCV
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Install dependencies from requirements.txt to respect strict numpy pinning
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Model paths – downloaded from GCS at startup if not present
ENV GCS_BUCKET_NAME="ngagetrack-models"
ENV I3D_LOCAL_PATH="/app/models/rgb_kinetics_i3d.pt"
ENV STUDENT_LOCAL_PATH="/app/models/v4_student_attention_best.pt"
ENV PORT=8080

CMD ["python", "main.py"]
