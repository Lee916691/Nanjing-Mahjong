import type { RoomView, TableEvent } from '@nanjing-mahjong/shared-types';
import { collectTableNotices } from './table-notifications';
import type { createNotificationCursor } from './table-notifications';

export type TableSound = 'operation' | 'special' | 'win' | 'draw' | 'settled';
export interface TableFeedback {
  id: number;
  hand: number;
  kind: 'discard' | 'meld' | 'result';
  seat?: number;
  tileId?: string;
}

export function soundForEvent(event: TableEvent): TableSound | null {
  switch (event.type) {
    case 'peng':
    case 'ming-gang':
    case 'an-gang':
    case 'bu-gang':
      return 'operation';
    case 'special-rule-confirmed':
    case 'mouth-locked':
      return 'special';
    case 'hu':
      return 'win';
    case 'draw':
      return 'draw';
    case 'hand-settled':
      return 'settled';
    default:
      return null;
  }
}

export function visualForEvent(event: TableEvent, room: RoomView): TableFeedback | null {
  const base = { id: event.id, hand: event.hand };
  switch (event.type) {
    case 'tile-discarded': {
      const tile = room.players[event.seat]?.discards.at(-1);
      return tile?.id === room.lastDiscard?.id &&
        tile?.family === event.tile.family &&
        tile?.label === event.tile.label
        ? { ...base, kind: 'discard', seat: event.seat, tileId: tile.id }
        : null;
    }
    case 'peng':
    case 'ming-gang':
    case 'an-gang':
    case 'bu-gang':
      return { ...base, kind: 'meld', seat: event.seat };
    case 'hu':
    case 'draw':
    case 'hand-settled':
      return { ...base, kind: 'result' };
    default:
      // Special rules/locks use the existing notice's emphasis, with no second message.
      return null;
  }
}

export function collectTableFeedback(
  cursor: ReturnType<typeof createNotificationCursor>,
  room: RoomView,
): TableEvent[] {
  // Reuse the reviewed algorithm with an independent cursor, never the notice cursor.
  const ids = new Set(collectTableNotices(cursor, room).map((notice) => notice.id));
  return [...room.tableEvents]
    .sort((a, b) => a.sequence - b.sequence)
    .filter((event) => ids.delete(event.id));
}

export function readSoundMuted(): boolean {
  try {
    return localStorage.getItem('mj_sound_muted') !== '0';
  } catch {
    return true;
  }
}

export function saveSoundMuted(muted: boolean) {
  try {
    localStorage.setItem('mj_sound_muted', muted ? '1' : '0');
  } catch {
    // Storage may be unavailable; the in-memory preference still takes effect.
  }
}

export function createTableAudio(
  initiallyMuted: boolean,
  makeAudio = (sound: TableSound) => new Audio(`/sounds/${sound}.wav`),
  isVisible = () => document.visibilityState === 'visible',
) {
  let muted = initiallyMuted;
  let activated = false;
  let queue: TableSound[] = [];
  let active: HTMLAudioElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clear() {
    queue = [];
    const audio = active;
    active = null;
    clearTimeout(timer);
    if (audio) {
      audio.onended = audio.onerror = null;
      try {
        audio.pause();
      } catch {
        // Audio failure must not escape into room event consumption.
      }
    }
  }
  function next() {
    if (active || !queue.length) return;
    if (muted || !activated || !isVisible()) return clear();
    const sound = queue.shift()!;
    try {
      const audio = makeAudio(sound);
      active = audio;
      const finish = () => {
        if (active !== audio) return;
        active = null;
        clearTimeout(timer);
        audio.onended = audio.onerror = null;
        try {
          audio.pause();
        } catch {
          // A broken media element must not prevent the next event.
        }
        next();
      };
      audio.volume = 0.45;
      audio.onended = audio.onerror = finish;
      // Bound loading/playback even if the browser never reports completion.
      timer = setTimeout(finish, 1200);
      void audio.play().catch(finish);
    } catch {
      active = null;
      clearTimeout(timer);
      next();
    }
  }
  return {
    activate() {
      activated = true;
    },
    setMuted(value: boolean) {
      muted = value;
      if (muted) clear();
    },
    enqueue(events: TableEvent[]) {
      if (muted || !activated || !isVisible()) return;
      queue.push(...events.flatMap((event) => soundForEvent(event) ?? []));
      next();
    },
    clear,
  };
}
