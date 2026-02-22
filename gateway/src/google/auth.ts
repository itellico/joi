// Google OAuth2 authentication — multi-account, DB-backed
// Supports multiple Google accounts with per-account token storage

import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import { query } from "../db/client.js";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
];

// Credentials file in project root
const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const CREDENTIALS_PATH = path.join(PROJECT_ROOT, "secrets", "google-credentials.json");
const LEGACY_TOKEN_PATH = path.join(PROJECT_ROOT, "secrets", "google-token.json");

// Per-account OAuth2 client cache
const clientCache = new Map<string, InstanceType<typeof google.auth.OAuth2>>();
let configuredPublicUrl: string | undefined;

interface GoogleCredentials {
  installed?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
  web?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
}

export interface GoogleAccount {
  id: string;
  email: string | null;
  display_name: string;
  scopes: string[];
  is_default: boolean;
  status: string;
  error_message: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

function loadCredentials(): GoogleCredentials {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `Google credentials not found at ${CREDENTIALS_PATH}. ` +
      `Download OAuth2 credentials from Google Cloud Console and save as google-credentials.json`,
    );
  }
  return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
}

// Set the public URL from gateway config (called on startup)
export function setPublicUrl(url: string | undefined): void {
  configuredPublicUrl = url;
  clientCache.clear();
}

function getRedirectUri(credsRedirectUri?: string): string {
  if (configuredPublicUrl) {
    return `${configuredPublicUrl.replace(/\/$/, "")}/api/google/callback`;
  }
  return credsRedirectUri || "http://localhost:3100/api/google/callback";
}

function createOAuth2Client(): InstanceType<typeof google.auth.OAuth2> {
  const creds = loadCredentials();
  const config = creds.installed || creds.web;
  if (!config) throw new Error("Invalid credentials format — need 'installed' or 'web' key");

  return new google.auth.OAuth2(
    config.client_id,
    config.client_secret,
    getRedirectUri(config.redirect_uris[0]),
  );
}

/**
 * Get the default account ID. Returns null if no accounts exist.
 */
async function getDefaultAccountId(): Promise<string | null> {
  // First try explicit default
  const defaultResult = await query<{ id: string }>(
    `SELECT id FROM google_accounts WHERE is_default = true AND status = 'connected' LIMIT 1`,
  );
  if (defaultResult.rows.length > 0) return defaultResult.rows[0].id;

  // Fall back to any connected account
  const anyResult = await query<{ id: string }>(
    `SELECT id FROM google_accounts WHERE status = 'connected' ORDER BY created_at ASC LIMIT 1`,
  );
  return anyResult.rows.length > 0 ? anyResult.rows[0].id : null;
}

/**
 * Resolve an account ID — uses default if none specified.
 */
async function resolveAccountId(accountId?: string): Promise<string> {
  if (accountId) return accountId;
  const defaultId = await getDefaultAccountId();
  if (!defaultId) {
    throw new Error("No Google account connected. Add one via /api/google/accounts");
  }
  return defaultId;
}

/**
 * Get an authenticated OAuth2 client for a specific account.
 * If no accountId is given, uses the default account.
 */
