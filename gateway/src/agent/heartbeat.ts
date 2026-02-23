// Agent Heartbeat — liveness tracking, task management, stale detection
import { query } from "../db/client.js";

// ─── Types ───

export interface AgentHeartbeat {
  agent_id: string;
  status: "idle" | "working" | "finished" | "error" | "stale";
  current_task: string | null;
  progress: number | null;
  workload_summary: Record<string, unknown>;
  metadata: Record<string, unknown>;
  last_heartbeat_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentTask {
  id: string;
  agent_id: string;
  assigned_by: string | null;
  title: string;
  description: string | null;
  priority: number;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  input_data: Record<string, unknown>;
  result_data: unknown;
  conversation_id: string | null;
  result_conversation_id: string | null;
  progress: number;
  heartbeat_count: number;
  last_heartbeat_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  deadline: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Heartbeat CRUD ───

export async function updateHeartbeat(
  agentId: string,
  data: {
    status?: string;
    current_task?: string | null;
    progress?: number | null;
    error_message?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<AgentHeartbeat> {
  const now = new Date().toISOString();

  const result = await query<AgentHeartbeat>(
    `INSERT INTO agent_heartbeats (agent_id, status, current_task, progress, error_message, metadata, last_heartbeat_at, started_at, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
       CASE WHEN $2 = 'working' THEN $7::timestamptz ELSE NULL END,
       CASE WHEN $2 IN ('finished', 'error') THEN $7::timestamptz ELSE NULL END)
     ON CONFLICT (agent_id) DO UPDATE SET
       status = COALESCE($2, agent_heartbeats.status),
       current_task = CASE WHEN $3 IS NOT NULL THEN $3 ELSE agent_heartbeats.current_task END,
       progress = COALESCE($4, agent_heartbeats.progress),
       error_message = CASE WHEN $5 IS NOT NULL THEN $5 ELSE agent_heartbeats.error_message END,
       metadata = CASE WHEN $6 != '{}'::jsonb THEN agent_heartbeats.metadata || $6 ELSE agent_heartbeats.metadata END,
       last_heartbeat_at = $7,
       started_at = CASE WHEN $2 = 'working' AND agent_heartbeats.status != 'working' THEN $7::timestamptz ELSE agent_heartbeats.started_at END,
       finished_at = CASE WHEN $2 IN ('finished', 'error') THEN $7::timestamptz ELSE agent_heartbeats.finished_at END,
       updated_at = $7
     RETURNING *`,
    [
      agentId,
      data.status || "idle",
      data.current_task ?? null,
      data.progress ?? null,
      data.error_message ?? null,
      JSON.stringify(data.metadata || {}),
      now,
    ],
  );

  return result.rows[0];
}

export async function getHeartbeat(agentId: string): Promise<AgentHeartbeat | null> {
  const result = await query<AgentHeartbeat>(
    "SELECT * FROM agent_heartbeats WHERE agent_id = $1",
    [agentId],
  );
  return result.rows[0] || null;
}

export async function getAllHeartbeats(): Promise<(AgentHeartbeat & { agent_name: string })[]> {
  const result = await query<AgentHeartbeat & { agent_name: string }>(
    `SELECT h.*, a.name AS agent_name
     FROM agent_heartbeats h
     JOIN agents a ON h.agent_id = a.id
     ORDER BY h.last_heartbeat_at DESC`,
  );
  return result.rows;
}

// ─── Stale Detection ───

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export async function checkHeartbeats(broadcast?: (type: string, data: unknown) => void): Promise<{
  stale: string[];
  failedTasks: string[];
}> {
  const staleAgents: string[] = [];
  const failedTasks: string[] = [];

  // Mark agents as stale if they were "working" but haven't reported in > 5 min
  const staleResult = await query<{ agent_id: string }>(
    `UPDATE agent_heartbeats
     SET status = 'stale', updated_at = NOW()
     WHERE status = 'working'
       AND last_heartbeat_at < NOW() - INTERVAL '${Math.floor(STALE_THRESHOLD_MS / 1000)} seconds'
     RETURNING agent_id`,
  );
  for (const row of staleResult.rows) {
    staleAgents.push(row.agent_id);
  }

  // Auto-fail tasks past their deadline
  const deadlineResult = await query<{ id: string; agent_id: string; title: string }>(
    `UPDATE agent_tasks
     SET status = 'failed', completed_at = NOW(), updated_at = NOW()
     WHERE status IN ('pending', 'in_progress')
       AND deadline IS NOT NULL
       AND deadline < NOW()
     RETURNING id, agent_id, title`,
  );
  for (const row of deadlineResult.rows) {
    failedTasks.push(row.id);
  }

  // Update workload summaries for each agent
  const workloadResult = await query<{ agent_id: string; pending: string; in_progress: string; completed: string; failed: string }>(
    `SELECT agent_id,
       COUNT(*) FILTER (WHERE status = 'pending') AS pending,
       COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
       COUNT(*) FILTER (WHERE status = 'completed') AS completed,
       COUNT(*) FILTER (WHERE status = 'failed') AS failed
     FROM agent_tasks
     GROUP BY agent_id`,
  );

  for (const row of workloadResult.rows) {
    await query(
      `UPDATE agent_heartbeats SET
         workload_summary = $1::jsonb,
         updated_at = NOW()
       WHERE agent_id = $2`,
      [
        JSON.stringify({
          pending: parseInt(row.pending),
          in_progress: parseInt(row.in_progress),
          completed: parseInt(row.completed),
          failed: parseInt(row.failed),
        }),
        row.agent_id,
      ],
    ).catch(() => {});
  }

  // Broadcast status updates
  if (broadcast && (staleAgents.length > 0 || failedTasks.length > 0)) {
    broadcast("agent.heartbeat_check", {
      staleAgents,
      failedTasks: deadlineResult.rows,
      timestamp: new Date().toISOString(),
    });
  }

  // Broadcast all heartbeats for UI refresh
  if (broadcast) {
    const all = await getAllHeartbeats();
    broadcast("agent.heartbeats", { heartbeats: all });
  }

  return { stale: staleAgents, failedTasks };
}

// ─── Task CRUD ───

export async function createTask(data: {
  agent_id: string;
  assigned_by?: string;
  title: string;
  description?: string;
  priority?: number;
  input_data?: Record<string, unknown>;
  conversation_id?: string;
  deadline?: string;
}): Promise<AgentTask> {
  const result = await query<AgentTask>(
    `INSERT INTO agent_tasks (agent_id, assigned_by, title, description, priority, input_data, conversation_id, deadline)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      data.agent_id,
      data.assigned_by || null,
      data.title,
      data.description || null,
      data.priority ?? 5,
      JSON.stringify(data.input_data || {}),
      data.conversation_id || null,
      data.deadline || null,
    ],
  );
  return result.rows[0];
}

export async function updateTask(
  taskId: string,
  data: {
    status?: string;
    progress?: number;
    result_data?: unknown;
    result_conversation_id?: string;
  },
): Promise<AgentTask> {
  const sets: string[] = ["updated_at = NOW()"];
  const vals: unknown[] = [];
  let idx = 1;

  if (data.status !== undefined) {
    sets.push(`status = $${idx++}`);
    vals.push(data.status);

    if (data.status === "in_progress") {
      sets.push("started_at = COALESCE(started_at, NOW())");
    }
    if (data.status === "completed" || data.status === "failed") {
      sets.push("completed_at = NOW()");
    }
  }
  if (data.progress !== undefined) {
    sets.push(`progress = $${idx++}`);
    vals.push(data.progress);
  }
  if (data.result_data !== undefined) {
    sets.push(`result_data = $${idx++}`);
    vals.push(JSON.stringify(data.result_data));
  }
  if (data.result_conversation_id !== undefined) {
    sets.push(`result_conversation_id = $${idx++}`);
    vals.push(data.result_conversation_id);
  }

  // Increment heartbeat count
  sets.push("heartbeat_count = heartbeat_count + 1");
  sets.push("last_heartbeat_at = NOW()");

  vals.push(taskId);

  const result = await query<AgentTask>(
    `UPDATE agent_tasks SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    vals,
  );

  if (result.rows.length === 0) throw new Error(`Task not found: ${taskId}`);
  return result.rows[0];
}

export async function listTasks(filters: {
  agent_id?: string;
  status?: string;
  assigned_by?: string;
  limit?: number;
}): Promise<AgentTask[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.agent_id) {
    conditions.push(`agent_id = $${idx++}`);
    params.push(filters.agent_id);
  }
  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.assigned_by) {
    conditions.push(`assigned_by = $${idx++}`);
    params.push(filters.assigned_by);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(filters.limit || 50);

  const result = await query<AgentTask>(
    `SELECT * FROM agent_tasks ${where} ORDER BY priority DESC, created_at DESC LIMIT $${idx}`,
    params,
  );
  return result.rows;
}

export async function getTask(taskId: string): Promise<AgentTask | null> {
  const result = await query<AgentTask>(
    "SELECT * FROM agent_tasks WHERE id = $1",
    [taskId],
  );
  return result.rows[0] || null;
}
