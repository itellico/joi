# Training container for custom openWakeWord models
# Must run with --platform linux/amd64 on Apple Silicon (Piper TTS requires x86_64)
#
# Usage:
#   docker build --platform linux/amd64 -t joi-wakeword-trainer -f infra/toolbox/training/Dockerfile .
#   docker run --platform linux/amd64 -v $(pwd)/infra/toolbox/models:/output joi-wakeword-trainer
#
FROM --platform=linux/amd64 python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    wget \
    curl \
    libsndfile1 \
    ffmpeg \
    sox \
    libspeexdsp-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Install Python dependencies
RUN pip install --no-cache-dir \
    openwakeword \
    torch \
    torchaudio \
    numpy \
    scipy \
    librosa \
    soundfile \
    datasets \
    onnx \
    onnxruntime

# Clone piper-sample-generator for synthetic speech
RUN git clone --depth 1 https://github.com/rhasspy/piper-sample-generator /workspace/piper-sample-generator && \
    cd /workspace/piper-sample-generator && \
    pip install --no-cache-dir -e .

# Download Piper voice models (English + German)
RUN mkdir -p /workspace/voices && \
    wget -q -O /workspace/voices/en_US-lessac-medium.onnx \
      'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx' && \
    wget -q -O /workspace/voices/en_US-lessac-medium.onnx.json \
      'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json' && \
    wget -q -O /workspace/voices/de_DE-thorsten-medium.onnx \
      'https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx' && \
    wget -q -O /workspace/voices/de_DE-thorsten-medium.onnx.json \
      'https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json'

# Copy training script
COPY infra/toolbox/training/train_hey_joi.py /workspace/train_hey_joi.py

# Output directory (mount as volume)
RUN mkdir -p /output

CMD ["python3", "/workspace/train_hey_joi.py"]