export async function getAuthClient(accountId?: string): Promise<InstanceType<typeof google.auth.OAuth2>> {
  const id = await resolveAccountId(accountId);

  if (clientCache.has(id)) return clientCache.get(id)!;

  const result = await query<{ tokens: Record<string, unknown>; status: string }>(
    `SELECT tokens, status FROM google_accounts WHERE id = $1`,
    [id],
  );

  if (result.rows.length === 0) {
    throw new Error(`Google account '${id}' not found`);
  }

  const { tokens, status } = result.rows[0];
  if (status !== "connected" || !tokens?.refresh_token) {
    throw new Error(
      `Google account '${id}' is not connected. Visit /api/google/accounts/${id}/auth to authenticate.`,
    );
  }

  const client = createOAuth2Client();
  client.setCredentials(tokens as any);

  // Auto-refresh: persist new tokens to DB
  client.on("tokens", async (newTokens) => {
    try {
      await query(
        `UPDATE google_accounts
         SET tokens = tokens || $1::jsonb, updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(newTokens), id],
      );
    } catch (err) {
      console.error(`[Google] Failed to persist refreshed tokens for '${id}':`, err);
    }
  });

  // Update last_used_at
  query(`UPDATE google_accounts SET last_used_at = NOW() WHERE id = $1`, [id]).catch(() => {});

  clientCache.set(id, client);
  return client;
}

/**
 * Generate OAuth URL for a specific account.
 * Passes accountId via the state parameter.
 */
export function getAuthUrl(accountId: string): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state: accountId,
  });
}

/**
 * Handle OAuth callback — save tokens and fetch user email.
 */
export async function handleCallback(code: string, accountId: string): Promise<GoogleAccount> {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);

  // Fetch user email from Google userinfo
  client.setCredentials(tokens as any);
  let email: string | null = null;
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data } = await oauth2.userinfo.get();
    email = data.email || null;
  } catch (err) {
    console.warn("[Google] Could not fetch user email:", err);
  }

  const scopes = (tokens.scope || "").split(" ").filter(Boolean);

  await query(
    `UPDATE google_accounts
     SET tokens = $1, email = COALESCE($2, email), scopes = $3,
         status = 'connected', error_message = NULL, updated_at = NOW()
     WHERE id = $4`,
    [JSON.stringify(tokens), email, scopes, accountId],
  );

  // Clear cached client so it picks up new tokens
  clientCache.delete(accountId);

  const result = await query<GoogleAccount>(
    `SELECT id, email, display_name, scopes, is_default, status,
            error_message, last_used_at, created_at, updated_at
     FROM google_accounts WHERE id = $1`,
    [accountId],
  );

  return result.rows[0];
}

/**
 * Check if an account (or any account) is authenticated.
 */
export async function isAuthenticated(accountId?: string): Promise<boolean> {
  if (accountId) {
    const result = await query<{ status: string }>(
      `SELECT status FROM google_accounts WHERE id = $1`,
      [accountId],
    );
    return result.rows.length > 0 && result.rows[0].status === "connected";
  }
  // Any connected account?
  const result = await query<{ id: string }>(
    `SELECT id FROM google_accounts WHERE status = 'connected' LIMIT 1`,
  );
  return result.rows.length > 0;
}

// ─── Account CRUD ───

export async function listGoogleAccounts(): Promise<GoogleAccount[]> {
  const result = await query<GoogleAccount>(
    `SELECT id, email, display_name, scopes, is_default, status,
            error_message, last_used_at, created_at, updated_at
     FROM google_accounts ORDER BY is_default DESC, created_at ASC`,
  );
  return result.rows;
}

export async function createGoogleAccount(id: string, displayName: string): Promise<GoogleAccount> {
  // If this is the first account, make it default
  const existing = await query<{ id: string }>(`SELECT id FROM google_accounts LIMIT 1`);
  const isDefault = existing.rows.length === 0;

  await query(
    `INSERT INTO google_accounts (id, display_name, is_default)
     VALUES ($1, $2, $3)`,
    [id, displayName, isDefault],
  );

  const result = await query<GoogleAccount>(
    `SELECT id, email, display_name, scopes, is_default, status,
            error_message, last_used_at, created_at, updated_at
     FROM google_accounts WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

export async function updateGoogleAccount(
  id: string,
  updates: { display_name?: string; is_default?: boolean },
): Promise<GoogleAccount> {
  if (updates.is_default) {
    // Clear existing default first
    await query(`UPDATE google_accounts SET is_default = false WHERE is_default = true`);
  }

  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  let idx = 1;

  if (updates.display_name !== undefined) {
    sets.push(`display_name = $${idx++}`);
    params.push(updates.display_name);
  }
  if (updates.is_default !== undefined) {
    sets.push(`is_default = $${idx++}`);
    params.push(updates.is_default);
  }

  params.push(id);
  await query(
    `UPDATE google_accounts SET ${sets.join(", ")} WHERE id = $${idx}`,
    params,
  );

  const result = await query<GoogleAccount>(
    `SELECT id, email, display_name, scopes, is_default, status,
            error_message, last_used_at, created_at, updated_at
     FROM google_accounts WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

export async function deleteGoogleAccount(id: string): Promise<void> {
  clientCache.delete(id);
  await query(`DELETE FROM google_accounts WHERE id = $1`, [id]);
}

/**
 * One-time migration: import existing google-token.json into DB.
 * Only runs if DB has zero accounts and the legacy token file exists.
 */
export async function migrateFileTokensToDb(): Promise<boolean> {
  const existing = await query<{ id: string }>(`SELECT id FROM google_accounts LIMIT 1`);
  if (existing.rows.length > 0) return false; // Already have accounts

  if (!fs.existsSync(LEGACY_TOKEN_PATH)) return false; // No legacy token

  try {
    const tokens = JSON.parse(fs.readFileSync(LEGACY_TOKEN_PATH, "utf-8"));
    const scopes = (tokens.scope || "").split(" ").filter(Boolean);

    // Try to get email from an auth call
    let email: string | null = null;
    try {
      const client = createOAuth2Client();
      client.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: "v2", auth: client });
      const { data } = await oauth2.userinfo.get();
      email = data.email || null;
    } catch {
      // Not critical — email can be populated later
    }

    await query(
      `INSERT INTO google_accounts (id, email, display_name, tokens, scopes, is_default, status)
       VALUES ('default', $1, 'Default', $2, $3, true, 'connected')`,
      [email, JSON.stringify(tokens), scopes],
    );

    console.log(`[Google] Migrated legacy token to DB as 'default' account${email ? ` (${email})` : ""}`);
    return true;
  } catch (err) {
    console.error("[Google] Failed to migrate legacy tokens:", err);
    return false;
  }
}
