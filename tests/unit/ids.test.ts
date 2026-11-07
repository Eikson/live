import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId, uuidV4 } from '../../src/platform/ids';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('IDs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('formatiert Zufallsbytes als UUID Version 4', () => {
    expect(uuidV4(new Uint8Array(16).fill(0xff))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(uuidV4(new Uint8Array(16))).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('funktioniert ohne crypto.randomUUID (http im WLAN)', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: <T extends ArrayBufferView>(a: T) => real.getRandomValues(a as never) as T });
    expect(crypto.randomUUID).toBeUndefined();
    const ids = new Set(Array.from({ length: 50 }, () => newId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });
});
