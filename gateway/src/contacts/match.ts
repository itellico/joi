// Contact matching for inbound channel messages.
// Resolves a ChannelMessage sender to a contacts.id using per-channel logic.
// Results are cached for 5 minutes to avoid repeated DB hits.

import { query } from "../db/client.js";
import type { ChannelMessage } from "../channels/types.js";

interface CacheEntry {
  contactId: string | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 30 * 1000; // shorter TTL for "no match" results

/** Strip non-digit chars, return last 7 digits for suffix matching. */
function phoneSuffix(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.slice(-7);
}

/** Match a contact by email address against contacts.emails[]. */
async function matchByEmail(email: string): Promise<string | null> {
  const result = await query<{ id: string }>(
    `SELECT id FROM contacts WHERE $1 ILIKE ANY(emails) LIMIT 1`,
    [email],
  );
  return result.rows[0]?.id ?? null;
}

async function matchImessage(msg: ChannelMessage): Promise<string | null> {
  const sender = msg.senderId;

  if (sender.includes("@")) {
    return matchByEmail(sender);
  }

  // Phone-based iMessage — suffix match
  const suffix = phoneSuffix(sender);
  if (suffix.length < 7) return null;

  const result = await query<{ id: string }>(
    `SELECT id FROM contacts
     WHERE EXISTS (
       SELECT 1 FROM unnest(phones) AS p
       WHERE regexp_replace(p, '\\D', '', 'g') LIKE '%' || $1
     )
     LIMIT 1`,
    [suffix],
  );
  return result.rows[0]?.id ?? null;
}

async function matchTelegram(msg: ChannelMessage): Promise<string | null> {
  // Try telegram_id first (most reliable)
  const byId = await query<{ id: string }>(
    `SELECT id FROM contacts WHERE telegram_id = $1 LIMIT 1`,
    [msg.senderId],
  );
  if (byId.rows[0]) return byId.rows[0].id;

  // Fallback: match by username from message metadata
  const username = msg.metadata?.username as string | undefined;
  if (!username) return null;

  const byUsername = await query<{ id: string }>(
    `SELECT id FROM contacts WHERE LOWER(telegram_username) = LOWER($1) LIMIT 1`,
    [username],
  );
  return byUsername.rows[0]?.id ?? null;
}

async function matchSlack(msg: ChannelMessage): Promise<string | null> {
  // Try slack_handle column (Slack user ID)
  const byHandle = await query<{ id: string }>(
    `SELECT id FROM contacts WHERE LOWER(slack_handle) = LOWER($1) LIMIT 1`,
    [msg.senderId],
  );
  if (byHandle.rows[0]) return byHandle.rows[0].id;

  // Try extra->'slack_ids' JSONB for workspace-specific mapping
  const teamId = msg.metadata?.teamId as string | undefined;
  if (teamId) {
    const byExtra = await query<{ id: string }>(
      `SELECT id FROM contacts WHERE extra->'slack_ids'->>$1 = $2 LIMIT 1`,
      [teamId, msg.senderId],
    );
    if (byExtra.rows[0]) return byExtra.rows[0].id;
  }

  // Fallback: match by email from Slack user profile
  const email = msg.metadata?.email as string | undefined;
  if (email) return matchByEmail(email);

  return null;
}

async function matchDiscord(msg: ChannelMessage): Promise<string | null> {
  // Primary: discord_id column (Discord user ID snowflake)
  const byId = await query<{ id: string }>(
    `SELECT id FROM contacts WHERE discord_id = $1 LIMIT 1`,
    [msg.senderId],
  );
  if (byId.rows[0]) return byId.rows[0].id;

  // Fallback: discord_username
  const username = msg.metadata?.username as string | undefined;
  if (username) {
    const byUsername = await query<{ id: string }>(
      `SELECT id FROM contacts WHERE LOWER(discord_username) = LOWER($1) LIMIT 1`,
      [username],
    );
    if (byUsername.rows[0]) return byUsername.rows[0].id;
  }

  return null;
}

async function matchWhatsapp(msg: ChannelMessage): Promise<string | null> {
  // WhatsApp JIDs look like 436601234567@s.whatsapp.net
  const phone = msg.senderId.replace(/@.*$/, "");
  const suffix = phoneSuffix(phone);
  if (suffix.length < 7) return null;

  const result = await query<{ id: string }>(
    `SELECT id FROM contacts
     WHERE EXISTS (
       SELECT 1 FROM unnest(phones) AS p
       WHERE regexp_replace(p, '\\D', '', 'g') LIKE '%' || $1
     )
     LIMIT 1`,
    [suffix],
  );
  return result.rows[0]?.id ?? null;
}

/**
 * Resolve a channel message sender to a contact ID.
 * Returns null if no matching contact is found.
 * Results are cached for 5 minutes per channelType:senderId.
 */
export async function matchContact(msg: ChannelMessage): Promise<string | null> {
  const cacheKey = `${msg.channelType}:${msg.senderId}`;

  const cached = cache.get(cacheKey);
  if (cached) {
    if (cached.expiresAt > Date.now()) return cached.contactId;
    cache.delete(cacheKey);
  }

  // Periodic eviction: clean up expired entries every 100 lookups
  if (cache.size > 200) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expiresAt <= now) cache.delete(k);
    }
  }

  let contactId: string | null = null;

  switch (msg.channelType) {
    case "imessage":
      contactId = await matchImessage(msg);
      break;
    case "telegram":
      contactId = await matchTelegram(msg);
      break;
    case "whatsapp":
      contactId = await matchWhatsapp(msg);
      break;
    case "email":
      contactId = await matchByEmail(msg.senderId);
      break;
    case "slack":
      contactId = await matchSlack(msg);
      break;
    case "discord":
      contactId = await matchDiscord(msg);
      break;
  }

  const ttl = contactId ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
  cache.set(cacheKey, { contactId, expiresAt: Date.now() + ttl });
  return contactId;
}
