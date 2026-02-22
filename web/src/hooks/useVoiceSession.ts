import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  ConnectionState,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
  type Participant,
  type TrackPublication,
  type TranscriptionSegment,
} from "livekit-client";
import { debugLog as dlog } from "./useDebug";

export type VoiceState = "idle" | "connecting" | "connected";
export type VoiceActivity = "waitingForAgent" | "listening" | "processing" | "agentSpeaking";

export interface VoiceTranscript {
  speaker: "user" | "agent";
  text: string;
  isFinal: boolean;
  segmentId: string;
}

interface UseVoiceSessionOptions {
  conversationId: string | null;
  agentId?: string;
  onFinalTranscript?: (transcript: VoiceTranscript) => void;
  onConversationReady?: (conversationId: string) => void;
}

const log = (...args: unknown[]) => console.log("[voice]", ...args);
const SILENT_MIC_ERROR =
  "No usable microphone audio detected. In Chrome, click the lock icon -> Microphone and choose the correct input device.";
const SILENT_MIC_WARN =
  "Microphone looked silent during startup. Speak now to confirm input is flowing.";
const SILENCE_CONFIRMATION_MS = 2500;
const PREFERRED_MIC_LABEL_RE = /(built[- ]?in|internal|macbook|microphone|mic)/i;
const AVOID_MIC_LABEL_RE = /(blackhole|loopback|virtual|aggregate|obs|soundflower|vb-audio|cable|zoomaudio)/i;

function scoreAudioInput(device: MediaDeviceInfo): number {
  const label = device.label.trim();
  if (!label) {
    return 0;
  }

  let score = 0;
  if (device.deviceId === "default") {
    score += 1;
  }
  if (PREFERRED_MIC_LABEL_RE.test(label)) {
    score += 3;
  }
  if (AVOID_MIC_LABEL_RE.test(label)) {
    score -= 4;
  }
  return score;
}

function formatAudioInput(device: MediaDeviceInfo | undefined): string {
  if (!device) {
    return "unknown device";
  }

  const label = device.label.trim() || "(label hidden)";
  return `${label} [${device.deviceId}]`;
}

function chooseAudioInput(
  devices: MediaDeviceInfo[],
  detectedDeviceId: string | undefined,
): MediaDeviceInfo | undefined {
  if (!devices.length) {
    return undefined;
  }

  const detected = detectedDeviceId ? devices.find((d) => d.deviceId === detectedDeviceId) : undefined;
  const best = [...devices].sort((a, b) => scoreAudioInput(b) - scoreAudioInput(a))[0];

  if (!detected) {
    return best;
  }

  return scoreAudioInput(best) > scoreAudioInput(detected) + 1 ? best : detected;
}

async function sampleMicSignal(stream: MediaStream, durationMs = 400): Promise<{ rms: number; peak: number }> {
  const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) {
    return { rms: 0, peak: 0 };
  }

  const ctx = new Ctx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const data = new Uint8Array(analyser.fftSize);
  const iterations = Math.max(1, Math.floor(durationMs / 50));
  let peak = 0;
  let rmsTotal = 0;

  for (let i = 0; i < iterations; i++) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    analyser.getByteTimeDomainData(data);

    let sumSquares = 0;
    let framePeak = 0;
    for (const value of data) {
      const centered = (value - 128) / 128;
      const abs = Math.abs(centered);
      sumSquares += centered * centered;
      if (abs > framePeak) {
        framePeak = abs;
      }
    }

    const frameRms = Math.sqrt(sumSquares / data.length);
    rmsTotal += frameRms;
    if (framePeak > peak) {
      peak = framePeak;
    }
  }

  source.disconnect();
  analyser.disconnect();
  await ctx.close().catch(() => {});

  return { rms: rmsTotal / iterations, peak };
}

