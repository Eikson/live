import {
  loadHistoryView,
  type CalendarHabit,
  type CalendarMark,
  type ChartMarker,
  type HistoryView,
  type MonthView,
  type WeekRow,
} from '../../app/history';
import type { Comparison } from '../../domain/scoring/comparison';
import { dayOfMonth, weekdayOf, type LocalDate } from '../../domain/local-date';
import { de } from '../../i18n/de';
import { h, svg, uid } from '../dom';
import { formatDayMonth, formatDayShort, formatDecimal, formatMonth, WEEK_ORDER } from '../format';
import { routeHref } from '../router';
import type { Screen } from '../screen';

const t = de.history;

/* Diagramm-Geometrie im viewBox-Raster. Die Breite folgt beim Aufbau grob dem Bildschirm, damit
   Schrift und Punkte auf dem Handy nicht schrumpfen; danach skaliert das SVG mit der Spalte. */
let W = 640;

function fitChartWidth(): void {
  W = Math.round(Math.min(700, Math.max(300, window.innerWidth - 64)));
}
const PAD = { left: 36, right: 12, top: 12, bottom: 30 };
const PLOT_H = 170;
const MARKER_ROW = 16;

interface Plot {
  x(i: number): number;
  y(v: number): number;
  bottom: number;
}

function plot(n: number, min: number, max: number): Plot {
  const width = W - PAD.left - PAD.right;
  const step = n > 1 ? width / (n - 1) : 0;
  const bottom = PAD.top + PLOT_H;
  return {
    x: (i) => PAD.left + i * step,
    y: (v) => bottom - ((v - min) / (max - min || 1)) * PLOT_H,
    bottom,
  };
}

/** Zusammenhängende Abschnitte, in denen `has` gilt (Lücken unterbrechen Linie und Band). */
function segments<T>(items: readonly T[], has: (item: T) => boolean): number[][] {
  const out: number[][] = [];
  let current: number[] = [];
  items.forEach((item, i) => {
    if (has(item)) current.push(i);
    else if (current.length) {
      out.push(current);
      current = [];
    }
  });
  if (current.length) out.push(current);
  return out;
}

function axis(p: Plot, ticks: number[], dates: readonly LocalDate[]): SVGGElement {
  const g = svg('g', { class: 'chart-axis', 'aria-hidden': 'true' });
  for (const v of ticks) {
    g.append(
      svg('line', { x1: PAD.left, x2: W - PAD.right, y1: p.y(v), y2: p.y(v), class: 'chart-grid' }),
      svg('text', { x: PAD.left - 6, y: p.y(v) + 4, 'text-anchor': 'end' }, Number.isInteger(v) ? String(v) : formatDecimal(v)),
    );
  }
  const last = dates.length - 1;
  const labelled = last > 0 ? [0, Math.round(last / 2), last] : [0];
  labelled.forEach((i, k) => {
    const date = dates[i];
    if (!date) return;
    const anchor = k === 0 ? 'start' : k === labelled.length - 1 ? 'end' : 'middle';
    g.append(svg('text', { x: p.x(i), y: p.bottom + 18, 'text-anchor': anchor }, formatDayMonth(date)));
  });
  return g;
}

function chartFrame(titleText: string, descText: string, height: number): { root: SVGSVGElement } {
  const titleId = uid('chart-title');
  const descId = uid('chart-desc');
  const root = svg(
    'svg',
    {
      viewBox: `0 0 ${W} ${height}`,
      class: 'chart',
      role: 'img',
      'aria-labelledby': `${titleId} ${descId}`,
    },
    svg('title', { id: titleId }, titleText),
    svg('desc', { id: descId }, descText),
  );
  return { root };
}

