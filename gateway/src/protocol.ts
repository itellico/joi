// JOI Gateway WebSocket Protocol
// Simplified from OpenClaw's frame system

export type FrameType =
  | "chat.send"         // Client → Gateway: send user message
  | "chat.stream"       // Gateway → Client: streaming token
  | "chat.done"         // Gateway → Client: stream complete
  | "chat.error"        // Gateway → Client: error
  | "chat.plan"         // Gateway → Client: planned checklist steps for current turn
  | "chat.tool_use"     // Gateway → Client: tool call in progress
  | "chat.tool_result"  // Gateway → Client: tool call result
  | "chat.interrupt"    // Client → Gateway: voice interruption (truncate stored message)
  | "chat.routed"       // Gateway → Client: intent router selected an agent
  | "chat.agent_spawn"  // Gateway → Client: spawn_agent delegation started
  | "chat.agent_result" // Gateway → Client: spawned agent completed
  | "session.list"      // Client → Gateway: list sessions
  | "session.load"      // Client → Gateway: load session history
  | "session.create"    // Client → Gateway: create new session
  | "session.data"      // Gateway → Client: session data response
  | "agent.list"        // Client → Gateway: list agents
  | "agent.data"        // Gateway → Client: agents data
  | "pty.spawn"         // Client → Gateway: spawn Claude Code terminal
  | "pty.input"         // Client → Gateway: send keystrokes to PTY
  | "pty.output"        // Gateway → Client: terminal output data
  | "pty.resize"        // Client → Gateway: resize terminal
  | "pty.kill"          // Client → Gateway: kill PTY session
  | "pty.list"          // Client → Gateway: list active sessions
  | "pty.data"          // Gateway → Client: PTY response data
  | "pty.exit"          // Gateway → Client: PTY session exited
  | "log.entry"         // Gateway → Client: real-time log entry
  | "review.created"    // Gateway → Client: new review item
  | "review.resolved"   // Gateway → Client: review item resolved
  | "review.resolve"    // Client → Gateway: resolve a review item
  | "google.status"     // Gateway → Client: Google account status change
  | "channel.status"    // Gateway → Client: channel connection status
  | "channel.qr"        // Gateway → Client: QR code for WhatsApp auth
  | "channel.message"   // Gateway → Client: inbound/outbound message
  | "notification.push"  // Gateway → Client: push notification event
  | "system.status"     // Gateway → Client: system status
  | "autodev.pause"      // Client → Gateway: pause auto developer
  | "autodev.resume"     // Client → Gateway: resume auto developer
  | "autodev.stop-current" // Client → Gateway: abort current task
  | "autodev.status"     // Gateway → Client: status update
  | "autodev.log"        // Gateway → Client: streaming log output
  | "autodev.task_complete" // Gateway → Client: task completed
  | "autodev.error"      // Gateway → Client: error
  | "autodev.worker_hello" // Worker → Gateway: initial sync on connect
  | "qa.run_started"    // Gateway → Client: QA test run started
  | "qa.case_result"    // Gateway → Client: individual test case result
  | "qa.run_completed"  // Gateway → Client: QA test run finished
  | "qa.issue_created"  // Gateway → Client: new QA issue created
  | "system.ping"       // Client → Gateway: keepalive
  | "system.pong";      // Gateway → Client: keepalive response

export interface Frame {
  type: FrameType;
  id?: string;         // Request ID for req/res pairing
  data?: unknown;
  error?: string;
}

// Chat frames
export interface ChatSendData {
  conversationId?: string;
  agentId?: string;
  content: string;
  model?: string;  // Client-requested model override (e.g. "claude-sonnet-4-20250514" or "anthropic/claude-sonnet-4")
  mode?: "api" | "claude-code";  // api = OpenRouter/Anthropic, claude-code = CLI
  proactive?: boolean;  // True when AI initiates conversation after idle period
  attachments?: Array<{
    type: string;
    url?: string;
    data?: string;
    name?: string;
  }>;
  metadata?: Record<string, unknown>;
}

