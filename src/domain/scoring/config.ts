/**
 * Zentrale Score-Parameter. Diese Werte sind Produktannahmen, keine
 * wissenschaftlich belegten Schwellen. Änderungen nur im Code.
 */
export const scoringConfig = {
  fulfillment: {
    score: { DONE: 1, ALTERNATIVE: 1, MINIMAL: 0.5, NOT_DONE: 0 },
    quota: { DONE: 1, ALTERNATIVE: 1, MINIMAL: 1, NOT_DONE: 0 },
    procrastination: { NO: 1, PARTIAL: 0.5, YES: 0 },
    custom: { KEPT: 1, PARTIAL: 0.5, BROKEN: 0 },
    avoidance: { NONE_CHECKED: 1, ANY_CHECKED: 0 },
  },
  weight: { min: 1, max: 3, default: 1 },
  integration: {
    windowDays: 30,
    enterAt: 0.8,
    exitBelow: 0.5,
    minCoverage: 2 / 3,
    minDaysSinceActivation: 30,
  },
  corridor: { floorFactor: 0.6 },
  warning: {
    tolerance: 0.6,
    toleranceLowWellbeing: 0.4,
    lowWellbeingMax: 2,
    patternWindowDays: 7,
    patternMinDaysBelow: 5,
    avgWindowDays: 28,
    avgMinDays: 14,
    cardCooldownDays: 7,
  },
  comparison: { offsetDays: 182, windowDays: 28, minDays: 14 },
} as const;
