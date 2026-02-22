// PTY Session Manager — spawns Claude Code in a pseudo-terminal
// Each session is a live interactive Claude Code instance

import * as pty from "node-pty";

export interface PtySession {
  id: string;
  pty: pty.IPty;
  cwd: string;
  createdAt: number;
  /** Buffered output for session replay on reconnect */
  scrollback: string[];
  listeners: Set<(data: string) => void>;
  exitListeners: Set<(exitCode: number) => void>;
  exitCode: number | null;
}

const sessions = new Map<string, PtySession>();

const MAX_SCROLLBACK = 5000; // lines kept for replay
const SHELL = process.env.SHELL || "/bin/zsh";

export interface SpawnOptions {
  sessionId?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}

export function spawnSession(opts: SpawnOptions = {}): PtySession {
  const id = opts.sessionId || crypto.randomUUID();

  if (sessions.has(id)) {
    return sessions.get(id)!;
  }

  const cwd = opts.cwd || process.env.HOME || "/Users/mm2";

  // Build a clean env — strip all Claude Code env vars so it doesn't
  // refuse to start (it blocks nested sessions otherwise).
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== "CLAUDECODE" && !k.startsWith("CLAUDE_CODE_")) {
      env[k] = v;
    }
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";

  // Spawn through user's shell with -l (login) so PATH/env is fully loaded,
  // then exec claude. This ensures homebrew, nvm, etc. are available.
  const shell = pty.spawn(SHELL, ["-l", "-c", "claude"], {
    name: "xterm-256color",
    cols: opts.cols || 120,
    rows: opts.rows || 40,
    cwd,
    env,
  });

  const session: PtySession = {
    id,
    pty: shell,
    cwd,
    createdAt: Date.now(),
    scrollback: [],
    listeners: new Set(),
    exitListeners: new Set(),
    exitCode: null,
  };

  shell.onData((data) => {
    // Buffer for replay
    session.scrollback.push(data);
    if (session.scrollback.length > MAX_SCROLLBACK) {
      session.scrollback.splice(0, session.scrollback.length - MAX_SCROLLBACK);
    }

    // Notify all connected clients
    for (const listener of session.listeners) {
      listener(data);
    }
  });

  shell.onExit(({ exitCode }) => {
    session.exitCode = exitCode;
    console.log(`[PTY] Session ${id} exited (code ${exitCode})`);
    // Notify all exit listeners
    for (const listener of session.exitListeners) {
      listener(exitCode);
    }
  });

  sessions.set(id, session);
  console.log(`[PTY] Session ${id} spawned (cwd: ${cwd})`);

  return session;
}

export function getSession(id: string): PtySession | undefined {
  return sessions.get(id);
}

export function writeInput(id: string, data: string): void {
  const session = sessions.get(id);
  if (!session || session.exitCode !== null) return;
  session.pty.write(data);
}

export function resizeSession(id: string, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (!session || session.exitCode !== null) return;
  session.pty.resize(cols, rows);
}

export function killSession(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  session.pty.kill();
  sessions.delete(id);
  console.log(`[PTY] Session ${id} killed`);
}

export function listSessions(): Array<{
  id: string;
  cwd: string;
  createdAt: number;
  alive: boolean;
}> {
  return Array.from(sessions.values()).map((s) => ({
    id: s.id,
    cwd: s.cwd,
    createdAt: s.createdAt,
    alive: s.exitCode === null,
  }));
}

export function addListener(id: string, listener: (data: string) => void): () => void {
  const session = sessions.get(id);
  if (!session) return () => {};
  session.listeners.add(listener);
  return () => session.listeners.delete(listener);
}

export function addExitListener(id: string, listener: (exitCode: number) => void): () => void {
  const session = sessions.get(id);
  if (!session) return () => {};
  // If already exited, fire immediately
  if (session.exitCode !== null) {
    listener(session.exitCode);
    return () => {};
  }
  session.exitListeners.add(listener);
  return () => session.exitListeners.delete(listener);
}

export function getScrollback(id: string): string {
  const session = sessions.get(id);
  if (!session) return "";
  return session.scrollback.join("");
}

/** Kill all sessions — called on gateway shutdown */
export function killAllSessions(): void {
  for (const [id, session] of sessions) {
    session.pty.kill();
    console.log(`[PTY] Session ${id} killed (shutdown)`);
  }
  sessions.clear();
}
