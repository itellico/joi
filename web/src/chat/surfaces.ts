import type { ChatExecutionMode, ChatLatencyPreset } from "./simulation";

export type ChatSurfaceId = "main" | "assistant" | "task_widget";

export interface ChatSurfaceProfile {
  id: ChatSurfaceId;
  label: string;
  agentId: string;
  modeLock?: "api" | "claude-code";
  defaultExecutionMode: ChatExecutionMode;
  defaultLatencyPreset: ChatLatencyPreset;
  qaCaptureDefault: boolean;
  qaAutoCaptureDefault: boolean;
  showSimulationControls: boolean;
  showQaControls: boolean;
  showQaPerMessageActions: boolean;
}

export const CHAT_SURFACE_PROFILES: Record<ChatSurfaceId, ChatSurfaceProfile> = {
  main: {
    id: "main",
    label: "Main Chat",
    agentId: "personal",
    defaultExecutionMode: "live",
    defaultLatencyPreset: "none",
    qaCaptureDefault: true,
    qaAutoCaptureDefault: true,
    showSimulationControls: false,
    showQaControls: true,
    showQaPerMessageActions: true,
  },
  assistant: {
    id: "assistant",
    label: "Assistant Bubble",
    agentId: "personal",
    defaultExecutionMode: "live",
    defaultLatencyPreset: "none",
    qaCaptureDefault: false,
    qaAutoCaptureDefault: false,
    showSimulationControls: false,
    showQaControls: false,
    showQaPerMessageActions: false,
  },
  task_widget: {
    id: "task_widget",
    label: "Task Coder",
    agentId: "coder",
    modeLock: "claude-code",
    defaultExecutionMode: "live",
    defaultLatencyPreset: "none",
    qaCaptureDefault: false,
    qaAutoCaptureDefault: false,
    showSimulationControls: false,
    showQaControls: false,
    showQaPerMessageActions: false,
  },
};
