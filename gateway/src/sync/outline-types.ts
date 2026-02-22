// Type definitions for Outline <-> Obsidian sync

export interface OutlineDocument {
  id: string;
  title: string;
  text: string;
  collectionId: string;
  parentDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  url?: string;
}

export interface OutlineSearchResult {
  context: string;
  document: OutlineDocument;
}

export interface OutlineCollection {
  id: string;
  name: string;
  description: string;
  documents: Array<{ id: string; title: string; children: unknown[] }>;
}

export interface OutlineWebhookPayload {
  id: string;
  actorId: string;
  webhookSubscriptionId: string;
  createdAt: string;
  event: string;
  payload: {
    id: string;
    model: OutlineDocument;
  };
}

export type SyncStatus = "synced" | "conflicted" | "deleted";

export interface SyncState {
  outline_id: string;
  collection_id: string | null;
  collection_name: string | null;
  obsidian_path: string;
  outline_content_hash: string | null;
  obsidian_content_hash: string | null;
  outline_updated_at: string | null;
  last_synced_at: string;
  status: SyncStatus;
  conflict_detected_at: string | null;
  created_at: string;
  updated_at: string;
}