function levelChart(view: HistoryView): SVGSVGElement {
  const days = view.level.chart;
  let max = 1;
  for (const d of days) max = Math.max(max, d.score ?? 0, d.avg?.ceiling ?? 0);
  max = Math.ceil(max);
  const p = plot(days.length, 0, max);
  const markerRows = Math.max(1, ...countByDay(view.level.markers));
  const height = p.bottom + PAD.bottom + markerRows * MARKER_ROW;
  const { root } = chartFrame(t.chartTitle, t.chartDesc, height);
  root.append(axis(p, [0, max / 2, max], days.map((d) => d.date)));

  for (const seg of segments(days, (d) => d.avg !== undefined)) {
    const upper = seg.map((i) => `${p.x(i)},${p.y(days[i]!.avg!.ceiling)}`);
    const lower = [...seg].reverse().map((i) => `${p.x(i)},${p.y(days[i]!.avg!.floor)}`);
    root.append(svg('polygon', { points: [...upper, ...lower].join(' '), class: 'chart-band' }));
    root.append(svg('polyline', { points: seg.map((i) => `${p.x(i)},${p.y(days[i]!.avg!.score)}`).join(' '), class: 'chart-line' }));
  }
  days.forEach((d, i) => {
    if (d.score !== undefined) root.append(svg('circle', { cx: p.x(i), cy: p.y(d.score), r: 3.5, class: 'chart-point' }));
  });

  const index = new Map(days.map((d, i) => [d.date, i]));
  const stacked = new Map<LocalDate, number>();
  for (const m of view.level.markers) {
    const i = index.get(m.date);
    if (i === undefined) continue;
    const row = stacked.get(m.date) ?? 0;
    stacked.set(m.date, row + 1);
    const info = t.markers[m.kind];
    root.append(
      svg(
        'text',
        { x: p.x(i), y: p.bottom + PAD.bottom + row * MARKER_ROW + 10, 'text-anchor': 'middle', class: `chart-marker marker-${m.kind.toLowerCase()}` },
        svg('title', {}, `${info.label}, ${formatDayShort(m.date)}`),
        info.symbol,
      ),
    );
  }
  return root;
}

function countByDay(markers: readonly ChartMarker[]): number[] {
  const counts = new Map<LocalDate, number>();
  for (const m of markers) counts.set(m.date, (counts.get(m.date) ?? 0) + 1);
  return [...counts.values()];
}

function wellbeingChart(view: HistoryView): SVGSVGElement {
  const days = view.wellbeing.chart;
  const p = plot(days.length, 1, 5);
  const { root } = chartFrame(t.wellbeingChartTitle, t.wellbeingChartDesc, p.bottom + PAD.bottom);
  root.append(axis(p, [1, 2, 3, 4, 5], days.map((d) => d.date)));
  for (const seg of segments(days, (d) => d.avg !== undefined)) {
    root.append(svg('polyline', { points: seg.map((i) => `${p.x(i)},${p.y(days[i]!.avg!)}`).join(' '), class: 'chart-line' }));
  }
  days.forEach((d, i) => {
    if (d.value !== undefined) root.append(svg('circle', { cx: p.x(i), cy: p.y(d.value), r: 3.5, class: 'chart-point' }));
  });
  return root;
}

function legend(items: { cls: string; label: string }[], markers = false): HTMLElement {
  return h(
    'ul',
    { class: 'chart-legend' },
    items.map((item) => h('li', null, h('span', { class: `swatch ${item.cls}`, 'aria-hidden': 'true' }), item.label)),
    markers
      ? Object.values(t.markers).map((m) => h('li', null, h('span', { class: 'marker-key', 'aria-hidden': 'true' }, m.symbol), m.label))
      : null,
  );
}

function cell(text: string, label?: string): HTMLTableCellElement {
  return label ? h('td', null, h('span', { 'aria-hidden': 'true' }, text), h('span', { class: 'visually-hidden' }, label)) : h('td', null, text);
}

function weekTable(caption: string, daysLabel: string, weeks: readonly WeekRow[], corridor: boolean): HTMLElement {
  const none = () => cell(t.table.none, t.table.noneLabel);
  const num = (v: number | undefined) => (v === undefined ? none() : cell(formatDecimal(v)));
  return h(
    'details',
    { class: 'table-toggle' },
    h('summary', { class: 'button link' }, t.asTable),
    h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        { class: 'data-table' },
        h('caption', null, caption),
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', { scope: 'col' }, t.table.week),
            h('th', { scope: 'col' }, daysLabel),
            h('th', { scope: 'col' }, t.table.avg),
            corridor ? h('th', { scope: 'col' }, t.table.floor) : null,
            corridor ? h('th', { scope: 'col' }, t.table.ceiling) : null,
          ),
        ),
        h(
          'tbody',
          null,
          weeks.map((w) =>
            h(
              'tr',
              null,
              h('th', { scope: 'row' }, t.weekRange(formatDayMonth(w.from), formatDayMonth(w.to))),
              cell(String(w.days)),
              num(w.avg?.value),
              corridor ? num(w.avg?.floor) : null,
              corridor ? num(w.avg?.ceiling) : null,
            ),
          ),
        ),
      ),
    ),
  );
}

function comparisonLine(c: Comparison): HTMLElement {
  const text =
    c.kind === 'SIX_MONTHS'
      ? t.compareSixMonths(formatDecimal(c.window.mean))
      : c.kind === 'FIRST_WEEKS'
        ? t.compareFirstWeeks(formatDecimal(c.window.mean))
        : t.compareNone;
  return h('p', { class: 'muted comparison', 'data-role': 'comparison' }, text);
}

function figure(value: string): HTMLElement {
  return h('p', { class: 'level-figure' }, h('span', { class: 'level-value' }, `Ø ${value}`), ' ', h('span', { class: 'muted' }, t.last28));
}

