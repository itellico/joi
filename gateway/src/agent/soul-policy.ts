export const SOUL_ROLLOUT_POLICY = {
  version: "2026-02-23",
  canary: {
    enabledByDefault: true,
    defaultTrafficPercent: 10,
    defaultDurationHours: 24,
    minimumSampleSize: 20,
    promotionCriteria: {
      maxReviewRejectRateDelta: 0.05,
      maxQaFailureRateDelta: 0.03,
      maxHighSeverityIncidents: 0,
    },
  },
  rollback: {
    immediateTriggers: [
      "critical_security_incident",
      "high_severity_policy_violation",
    ],
    thresholdTriggers: {
      reviewRejectRateDelta: 0.1,
      qaFailureRateDelta: 0.08,
      highSeverityIncidents: 1,
    },
    action: "revert_to_previous_active_version_and_open_review",
  },
} as const;

export type SoulRolloutPolicy = typeof SOUL_ROLLOUT_POLICY;
