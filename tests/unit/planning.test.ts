import { describe, expect, it } from 'vitest';
import {
  formatIntention,
  normalizeGoalInput,
  normalizeHabitInput,
  suggestIntention,
  type HabitInput,
} from '../../src/domain/planning';

const build = (overrides: Partial<HabitInput> = {}): HabitInput => ({
  kind: 'BUILD',
  actionText: '10 Minuten spazieren',
  minimumText: '2 Minuten vor die Tür',
  cue: { type: 'ROUTINE', description: 'Nach dem Mittagessen' },
  ...overrides,
});

describe('planning', () => {
  it('Ziel: Titel ist Pflicht, Texte werden getrimmt, leere optionale Felder entfallen', () => {
    expect(normalizeGoalInput({ title: '   ' }).errors).toEqual({ title: 'REQUIRED' });
    const ok = normalizeGoalInput({ title: '  Mehr Bewegung ', why: ' ', successSignal: 'Treppe ohne Pause' });
    expect(ok.errors).toEqual({});
    expect(ok.value).toEqual({ title: 'Mehr Bewegung', successSignal: 'Treppe ohne Pause' });
    expect(normalizeGoalInput({ title: 'x'.repeat(121) }).errors.title).toBe('TOO_LONG');
  });

  it('BUILD-Habit braucht Handlung, Auslöser und kleinste Version', () => {
    const r = normalizeHabitInput({ kind: 'BUILD', actionText: '' });
    expect(r.errors).toEqual({ actionText: 'REQUIRED', minimumText: 'REQUIRED', cue: 'REQUIRED' });
    const ok = normalizeHabitInput(build());
    expect(ok.errors).toEqual({});
    expect(ok.value.schedule).toEqual({ type: 'DAILY' });
    expect(ok.value.weight).toBe(1);
  });

  it('Uhrzeit-Auslöser braucht eine gültige Uhrzeit, die Beschreibung ist optional', () => {
    expect(normalizeHabitInput(build({ cue: { type: 'TIME' } })).errors.cue).toBe('REQUIRED');
    expect(normalizeHabitInput(build({ cue: { type: 'TIME', time: '25:00' } })).errors.cue).toBe('INVALID');
    const ok = normalizeHabitInput(build({ cue: { type: 'TIME', time: '07:30' } }));
    expect(ok.errors).toEqual({});
    expect(ok.value.cue).toEqual({ type: 'TIME', description: '', time: '07:30' });
    expect(normalizeHabitInput(build({ cue: { type: 'EVENT', description: ' ' } })).errors.cue).toBe('REQUIRED');
  });

  it('Wenn-dann: beide Teile oder keiner', () => {
    expect(normalizeHabitInput(build({ intention: { ifText: 'x', thenText: '' } })).errors.intention).toBe('REQUIRED');
    const none = normalizeHabitInput(build({ intention: { ifText: ' ', thenText: '' } }));
    expect(none.errors).toEqual({});
    expect(none.value.intention).toBeUndefined();
  });

  it('Gewicht nur 1 bis 3, Wochentage werden normalisiert', () => {
    expect(normalizeHabitInput(build({ weight: 4 })).errors.weight).toBe('INVALID');
    expect(normalizeHabitInput(build({ weight: 1.5 })).errors.weight).toBe('INVALID');
    const r = normalizeHabitInput(build({ schedule: { type: 'WEEKDAYS', days: [5, 1, 1] } }));
    expect(r.value.schedule).toEqual({ type: 'WEEKDAYS', days: [1, 5] });
    expect(normalizeHabitInput(build({ schedule: { type: 'WEEKDAYS', days: [] } })).errors.schedule).toBe('INVALID');
  });

  it('Gegen-Habits sind täglich und haben keine kleinste Version', () => {
    const r = normalizeHabitInput({
      kind: 'COUNTER_CUSTOM',
      actionText: 'Kein Handy im Bett',
      minimumText: 'egal',
      schedule: { type: 'WEEKDAYS', days: [1] },
    });
    expect(r.errors).toEqual({});
    expect(r.value.schedule).toEqual({ type: 'DAILY' });
    expect(r.value.minimumText).toBeUndefined();
  });

  it('Bewältigungspläne: höchstens 3, jeweils beide Teile', () => {
    const plan = { obstacle: 'Regen', response: 'Schirm' };
    expect(normalizeHabitInput(build({ copingPlans: [plan, plan, plan, plan] })).errors.copingPlans).toBe('TOO_LONG');
    expect(normalizeHabitInput(build({ copingPlans: [{ obstacle: 'Regen', response: '' }] })).errors.copingPlans).toBe(
      'REQUIRED',
    );
    expect(normalizeHabitInput(build({ copingPlans: [{ obstacle: '', response: '' }] })).value.copingPlans).toEqual([]);
  });

  it('schlägt einen lesbaren Wenn-dann-Satz vor', () => {
    const routine = suggestIntention({ type: 'ROUTINE', description: 'Nach dem Mittagessen' }, '10 Minuten spazieren');
    expect(routine).toEqual({ ifText: 'nach dem Mittagessen', thenText: '10 Minuten spazieren' });
    expect(formatIntention(routine!)).toBe('Wenn nach dem Mittagessen, dann 10 Minuten spazieren.');

    const event = suggestIntention({ type: 'EVENT', description: 'Wenn ich nach Hause komme' }, 'Schuhe ausziehen');
    expect(event?.ifText).toBe('ich nach Hause komme');

    const noun = suggestIntention({ type: 'EVENT', description: 'Feierabend' }, 'Laufen');
    expect(noun?.ifText).toBe('Feierabend');

    const time = suggestIntention({ type: 'TIME', description: '', time: '07:30' }, 'Wasser trinken');
    expect(time?.ifText).toBe('es 07:30 Uhr ist');

    expect(suggestIntention(undefined, 'x')).toBeUndefined();
    expect(suggestIntention({ type: 'ROUTINE', description: 'x' }, '  ')).toBeUndefined();
  });
});