export function useVoiceSession({
  conversationId,
  agentId = "personal",
  onFinalTranscript,
  onConversationReady,
}: UseVoiceSessionOptions) {
  const [state, setState] = useState<VoiceState>("idle");
  const [activity, setActivity] = useState<VoiceActivity>("waitingForAgent");
  const [isMuted, setIsMuted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [agentAudioLevel, setAgentAudioLevel] = useState(0);
  const [interimTranscript, setInterimTranscript] = useState<VoiceTranscript | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addDebug = useCallback((msg: string, level: "info" | "warn" | "error" = "info") => {
    log(msg);
    dlog("voice", msg, level);
  }, []);

  const roomRef = useRef<Room | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const agentAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  const agentJoinedRef = useRef(false);
  const silenceTimerRef = useRef<number | null>(null);
  const heardUserSpeechRef = useRef(false);
  const localMicTrackRef = useRef<MediaStreamTrack | null>(null);
  const isMutedRef = useRef(false);
  const onFinalTranscriptRef = useRef(onFinalTranscript);
  const onConversationReadyRef = useRef(onConversationReady);
  onFinalTranscriptRef.current = onFinalTranscript;
  onConversationReadyRef.current = onConversationReady;

  useEffect(() => {
    isMutedRef.current = isMuted;
    if (audioElRef.current) {
      audioElRef.current.muted = isMuted;
    }
    if (isMuted) {
      setAgentAudioLevel(0);
    }
  }, [isMuted]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const releaseLocalMicTrack = useCallback(() => {
    if (localMicTrackRef.current) {
      localMicTrackRef.current.stop();
      localMicTrackRef.current = null;
    }
  }, []);

  // Audio level monitoring loop
  const startAudioLevelLoop = useCallback(() => {
    const tick = () => {
      if (analyserRef.current) {
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
        setAudioLevel(avg / 255);
      }
      if (agentAnalyserRef.current) {
        const data = new Uint8Array(agentAnalyserRef.current.frequencyBinCount);
        agentAnalyserRef.current.getByteFrequencyData(data);
        const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
        setAgentAudioLevel(avg / 255);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopAudioLevelLoop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  const setupMicAnalyser = useCallback((stream: MediaStream) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;
    log("mic analyser set up");
  }, []);

  const setupAgentAnalyser = useCallback((el: HTMLAudioElement) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    try {
      const source = ctx.createMediaElementSource(el);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      agentAnalyserRef.current = analyser;
      log("agent audio analyser set up");
    } catch {
      // Already connected
    }
  }, []);

  const connect = useCallback(async () => {
    if (roomRef.current) return;

    setState("connecting");
    setActivity("waitingForAgent");
    setError(null);
    agentJoinedRef.current = false;
    heardUserSpeechRef.current = false;
    clearSilenceTimer();

    try {
      let preferredInput: MediaDeviceInfo | undefined;
      let preferredDeviceId: string | undefined;

      // Force mic permission prompt early so failures are explicit and gather device diagnostics.
      let testStream: MediaStream | null = null;
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Browser does not support getUserMedia");
        }

        testStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const probeTrack = testStream.getAudioTracks()[0];
        if (!probeTrack) {
          throw new Error("No microphone track returned by browser");
        }

        const settings = probeTrack.getSettings();
        const detectedDeviceId = typeof settings.deviceId === "string" ? settings.deviceId : undefined;
        const devices = await navigator.mediaDevices
          .enumerateDevices()
          .then((all) => all.filter((d) => d.kind === "audioinput"))
          .catch(() => []);

        preferredInput = chooseAudioInput(devices, detectedDeviceId);
        preferredDeviceId = preferredInput?.deviceId ?? detectedDeviceId;

        addDebug(`Microphone permission granted (${devices.length} input device(s))`);
        if (detectedDeviceId) {
          const detected = devices.find((d) => d.deviceId === detectedDeviceId);
          addDebug(`Browser selected mic: ${formatAudioInput(detected)}`);
        }
        if (preferredInput && preferredInput.deviceId !== detectedDeviceId) {
          addDebug(`Using preferred mic candidate: ${formatAudioInput(preferredInput)}`);
        }

        const signal = await sampleMicSignal(testStream, 450);
        addDebug(`Mic preflight: rms=${signal.rms.toFixed(4)} peak=${signal.peak.toFixed(4)}`);
        if (signal.peak < 0.01) {
          addDebug("Mic preflight is near silent; check Chrome mic input selection", "warn");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Microphone permission denied";
        throw new Error(`Microphone access failed: ${msg}`);
      } finally {
        testStream?.getTracks().forEach((t) => t.stop());
      }

      addDebug("Fetching token...");
      const res = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantName: "user",
          conversationId: conversationId || undefined,
          agentId,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to get token" }));
        throw new Error(err.error || "Failed to get voice token");
      }

      const tokenPayload = await res.json() as {
        serverUrl: string;
        token: string;
        roomName: string;
        conversationId?: string;
      };
      const { serverUrl, token, roomName } = tokenPayload;
      if (tokenPayload.conversationId) {
        onConversationReadyRef.current?.(tokenPayload.conversationId);
      }
      addDebug(`Got token, room: ${roomName}`);

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      roomRef.current = room;

      // ── Connection state changes ──
      room.on(RoomEvent.ConnectionStateChanged, (connectionState: ConnectionState) => {
        addDebug(`Connection: ${connectionState}`);
      });

      room.on(RoomEvent.MediaDevicesError, (deviceErr: Error, kind?: MediaDeviceKind) => {
        const msg = `Media device error${kind ? ` (${kind})` : ""}: ${deviceErr.message}`;
        addDebug(msg, "error");
        setError(msg);
      });

      room.on(RoomEvent.ActiveDeviceChanged, (kind: MediaDeviceKind, deviceId: string) => {
        if (kind === "audioinput") {
          addDebug(`Active mic device changed: ${deviceId}`);
        }
      });

      room.on(RoomEvent.LocalAudioSilenceDetected, () => {
        addDebug(SILENT_MIC_WARN, "warn");
        clearSilenceTimer();
        silenceTimerRef.current = window.setTimeout(() => {
          if (!heardUserSpeechRef.current) {
            addDebug(SILENT_MIC_ERROR, "error");
            setError(SILENT_MIC_ERROR);
          }
        }, SILENCE_CONFIRMATION_MS);
      });

      room.on(RoomEvent.LocalTrackPublished, (pub) => {
        if (pub.source !== Track.Source.Microphone || !pub.track) {
          return;
        }

        const sourceTrack = pub.track.mediaStreamTrack;
        const settings = sourceTrack.getSettings();
        addDebug(
          "Local mic published: "
            + `deviceId=${settings.deviceId || "n/a"}, `
            + `sampleRate=${settings.sampleRate || "n/a"}, `
            + `channels=${settings.channelCount || "n/a"}, `
            + `muted=${sourceTrack.muted}, enabled=${sourceTrack.enabled}`,
        );
      });

      // ── Agent (remote participant) joins ──
      room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
        addDebug(`Participant: ${participant.identity} (isAgent: ${participant.isAgent})`);
        if (!agentJoinedRef.current) {
          agentJoinedRef.current = true;
          setActivity("listening");
          addDebug("Agent joined -> listening");
        }
      });

      room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
        log("participant disconnected:", participant.identity);
      });

      // ── Agent audio track ──
      room.on(
        RoomEvent.TrackSubscribed,
        (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
          addDebug(`Track: ${track.kind} from ${participant.identity} (${pub.source})`);
          if (track.kind === Track.Kind.Audio) {
            const el = track.attach();
            el.style.display = "none";
            el.muted = isMutedRef.current;
            document.body.appendChild(el);
            audioElRef.current = el;
            setupAgentAnalyser(el);
            addDebug("Agent audio attached");
          }
        },
      );

      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        log("track unsubscribed:", track.kind);
        track.detach();
        if (audioElRef.current) {
          audioElRef.current.remove();
          audioElRef.current = null;
        }
        agentAnalyserRef.current = null;
      });

      // ── Transcriptions ──
      room.on(
        RoomEvent.TranscriptionReceived,
        (segments: TranscriptionSegment[], participant?: Participant, _pub?: TrackPublication) => {
          const isAgent = participant !== undefined && participant !== room.localParticipant;
          const speaker: "user" | "agent" = isAgent ? "agent" : "user";

          for (const seg of segments) {
            addDebug(`STT ${speaker} ${seg.final ? "[FINAL]" : "[interim]"}: "${seg.text.slice(0, 60)}"`);
            log("transcription:", speaker, seg.final ? "[final]" : "[interim]", JSON.stringify(seg.text));

            if (speaker === "user" && seg.text.trim().length > 0) {
              heardUserSpeechRef.current = true;
              clearSilenceTimer();
              setError((prev) => (prev === SILENT_MIC_ERROR ? null : prev));
            }

            const transcript: VoiceTranscript = {
              speaker,
              text: seg.text,
              isFinal: seg.final,
              segmentId: seg.id,
            };

            if (seg.final) {
              setInterimTranscript(null);
              onFinalTranscriptRef.current?.(transcript);
            } else {
              setInterimTranscript(transcript);
            }
          }
        },
      );

      // ── Active speakers → activity state ──
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        if (!agentJoinedRef.current) return;
        const agentSpeaking = speakers.some((s) => s !== room.localParticipant);
        if (agentSpeaking) {
          setActivity("agentSpeaking");
        } else {
          setActivity("listening");
        }
      });

      // ── Disconnected ──
      room.on(RoomEvent.Disconnected, (reason) => {
        addDebug(`Disconnected: ${reason}`);
        setState("idle");
        setActivity("waitingForAgent");
        clearSilenceTimer();
        releaseLocalMicTrack();
        stopAudioLevelLoop();
      });

      // ── Connect ──
      log("connecting to room...");
      await room.connect(serverUrl, token);
      addDebug(`Connected! room: ${room.name}, participants: ${room.remoteParticipants.size}`);

      // Check if agent is already in the room
      for (const [, p] of room.remoteParticipants) {
        log("existing participant:", p.identity, "isAgent:", p.isAgent);
        if (!agentJoinedRef.current) {
          agentJoinedRef.current = true;
          setActivity("listening");
        }
      }

      if (preferredDeviceId) {
        try {
          const switched = await room.switchActiveDevice("audioinput", preferredDeviceId, true);
          addDebug(
            `${switched ? "Using mic device" : "Could not switch mic device"}: ${formatAudioInput(preferredInput)}`,
            switched ? "info" : "warn",
          );
        } catch (deviceErr) {
          const msg = deviceErr instanceof Error ? deviceErr.message : String(deviceErr);
          addDebug(`Failed to switch mic device: ${msg}`, "warn");
        }
      }

      // ── Capture and publish mic track explicitly to avoid browser/device ambiguity. ──
      log("capturing microphone track...");
      const explicitCaptureOptions: MediaTrackConstraints = {
        ...(preferredDeviceId ? { deviceId: { exact: preferredDeviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: 48000,
      };
      const localMicStream = await navigator.mediaDevices.getUserMedia({
        audio: explicitCaptureOptions,
      });
      const localMicTrack = localMicStream.getAudioTracks()[0];
      if (!localMicTrack) {
        throw new Error("Browser returned no audio track for explicit mic capture");
      }

      localMicTrackRef.current = localMicTrack;
      await room.localParticipant.publishTrack(localMicTrack, { source: Track.Source.Microphone });
      addDebug("Microphone track published (explicit capture)");

      const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (micPub) {
        addDebug(
          `Mic publication: source=${micPub.source}, muted=${micPub.isMuted}, trackSid=${micPub.trackSid || "n/a"}`,
        );
        if (micPub.track) {
          const sourceTrack = micPub.track.mediaStreamTrack;
          const settings = sourceTrack.getSettings();
          addDebug(
            "Mic source settings: "
              + `deviceId=${settings.deviceId || "n/a"}, `
              + `sampleRate=${settings.sampleRate || "n/a"}, `
              + `channels=${settings.channelCount || "n/a"}, `
              + `muted=${sourceTrack.muted}, enabled=${sourceTrack.enabled}`,
          );
        }
      } else {
        addDebug("Mic publication missing after explicit publish", "error");
      }
      if (isMutedRef.current && micPub?.track) {
        await micPub.track.mute().catch(() => {});
        addDebug("Applied saved mute state to microphone");
      }

      if (micPub?.track?.mediaStream) {
        setupMicAnalyser(micPub.track.mediaStream);
        addDebug("Mic media stream attached");
        const postPublishSignal = await sampleMicSignal(micPub.track.mediaStream, 700);
        addDebug(`Mic post-publish: rms=${postPublishSignal.rms.toFixed(4)} peak=${postPublishSignal.peak.toFixed(4)}`);
        if (postPublishSignal.peak >= 0.01) {
          heardUserSpeechRef.current = true;
          clearSilenceTimer();
        }
      } else {
        const warning = "No mic mediaStream available after enabling microphone";
        log(`WARNING: ${warning}`);
        addDebug(warning, "error");
      }

      setState("connected");
      startAudioLevelLoop();
      addDebug("Voice session ready");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Voice connection failed";
      addDebug(msg, "error");
      setError(msg);
      setState("idle");
      clearSilenceTimer();
      releaseLocalMicTrack();
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
    }
  }, [conversationId, agentId, addDebug, clearSilenceTimer, releaseLocalMicTrack, setupMicAnalyser, setupAgentAnalyser, startAudioLevelLoop, stopAudioLevelLoop]);

  const disconnect = useCallback(() => {
    log("disconnecting...");
    stopAudioLevelLoop();
    clearSilenceTimer();
    heardUserSpeechRef.current = false;
    releaseLocalMicTrack();

    if (audioElRef.current) {
      audioElRef.current.remove();
      audioElRef.current = null;
    }

    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }

    analyserRef.current = null;
    agentAnalyserRef.current = null;
    agentJoinedRef.current = false;

    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }

    setState("idle");
    setActivity("waitingForAgent");
    setAudioLevel(0);
    setAgentAudioLevel(0);
    setInterimTranscript(null);
    setIsMuted(false);
    setError(null);
  }, [clearSilenceTimer, releaseLocalMicTrack, stopAudioLevelLoop]);

  const toggleMute = useCallback(async () => {
    if (!roomRef.current) return;
    const newMuted = !isMutedRef.current;
    const micPub = roomRef.current.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (!micPub?.track) {
      addDebug("Cannot toggle mic track mute: no local mic publication", "warn");
    } else {
      try {
        if (newMuted) {
          await micPub.track.mute();
        } else {
          await micPub.track.unmute();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addDebug(`Mic mute toggle failed: ${msg}`, "warn");
      }
    }
    if (audioElRef.current) {
      audioElRef.current.muted = newMuted;
    }
    setIsMuted(newMuted);
    if (newMuted) {
      setAudioLevel(0);
      setAgentAudioLevel(0);
      setInterimTranscript(null);
    }
    log("global muted:", newMuted);
  }, [addDebug]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
      clearSilenceTimer();
      releaseLocalMicTrack();
    };
  }, [clearSilenceTimer, releaseLocalMicTrack]);

  return {
    state,
    activity,
    isMuted,
    audioLevel,
    agentAudioLevel,
    interimTranscript,
    error,
    connect,
    disconnect,
    toggleMute,
  };
}