export interface ChatStreamData {
  conversationId: string;
  messageId: string;
  delta: string;     // Incremental text chunk
  model?: string;
}

export interface ChatDoneData {
  conversationId: string;
  messageId: string;
  content: string;
  model: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  agentId?: string;
  agentName?: string;
  routeReason?: string;
  routeConfidence?: number;
  delegations?: Array<{
    delegationId?: string;
    agentId: string;
    task: string;
    durationMs: number;
    status: "success" | "error";
  }>;
  cacheStats?: {
    cacheReadTokens: number;
    cacheWriteTokens: number;
    cacheHitPercent: number;
  };
}

export interface ChatRoutedData {
  conversationId: string;
  agentId: string;
  agentName?: string;
  reason: string;
  confidence: number;
  matchedPattern?: string;
}

export interface ChatAgentSpawnData {
  conversationId: string;
  delegationId?: string;
  parentAgentId: string;
  childAgentId: string;
  task: string;
}

export interface ChatAgentResultData {
  conversationId: string;
  delegationId?: string;
  childAgentId: string;
  status: "success" | "error";
  durationMs: number;
}

export interface ChatToolUseData {
  conversationId: string;
  messageId: string;
  toolName: string;
  toolInput: unknown;
  toolUseId: string;
}

export interface ChatToolResultData {
  conversationId: string;
  messageId: string;
  toolUseId: string;
  result: unknown;
}

export interface ChatPlanData {
  conversationId: string;
  steps: string[];
}

export interface SessionListData {
  sessions: Array<{
    id: string;
    title: string | null;
    agentId: string;
    messageCount: number;
    lastMessage: string | null;
    updatedAt: string;
  }>;
}

export interface SessionLoadData {
  conversationId: string;
}

export interface SessionHistoryData {
  conversationId: string;
  messages: Array<{
    id: string;
    role: string;
    content: string | null;
    toolCalls?: unknown;
    toolResults?: unknown;
    model?: string;
    createdAt: string;
  }>;
}

// PTY frames
export interface PtySpawnData {
  sessionId?: string;     // Optional: reattach to existing session
  cwd?: string;           // Working directory (default: $HOME)
  cols?: number;
  rows?: number;
}

export interface PtyInputData {
  sessionId: string;
  data: string;           // Raw keystrokes
}

export interface PtyResizeData {
  sessionId: string;
  cols: number;
  rows: number;
}

export interface PtyKillData {
  sessionId: string;
}

// AutoDev frames
export interface AutoDevStartData {
  projectUuid: string;
}

export interface AutoDevStatusData {
  state: "waiting" | "picking" | "working" | "completing";
  projectUuid: string | null;
  projectTitle: string | null;
  currentTask: { uuid: string; title: string } | null;
  executorMode?: "auto" | "claude-code" | "gemini-cli" | "codex-cli";
  parallelExecution?: boolean;
  currentExecutor?: "claude-code" | "gemini-cli" | "codex-cli" | null;
  activeExecutors?: Array<"claude-code" | "gemini-cli" | "codex-cli">;
  executorStates?: Partial<Record<"claude-code" | "gemini-cli" | "codex-cli", "idle" | "running" | "success" | "error">>;
  currentAgentId?: string | null;
  currentSkill?: string | null;
  currentRouteReason?: string | null;
  completedCount: number;
  queue: Array<{ uuid: string; title: string }>;
}

export interface AutoDevLogData {
  delta: string;
  taskUuid?: string;
  full?: boolean;  // true = full log sync on reconnect
}

export interface AutoDevTaskCompleteData {
  taskUuid: string;
  taskTitle: string;
  summary: string;
  completedCount: number;
}

export interface AutoDevErrorData {
  error: string;
  taskUuid?: string;
}

// Helper to create frames
export function frame(type: FrameType, data?: unknown, id?: string): string {
  const f: Frame = { type };
  if (data !== undefined) f.data = data;
  if (id !== undefined) f.id = id;
  return JSON.stringify(f);
}

export function parseFrame(raw: string): Frame | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.type !== "string") return null;
    return parsed as Frame;
  } catch {
    return null;
  }
}
