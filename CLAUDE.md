# JOI Project

## Structure
pnpm monorepo:
- `gateway/` — Node.js + TypeScript backend (Express, WebSocket, PostgreSQL)
- `web/` — React + Vite frontend
- `legacy/` — Preserved vanilla JS dashboard (do not modify)

## Coding Conventions
- ESM modules (use `.js` extensions in imports, even for `.ts` files)
- TypeScript strict mode
- DB client uses lazy pool init (ES module import order issue with dotenv)
- `.env` lives at project root, loaded by `gateway/src/config/`

## Key Directories
- `gateway/src/agent/` — AI agent runtime, Claude Code CLI integration
- `gateway/src/autodev/` — AutoDev autonomous task runner
- `gateway/src/knowledge/` — Memory system (embeddings, search, writer)
- `gateway/src/config/` — Config schema and loader
- `gateway/src/db/` — PostgreSQL client and migrations
- `web/src/` — React frontend source

## Git Workflow
- Commit changes after completing a task
- Do NOT push to remote
- Do NOT create new branches
- Write concise commit messages describing what changed

## Environment
- macOS, OrbStack (not Docker Desktop)
- PostgreSQL on `mini.local:5434` (pgvector/pgvector:pg17)
- Gateway on port 3100
- Web dev server on port 5173
