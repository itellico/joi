// Media system types

export type MediaType = "photo" | "video" | "audio" | "document" | "sticker" | "voice" | "unknown";
export type MediaStatus = "pending" | "downloading" | "ready" | "error" | "deleted";

export interface MediaRecord {
  id: string;
  message_id: string | null;
  conversation_id: string | null;
  channel_type: string | null;
  channel_id: string | null;
  sender_id: string | null;
  media_type: MediaType;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string;
  thumbnail_path: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  status: MediaStatus;
  error_message: string | null;
  caption: string | null;
  created_at: string;
  updated_at: string;
}
