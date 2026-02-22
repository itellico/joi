# JOI - Personal AI Assistant

Personal AI assistant platform with React web app, PostgreSQL + pgvector for RAG, Ollama for local embeddings, voice, cron jobs, sub-agents, and messaging channels.

## Quick Start

```bash
# 1. Start PostgreSQL + Ollama
docker compose up -d

# 2. Copy env file and add your API keys
cp .env.example .env

# 3. Install dependencies
pnpm install

# 4. Run database migrations
pnpm db:migrate

# 5. Start development servers
pnpm dev
```

Gateway runs at `http://localhost:3000`, web app at `http://localhost:5173`.

## Runtime Ops

```bash
# Full local runtime audit (processes, dependencies, /api/health, recent errors)
./scripts/service-audit.sh

# Keep watchdog persistent across terminal closes/reboots (macOS launchd)
./scripts/install-watchdog-launchd.sh

# Remove launchd watchdog agent
./scripts/uninstall-watchdog-launchd.sh
```

## Project Structure

```
gateway/     # Node.js + TypeScript backend (Express + WebSocket)
web/         # React web app (Vite)
legacy/      # Original vanilla JS dashboard (preserved)
skills/      # Bundled skill definitions (Markdown)
macos/       # Swift menubar app (Phase 6)
```

## Architecture

- **Gateway**: Express + WebSocket server, agent runtime, tool system
- **Agent Runtime**: Claude API with streaming + tool_use loop
- **Database**: PostgreSQL 17 + pgvector for conversations, RAG, cron, memory
- **Embeddings**: Ollama (nomic-embed-text) for local vector embeddings
- **Web App**: React with real-time WebSocket chat, dashboard, and management UI

## Mem0

Mem0 can be enabled as an OSS memory engine while keeping JOI's Postgres memory and review workflow.

- Config: `.env` (`MEM0_*` vars, no cloud key)
- Recommended backend: `pgvector` on JOI Postgres (`MEM0_VECTOR_BACKEND=pgvector`)
- Optional fallback: local SQLite backend (`MEM0_VECTOR_BACKEND=sqlite`)
- Details: `docs/mem0-integration.md`
