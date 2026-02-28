/**
 * Wake Word Hook — streams mic audio to the openWakeWord service
 * and emits voice control events when the wake word is detected.
 *
 * Protocol: sends raw 16kHz 16-bit mono PCM via WebSocket,
 * receives JSON detection events like {"detected":"hey_joi","confidence":0.95}
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { emitAssistantVoiceControl } from "../lib/assistantVoiceEvents";

export type WakeWordState = "idle" | "listening" | "error";

interface UseWakeWordOptions {
  /** WebSocket URL for the wake word service */
  serviceUrl?: string;
  /** Auto-start listening on mount */
  autoStart?: boolean;
  /** Callback when wake word is detected */
  onDetected?: (keyword: string, confidence: number) => void;
}

const log = (...args: unknown[]) => console.log("[wakeword]", ...args);

// Resample from source rate to 16kHz and convert to Int16 PCM
function resampleTo16kPCM(input: Float32Array, sourceSampleRate: number): Int16Array {
  const ratio = sourceSampleRate / 16000;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIdx = Math.floor(i * ratio);
    // Clamp to [-1, 1] then scale to Int16
    const sample = Math.max(-1, Math.min(1, input[srcIdx]));
    output[i] = sample < 0 ? sample * 32768 : sample * 32767;
  }
  return output;
}

export function useWakeWord(options: UseWakeWordOptions = {}) {
  const {
    serviceUrl,
    autoStart = false,
    onDetected,
  } = options;

  const [state, setState] = useState<WakeWordState>("idle");
  const [lastDetection, setLastDetection] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef(false);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  const stop = useCallback(() => {
    activeRef.current = false;
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState("idle");
    log("Stopped");
  }, []);

  const start = useCallback(async () => {
    if (activeRef.current) return;

    // Resolve wake word service URL
    const url = serviceUrl || resolveWakeWordUrl();
    if (!url) {
      log("No wake word service URL configured");
      setState("error");
      return;
    }

    try {
      activeRef.current = true;
      setState("listening");

      // Connect WebSocket to wake word service
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => log("Connected to wake word service");

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          if (data.detected) {
            log(`Detected: ${data.detected} (confidence=${data.confidence})`);
            setLastDetection(data.detected);
            onDetectedRef.current?.(data.detected, data.confidence);
            // Trigger voice session connect
            emitAssistantVoiceControl("connect");
          }
        } catch {
          // ignore non-JSON
        }
      };

      ws.onerror = () => {
        log("WebSocket error");
        setState("error");
      };

      ws.onclose = () => {
        if (activeRef.current) {
          // Reconnect after a delay
          log("Disconnected, reconnecting in 3s...");
          setTimeout(() => {
            if (activeRef.current) void start();
          }, 3000);
        }
      };

      // Wait for WebSocket to open
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve(), { once: true });
        ws.addEventListener("error", () => reject(new Error("WS connect failed")), { once: true });
      });

      // Capture mic audio
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
          channelCount: 1,
        },
      });
      streamRef.current = stream;

      // Set up audio processing pipeline
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);

      // Use ScriptProcessorNode (widely supported) to get raw PCM
      // Buffer size 4096 at 16kHz = 256ms chunks
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!activeRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const inputData = e.inputBuffer.getChannelData(0);
        // Convert Float32 to Int16 PCM (already at 16kHz if AudioContext honored our rate)
        const pcm = resampleTo16kPCM(inputData, audioCtx.sampleRate);
        wsRef.current.send(pcm.buffer);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination); // Required for processing to run

      log(`Listening for wake word via ${url}`);
    } catch (err) {
      log("Failed to start:", err);
      setState("error");
      stop();
    }
  }, [serviceUrl, stop]);

  // Auto-start
  useEffect(() => {
    if (autoStart) {
      void start();
    }
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    state,
    lastDetection,
    start,
    stop,
  };
}

/** Resolve the wake word WebSocket URL from settings or defaults */
function resolveWakeWordUrl(): string | null {
  // Try to use the same hostname as the page (for local network setups)
  // The toolbox runs on port 3101
  const host = window.location.hostname || "localhost";
  return `ws://${host}:3101/ws`;
}
