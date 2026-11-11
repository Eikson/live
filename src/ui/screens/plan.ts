import { loadPlanView, type PlanHabit, type PlanView } from '../../app/plan';
import { activateHabit, changeHabitStatus, deleteGoal, deleteHabit } from '../../app/planning';
import { deleteTask, dropTask } from '../../app/tasks';
import { appConfig } from '../../domain/app-config';
import { icsFileName, taskIcs } from '../../domain/ics';
import { formatCopingPlan, formatIntention } from '../../domain/planning';
import type { Task } from '../../domain/types';
import { de } from '../../i18n/de';
import { h, type Child } from '../dom';
import { downloadText } from '../../platform/files';
import { formatCue, formatDate, formatDayMonth, formatSchedule } from '../format';
import { routeHref } from '../router';
import type { Screen } from '../screen';

type Status = { text: string; error?: boolean };

type HabitAction = 'ACTIVATE' | 'PAUSE' | 'RESUME' | 'ARCHIVE' | 'DELETE';
type TaskAction = 'CALENDAR' | 'DROP' | 'DELETE';

interface Handlers {
  habit(action: HabitAction, habitId: string): void;
  deleteGoal(goalId: string): void;
  task(action: TaskAction, task: Task): void;
}

/** Eine Aktion an einem Habit oder Ziel; der Name des Objekts steht für Screenreader dabei. */
interface ActionSpec {
  key: string;
  label: string;
  target: string;
  href?: string;
  run?: () => void;
  /** Rückfrage vor endgültigen Aktionen (Archivieren, Löschen), direkt an Ort und Stelle. */
  confirm?: { question: string; yes: string };
}

/** Meldungen nach dem Bearbeiten (Parameter `meldung`). */
const MESSAGES: Record<string, string> = {
  bearbeitet: de.plan.edited,
  unveraendert: de.plan.unchanged,
  ziel: de.plan.goalSaved,
  'gegen-habit': de.plan.counterSaved,
  vorhaben: de.tasks.saved,
  'vorhaben-bearbeitet': de.tasks.edited,
};

function actionBar(specs: ActionSpec[], extra: Child[] = []): HTMLElement {
  const bar = h('div', { class: 'actions item-actions' });
  // Sichtbar steht nur die Aktion; Screenreader hören, worauf sie sich bezieht.
  const named = (s: ActionSpec, text = s.label) => ({ 'aria-label': `${text}: ${s.target}`, 'data-action': s.key });

  const runSpec = (s: ActionSpec, button: HTMLButtonElement) => {
    for (const b of bar.querySelectorAll('button')) b.disabled = true;
    button.textContent = de.common.busy;
    s.run?.();
  };

  const show = (focusKey?: string) => {
    const nodes = specs.map((s) => {
      if (s.href) return h('a', { class: 'button quiet', href: s.href, ...named(s) }, s.label);
      const button: HTMLButtonElement = h(
        'button',
        {
          type: 'button',
          class: 'button quiet',
          ...named(s),
          onclick: () => (s.confirm ? ask(s) : runSpec(s, button)),
        },
        s.label,
      );
      return button;
    });
    bar.replaceChildren(...nodes, ...extra.filter((n): n is Node => n instanceof Node));
    if (focusKey) bar.querySelector<HTMLElement>(`[data-action="${focusKey}"]`)?.focus();
  };

  const ask = (s: ActionSpec) => {
    const question = h('p', { class: 'confirm-text', tabindex: '-1', 'data-role': 'confirm' }, s.confirm!.question);
    const yes: HTMLButtonElement = h(
      'button',
      { type: 'button', class: 'button', ...named(s, s.confirm!.yes), 'data-action': `${s.key}-confirm`, onclick: () => runSpec(s, yes) },
      s.confirm!.yes,
    );
    const no = h('button', { type: 'button', class: 'button quiet', onclick: () => show(s.key) }, de.common.cancel);
    bar.replaceChildren(h('div', { class: 'confirm' }, question, h('div', { class: 'actions' }, yes, no)));
    question.focus();
  };

  show();
  return bar;
}

