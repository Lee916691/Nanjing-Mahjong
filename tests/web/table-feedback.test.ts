import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TableEvent } from '@nanjing-mahjong/shared-types';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  collectTableFeedback,
  createTableAudio,
  readSoundMuted,
  saveSoundMuted,
  soundForEvent,
  visualForEvent,
} from '../../apps/web/src/table-feedback';
import {
  collectTableNotices,
  createNotificationCursor,
} from '../../apps/web/src/table-notifications';
import { updateTableHistory } from '../../apps/web/src/table-history';
import { SoundToggle } from '../../apps/web/src/SoundToggle';
import { TableNotification } from '../../apps/web/src/TableNotification';
import { view } from '../../apps/server/src/table';
import { eventRoom } from '../../apps/server/test/event-fixture';

const base = { id: 1, sequence: 1, hand: 1 };
const tile = { family: 'wan', label: '1万' };
const peng: TableEvent = { ...base, type: 'peng', seat: 1, fromSeat: 0, tile };
const roomView = () => view(eventRoom(), 'p0', new Set(['p0', 'p1', 'p2', 'p3']), 'secret');
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('confirmed event sound and visual mapping', () => {
  it.each([
    [{ type: 'peng', seat: 1, fromSeat: 0, tile }, 'operation', 'meld'],
    [{ type: 'ming-gang', seat: 1, fromSeat: 0, tile }, 'operation', 'meld'],
    [{ type: 'an-gang', seat: 1, tile }, 'operation', 'meld'],
    [{ type: 'bu-gang', seat: 1, fromSeat: 0, tile }, 'operation', 'meld'],
    [{ type: 'hu', winnerSeats: [1], fromSeat: null, summary: '自摸胡' }, 'win', 'result'],
    [{ type: 'hu', winnerSeats: [1], fromSeat: 0, summary: '点炮胡' }, 'win', 'result'],
    [{ type: 'hu', winnerSeats: [1], fromSeat: 0, summary: '抢补杠胡' }, 'win', 'result'],
    [{ type: 'hu', winnerSeats: [1, 2, 3], fromSeat: 0, summary: '点炮胡' }, 'win', 'result'],
    [{ type: 'draw', summary: '流局' }, 'draw', 'result'],
    [
      { type: 'hand-settled', result: 'hu', winnerSeats: [1, 2], changes: [], summary: '点炮胡' },
      'settled',
      'result',
    ],
    [{ type: 'special-rule-confirmed', rule: 'flower-kong', seat: 1 }, 'special', null],
    [{ type: 'special-rule-confirmed', rule: 'four-winds-gathered', seat: 1 }, 'special', null],
    [{ type: 'special-rule-confirmed', rule: 'follow-discard', seat: 1 }, 'special', null],
    [{ type: 'mouth-locked', seat: 1, fromSeat: 0, mouths: 2 }, 'special', null],
    [{ type: 'mouth-locked', seat: 1, fromSeat: 0, mouths: 3 }, 'special', null],
    [{ type: 'hand-started', dealer: 0 }, null, null],
    [{ type: 'tile-drawn', seat: 0 }, null, null],
    [{ type: 'flower-replaced', seat: 0, flower: tile }, null, null],
    [{ type: 'score-changed', changes: [], reason: 'flower-kong-created' }, null, null],
  ] as const)('maps only the public fact %j', (fields, sound, kind) => {
    const event = { ...base, ...fields } as TableEvent;
    expect(soundForEvent(event)).toBe(sound);
    expect(visualForEvent(event, roomView())?.kind ?? null).toBe(kind);
    if (event.type === 'special-rule-confirmed' || event.type === 'mouth-locked') {
      const room = roomView();
      const cursor = createNotificationCursor();
      collectTableNotices(cursor, room);
      room.tableEvents = [event];
      const notice = collectTableNotices(cursor, room)[0]!;
      expect(renderToStaticMarkup(createElement(TableNotification, { notice }))).toContain(
        'notice-emphasis',
      );
    }
  });

  it('targets only an authoritative current discard and never exposes a concealed kong face', () => {
    const room = roomView();
    const discard: TableEvent = { ...base, type: 'tile-discarded', seat: 0, tile };
    expect(visualForEvent(discard, room)).toBeNull();
    const visible = { ...tile, id: 'wan-1-1' };
    room.players[0]!.discards = [visible];
    room.lastDiscard = visible;
    expect(visualForEvent(discard, room)).toEqual({
      id: 1,
      hand: 1,
      kind: 'discard',
      seat: 0,
      tileId: visible.id,
    });
    expect(soundForEvent(discard)).toBeNull();
    room.lastDiscard = { ...visible, id: 'wan-1-2' };
    expect(visualForEvent(discard, room)).toBeNull();
    expect(
      JSON.stringify(
        visualForEvent(
          {
            ...base,
            type: 'an-gang',
            seat: 1,
            tile: { family: 'wan', label: 'hidden-face-sentinel' },
          },
          room,
        ),
      ),
    ).not.toContain('sentinel');
  });

  it('baselines, orders, deduplicates IDs and keeps notice/history consumption independent', () => {
    const room = roomView();
    const cursor = createNotificationCursor();
    const notices = createNotificationCursor();
    room.tableEvents = [{ ...peng, id: 80, sequence: 100 }];
    expect(collectTableFeedback(cursor, room)).toEqual([]);
    collectTableNotices(notices, room);
    room.tableEvents.push(
      { ...peng, id: 12, sequence: 103 },
      { ...peng, id: 10, sequence: 101 },
      { ...peng, id: 10, sequence: 102 },
    );
    expect(collectTableFeedback(cursor, room).map((event) => event.id)).toEqual([10, 12]);
    expect(collectTableNotices(notices, room).map((notice) => notice.id)).toEqual([10, 12]);
    const saved = structuredClone(cursor);
    updateTableHistory(null, room);
    expect(cursor).toEqual(saved);
    expect(collectTableFeedback(cursor, room)).toEqual([]);
    room.tableEvents = [{ ...peng, id: 80, sequence: 100 }];
    expect(collectTableFeedback(cursor, room)).toEqual([]);
    room.tableEvents.push({ ...peng, id: 13, sequence: 104, hand: 2 });
    expect(collectTableFeedback(cursor, room).map((event) => event.id)).toEqual([13]);
    expect(collectTableFeedback(createNotificationCursor(), room)).toEqual([]);
    room.id = 'new-room';
    expect(collectTableFeedback(cursor, room)).toEqual([]);
    room.status = 'waiting';
    room.tableEvents = [];
    collectTableFeedback(cursor, room);
    room.tableEvents = [{ ...peng, id: 14, sequence: 105 }];
    expect(collectTableFeedback(cursor, room)).toHaveLength(1);
  });
});

