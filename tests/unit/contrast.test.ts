import css from '../../src/styles.css?raw';
import { describe, expect, it } from 'vitest';

/**
 * Prüft die Design-Tokens aus styles.css gegen WCAG AA:
 * Text mindestens 4,5:1, Fokusrahmen und Bedienelement-Ränder (Nicht-Text) mindestens 3:1.
 */
type Rgb = [number, number, number];
type Tokens = Record<string, string>;

function tokensOf(block: string): Tokens {
  const out: Tokens = {};
  for (const m of block.matchAll(/--([a-z-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

function blockAfter(selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`${selector} fehlt`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

const light = tokensOf(blockAfter(':root {'));
const darkMedia = tokensOf(blockAfter(":root:not([data-theme='light'])"));
const darkManual = tokensOf(blockAfter(":root[data-theme='dark']"));
const dark = { ...light, ...darkManual };

function parse(color: string): { rgb: Rgb; alpha: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const rgb = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(color);
  if (rgb) return { rgb: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])], alpha: rgb[4] ? Number(rgb[4]) : 1 };
  throw new Error(`Farbe nicht lesbar: ${color}`);
}

/** Halbtransparente Farbe auf einem deckenden Untergrund. */
function over(color: string, base: string): Rgb {
  const top = parse(color);
  const bottom = parse(base).rgb;
  return top.rgb.map((c, i) => c * top.alpha + bottom[i]! * (1 - top.alpha)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const solid = (c: string) => parse(c).rgb;

describe.each([
  ['hell', light],
  ['dunkel', dark],
])('Kontraste (%s)', (_name, t: Tokens) => {
  const pairs: [string, Rgb, Rgb, number][] = [
    ['Text auf Hintergrund', solid(t.text!), solid(t.bg!), 4.5],
    ['Text auf Fläche', solid(t.text!), solid(t.surface!), 4.5],
    ['gedämpfter Text auf Hintergrund', solid(t.muted!), solid(t.bg!), 4.5],
    ['gedämpfter Text auf Fläche', solid(t.muted!), solid(t.surface!), 4.5],
    ['Akzent auf Hintergrund', solid(t.accent!), solid(t.bg!), 4.5],
    ['Akzent auf Fläche', solid(t.accent!), solid(t.surface!), 4.5],
    ['Akzent auf zartem Akzent', solid(t.accent!), over(t['accent-soft']!, t.surface!), 4.5],
    ['Text auf Akzent-Knopf', solid(t['accent-text']!), solid(t.accent!), 4.5],
    ['Hinweisfarbe auf Fläche', solid(t.notice!), solid(t.surface!), 4.5],
    ['Fokusrahmen auf Hintergrund', solid(t.focus!), solid(t.bg!), 3],
    ['Fokusrahmen auf Fläche', solid(t.focus!), solid(t.surface!), 3],
  ];
  it.each(pairs)('%s', (_label, fg, bg, min) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});

describe('Dunkelmodus', () => {
  it('Systemeinstellung und manuelle Wahl nutzen dieselben Farben', () => {
    expect(darkMedia).toEqual(darkManual);
  });
});