function habitActions(item: PlanHabit, view: PlanView, on: Handlers): HTMLElement {
  const { habit } = item;
  const target = habit.actionText;
  const run = (action: HabitAction) => () => on.habit(action, habit.id);
  const edit: ActionSpec = { key: 'edit', label: de.plan.edit, target, href: routeHref('gewohnheit-bearbeiten', { id: habit.id }) };
  const archive: ActionSpec = {
    key: 'archive',
    label: de.plan.archive,
    target,
    run: run('ARCHIVE'),
    confirm: { question: de.plan.archiveQuestion, yes: de.plan.confirmArchive },
  };
  const remove: ActionSpec = {
    key: 'delete',
    label: de.plan.delete,
    target,
    run: run('DELETE'),
    confirm: { question: de.plan.deleteQuestion, yes: de.plan.confirmDelete },
  };

  switch (habit.status) {
    case 'ACTIVE':
      return actionBar([edit, { key: 'pause', label: de.plan.pause, target, run: run('PAUSE') }, archive, remove]);
    case 'PAUSED':
      return item.canResume
        ? actionBar([{ key: 'resume', label: de.plan.resume, target, run: run('RESUME') }, edit, archive, remove])
        : actionBar([edit, archive, remove], [h('p', { class: 'hint' }, de.plan.resumeBlocked(appConfig.maxBuildingHabits))]);
    case 'DRAFT':
      return view.hasFreeSlot
        ? actionBar([{ key: 'activate', label: de.plan.activate, target, run: run('ACTIVATE') }, edit, archive, remove])
        : actionBar([edit, archive, remove], [h('p', { class: 'hint' }, de.plan.activateBlocked(appConfig.maxBuildingHabits))]);
    default:
      return actionBar([remove]);
  }
}

function habitItem(item: PlanHabit, view: PlanView, on: Handlers, opts: { showGoal?: boolean; open?: boolean } = {}): HTMLElement {
  const { habit, badge } = item;
  const rows: [string, Child | Child[]][] = [];
  if (opts.showGoal && item.goalTitle) rows.push([de.plan.goalOf, item.goalTitle]);
  if (habit.cue) rows.push([de.plan.cue, formatCue(habit.cue)]);
  if (habit.intention) rows.push([de.plan.intention, formatIntention(habit.intention)]);
  if (habit.minimumText) rows.push([de.plan.minimum, habit.minimumText]);
  if (habit.copingPlans.length > 0) {
    rows.push([de.plan.coping, habit.copingPlans.map((p) => h('span', { class: 'fact-line' }, formatCopingPlan(p)))]);
  }
  // Gegen-Habits werden jeden Abend gefragt; ein Rhythmus gehört nicht zu ihnen.
  const counter = habit.kind !== 'BUILD';
  if (!counter) rows.push([de.plan.rhythm, formatSchedule(habit.schedule)]);
  rows.push([de.plan.weightLabel, String(habit.weight)]);

  return h(
    'li',
    { 'data-habit': habit.id },
    h(
      'details',
      { class: 'habit-item', open: opts.open },
      h(
        'summary',
        null,
        h('span', { class: 'habit-item__title' }, habit.actionText),
        h(
          'span',
          { class: 'habit-item__meta' },
          counter && habit.status === 'ACTIVE'
            ? de.plan.weight(habit.weight)
            : `${de.plan.weight(habit.weight)} · ${de.plan.status[badge]}`,
        ),
      ),
      h(
        'dl',
        { class: 'facts' },
        rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, ...(Array.isArray(v) ? v : [v]))]),
      ),
      habit.kind === 'COUNTER_AVOIDANCE'
        ? h('a', { class: 'button link', href: routeHref('ausweichliste'), 'data-role': 'edit-avoidance' }, de.plan.editList)
        : null,
      habitActions(item, view, on),
    ),
  );
}