function audioFixture(muted = false) {
  const media: HTMLAudioElement[] = [];
  const played: string[] = [];
  let visible = true;
  const audio = createTableAudio(
    muted,
    (sound) => {
      played.push(sound);
      const element = {
        volume: 1,
        onended: null,
        onerror: null,
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
      } as unknown as HTMLAudioElement;
      media.push(element);
      return element;
    },
    () => visible,
  );
  return {
    audio,
    media,
    played,
    hide: () => {
      visible = false;
    },
  };
}

describe('native audio queue failure and mute isolation', () => {
  it('does not autoplay on load, even with an enabled saved preference; never catches up', () => {
    const { audio, played } = audioFixture();
    audio.enqueue([peng]);
    audio.activate();
    expect(played).toEqual([]);
    audio.enqueue([peng]);
    expect(played).toEqual(['operation']);
    audio.clear();
  });
  it('plays in order and mute cancels active and pending sounds without replay', () => {
    const { audio, media, played } = audioFixture();
    audio.activate();
    audio.enqueue([peng, { ...base, type: 'draw', summary: '流局' }]);
    expect(played).toEqual(['operation']);
    audio.setMuted(true);
    expect(media[0]!.pause).toHaveBeenCalled();
    audio.enqueue([peng]);
    audio.setMuted(false);
    expect(played).toEqual(['operation']);
    audio.enqueue([
      { ...base, type: 'hu', winnerSeats: [1], fromSeat: 0, summary: '点炮胡' },
      peng,
    ]);
    expect(played).toEqual(['operation', 'win']);
    media[1]!.onended?.(new Event('ended'));
    expect(played).toEqual(['operation', 'win', 'operation']);
    audio.clear();
  });
  it('drops background events and clears the queue instead of playing on return', () => {
    const { audio, hide, played } = audioFixture();
    audio.activate();
    hide();
    audio.enqueue([peng]);
    expect(played).toEqual([]);
  });
  it.each(['reject', 'error', 'timeout', 'throw'] as const)('continues after %s', async (mode) => {
    vi.useFakeTimers();
    const { audio, media, played } = audioFixture();
    audio.activate();
    audio.enqueue([peng]);
    if (mode === 'reject') {
      media[0]!.play = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
      audio.clear();
      const factory = vi.fn().mockReturnValueOnce(media[0]).mockReturnValue(media[0]);
      const rejected = createTableAudio(false, factory, () => true);
      rejected.activate();
      rejected.enqueue([peng, peng]);
      await Promise.resolve();
      await Promise.resolve();
      expect(factory).toHaveBeenCalledTimes(2);
      rejected.clear();
    } else {
      audio.enqueue([peng]);
      if (mode === 'error') media[0]!.onerror?.(new Event('error'));
      if (mode === 'timeout') vi.advanceTimersByTime(1200);
      if (mode === 'throw') {
        const factory = vi
          .fn()
          .mockImplementationOnce(() => {
            throw new Error('unsupported');
          })
          .mockReturnValue(media[0]);
        const unsupported = createTableAudio(false, factory, () => true);
        unsupported.activate();
        expect(() => unsupported.enqueue([peng, peng])).not.toThrow();
        expect(factory).toHaveBeenCalledTimes(2);
        unsupported.clear();
      } else expect(played).toEqual(['operation', 'operation']);
    }
    audio.clear();
  });
  it('a late rejection from a canceled audio does not stop a newer queue', async () => {
    let reject!: (reason: Error) => void;
    const first = {
      play: () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        }),
      pause: vi.fn(),
    };
    const second = { play: vi.fn().mockResolvedValue(undefined), pause: vi.fn() };
    const factory = vi.fn().mockReturnValueOnce(first).mockReturnValue(second);
    const audio = createTableAudio(false, factory, () => true);
    audio.activate();
    audio.enqueue([peng]);
    audio.setMuted(true);
    audio.setMuted(false);
    audio.enqueue([peng]);
    reject(new Error('late rejection'));
    await Promise.resolve();
    expect(second.pause).not.toHaveBeenCalled();
    audio.clear();
  });
});

describe('local-only sound preference and accessible toggle', () => {
  it('defaults to muted, round trips both choices and safely handles unavailable storage', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    expect(readSoundMuted()).toBe(true);
    saveSoundMuted(false);
    expect(readSoundMuted()).toBe(false);
    saveSoundMuted(true);
    expect(readSoundMuted()).toBe(true);
    expect([...values.keys()]).toEqual(['mj_sound_muted']);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(readSoundMuted()).toBe(true);
    expect(() => saveSoundMuted(false)).not.toThrow();
  });
  it.each([true, false])('labels the current setting %s without relying on an icon', (muted) => {
    const html = renderToStaticMarkup(createElement(SoundToggle, { muted, onToggle: () => {} }));
    expect(html).toContain(muted ? '已静音' : '已开启');
    expect(html).toContain(`aria-pressed="${!muted}"`);
  });
});
