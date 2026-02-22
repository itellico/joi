// Channel adapter types

export type ChannelType = "whatsapp" | "telegram" | "imessage" | "email" | "slack" | "discord" | "notion";

export type ChannelStatus = "disconnected" | "connecting" | "connected" | "error" | "awaiting_code" | "awaiting_2fa";

export interface ChannelAttachment {
  type: "photo" | "video" | "audio" | "document" | "sticker" | "voice" | "unknown";
  filename?: string;
  mimeType?: string;
  size?: number;
}

export interface ChannelMessage {
  channelId: string;
  channelType: ChannelType;
  senderId: string;
  senderName?: string;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
  attachments?: ChannelAttachment[];
}

export interface ChannelStatusInfo {
  channelId: string;
  channelType: ChannelType;
  status: ChannelStatus;
  displayName?: string;
  error?: string;
  connectedAt?: Date;
}

export interface ChannelConfig {
  id: string;
  channel_type: ChannelType;
  config: Record<string, unknown>;
  enabled: boolean;
  status: ChannelStatus;
  display_name?: string;
  error_message?: string;
  last_connected_at?: Date;
  scope?: string;
  scope_metadata?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface ChannelAdapter {
  readonly channelType: ChannelType;
  readonly channelId: string;

  connect(config: Record<string, unknown>): Promise<void>;
  disconnect(): Promise<void>;
  send(to: string, content: string): Promise<void>;
  getStatus(): ChannelStatusInfo;

  // Optional: scan historical messages from this channel
  scanHistory?(since: Date): Promise<ChannelMessage[]>;

  // Callbacks — set by ChannelManager before connect()
  onMessage: ((msg: ChannelMessage) => void) | null;
  onStatusChange: ((status: ChannelStatusInfo) => void) | null;
  onQrCode: ((qrDataUrl: string) => void) | null;
}
