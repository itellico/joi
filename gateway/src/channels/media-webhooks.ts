// Webhook receiver for media + generic webhook channels.
// Converts webhook payloads into inbound channel messages so they are persisted,
// triaged, and visible in JOI just like other channel activity.

import crypto from "node:crypto";
import { Router, type Request } from "express";
import { query } from "../db/client.js";
import { routeInboundMessage } from "./router.js";
import type { ChannelMessage, ChannelType } from "./types.js";
import type { JoiConfig } from "../config/schema.js";

type WebhookChannelType = Extract<ChannelType, "emby" | "jellyseerr" | "webhook">;
type ActivityProvider = "emby" | "jellyseerr" | "webhook";
type ActivityStatus = "accepted" | "rejected" | "route_error";

const WEBHOOK_ACTIVITY_MAX_ENTRIES = 600;

export interface MediaWebhookActivityEvent {
  id: string;
  timestamp: string;
  provider: ActivityProvider;
  channelId: string;
  channelType: WebhookChannelType;
  channelName: string | null;
  status: ActivityStatus;
  event: string;
  summary: string;
}

interface MediaWebhookActivityQuery {
  provider?: string;
  channelId?: string;
  limit?: number;
}

interface ChannelRow {
  id: string;
  channel_type: WebhookChannelType;
  display_name: string | null;
  enabled: boolean;
  config: Record<string, unknown> | null;
}

const mediaWebhookActivityLog: MediaWebhookActivityEvent[] = [];

function recordMediaWebhookActivityEvent(event: MediaWebhookActivityEvent): void {
  mediaWebhookActivityLog.unshift(event);
  if (mediaWebhookActivityLog.length > WEBHOOK_ACTIVITY_MAX_ENTRIES) {
    mediaWebhookActivityLog.length = WEBHOOK_ACTIVITY_MAX_ENTRIES;
  }
}

function createActivityEvent(params: {
  provider: ActivityProvider;
  requestedChannelId: string;
  channel?: ChannelRow | null;
  status: ActivityStatus;
  event?: string;
  summary?: string;
}): MediaWebhookActivityEvent {
  const channelType = params.channel?.channel_type || params.provider;
  const eventName = (params.event || "unknown").trim() || "unknown";
  const summary = shorten((params.summary || "").trim() || eventName, 320);

  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    provider: params.provider,
    channelId: params.channel?.id || params.requestedChannelId,
    channelType,
    channelName: params.channel?.display_name || null,
    status: params.status,
    event: eventName,
    summary,
  };
}

function recordActivity(params: {
  provider: ActivityProvider;
  requestedChannelId: string;
  channel?: ChannelRow | null;
  status: ActivityStatus;
  event?: string;
  summary?: string;
}): void {
  recordMediaWebhookActivityEvent(createActivityEvent(params));
}

