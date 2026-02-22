// Notification Dispatcher
// Intercepts broadcast events and forwards important ones as push notifications
// WebSocket = foreground (already working), APNs = background (this module)

import { pushToAllDevices, isAPNsConfigured } from "./apns.js";
import { query } from "../db/client.js";

interface NotificationEvent {
  type: string;
  data: unknown;
}

// Event types that warrant a push notification
const PUSH_EVENTS: Record<string, (data: any) => { title: string; body: string; threadId?: string; collapseId?: string } | null> = {
  "review.created": (data) => ({
    title: "New Review Item",
    body: data.title || data.summary?.slice(0, 100) || "An agent submitted something for your review",
    threadId: "reviews",
    collapseId: "review-" + (data.id ?? "new"),
  }),

  "channel.message": (data) => {
    // Only push for inbound messages (not messages we sent)
    if (data.direction === "outbound") return null;
    const sender = data.contactName || data.from || "Unknown";
    return {
      title: `Message from ${sender}`,
      body: data.text?.slice(0, 200) || "New message",
      threadId: `channel-${data.channelId ?? "default"}`,
    };
  },

  "chat.done": (data) => {
    // Only push if it's from a cron/background agent (no active WS client)
    if (!data._background) return null;
    return {
      title: "Agent completed",
      body: data.content?.slice(0, 200) || "Background task finished",
      threadId: `chat-${data.conversationId ?? "default"}`,
    };
  },
};

// Wrap the existing broadcast function to also dispatch push notifications
export function createPushDispatcher(
  originalBroadcast: (type: string, data: unknown) => void,
): (type: string, data: unknown) => void {
  return (type: string, data: unknown) => {
    // Always do the WebSocket broadcast
    originalBroadcast(type, data);

    // Check if this event type should trigger a push
    if (!isAPNsConfigured()) return;

    const handler = PUSH_EVENTS[type];
    if (!handler) return;

    const notification = handler(data);
    if (!notification) return;

    // Fire-and-forget push
    pushToAllDevices(
      {
        _eventType: type,
        aps: {
          alert: {
            title: notification.title,
            body: notification.body,
          },
          sound: "default",
          "thread-id": notification.threadId,
          "interruption-level": "active",
          "mutable-content": 1,
        },
        // Custom data for the app to handle
        joiEvent: type,
        joiData: data,
      } as any,
      { collapseId: notification.collapseId },
    ).catch((err) => {
      console.error("[Push] Dispatch failed:", err);
    });
  };
}

// Get recent notification history
export async function getNotificationLog(limit = 50): Promise<unknown[]> {
  const result = await query(
    "SELECT * FROM notification_log ORDER BY created_at DESC LIMIT $1",
    [limit],
  );
  return result.rows;
}

// Get registered device count
export async function getDeviceCount(): Promise<number> {
  const result = await query<{ count: number }>(
    "SELECT count(*)::int AS count FROM push_tokens WHERE enabled = true",
  );
  return result.rows[0]?.count ?? 0;
}