/** Kalendereintrag für den geplanten Start als Datei; Live selbst erinnert nicht. */
function downloadCalendarEntry(task: Task, createdAt: string): string {
  const file = icsFileName(task.title);
  const text = taskIcs(task, createdAt, {
    summary: de.tasks.ics.summary,
    description: (x) => de.tasks.ics.description(x.firstStep, formatDate(x.deadline)),
  });
  downloadText(file, text, 'text/calendar');
  return file;
}

function taskFacts(task: Task): [string, Child | Child[]][] {
  const t = de.tasks.plan;
  const rows: [string, Child | Child[]][] = [
    [t.deadline, formatDate(task.deadline)],
    [t.plannedStart, task.plannedStartTime ? `${formatDate(task.plannedStart)}, ${task.plannedStartTime} Uhr` : formatDate(task.plannedStart)],
  ];
  if (task.startedOn) rows.push([t.startedOn, formatDate(task.startedOn)]);
  if (task.finishedOn) rows.push([t.finishedOn, formatDate(task.finishedOn)]);
  rows.push([t.firstStep, task.firstStep], [t.estimate, t.minutes(task.estimateMinutes)]);
  if (task.actualMinutes !== undefined) rows.push([t.actual, t.minutes(task.actualMinutes)]);
  rows.push([
    t.review,
    task.reviewOn === undefined
      ? t.reviewNone
      : task.reviewDoneOn !== undefined
        ? de.tasks.card.reviewGot(formatDate(task.reviewDoneOn))
        : de.tasks.card.reviewUntil(formatDate(task.reviewOn)),
  ]);
  if (task.deferrals.length > 0) {
    rows.push([
      t.deferrals,
      task.deferrals.map((d) => h('span', { class: 'fact-line' }, t.deferral(formatDayMonth(d.from), formatDayMonth(d.to), d.reason))),
    ]);
  }
  return rows;
}

function taskEntry(task: Task, meta: string, actions: HTMLElement, open: boolean): HTMLElement {
  return h(
    'li',
    { 'data-task': task.id },
    h(
      'details',
      { class: 'habit-item', open },
      h('summary', null, h('span', { class: 'habit-item__title' }, task.title), h('span', { class: 'habit-item__meta' }, meta)),
      h(
        'dl',
        { class: 'facts' },
        taskFacts(task).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, ...(Array.isArray(v) ? v : [v]))]),
      ),
      actions,
    ),
  );
}

function tasksSection(view: PlanView, highlight: string | null, on: Handlers): HTMLElement {
  const t = de.tasks;
  const { open, closed, canAdd } = view.tasks;
  const titleId = 'plan-tasks-title';
  const remove = (task: Task): ActionSpec => ({
    key: 'delete-task',
    label: t.plan.delete,
    target: task.title,
    run: () => on.task('DELETE', task),
    confirm: { question: t.plan.deleteQuestion, yes: de.plan.confirmDelete },
  });
  return h(
    'section',
    { class: 'card tasks', 'aria-labelledby': titleId, 'data-role': 'tasks' },
    h('h2', { id: titleId }, t.heading),
    h('p', { class: 'muted' }, t.intro),
    open.length > 0
      ? h(
          'ul',
          { class: 'habit-list' },
          open.map(({ task, phase }) =>
            taskEntry(
              task,
              `${t.plan.phases[phase]} · ${t.plan.deadline} ${formatDayMonth(task.deadline)}`,
              actionBar([
                { key: 'edit-task', label: t.plan.edit, target: task.title, href: routeHref('vorhaben-bearbeiten', { id: task.id }) },
                ...(task.startedOn === undefined
                  ? [{ key: 'calendar', label: t.plan.calendar, target: task.title, run: () => on.task('CALENDAR', task) }]
                  : []),
                {
                  key: 'drop-task',
                  label: t.plan.drop,
                  target: task.title,
                  run: () => on.task('DROP', task),
                  confirm: { question: t.plan.dropQuestion, yes: t.plan.dropConfirm },
                },
                remove(task),
              ]),
              task.id === highlight,
            ),
          ),
        )
      : h('p', { class: 'muted' }, t.empty),
    canAdd
      ? h('a', { class: 'button quiet add-link', href: routeHref('vorhaben-neu'), 'aria-label': t.addLabel }, t.add)
      : h('p', { class: 'hint', 'data-role': 'task-limit' }, t.limit(appConfig.tasks.maxOpen)),
    closed.length > 0
      ? h(
          'details',
          { class: 'plan-group task-closed', 'data-group': 'tasks-closed' },
          h('summary', null, `${t.plan.closed} (${closed.length})`),
          h(
            'ul',
            { class: 'habit-list' },
            closed.map((task) => taskEntry(task, t.plan.closedStatus[task.status]!, actionBar([remove(task)]), false)),
          ),
        )
      : null,
  );
}

