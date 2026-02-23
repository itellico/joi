/**
 * OKR agent tools
 *
 * Provides OKR-specific operations:
 *   okr_score_all    — Recalculate all KR + Objective scores
 *   okr_report       — Generate a formatted OKR status report
 *   okr_sync_things3 — Push OKRs to Things3
 *   okr_things3_progress — Read completion data from Things3
 *   okr_checkin      — Create a weekly check-in for a KR
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext } from "../agent/tools.js";
import { query } from "../db/client.js";
import { syncToThings3, readThings3Progress } from "./things3-sync.js";

type ToolHandler = (input: unknown, ctx: ToolContext) => Promise<unknown>;

// ─── Helpers ───

interface ObjRow {
  id: string;
  title: string;
  data: Record<string, unknown>;
  tags: string[];
  status: string;
}

interface KRRow {
  id: string;
  title: string;
  data: Record<string, unknown>;
  relation_id: string;
  objective_id: string;
}

async function getOKRCollectionIds(): Promise<{ objCollId: string | null; krCollId: string | null; ciCollId: string | null }> {
  const res = await query(
    "SELECT id, name FROM store_collections WHERE name IN ('OKR Objectives', 'OKR Key Results', 'OKR Check-ins')"
  );
  return {
    objCollId: res.rows.find((r: any) => r.name === "OKR Objectives")?.id || null,
    krCollId: res.rows.find((r: any) => r.name === "OKR Key Results")?.id || null,
    ciCollId: res.rows.find((r: any) => r.name === "OKR Check-ins")?.id || null,
  };
}

function computeScore(kr: Record<string, unknown>): number {
  const metricType = kr.metric_type as string;
  if (metricType === "binary") {
    return (kr.status as string) === "achieved" ? 1.0 : 0.0;
  }
  const baseline = Number(kr.baseline) || 0;
  const target = Number(kr.target) || 0;
  const current = Number(kr.current) || 0;
  if (target === baseline) return 0;
  return Math.max(0, Math.min(1, (current - baseline) / (target - baseline)));
}

function scoreGrade(score: number): string {
  if (score >= 0.7) return "green";
  if (score >= 0.4) return "yellow";
  return "red";
}

// ─── Tool Handlers ───

export function getOKRToolHandlers(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // ─── okr_score_all ───

  handlers.set("okr_score_all", async (_input, _ctx) => {
    const { objCollId, krCollId } = await getOKRCollectionIds();
    if (!objCollId || !krCollId) return { error: "OKR collections not found" };

    // Fetch all active objectives
    const objRes = await query<ObjRow>(
      "SELECT id, title, data, tags, status FROM store_objects WHERE collection_id = $1 AND status = 'active'",
      [objCollId]
    );

    const updated: { objective: string; oldScore: number; newScore: number; krs: { title: string; oldScore: number; newScore: number }[] }[] = [];

    for (const obj of objRes.rows) {
      // Fetch linked KRs
      const krRes = await query<KRRow>(
        `SELECT t.id, t.title, t.data, r.id AS relation_id, r.source_id AS objective_id
         FROM store_objects t
         JOIN store_relations r ON r.target_id = t.id
         WHERE r.source_id = $1 AND r.relation = 'has_key_result' AND t.status = 'active'`,
        [obj.id]
      );

      const krUpdates: { title: string; oldScore: number; newScore: number }[] = [];

      for (const kr of krRes.rows) {
        const data = typeof kr.data === "string" ? JSON.parse(kr.data) : kr.data;
        const oldScore = Number(data.score) || 0;
        const newScore = Math.round(computeScore(data) * 100) / 100;

        if (Math.abs(oldScore - newScore) > 0.005) {
          // Determine status
          let newStatus = "on_track";
          if (newScore >= 1.0) newStatus = "achieved";
          else if (newScore < 0.4) newStatus = "behind";
          else if (newScore < 0.7) newStatus = "at_risk";

          await query(
            "UPDATE store_objects SET data = jsonb_set(jsonb_set(data, '{score}', $2::jsonb), '{status}', $3::jsonb) WHERE id = $1",
            [kr.id, JSON.stringify(newScore), JSON.stringify(newStatus)]
          );

          krUpdates.push({ title: kr.title, oldScore, newScore });
        }
      }

      // Compute objective score
      const krScores = krRes.rows.map((kr) => {
        const data = typeof kr.data === "string" ? JSON.parse(kr.data) : kr.data;
        return computeScore(data);
      });
      const objOldScore = Number(obj.data.score) || 0;
      const objNewScore = krScores.length > 0
        ? Math.round((krScores.reduce((a, b) => a + b, 0) / krScores.length) * 100) / 100
        : 0;

      if (Math.abs(objOldScore - objNewScore) > 0.005) {
        await query(
          "UPDATE store_objects SET data = jsonb_set(data, '{score}', $2::jsonb) WHERE id = $1",
          [obj.id, JSON.stringify(objNewScore)]
        );
      }

      updated.push({
        objective: obj.title,
        oldScore: objOldScore,
        newScore: objNewScore,
        krs: krUpdates,
      });
    }

    return {
      objectives_processed: updated.length,
      updates: updated,
      message: `Scored ${updated.length} objectives`,
    };
  });

  // ─── okr_report ───

  handlers.set("okr_report", async (input, _ctx) => {
    const { quarter } = input as { quarter?: string };
    const { objCollId, krCollId } = await getOKRCollectionIds();
    if (!objCollId || !krCollId) return { error: "OKR collections not found" };

    // Default to current quarter
    const now = new Date();
    const currentQ = `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`;
    const targetQuarter = quarter || currentQ;

    // Fetch objectives for quarter
    const objRes = await query<ObjRow>(
      "SELECT id, title, data, tags, status FROM store_objects WHERE collection_id = $1 AND status = 'active' ORDER BY created_at ASC",
      [objCollId]
    );
    const objectives = objRes.rows.filter((o) => o.data.quarter === targetQuarter);

    if (objectives.length === 0) {
      return { report: `No active objectives for ${targetQuarter}`, quarter: targetQuarter };
    }

    const sections: string[] = [];
    let totalScore = 0;
    let greenCount = 0, yellowCount = 0, redCount = 0;

    for (let i = 0; i < objectives.length; i++) {
      const obj = objectives[i];
      const objScore = Number(obj.data.score) || 0;
      totalScore += objScore;

      // Fetch KRs
      const krRes = await query(
        `SELECT t.id, t.title, t.data
         FROM store_objects t
         JOIN store_relations r ON r.target_id = t.id
         WHERE r.source_id = $1 AND r.relation = 'has_key_result' AND t.status = 'active'
         ORDER BY t.created_at ASC`,
        [obj.id]
      );

      const krLines: string[] = [];
      for (let j = 0; j < krRes.rows.length; j++) {
        const kr = krRes.rows[j];
        const d = typeof kr.data === "string" ? JSON.parse(kr.data) : kr.data;
        const score = computeScore(d);
        const grade = scoreGrade(score);
        if (grade === "green") greenCount++;
        else if (grade === "yellow") yellowCount++;
        else redCount++;

        const metricType = d.metric_type as string;
        const progress = metricType === "binary"
          ? (d.status === "achieved" ? "Done" : "Not done")
          : `${d.current || 0}/${d.target || 0} ${d.unit || ""}`;

        krLines.push(
          `  KR${j + 1}: ${kr.title} — ${progress} [${score.toFixed(1)}] ${grade.toUpperCase()} (${d.confidence || "medium"} confidence)`
        );
      }

      const objGrade = scoreGrade(objScore);
      sections.push(
        `O${i + 1}: ${obj.title} [${objScore.toFixed(1)}] ${objGrade.toUpperCase()} (${obj.data.type})\n${krLines.join("\n") || "  No key results"}`
      );
    }

    const overallScore = objectives.length > 0 ? totalScore / objectives.length : 0;

    const report = [
      `OKR Report: ${targetQuarter}`,
      `Overall Score: ${overallScore.toFixed(2)} ${scoreGrade(overallScore).toUpperCase()}`,
      `KR Health: ${greenCount} green, ${yellowCount} yellow, ${redCount} red`,
      "",
      ...sections,
    ].join("\n");

    return {
      report,
      quarter: targetQuarter,
      overall_score: Math.round(overallScore * 100) / 100,
      objectives_count: objectives.length,
      kr_health: { green: greenCount, yellow: yellowCount, red: redCount },
    };
  });

  // ─── okr_sync_things3 ───

  handlers.set("okr_sync_things3", async (_input, _ctx) => {
    return await syncToThings3();
  });

  // ─── okr_things3_progress ───

  handlers.set("okr_things3_progress", async (_input, _ctx) => {
    return readThings3Progress();
  });

  // ─── okr_checkin ───

  handlers.set("okr_checkin", async (input, ctx) => {
    const {
      kr_id, new_value, confidence, progress_note, blockers, priorities,
    } = input as {
      kr_id: string;
      new_value: number;
      confidence: number;
      progress_note?: string;
      blockers?: string;
      priorities?: string;
    };

    const { ciCollId } = await getOKRCollectionIds();
    if (!ciCollId) return { error: "OKR Check-ins collection not found" };

    // Get the KR
    const krRes = await query(
      "SELECT id, title, data FROM store_objects WHERE id = $1",
      [kr_id]
    );
    if (krRes.rows.length === 0) return { error: "Key Result not found" };
    const kr = krRes.rows[0];
    const krData = typeof kr.data === "string" ? JSON.parse(kr.data) : kr.data;
    const previousValue = Number(krData.current) || 0;

    // Calculate week string
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
    const week = `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;

    // Create check-in object
    const ciRes = await query(
      `INSERT INTO store_objects (collection_id, title, data, tags, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        ciCollId,
        `${week} Check-in: ${kr.title}`,
        JSON.stringify({
          week,
          confidence: Math.max(1, Math.min(10, confidence)),
          progress_note: progress_note || "",
          blockers: blockers || "",
          priorities: priorities || "",
          previous_value: previousValue,
          new_value: new_value,
        }),
        [week, "check-in"],
        `agent:${ctx.agentId}`,
      ]
    );

    // Link check-in to KR
    await query(
      `INSERT INTO store_relations (source_id, target_id, relation)
       VALUES ($1, $2, 'check_in_for')
       ON CONFLICT (source_id, target_id, relation) DO NOTHING`,
      [ciRes.rows[0].id, kr_id]
    );

    // Update KR current value and score
    const baseline = Number(krData.baseline) || 0;
    const target = Number(krData.target) || 0;
    const newScore = target === baseline ? 0 : Math.max(0, Math.min(1, (new_value - baseline) / (target - baseline)));
    let newStatus = "on_track";
    if (newScore >= 1.0) newStatus = "achieved";
    else if (newScore < 0.4) newStatus = "behind";
    else if (newScore < 0.7) newStatus = "at_risk";

    await query(
      `UPDATE store_objects SET data = data || $2::jsonb WHERE id = $1`,
      [kr_id, JSON.stringify({
        current: new_value,
        score: Math.round(newScore * 100) / 100,
        status: newStatus,
        confidence: confidence >= 7 ? "high" : confidence >= 4 ? "medium" : "low",
      })]
    );

    return {
      check_in_id: ciRes.rows[0].id,
      kr_id,
      kr_title: kr.title,
      week,
      previous_value: previousValue,
      new_value,
      score: Math.round(newScore * 100) / 100,
      status: newStatus,
    };
  });

  return handlers;
}

// ─── Tool Definitions ───

export function getOKRToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: "okr_score_all",
      description:
        "Recalculate scores for all active OKRs. Computes KR scores from current/baseline/target values, " +
        "then computes objective scores as the average of their KR scores. Updates the store.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "okr_report",
      description:
        "Generate a formatted OKR status report for a given quarter. Shows all objectives, " +
        "their key results with scores/progress, and overall health (green/yellow/red counts).",
      input_schema: {
        type: "object" as const,
        properties: {
          quarter: {
            type: "string",
            description: 'Period to report on — e.g. "Q1 2026" for quarterly or "2026" for annual. Defaults to current quarter.',
          },
        },
        required: [],
      },
    },
    {
      name: "okr_sync_things3",
      description:
        "Push active OKR objectives and key results to Things3. Creates projects (in OKRs area) " +
        "for new objectives and headings for KRs. Updates existing project titles with current progress.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "okr_things3_progress",
      description:
        "Read OKR project completion data from Things3. Returns task counts per project and heading " +
        "for the OKRs area.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "okr_checkin",
      description:
        "Create a weekly check-in for a specific Key Result. Records the new value, confidence (1-10), " +
        "progress notes, blockers, and priorities. Auto-updates the KR's current value and score.",
      input_schema: {
        type: "object" as const,
        properties: {
          kr_id: {
            type: "string",
            description: "The Key Result object UUID to check in on",
          },
          new_value: {
            type: "number",
            description: "The new current value for this KR metric",
          },
          confidence: {
            type: "number",
            description: "Confidence level 1-10 (1=no chance, 10=certain we'll hit target)",
          },
          progress_note: {
            type: "string",
            description: "What changed this week",
          },
          blockers: {
            type: "string",
            description: "Any blockers or risks",
          },
          priorities: {
            type: "string",
            description: "Top priorities for next week",
          },
        },
        required: ["kr_id", "new_value", "confidence"],
      },
    },
  ];
}
