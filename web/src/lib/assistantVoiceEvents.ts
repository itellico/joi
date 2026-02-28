export type AssistantVoiceState = "idle" | "connecting" | "connected";

export type AssistantVoiceControlAction =
  | "connect"
  | "stop"
  | "status"
  | "mute"
  | "unmute"
  | "toggleMute";

export interface AssistantVoiceControlDetail {
  action: AssistantVoiceControlAction;
}

export interface AssistantVoiceStatusDetail {
  state: AssistantVoiceState;
  isMuted: boolean;
  error: string | null;
  isListening: boolean;
}

export const ASSISTANT_VOICE_CONTROL_EVENT = "assistant:voice-control";
export const ASSISTANT_VOICE_STATUS_EVENT = "assistant:voice-status";

export function emitAssistantVoiceControl(action: AssistantVoiceControlAction): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AssistantVoiceControlDetail>(ASSISTANT_VOICE_CONTROL_EVENT, {
      detail: { action },
    }),
  );
}

export function emitAssistantVoiceStatus(status: AssistantVoiceStatusDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AssistantVoiceStatusDetail>(ASSISTANT_VOICE_STATUS_EVENT, {
      detail: status,
    }),
  );
}