function levelSection(view: HistoryView): HTMLElement {
  const level = view.level;
  const hasPoints = level.chart.some((d) => d.score !== undefined);
  return h(
    'section',
    { class: 'card history-block', 'aria-labelledby': 'level-heading', 'data-role': 'level' },
    h('h2', { id: 'level-heading' }, t.level),
    level.sufficient
      ? figure(formatDecimal(level.current.score))
      : h('p', { class: 'muted' }, t.levelTooFew(level.current.days)),
    comparisonLine(level.comparison),
    hasPoints ? levelChart(view) : h('p', { class: 'muted' }, t.chartEmpty),
    hasPoints
      ? legend(
          [
            { cls: 'swatch-point', label: t.legend.point },
            { cls: 'swatch-band', label: t.legend.band },
            { cls: 'swatch-line', label: t.legend.line },
          ],
          true,
        )
      : null,
    weekTable(t.table.caption, t.table.days, level.weeks, true),
  );
}

function wellbeingSection(view: HistoryView): HTMLElement {
  const w = view.wellbeing;
  const body = !w.any
    ? [h('p', { class: 'muted' }, t.wellbeingEmpty)]
    : [
        w.current.sufficient ? figure(formatDecimal(w.current.mean)) : h('p', { class: 'muted' }, t.wellbeingTooFew(w.current.days)),
        comparisonLine(w.comparison),
        wellbeingChart(view),
        legend([
          { cls: 'swatch-point', label: t.wellbeingLegend.point },
          { cls: 'swatch-line', label: t.wellbeingLegend.line },
        ]),
        weekTable(t.wellbeingTable.caption, t.wellbeingTable.days, w.weeks, false),
      ];
  return h(
    'section',
    { class: 'card history-block', 'aria-labelledby': 'wellbeing-heading', 'data-role': 'wellbeing' },
    h('h2', { id: 'wellbeing-heading' }, t.wellbeing),
    body,
  );
}

function markLabel(entry: CalendarHabit, mark: CalendarMark): string {
  const counter = entry.habit.kind !== 'BUILD';
  if (counter && (mark === 'DONE' || mark === 'MINIMAL' || mark === 'NOT_DONE')) return t.counterMarks[mark];
  return t.marks[mark].label;
}

function countsLine(entry: CalendarHabit): string {
  const c = entry.counts;
  const counter = entry.habit.kind !== 'BUILD';
  const parts: string[] = [];
  const add = (n: number, text: (n: number) => string) => {
    if (n > 0) parts.push(text(n));
  };
  add(c.done, counter ? t.counts.kept : t.counts.done);
  add(c.minimal, counter ? t.counts.partial : t.counts.minimal);
  add(c.alternative, t.counts.alternative);
  add(c.notDone, counter ? t.counts.broken : t.counts.notDone);
  add(c.noEntry, t.counts.noEntry);
  add(c.extra, t.counts.extra);
  add(c.exception, t.counts.exception);
  return parts.join(' · ');
}

function statusText(entry: CalendarHabit): string {
  if (entry.status === 'PAUSED') return t.paused;
  if (entry.status === 'INTEGRATED' && entry.integratedSince) return t.integratedSince(formatDayMonth(entry.integratedSince));
  return t.building;
}

function monthGrid(entry: CalendarHabit, month: MonthView): HTMLElement {
  const lead = WEEK_ORDER.indexOf(weekdayOf(month.days[0]!));
  const cells: HTMLElement[] = [];
  for (let i = 0; i < lead; i++) cells.push(h('td', { class: 'cal-blank' }));
  month.days.forEach((date, i) => {
    const mark = entry.marks[i]!;
    cells.push(
      h(
        'td',
        { class: `cal-day mark-${mark.toLowerCase()}` },
        h('span', { class: 'cal-num', 'aria-hidden': 'true' }, String(dayOfMonth(date))),
        h('span', { class: 'cal-sym', 'aria-hidden': 'true' }, t.marks[mark].symbol),
        h('span', { class: 'visually-hidden' }, `${formatDayShort(date)}: ${markLabel(entry, mark)}`),
      ),
    );
  });
  while (cells.length % 7 !== 0) cells.push(h('td', { class: 'cal-blank' }));
  const rows: HTMLElement[] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(h('tr', null, cells.slice(i, i + 7)));
  return h(
    'table',
    { class: 'calendar' },
    h('caption', { class: 'visually-hidden' }, t.calendarCaption(entry.habit.actionText, formatMonth(month.month))),
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        WEEK_ORDER.map((d) => h('th', { scope: 'col', abbr: de.date.weekdaysLong[d] }, de.date.weekdaysShort[d])),
      ),
    ),
    h('tbody', null, rows),
  );
}

