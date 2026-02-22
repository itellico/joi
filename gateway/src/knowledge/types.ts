// JOI Memory System - Core Types

export type MemoryArea = "identity" | "preferences" | "knowledge" | "solutions" | "episodes";
export type MemorySource = "user" | "inferred" | "solution_capture" | "episode" | "flush" | "feedback";

export interface Memory {
  id: string;
  area: MemoryArea;
  content: string;
  summary: string | null;
  tags: string[];
  confidence: number;
  accessCount: number;
  reinforcementCount: number;
  source: MemorySource;
  conversationId: string | null;
  channelId: string | null;
  projectId: string | null;
  pinned: boolean;
  supersededBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
  expiresAt: Date | null;
}

export interface MemoryWriteRequest {
  area: MemoryArea;
  content: string;
  summary?: string;
  tags?: string[];
  confidence?: number;
  source: MemorySource;
  conversationId?: string;
  channelId?: string;
  projectId?: string;
  pinned?: boolean;
  expiresAt?: Date;
}

export interface MemorySearchOptions {
  query: string;
  areas?: MemoryArea[];
  projectId?: string | null;
  limit?: number;
  minConfidence?: number;
  includeSuperseded?: boolean;
}

export interface MemorySearchResult {
  memory: Memory;
  score: number;
  vectorScore: number;
  textScore: number;
  decayMultiplier: number;
  matchedArea: MemoryArea;
}

export interface AreaSearchConfig {
  area: MemoryArea;
  vectorWeight: number;
  textWeight: number;
  temporalDecayEnabled: boolean;
  halfLifeDays: number | null;
  minConfidence: number;
}