export function getMediaWebhookActivity(query: MediaWebhookActivityQuery = {}): MediaWebhookActivityEvent[] {
  const limitRaw = Number(query.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(200, Math.trunc(limitRaw)))
    : 30;

  const provider = asString(query.provider)?.toLowerCase();
  const channelId = asString(query.channelId);

  return mediaWebhookActivityLog
    .filter((item) => {
      if (provider && provider !== "all" && item.provider !== provider) return false;
      if (channelId && item.channelId !== channelId) return false;
      return true;
    })
    .slice(0, limit)
    .map((item) => ({ ...item }));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asText(value: unknown): string | undefined {
  if (typeof value === "string") return asString(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return undefined;
}

function getByPath(payload: Record<string, unknown>, path: string | undefined): unknown {
  if (!path) return undefined;
  const parts = path
    .split(".")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return undefined;

  let cursor: unknown = payload;
  for (const part of parts) {
    const record = asRecord(cursor);
    if (!record) return undefined;
    cursor = record[part];
  }
  return cursor;
}

function firstText(values: unknown[]): string | undefined {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return undefined;
}

function shorten(text: string, maxChars = 2000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

function parseSender(senderValue: unknown): { id?: string; name?: string } {
  const direct = asText(senderValue);
  if (direct) return { id: direct, name: direct };

  const sender = asRecord(senderValue);
  if (!sender) return {};

  const name =
    asText(sender.name) ||
    asText(sender.username) ||
    asText(sender.displayName) ||
    asText(sender.email) ||
    asText(sender.id);

  const id =
    asText(sender.id) ||
    asText(sender.email) ||
    asText(sender.username) ||
    name;

  return { id, name: name || id };
}

function getWebhookSecret(config: Record<string, unknown> | null): string | undefined {
  if (!config) return undefined;
  return asString(config.webhookSecret ?? config.webhookToken ?? config.secret);
}

function getProvidedSecret(req: Request): string | undefined {
  const fromQuery = asString(req.query.secret);
  if (fromQuery) return fromQuery;

  const fromHeader =
    asString(req.headers["x-joi-webhook-secret"]) ||
    asString(req.headers["x-webhook-secret"]);
  if (fromHeader) return fromHeader;

  const auth = asString(req.headers.authorization);
  if (auth?.startsWith("Bearer ")) {
    return asString(auth.slice(7));
  }

  return undefined;
}

function secretMatches(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

async function loadChannel(
  channelId: string,
  type: WebhookChannelType,
): Promise<ChannelRow | null> {
  const result = await query<ChannelRow>(
    `SELECT id, channel_type, display_name, enabled, config
       FROM channel_configs
      WHERE id = $1 AND channel_type = $2
      LIMIT 1`,
    [channelId, type],
  );
  return result.rows[0] || null;
}

function findNestedRecord(
  payload: Record<string, unknown>,
  directKey: string,
  fallbackMatcher: (candidate: Record<string, unknown>, key: string) => boolean,
): Record<string, unknown> | null {
  const direct = asRecord(payload[directKey]);
  if (direct) return direct;

  for (const [key, value] of Object.entries(payload)) {
    const candidate = asRecord(value);
    if (!candidate) continue;
    if (fallbackMatcher(candidate, key)) return candidate;
  }

  return null;
}

function buildJellyseerrMessage(row: ChannelRow, body: unknown): ChannelMessage {
  const payload = asRecord(body) || {};
  const event = asString(payload.event) || asString(payload.notification_type) || "unknown";
  const subject = asString(payload.subject);
  const message = asString(payload.message);

  const media = findNestedRecord(payload, "media", (candidate, key) => {
    const lower = key.toLowerCase();
    return lower.includes("media") || candidate.tmdbId !== undefined || candidate.media_type !== undefined;
  });
  const request = findNestedRecord(payload, "request", (candidate, key) => {
    const lower = key.toLowerCase();
    return lower.includes("request") || candidate.request_id !== undefined;
  });
  const issue = findNestedRecord(payload, "issue", (candidate, key) => {
    const lower = key.toLowerCase();
    return lower.includes("issue") || candidate.issue_id !== undefined;
  });
  const comment = findNestedRecord(payload, "comment", (candidate, key) => {
    const lower = key.toLowerCase();
    return lower.includes("comment") || candidate.comment_message !== undefined;
  });

  const requestedBy = asString(request?.requestedBy_username) || asString(request?.requestedBy_email);
  const reportedBy = asString(issue?.reportedBy_username) || asString(issue?.reportedBy_email);
  const commentedBy = asString(comment?.commentedBy_username) || asString(comment?.commentedBy_email);
  const senderName = requestedBy || reportedBy || commentedBy || row.display_name || "Jellyseerr";

  const senderId =
    asString(request?.requestedBy_email) ||
    asString(issue?.reportedBy_email) ||
    asString(comment?.commentedBy_email) ||
    senderName;

  const requestId = asString(request?.request_id);
  const mediaType = asString(media?.media_type) || asString(media?.mediaType);
  const tmdbId = asString(media?.tmdbId) || asString(media?.tmdbid);

  const contentParts: string[] = [];
  contentParts.push(`[Jellyseerr] ${subject || event}`);
  if (message) contentParts.push(message);
  if (requestId) contentParts.push(`request #${requestId}`);
  if (mediaType || tmdbId) {
    const mediaDetails = [mediaType, tmdbId ? `tmdb:${tmdbId}` : null]
      .filter((part): part is string => Boolean(part))
      .join(" ");
    if (mediaDetails) contentParts.push(mediaDetails);
  }

  return {
    channelId: row.id,
    channelType: "jellyseerr",
    senderId,
    senderName,
    content: contentParts.join(" — "),
    timestamp: new Date(),
    metadata: {
      source: "webhook",
      provider: "jellyseerr",
      event,
      subject: subject || null,
      requestId: requestId || null,
      mediaType: mediaType || null,
      tmdbId: tmdbId || null,
      payload,
    },
  };
}

function buildEmbyMessage(row: ChannelRow, body: unknown): ChannelMessage {
  const payload = asRecord(body) || {};
  const event =
    asString(payload.Event) ||
    asString(payload.event) ||
    asString(payload.NotificationType) ||
    asString(payload.notification_type) ||
    asString(payload.Type) ||
    asString(payload.type) ||
    "unknown";

  const item = findNestedRecord(payload, "Item", (candidate, key) => {
    const lower = key.toLowerCase();
    return lower.includes("item") || candidate.Name !== undefined || candidate.Type !== undefined;
  });
  const user = findNestedRecord(payload, "User", (candidate, key) => {
    const lower = key.toLowerCase();
    return lower.includes("user") || candidate.Name !== undefined || candidate.Email !== undefined;
  });

  const itemName = asString(item?.Name) || asString(item?.name);
  const itemType = asString(item?.Type) || asString(item?.type);
  const message =
    asString(payload.Message) ||
    asString(payload.message) ||
    asString(payload.Description) ||
    asString(payload.description);

  const senderName = asString(user?.Name) || asString(user?.name) || row.display_name || "Emby";
  const senderId =
    asString(user?.Id) ||
    asString(user?.id) ||
    asString(user?.Email) ||
    asString(user?.email) ||
    senderName;

  const contentParts: string[] = [];
  contentParts.push(`[Emby] ${event}`);
  if (itemName) contentParts.push(itemName);
  if (itemType) contentParts.push(itemType);
  if (message) contentParts.push(message);

  return {
    channelId: row.id,
    channelType: "emby",
    senderId,
    senderName,
    content: contentParts.join(" — "),
    timestamp: new Date(),
    metadata: {
      source: "webhook",
      provider: "emby",
      event,
      itemName: itemName || null,
      itemType: itemType || null,
      payload,
    },
  };
}

function buildGenericWebhookMessage(row: ChannelRow, body: unknown): ChannelMessage {
  const payload = asRecord(body) || { raw: body };
  const channelConfig = row.config || {};

  const sourceLabel = asString(channelConfig.sourceLabel) || row.display_name || "Webhook";
  const eventPath = asString(channelConfig.eventPath);
  const messagePath = asString(channelConfig.messagePath);
  const senderPath = asString(channelConfig.senderPath);

  const event =
    firstText([
      getByPath(payload, eventPath),
      payload.event,
      payload.type,
      payload.action,
      payload.notification_type,
      payload.trigger,
    ]) || "event";

  const message =
    firstText([
      getByPath(payload, messagePath),
      payload.message,
      payload.text,
      payload.subject,
      payload.title,
      payload.description,
      payload.summary,
      payload.details,
    ]) || null;

  const senderValue =
    (senderPath ? getByPath(payload, senderPath) : undefined) ??
    payload.sender ??
    payload.from ??
    payload.user ??
    payload.actor ??
    payload.username ??
    payload.email;

  const sender = parseSender(senderValue);
  const senderName = sender.name || sourceLabel;
  const senderId = sender.id || senderName || row.id;

  const contentParts: string[] = [];
  contentParts.push(`[${sourceLabel}] ${event}`);
  if (message) {
    contentParts.push(message);
  } else {
    const keys = Object.keys(payload).slice(0, 6);
    contentParts.push(
      keys.length > 0 ? `payload keys: ${keys.join(", ")}` : "payload received",
    );
  }

  return {
    channelId: row.id,
    channelType: "webhook",
    senderId,
    senderName,
    content: shorten(contentParts.join(" — ")),
    timestamp: new Date(),
    metadata: {
      source: "webhook",
      provider: "generic-webhook",
      sourceLabel,
      event,
      payload,
    },
  };
}

function validateSecret(req: Request, row: ChannelRow): { ok: true } | { ok: false; status: number; error: string } {
  const expected = getWebhookSecret(row.config);
  if (!expected) {
    return {
      ok: false,
      status: 412,
      error: "Webhook secret is not configured for this channel. Set config.webhookSecret first.",
    };
  }

  const provided = getProvidedSecret(req);
  if (!secretMatches(expected, provided)) {
    return { ok: false, status: 401, error: "Invalid webhook secret" };
  }

  return { ok: true };
}

export function createMediaWebhookRouter(config: JoiConfig): Router {
  const router = Router();

  router.post("/jellyseerr/:channelId", async (req, res) => {
    try {
      const channel = await loadChannel(req.params.channelId, "jellyseerr");
      if (!channel || !channel.enabled) {
        recordActivity({
          provider: "jellyseerr",
          requestedChannelId: req.params.channelId,
          channel,
          status: "rejected",
          event: "channel_not_found",
          summary: "Jellyseerr channel not found or disabled",
        });
        res.status(404).json({ error: "Jellyseerr channel not found or disabled" });
        return;
      }

      const check = validateSecret(req, channel);
      if (!check.ok) {
        recordActivity({
          provider: "jellyseerr",
          requestedChannelId: req.params.channelId,
          channel,
          status: "rejected",
          event: "auth_failed",
          summary: check.error,
        });
        res.status(check.status).json({ error: check.error });
        return;
      }

      res.status(200).json({ ok: true });

      const message = buildJellyseerrMessage(channel, req.body);
      const metadata = asRecord(message.metadata);
      const event = asString(metadata?.event) || "unknown";
      recordActivity({
        provider: "jellyseerr",
        requestedChannelId: req.params.channelId,
        channel,
        status: "accepted",
        event,
        summary: asString(message.content) || event,
      });
      routeInboundMessage(message, config).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        recordActivity({
          provider: "jellyseerr",
          requestedChannelId: req.params.channelId,
          channel,
          status: "route_error",
          event,
          summary: msg,
        });
        console.error(`[Webhook:jellyseerr] Failed to route message for ${channel.id}:`, msg);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordActivity({
        provider: "jellyseerr",
        requestedChannelId: req.params.channelId,
        status: "route_error",
        event: "handler_error",
        summary: message,
      });
      res.status(500).json({ error: message });
    }
  });

  router.post("/emby/:channelId", async (req, res) => {
    try {
      const channel = await loadChannel(req.params.channelId, "emby");
      if (!channel || !channel.enabled) {
        recordActivity({
          provider: "emby",
          requestedChannelId: req.params.channelId,
          channel,
          status: "rejected",
          event: "channel_not_found",
          summary: "Emby channel not found or disabled",
        });
        res.status(404).json({ error: "Emby channel not found or disabled" });
        return;
      }

      const check = validateSecret(req, channel);
      if (!check.ok) {
        recordActivity({
          provider: "emby",
          requestedChannelId: req.params.channelId,
          channel,
          status: "rejected",
          event: "auth_failed",
          summary: check.error,
        });
        res.status(check.status).json({ error: check.error });
        return;
      }

      res.status(200).json({ ok: true });

      const message = buildEmbyMessage(channel, req.body);
      const metadata = asRecord(message.metadata);
      const event = asString(metadata?.event) || "unknown";
      recordActivity({
        provider: "emby",
        requestedChannelId: req.params.channelId,
        channel,
        status: "accepted",
        event,
        summary: asString(message.content) || event,
      });
      routeInboundMessage(message, config).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        recordActivity({
          provider: "emby",
          requestedChannelId: req.params.channelId,
          channel,
          status: "route_error",
          event,
          summary: msg,
        });
        console.error(`[Webhook:emby] Failed to route message for ${channel.id}:`, msg);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordActivity({
        provider: "emby",
        requestedChannelId: req.params.channelId,
        status: "route_error",
        event: "handler_error",
        summary: message,
      });
      res.status(500).json({ error: message });
    }
  });

  router.post("/inbound/:channelId", async (req, res) => {
    try {
      const channel = await loadChannel(req.params.channelId, "webhook");
      if (!channel || !channel.enabled) {
        recordActivity({
          provider: "webhook",
          requestedChannelId: req.params.channelId,
          channel,
          status: "rejected",
          event: "channel_not_found",
          summary: "Webhook channel not found or disabled",
        });
        res.status(404).json({ error: "Webhook channel not found or disabled" });
        return;
      }

      const check = validateSecret(req, channel);
      if (!check.ok) {
        recordActivity({
          provider: "webhook",
          requestedChannelId: req.params.channelId,
          channel,
          status: "rejected",
          event: "auth_failed",
          summary: check.error,
        });
        res.status(check.status).json({ error: check.error });
        return;
      }

      res.status(200).json({ ok: true });

      const message = buildGenericWebhookMessage(channel, req.body);
      const metadata = asRecord(message.metadata);
      const event = asString(metadata?.event) || "unknown";
      recordActivity({
        provider: "webhook",
        requestedChannelId: req.params.channelId,
        channel,
        status: "accepted",
        event,
        summary: asString(message.content) || event,
      });
      routeInboundMessage(message, config).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        recordActivity({
          provider: "webhook",
          requestedChannelId: req.params.channelId,
          channel,
          status: "route_error",
          event,
          summary: msg,
        });
        console.error(`[Webhook:inbound] Failed to route message for ${channel.id}:`, msg);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordActivity({
        provider: "webhook",
        requestedChannelId: req.params.channelId,
        status: "route_error",
        event: "handler_error",
        summary: message,
      });
      res.status(500).json({ error: message });
    }
  });

  // Alias for convenience.
  router.post("/generic/:channelId", async (req, res) => {
    try {
      const channel = await loadChannel(req.params.channelId, "webhook");
      if (!channel || !channel.enabled) {
        recordActivity({
          provider: "webhook",
          requestedChannelId: req.params.channelId,
          channel,
          status: "rejected",
          event: "channel_not_found",
          summary: "Webhook channel not found or disabled",
        });
        res.status(404).json({ error: "Webhook channel not found or disabled" });
        return;
      }

      const check = validateSecret(req, channel);
      if (!check.ok) {
        recordActivity({
          provider: "webhook",
          requestedChannelId: req.params.channelId,
          channel,
          status: "rejected",
          event: "auth_failed",
          summary: check.error,
        });
        res.status(check.status).json({ error: check.error });
        return;
      }

      res.status(200).json({ ok: true });

      const message = buildGenericWebhookMessage(channel, req.body);
      const metadata = asRecord(message.metadata);
      const event = asString(metadata?.event) || "unknown";
      recordActivity({
        provider: "webhook",
        requestedChannelId: req.params.channelId,
        channel,
        status: "accepted",
        event,
        summary: asString(message.content) || event,
      });
      routeInboundMessage(message, config).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        recordActivity({
          provider: "webhook",
          requestedChannelId: req.params.channelId,
          channel,
          status: "route_error",
          event,
          summary: msg,
        });
        console.error(`[Webhook:generic] Failed to route message for ${channel.id}:`, msg);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordActivity({
        provider: "webhook",
        requestedChannelId: req.params.channelId,
        status: "route_error",
        event: "handler_error",
        summary: message,
      });
      res.status(500).json({ error: message });
    }
  });

  return router;
}