export const planScreen: Screen = async ({ ctx, params }) => {
  const section = h('section', { class: 'screen' });
  const saved = params.get('gespeichert');
  const notice = params.get('meldung');
  let highlight = saved ?? params.get('vorhaben');
  let status: Status | undefined = notice && MESSAGES[notice] ? { text: MESSAGES[notice] } : undefined;
  if (saved || notice) {
    // Die Meldung gilt nur für diesen Aufruf; die Adresse wird ohne Parameter ersetzt.
    history.replaceState(null, '', routeHref('plan'));
  }

  async function fill(focusStatus: boolean): Promise<void> {
    const view = await loadPlanView(ctx);
    if (saved && !status) {
      const draft = view.drafts.some((d) => d.habit.id === saved);
      status = { text: draft ? de.plan.savedDraft : de.plan.savedActive };
    }
    section.replaceChildren(...build(view, highlight, status, handlers));
    if (focusStatus) section.querySelector<HTMLElement>('[data-role="plan-status"]')?.focus();
  }

  async function perform(run: () => Promise<Status>): Promise<void> {
    try {
      status = await run();
    } catch {
      status = { text: de.errors.saveFailed, error: true };
    }
    await fill(true);
  }

  const failed: Status = { text: de.errors.saveFailed, error: true };
  const blocked: Status = { text: de.plan.activateBlocked(appConfig.maxBuildingHabits), error: true };

  const handlers: Handlers = {
    habit(action, habitId) {
      highlight = habitId;
      void perform(async () => {
        switch (action) {
          case 'ACTIVATE': {
            const r = await activateHabit(ctx, habitId);
            return r.ok ? { text: de.plan.activated } : r.reason === 'BUILD_LIMIT_REACHED' ? blocked : failed;
          }
          case 'RESUME': {
            const r = await changeHabitStatus(ctx, habitId, 'RESUME');
            if (r.ok) return { text: de.plan.resumed };
            return r.reason === 'BUILD_LIMIT_REACHED'
              ? { text: de.plan.resumeBlocked(appConfig.maxBuildingHabits), error: true }
              : failed;
          }
          case 'PAUSE':
            return (await changeHabitStatus(ctx, habitId, 'PAUSE')).ok ? { text: de.plan.pausedDone } : failed;
          case 'ARCHIVE':
            return (await changeHabitStatus(ctx, habitId, 'ARCHIVE')).ok ? { text: de.plan.archivedDone } : failed;
          case 'DELETE':
            return (await deleteHabit(ctx, habitId)).ok ? { text: de.plan.deleted } : failed;
        }
      });
    },
    deleteGoal(goalId) {
      void perform(async () => ((await deleteGoal(ctx, goalId)).ok ? { text: de.plan.goalDeleted } : failed));
    },
    task(action, task) {
      highlight = task.id;
      void perform(async () => {
        switch (action) {
          case 'CALENDAR':
            try {
              return { text: de.tasks.plan.calendarSaved(downloadCalendarEntry(task, ctx.clock.now().toISOString())) };
            } catch {
              return { text: de.tasks.plan.calendarFailed, error: true };
            }
          case 'DROP':
            return (await dropTask(ctx, task.id)).ok ? { text: de.tasks.plan.dropped } : failed;
          case 'DELETE':
            return (await deleteTask(ctx, task.id)).ok ? { text: de.tasks.plan.deleted } : failed;
        }
      });
    },
  };

  await fill(false);
  return section;
};

