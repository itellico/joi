# Mem0 Integration Strategy

## Decision

Use Mem0 OSS as JOI's working-memory layer, backed by production storage.

- Default backend: `pgvector` on the existing JOI PostgreSQL database.
- Optional fallback backend: local SQLite (development/troubleshooting only).
- JOI Postgres memories/facts remain the audit/control plane.

## Runtime mode

When `MEM0_ENABLED=true`, JOI enables Mem0.

Backend selection:

- `MEM0_VECTOR_BACKEND=pgvector` (recommended)
- `MEM0_VECTOR_BACKEND=sqlite` (fallback/local)

When `MEM0_SHADOW_WRITE_LOCAL=true`, JOI also writes to local Postgres memories
via existing `memory_store`/auto-learn paths.

## Required env

```bash
DATABASE_URL=postgresql://joi:joi@mini:5434/joi
OLLAMA_URL=http://mini:11434
MEM0_ENABLED=true
MEM0_USER_ID=primary-user
MEM0_APP_ID=joi
MEM0_VECTOR_BACKEND=pgvector
MEM0_PGVECTOR_TABLE=mem0_vectors
MEM0_SHADOW_WRITE_LOCAL=true
MEM0_SESSION_CONTEXT_LIMIT=8
```

## Notes

- Mem0 cloud mode is not required for JOI.
- Keep identity/preferences truth in verified Facts; use Mem0 for recall/context.
- SQLite backend exists for local fallback, not production primary storage.
