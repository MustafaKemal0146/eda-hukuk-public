import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AutosaveController,
  type SaveReason,
  type SaveResult,
  type SaveState,
} from '../src/features/studio/autosave.ts';

function setup(results: SaveResult[]) {
  const states: SaveState[] = [];
  const saves: SaveReason[] = [];
  const queue = [...results];
  const c = new AutosaveController({
    debounceMs: 3000,
    maxWaitMs: 15000,
    retryMax: 2,
    onState: (s) => states.push(s),
    save: async (reason) => {
      saves.push(reason);
      return queue.shift() ?? { kind: 'ok' };
    },
  });
  return { c, states, saves };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('KK-P17c-5: otomatik kayıt 3000/15000 ms, uçuşta tek istek (054 KK-18)', () => {
  it('3 sn sessizlikten sonra kaydeder', async () => {
    const { c, saves, states } = setup([]);
    c.markDirty();
    await vi.advanceTimersByTimeAsync(2999);
    expect(saves).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saves).toEqual(['autosave']);
    expect(states.at(-1)).toBe('saved');
  });

  it('sürekli yazımda 15 sn üst sınırında kaydeder', async () => {
    const { c, saves } = setup([]);
    for (let i = 0; i < 8; i++) {
      c.markDirty();
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(saves.length).toBeGreaterThanOrEqual(1);
    expect(saves[0]).toBe('autosave');
  });

  it('uçuştayken gelen değişiklik yanıttan sonra yeniden kaydedilir (tek istek)', async () => {
    const { c, saves } = setup([]);
    let release: (r: SaveResult) => void = () => undefined;
    const slow = new AutosaveController({
      debounceMs: 10,
      maxWaitMs: 100,
      retryMax: 1,
      onState: () => undefined,
      save: (reason) => {
        saves.push(reason);
        return new Promise<SaveResult>((r) => {
          release = r;
        });
      },
    });
    slow.markDirty();
    await vi.advanceTimersByTimeAsync(10);
    expect(saves).toHaveLength(1);
    slow.markDirty();
    await vi.advanceTimersByTimeAsync(50);
    expect(saves).toHaveLength(1);
    release({ kind: 'ok' });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(20);
    expect(saves.length).toBeGreaterThanOrEqual(2);
    void c;
  });
});

describe('KK-P17c-8: hata yolları', () => {
  it('çakışma yeniden denenmez ve durum çakışmadır', async () => {
    const { c, saves, states } = setup([{ kind: 'conflict' }]);
    c.markDirty();
    await vi.advanceTimersByTimeAsync(3000);
    expect(states.at(-1)).toBe('conflict');
    c.markDirty();
    await vi.advanceTimersByTimeAsync(20000);
    expect(saves).toHaveLength(1);
    expect(c.hasUnsaved).toBe(true);
  });

  it('ağ hatasında üstel geri çekilmeyle yeniden dener, sınır aşılınca hata', async () => {
    const { c, saves, states } = setup([
      { kind: 'network' },
      { kind: 'network' },
      { kind: 'network' },
    ]);
    c.markDirty();
    await vi.advanceTimersByTimeAsync(3000);
    expect(states).toContain('retry');
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(saves).toHaveLength(3);
    expect(states.at(-1)).toBe('error');
  });

  it('flush bekleyen değişikliği hemen gönderir', async () => {
    const { c, saves } = setup([]);
    c.markDirty();
    await c.flush('manual');
    expect(saves).toEqual(['manual']);
    expect(c.hasUnsaved).toBe(false);
  });
});
