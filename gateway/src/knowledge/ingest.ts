// Document ingestion pipeline: chunk → embed → store in PostgreSQL

import crypto from "node:crypto";
import { query, transaction } from "../db/client.js";
import { embedBatch } from "./embeddings.js";
import type { JoiConfig } from "../config/schema.js";

export interface IngestOptions {
  source: "obsidian" | "file" | "web" | "manual";
  path?: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  config: JoiConfig;
}

interface ChunkMetadataContext {
  source: IngestOptions["source"];
  path?: string;
  title: string;
  metadata?: Record<string, unknown>;
}

// Chunk a document into overlapping segments
export function chunkText(
  text: string,
  maxChunkSize = 1000,
  overlap = 200,
): Array<{ content: string; startLine: number; endLine: number }> {
  const lines = text.split("\n");
  const chunks: Array<{ content: string; startLine: number; endLine: number }> = [];

  let currentChunk: string[] = [];
  let currentSize = 0;
  let startLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineSize = line.length + 1; // +1 for newline

    // If adding this line exceeds max, save current chunk and start new one
    if (currentSize + lineSize > maxChunkSize && currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.join("\n"),
        startLine,
        endLine: i - 1,
      });

      // Overlap: keep last N characters worth of lines
      let overlapSize = 0;
      let overlapStart = currentChunk.length;
      while (overlapStart > 0 && overlapSize < overlap) {
        overlapStart--;
        overlapSize += currentChunk[overlapStart].length + 1;
      }

      const overlapLines = currentChunk.slice(overlapStart);
      currentChunk = [...overlapLines];
      currentSize = overlapLines.reduce((sum, l) => sum + l.length + 1, 0);
      startLine = i - overlapLines.length;
    }

    currentChunk.push(line);
    currentSize += lineSize;
  }

  // Last chunk
  if (currentChunk.length > 0) {
    chunks.push({
      content: currentChunk.join("\n"),
      startLine,
      endLine: lines.length - 1,
    });
  }

  return chunks;
}

// Ingest a document: chunk, embed, store
export async function ingestDocument(options: IngestOptions): Promise<{
  documentId: number;
  chunksCreated: number;
}> {
  const { source, path, title, content, metadata, config } = options;
  const contentHash = crypto.createHash("sha256").update(content).digest("hex");

  // Check if document already exists with same hash (skip if unchanged)
  if (path) {
    const existing = await query<{ id: number; content_hash: string }>(
      "SELECT id, content_hash FROM documents WHERE source = $1 AND path = $2",
      [source, path],
    );

    if (existing.rows.length > 0 && existing.rows[0].content_hash === contentHash) {
      return { documentId: existing.rows[0].id, chunksCreated: 0 };
    }

    // Delete old chunks if document exists but changed
    if (existing.rows.length > 0) {
      await query("DELETE FROM chunks WHERE document_id = $1", [existing.rows[0].id]);
      await query(
        "UPDATE documents SET content = $1, content_hash = $2, title = $3, metadata = $4, updated_at = NOW(), embedded_at = NULL WHERE id = $5",
        [content, contentHash, title, JSON.stringify(metadata || {}), existing.rows[0].id],
      );

      const docId = existing.rows[0].id;
      const chunksCreated = await embedAndStoreChunks(docId, content, config, {
        source,
        path,
        title,
        metadata,
      });
      return { documentId: docId, chunksCreated };
    }
  }

  // Insert new document
  const docResult = await query<{ id: number }>(
    `INSERT INTO documents (source, path, title, content, content_hash, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [source, path || null, title, content, contentHash, JSON.stringify(metadata || {})],
  );

  const docId = docResult.rows[0].id;
  const chunksCreated = await embedAndStoreChunks(docId, content, config, {
    source,
    path,
    title,
    metadata,
  });

  return { documentId: docId, chunksCreated };
}

function buildChunkMetadata(
  context: ChunkMetadataContext,
  chunkIndex: number,
  startLine: number,
  endLine: number,
): Record<string, unknown> {
  const docMeta = context.metadata || {};
  const data: Record<string, unknown> = {
    source: context.source,
    path: context.path || null,
    title: context.title,
    obsidianType: typeof docMeta.obsidianType === "string" ? docMeta.obsidianType : null,
    obsidianArea: typeof docMeta.obsidianArea === "string" ? docMeta.obsidianArea : null,
    chunkIndex,
    startLine,
    endLine,
  };
  return data;
}

async function embedAndStoreChunks(
  documentId: number,
  content: string,
  config: JoiConfig,
  context: ChunkMetadataContext,
): Promise<number> {
  const chunks = chunkText(content);
  if (chunks.length === 0) return 0;

  // Batch embed all chunks
  let embeddings: number[][] | null = null;
  try {
    embeddings = await embedBatch(
      chunks.map((c) => c.content),
      config,
    );
  } catch (err) {
    console.warn("Failed to embed chunks, storing without vectors:", err);
  }

  // Insert all chunks
  await transaction(async (client) => {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings?.[i];
      const metadata = buildChunkMetadata(
        context,
        i,
        chunk.startLine,
        chunk.endLine,
      );

      await client.query(
        `INSERT INTO chunks (document_id, content, embedding, chunk_index, start_line, end_line, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          documentId,
          chunk.content,
          embedding ? `[${embedding.join(",")}]` : null,
          i,
          chunk.startLine,
          chunk.endLine,
          JSON.stringify(metadata),
        ],
      );
    }

    // Mark document as embedded
    await client.query(
      "UPDATE documents SET embedded_at = NOW() WHERE id = $1",
      [documentId],
    );
  });

  return chunks.length;
}

// Delete a document and its chunks
export async function deleteDocument(source: string, path: string): Promise<boolean> {
  const result = await query<{ id: number }>(
    "DELETE FROM documents WHERE source = $1 AND path = $2 RETURNING id",
    [source, path],
  );
  return result.rows.length > 0;
}