/** Eigene Angaben aus den Wochenrückblicken: nur Wochenwerte, keine Tageszahlen. */
function reviewList(entry: CalendarHabit): HTMLElement | null {
  if (entry.reviews.length === 0) return null;
  const r = de.review.history;
  return h(
    'ul',
    { class: 'review-values muted small', 'data-role': 'review-values' },
    entry.reviews.map((v) => {
      const parts = [
        v.ease !== undefined ? r.ease(v.ease) : undefined,
        v.cueConsistency ? r.cue(de.review.cueOptions[v.cueConsistency]) : undefined,
        v.automaticity !== undefined ? r.automaticity(formatDecimal(v.automaticity)) : undefined,
      ].filter((p): p is string => p !== undefined);
      return h('li', null, `${r.week(formatDayMonth(v.weekStart))}: ${parts.join(' · ')}`);
    }),
  );
}

function calendarHabitCard(entry: CalendarHabit, month: MonthView): HTMLElement {
  const c = entry.counts;
  const kept = c.done + c.minimal + c.alternative;
  const details = countsLine(entry);
  return h(
    'article',
    { class: 'calendar-habit', 'data-role': 'calendar-habit' },
    h('h3', null, entry.habit.actionText),
    h(
      'p',
      { class: 'muted small' },
      c.planned > 0 ? t.plannedDays(kept, c.planned) : t.noPlannedDays,
      ' · ',
      statusText(entry),
    ),
    details ? h('p', { class: 'muted small' }, details) : null,
    reviewList(entry),
    monthGrid(entry, month),
  );
}

function calendarLegend(): HTMLElement {
  const keys: CalendarMark[] = ['DONE', 'MINIMAL', 'ALTERNATIVE', 'NOT_DONE', 'NO_ENTRY', 'EXCEPTION', 'EXTRA'];
  return h(
    'div',
    { class: 'calendar-legend' },
    h(
      'ul',
      { class: 'chart-legend' },
      keys.map((k) => h('li', null, h('span', { class: `marker-key mark-${k.toLowerCase()}`, 'aria-hidden': 'true' }, t.marks[k].symbol), t.marks[k].label)),
      h('li', null, t.legendNote),
    ),
    h('p', { class: 'muted small' }, t.counterNote),
  );
}

function calendarSection(month: MonthView): HTMLElement {
  const monthLink = (target: string | undefined, label: string, symbol: string) =>
    target
      ? h('a', { class: 'icon-button', href: routeHref('verlauf', { monat: target }), 'aria-label': label }, symbol)
      : h('span', { class: 'icon-button placeholder', 'aria-hidden': 'true' });
  return h(
    'section',
    { class: 'card history-block', 'aria-labelledby': 'calendar-heading', 'data-role': 'calendar' },
    h('h2', { id: 'calendar-heading' }, t.calendar),
    h(
      'div',
      { class: 'month-nav' },
      monthLink(month.prev, t.prevMonth, '‹'),
      h('p', { class: 'month-title', 'aria-live': 'polite' }, formatMonth(month.month)),
      monthLink(month.next, t.nextMonth, '›'),
    ),
    month.habits.length === 0 ? h('p', { class: 'muted' }, t.calendarEmpty) : [calendarLegend(), ...month.habits.map((e) => calendarHabitCard(e, month))],
    month.exceptionDays.length > 0 ? h('p', { class: 'muted small' }, t.exceptionDays(month.exceptionDays.length)) : null,
    h('h3', null, t.events),
    month.events.length === 0
      ? h('p', { class: 'muted small' }, t.noEvents)
      : h(
          'ul',
          { class: 'event-list', 'data-role': 'events' },
          month.events.map((e) => h('li', null, h('span', null, t.event[e.kind](formatDayShort(e.date))), ' · ', h('span', { class: 'muted' }, e.habit.actionText))),
        ),
  );
}

export const historyScreen: Screen = async ({ ctx, params }) => {
  const view = await loadHistoryView(ctx, params.get('monat') ?? undefined);
  fitChartWidth();
  const info = h('p', null, h('a', { class: 'button link', href: routeHref('info') }, t.infoLink));
  if (!view.hasHabits) {
    return h(
      'section',
      { class: 'screen history' },
      h('h1', { tabindex: '-1' }, t.heading),
      h('div', { class: 'card empty', 'data-role': 'history-empty' }, h('p', null, t.empty), h('a', { class: 'button primary', href: routeHref('plan') }, t.toPlan)),
      info,
    );
  }
  return h(
    'section',
    { class: 'screen history' },
    h('h1', { tabindex: '-1' }, t.heading),
    levelSection(view),
    calendarSection(view.month),
    wellbeingSection(view),
    info,
  );
};
