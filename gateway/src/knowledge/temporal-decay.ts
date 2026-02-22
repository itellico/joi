// Temporal decay scoring — ported from OpenClaw
// Exponential decay: score × e^(-λ × age_days)
// where λ = ln(2) / half_life_days

const DAY_MS = 24 * 60 * 60 * 1000;

export function toDecayLambda(halfLifeDays: number): number {
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) return 0;
  return Math.LN2 / halfLifeDays;
}

export function calculateTemporalDecayMultiplier(params: {
  ageInDays: number;
  halfLifeDays: number;
}): number {
  const lambda = toDecayLambda(params.halfLifeDays);
  const clampedAge = Math.max(0, params.ageInDays);
  if (lambda <= 0 || !Number.isFinite(clampedAge)) return 1;
  return Math.exp(-lambda * clampedAge);
}

export function applyTemporalDecayToScore(params: {
  score: number;
  ageInDays: number;
  halfLifeDays: number;
}): number {
  return params.score * calculateTemporalDecayMultiplier(params);
}

export function ageInDaysFromDate(date: Date, now?: Date): number {
  const nowMs = (now ?? new Date()).getTime();
  const ageMs = Math.max(0, nowMs - date.getTime());
  return ageMs / DAY_MS;
}

// Apply decay to an array of search results with timestamps
export function applyDecayToResults<T extends { score: number; createdAt: Date }>(
  results: T[],
  halfLifeDays: number,
  now?: Date,
): T[] {
  if (halfLifeDays <= 0) return [...results];

  return results.map((r) => ({
    ...r,
    score: applyTemporalDecayToScore({
      score: r.score,
      ageInDays: ageInDaysFromDate(r.createdAt, now),
      halfLifeDays,
    }),
  }));
}
