"""
openWakeWord WebSocket service for JOI.

Accepts raw 16kHz 16-bit mono PCM audio via WebSocket.
Sends JSON detection events when the wake word is heard.

Protocol:
  Client → Server: binary frames (raw PCM int16, 16kHz mono)
  Server → Client: JSON text frames {"detected": "hey_joi", "confidence": 0.95}

Also exposes /health for container health checks.
"""

import asyncio
import json
import logging
import os
import sys
from pathlib import Path

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
import uvicorn

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("wakeword")

app = FastAPI(title="JOI Wake Word Service")

# ── Configuration ──

SAMPLE_RATE = 16000
# Chunk size in samples — openWakeWord expects ~80ms chunks (1280 samples at 16kHz)
CHUNK_SAMPLES = 1280
# Minimum confidence to trigger detection
CONFIDENCE_THRESHOLD = float(os.environ.get("WAKEWORD_THRESHOLD", "0.5"))
# Cooldown after detection to avoid rapid re-triggers (seconds)
DETECTION_COOLDOWN_S = float(os.environ.get("WAKEWORD_COOLDOWN", "3.0"))
# Custom model path (if trained)
CUSTOM_MODEL_PATH = os.environ.get("WAKEWORD_MODEL_PATH", "")
# Wake word name to listen for (built-in or custom)
WAKEWORD_NAME = os.environ.get("WAKEWORD_NAME", "hey_jarvis")

# ── Model loading ──

_oww_model = None


def get_model():
    """Lazy-load the openWakeWord model."""
    global _oww_model
    if _oww_model is not None:
        return _oww_model

    from openwakeword.model import Model

    model_paths = []
    custom_model_dir = Path("/app/models")

    # Check for custom .onnx or .tflite models
    if CUSTOM_MODEL_PATH and Path(CUSTOM_MODEL_PATH).exists():
        model_paths.append(CUSTOM_MODEL_PATH)
        log.info(f"Loading custom model: {CUSTOM_MODEL_PATH}")
    elif custom_model_dir.exists():
        custom_files = list(custom_model_dir.glob("*.onnx")) + list(
            custom_model_dir.glob("*.tflite")
        )
        if custom_files:
            model_paths = [str(f) for f in custom_files]
            log.info(f"Loading custom models from /app/models: {model_paths}")

    if model_paths:
        _oww_model = Model(wakeword_models=model_paths)
    else:
        # Use built-in model as placeholder until custom "hey_joi" is trained
        log.info(
            f"No custom model found — using built-in '{WAKEWORD_NAME}' model. "
            "Train a custom 'hey_joi' model and place the .onnx file in /app/models/ to replace it."
        )
        _oww_model = Model()

    log.info(f"Models loaded. Available wake words: {list(_oww_model.models.keys())}")
    return _oww_model


# ── Health endpoint ──


@app.get("/health")
async def health():
    try:
        model = get_model()
        return JSONResponse(
            {
                "status": "ok",
                "models": list(model.models.keys()),
                "threshold": CONFIDENCE_THRESHOLD,
            }
        )
    except Exception as e:
        return JSONResponse({"status": "error", "detail": str(e)}, status_code=503)


# ── WebSocket endpoint ──


@app.websocket("/ws")
async def wakeword_ws(ws: WebSocket):
    await ws.accept()
    client = ws.client
    log.info(f"Client connected: {client}")

    model = get_model()
    last_detection_time = 0.0
    audio_buffer = bytearray()

    try:
        while True:
            data = await ws.receive_bytes()
            audio_buffer.extend(data)

            # Process in chunks of CHUNK_SAMPLES (1280 samples * 2 bytes = 2560 bytes)
            chunk_bytes = CHUNK_SAMPLES * 2
            while len(audio_buffer) >= chunk_bytes:
                chunk = audio_buffer[:chunk_bytes]
                audio_buffer = audio_buffer[chunk_bytes:]

                # Convert bytes to int16 numpy array
                audio_array = np.frombuffer(bytes(chunk), dtype=np.int16)

                # Run prediction
                prediction = model.predict(audio_array)

                # Check each model's prediction
                for name, confidence in prediction.items():
                    if confidence >= CONFIDENCE_THRESHOLD:
                        now = asyncio.get_event_loop().time()
                        if now - last_detection_time < DETECTION_COOLDOWN_S:
                            continue
                        last_detection_time = now

                        log.info(
                            f"Wake word detected: {name} (confidence={confidence:.3f})"
                        )
                        await ws.send_text(
                            json.dumps(
                                {
                                    "detected": name,
                                    "confidence": round(float(confidence), 3),
                                }
                            )
                        )

    except WebSocketDisconnect:
        log.info(f"Client disconnected: {client}")
    except Exception as e:
        log.error(f"WebSocket error: {e}")


if __name__ == "__main__":
    # Pre-load model at startup
    log.info("Pre-loading wake word model...")
    get_model()

    port = int(os.environ.get("WAKEWORD_PORT", "3101"))
    log.info(f"Starting wake word service on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
