import { query } from "../db/client.js";

export interface ConversationScope {
  scope: string;
  metadata: Record<string, unknown>;
  companyId?: string;
  contactId?: string;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeScope(value: unknown, fallback = "personal"): string {
  const parsed = asNonEmptyString(value);
  return (parsed || fallback).toLowerCase();
}

export function normalizeScopeMetadata(value: unknown): Record<string, unknown> {
  return asObject(value);
}

export function extractScopeEntityIds(metadata: Record<string, unknown>): {
  companyId?: string;
  contactId?: string;
} {
  const companyId =
    asNonEmptyString(metadata.company_id)
    || asNonEmptyString(metadata.companyId)
    || asNonEmptyString(metadata.company);

  const contactId =
    asNonEmptyString(metadata.contact_id)
    || asNonEmptyString(metadata.contactId)
    || asNonEmptyString(metadata.contact);

  return { companyId, contactId };
}

export function resolveAllowedScopes(options: {
  scope?: string;
  allowedScopes?: string[] | null;
  allowGlobalDataAccess?: boolean;
}): string[] | null {
  if (options.allowGlobalDataAccess) return null;

  const explicit = (options.allowedScopes || [])
    .map((s) => normalizeScope(s))
    .filter(Boolean);
  if (explicit.length > 0) {
    return Array.from(new Set(explicit));
  }

  return [normalizeScope(options.scope)];
}

/**
 * SQL scope filter expression.
 * - Rows with explicit scope are always filtered by allowed scopes.
 * - Unscoped rows are treated as personal and only visible when personal scope is allowed.
 */
export function buildScopeFilterSql(
  scopeColumnExpr: string,
  scopesParamIndex: number,
): string {
  return `(
    ${scopeColumnExpr} = ANY($${scopesParamIndex}::text[])
    OR (
      'personal' = ANY($${scopesParamIndex}::text[])
      AND COALESCE(NULLIF(${scopeColumnExpr}, ''), 'personal') = 'personal'
    )
  )`;
}

export async function loadConversationScope(
  conversationId: string,
): Promise<ConversationScope> {
  const result = await query<{
    scope: string | null;
    scope_metadata: Record<string, unknown> | null;
  }>(
    `SELECT cc.scope, cc.scope_metadata
     FROM conversations conv
     LEFT JOIN channel_configs cc ON cc.id = conv.channel_id
     WHERE conv.id = $1
     LIMIT 1`,
    [conversationId],
  );

  const row = result.rows[0];
  const metadata = normalizeScopeMetadata(row?.scope_metadata ?? {});
  const scope = normalizeScope(row?.scope, "personal");
  const ids = extractScopeEntityIds(metadata);

  return {
    scope,
    metadata,
    companyId: ids.companyId,
    contactId: ids.contactId,
  };
}
