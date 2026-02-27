FROM python:3.12-slim

# Base system tools for a multi-purpose container
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    git \
    ffmpeg \
    sox \
    jq \
    wget \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Python packages: openWakeWord + WebSocket server
RUN pip install --no-cache-dir \
    openwakeword \
    fastapi \
    uvicorn[standard] \
    websockets \
    numpy \
    onnxruntime

WORKDIR /app

# Copy service code
COPY services/ /app/services/
COPY models/ /app/models/

EXPOSE 3101

CMD ["python", "-m", "services.wakeword"]