function build(view: PlanView, highlight: string | null, status: Status | undefined, on: Handlers): Node[] {
  const nodes: Node[] = [
    h('h1', { tabindex: '-1' }, de.plan.heading),
    h(
      'p',
      {
        class: status?.error ? 'form-error' : 'status-line',
        role: 'status',
        tabindex: '-1',
        'data-role': 'plan-status',
      },
      status?.text ?? '',
    ),
  ];

  if (view.goals.length === 0) nodes.push(h('p', { class: 'muted' }, de.plan.empty));

  const others = [...view.drafts, ...view.paused, ...view.archived];
  for (const { goal, habits } of view.goals) {
    const meta = [
      goal.why ? `${de.plan.why}: ${goal.why}` : undefined,
      goal.successSignal ? `${de.plan.successSignal}: ${goal.successSignal}` : undefined,
    ].filter((x): x is string => Boolean(x));
    const habitCount = habits.length + others.filter((i) => i.habit.goalId === goal.id).length;
    nodes.push(
      h(
        'article',
        { class: 'card goal', 'data-goal': goal.id },
        h('h2', null, de.plan.goal(goal.title)),
        meta.map((m) => h('p', { class: 'muted' }, m)),
        habits.length > 0
          ? h(
              'ul',
              { class: 'habit-list' },
              habits.map((item) => habitItem(item, view, on, { open: item.habit.id === highlight })),
            )
          : h('p', { class: 'muted' }, de.plan.noHabits),
        h(
          'a',
          {
            class: 'button quiet add-link',
            href: routeHref('gewohnheit-neu', { ziel: goal.id }),
            'aria-label': de.plan.addHabitFor(goal.title),
          },
          de.plan.addHabit,
        ),
        actionBar([
          { key: 'edit-goal', label: de.plan.editGoal, target: goal.title, href: routeHref('ziel-bearbeiten', { id: goal.id }) },
          {
            key: 'delete-goal',
            label: de.plan.deleteGoal,
            target: goal.title,
            run: () => on.deleteGoal(goal.id),
            confirm: { question: de.plan.deleteGoalQuestion(habitCount), yes: de.plan.confirmDelete },
          },
        ]),
      ),
    );
  }

  nodes.push(tasksSection(view, highlight, on));

  const countersTitle = 'plan-counters-title';
  nodes.push(
    h(
      'section',
      { class: 'card counters', 'aria-labelledby': countersTitle, 'data-role': 'counters' },
      h('h2', { id: countersTitle }, de.plan.counters),
      view.counters.length > 0
        ? h(
            'ul',
            { class: 'habit-list' },
            view.counters.map((item) => habitItem(item, view, on, { open: item.habit.id === highlight })),
          )
        : h('p', { class: 'muted' }, de.plan.countersEmpty),
      view.counterHint ? h('p', { class: 'hint' }, de.plan.counterHint) : null,
      h(
        'a',
        { class: 'button quiet add-link', href: routeHref('gegen-habit-neu'), 'aria-label': de.plan.addCounterLabel },
        de.plan.addCounter,
      ),
    ),
  );

  const groups: [string, string, PlanHabit[]][] = [
    ['drafts', de.plan.drafts, view.drafts],
    ['paused', de.plan.paused, view.paused],
    ['archived', de.plan.archived, view.archived],
  ];
  nodes.push(
    h(
      'div',
      { class: 'plan-groups' },
      groups.map(([key, label, items]) =>
        h(
          'details',
          { class: 'card plan-group', 'data-group': key, open: items.some((i) => i.habit.id === highlight) },
          h('summary', null, `${label} (${items.length})`),
          items.length > 0
            ? h(
                'ul',
                { class: 'habit-list' },
                items.map((item) => habitItem(item, view, on, { showGoal: true, open: item.habit.id === highlight })),
              )
            : h('p', { class: 'muted' }, de.plan.groupEmpty),
        ),
      ),
    ),
    h('a', { class: 'button', href: routeHref('ziel-neu'), 'aria-label': de.plan.addGoalLabel }, de.plan.addGoal),
  );
  return nodes;
}
