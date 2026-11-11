/** Zentrale App-Parameter. Änderungen nur im Code. */
export const appConfig = {
  maxBuildingHabits: 2,
  checkInBackfillDays: 7,
  recovery: { daysWithoutAnyEntry: 5, minMissedPlannedOpportunities: 2 },
  review: { defaultWeekday: 0 /* Sonntag */, automaticityEveryNthReview: 4, suggestionSnoozeDays: 28 },
  /** Startwert; in den Einstellungen änderbar (docs/entscheidungen.md, E-001). */
  eveningCardFrom: '18:00',
  backupReminderDays: 14,
  counterHabitSoftHintAbove: 5, // ab hier Hinweis: Abend-Check-in wird länger als 30 s
  /** Vorhaben: höchstens so viele offen; Kennzahlen über so viele Tage und erst ab so vielen Werten. */
  tasks: { maxOpen: 3, metricsDays: 84, minForMedian: 3, startWindowMinutes: 15, maxMinutes: 6000 },
  import: { maxFileBytes: 20 * 1024 * 1024 },
  /** Längenbegrenzungen für Nutzertexte (Zeichen). */
  textLimits: { short: 120, long: 500, note: 1000 },
} as const;
