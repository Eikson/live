import { createTask, loadTaskForm, updateTask } from '../../app/tasks';
import { appConfig } from '../../domain/app-config';
import type { FieldError } from '../../domain/planning';
import { normalizeTaskInput, type TaskField, type TaskInput } from '../../domain/task';
import { de } from '../../i18n/de';
import { h } from '../dom';
import { createEditForm } from '../edit-form';
import { formatDate } from '../format';
import { navigate, routeHref } from '../router';
import type { Screen } from '../screen';
import { message, textField, type TextField } from '../wizard';

const t = de.tasks;

type Draft = Record<TaskField, string>;

/** Meldung je Feld: Pflicht und Länge wie überall, „passt nicht“ mit dem konkreten Grund. */
function fieldMessage(field: TaskField, error: FieldError | undefined, max: number): string | undefined {
  if (error === 'INVALID') {
    if (field === 'plannedStartTime') return de.errors.invalidTime;
    return t.form.invalid[field] ?? de.errors.invalid;
  }
  return message(error, max);
}

function missingScreen(text: string): HTMLElement {
  return h(
    'section',
    { class: 'screen' },
    h('h1', { tabindex: '-1' }, text),
    h('a', { class: 'button', href: routeHref('plan') }, t.toPlan),
  );
}

/**
 * Vorhaben anlegen (`#/vorhaben-neu`) oder bearbeiten (`#/vorhaben-bearbeiten?id=…`): alle
 * Angaben auf einem Bildschirm. Ist der geplante Start erreicht, steht er nur noch als Text da.
 */
function taskFormScreen(mode: 'new' | 'edit'): Screen {
  return async ({ ctx, params }) => {
    const form = await loadTaskForm(ctx, mode === 'edit' ? (params.get('id') ?? '') : undefined);
    if (!form) return missingScreen(t.missing);
    if (!form.canAdd) return missingScreen(t.limit(appConfig.tasks.maxOpen));
    const task = form.task;
    const startFixed = task !== undefined && (task.startedOn !== undefined || task.plannedStart <= form.today);

    const d: Draft = {
      title: task?.title ?? '',
      deadline: task?.deadline ?? '',
      plannedStart: task?.plannedStart ?? form.today,
      plannedStartTime: task?.plannedStartTime ?? '',
      firstStep: task?.firstStep ?? '',
      estimateMinutes: task ? String(task.estimateMinutes) : '',
      reviewOn: task?.reviewOn ?? '',
    };
    const input = (): TaskInput => ({ ...d });
    const { short, long } = appConfig.textLimits;

    const editForm = createEditForm({
      heading: mode === 'edit' ? t.editHeading : t.newHeading,
      cancelHref: routeHref('plan'),
      view: () => {
        const make = (
          name: TaskField,
          opts: { label: string; hint?: string; max?: number; optional?: boolean; type?: string; attrs?: Record<string, string> },
        ): { name: TaskField; max: number; f: TextField } => {
          const max = opts.max ?? short;
          const f = textField({
            label: opts.label,
            value: d[name],
            max,
            name,
            ...(opts.hint ? { hint: opts.hint } : {}),
            ...(opts.optional ? { optional: true } : {}),
            onInput: (v) => (d[name] = v),
          });
          if (opts.type) (f.input as HTMLInputElement).type = opts.type;
          for (const [key, value] of Object.entries(opts.attrs ?? {})) f.input.setAttribute(key, value);
          return { name, max, f };
        };
        const dateAttrs = { min: form.today };
        const fields = [
          make('title', { label: t.form.title, hint: t.form.titleHint }),
          make('deadline', { label: t.form.deadline, type: 'date', attrs: dateAttrs }),
          ...(startFixed
            ? []
            : [
                make('plannedStart', { label: t.form.plannedStart, type: 'date', attrs: dateAttrs }),
                make('plannedStartTime', { label: t.form.plannedStartTime, hint: t.form.plannedStartTimeHint, type: 'time', optional: true }),
              ]),
          make('firstStep', { label: t.form.firstStep, hint: t.form.firstStepHint, max: long }),
          make('estimateMinutes', {
            label: t.form.estimate,
            type: 'number',
            attrs: { min: '1', max: String(appConfig.tasks.maxMinutes), step: '1', inputmode: 'numeric' },
          }),
          make('reviewOn', { label: t.form.review, hint: t.form.reviewHint, type: 'date', attrs: dateAttrs, optional: true }),
        ];
        const nodes: (Node | null)[] = fields.map((x) => x.f.field);
        if (startFixed && task) {
          nodes.splice(2, 0, h('p', { class: 'hint', 'data-role': 'start-fixed' }, t.form.plannedStartFixed(formatDate(task.plannedStart))));
        }
        return {
          nodes,
          check: () => {
            const { errors } = normalizeTaskInput(input(), form.today, task);
            let first: HTMLElement | undefined;
            for (const { name, max, f } of fields) {
              const msg = fieldMessage(name, errors[name], max);
              f.showError(msg);
              if (msg) first ??= f.input;
            }
            return first;
          },
        };
      },
      save: async () => {
        const result = task ? await updateTask(ctx, task.id, input()) : await createTask(ctx, input());
        if (result.ok) {
          navigate('plan', { replace: true, params: { meldung: task ? 'vorhaben-bearbeitet' : 'vorhaben', vorhaben: result.taskId } });
        } else if ('error' in result) navigate('plan', { replace: true });
        else throw new Error('invalid');
      },
    });

    editForm.render();
    return editForm.root;
  };
}

export const taskNewScreen = taskFormScreen('new');
export const taskEditScreen = taskFormScreen('edit');
