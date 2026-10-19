import {
  twoPlayerRoom as room,
  completeTwoPlayerWin as ordinaryWin,
} from './two-player-fixture.js';
import { describe, expect, it } from 'vitest';
import {
  appendTableEvents,
  confirmNextHand,
  newRoom,
  paused,
  restoreRoomRules,
  reviewToken,
  view,
} from '../src/table.js';
import { Store } from '../src/store.js';

const mode = 'nanjing-open-duo' as const;
const online = new Set(['p0', 'p1']);
const secret = 'test-secret';

describe('two-player authoritative rooms and archives', () => {
  it('uses exactly two real members and exposes mode without private opponent data', () => {
    const value = room();
    expect(value.format).toBe(2);
    expect(value.rules).toBe('V1.0.12');
    expect(value.members).toHaveLength(2);
    expect(value.match!.currentHand.players).toHaveLength(2);
    for (const session of online) {
      const state = view(value, session, online, secret);
      expect(state).toMatchObject({ ruleSetId: mode, totalEffectiveDealerTurns: 8, paused: false });
      expect(state.players[state.self]!.hand).toBeDefined();
      expect(state.players[1 - state.self]!.hand).toBeUndefined();
    }
    expect(paused(value, new Set(['p0']))).toBe(true);
  });

  it('saves and restores a mixed-mode SQLite database without changing old scores', () => {
    const store = new Store(':memory:');
    try {
      const duo = room();
      const four = newRoom('four', '四人房');
      store.commit(duo);
      store.commit(four);
      const restored = store.rooms();
      expect(restored).toEqual([duo, four]);
      expect(store.db.prepare("SELECT value FROM metadata WHERE key='version'").get()?.value).toBe(
        '2:room-modes',
      );
      const legacy = { ...JSON.parse(JSON.stringify(four)), format: 1 };
      delete legacy.ruleSetId;
      store.db.prepare('UPDATE rooms SET body=? WHERE id=?').run(JSON.stringify(legacy), four.id);
      const loaded = store.rooms().find((entry) => entry.id === four.id)!;
      expect(loaded.ruleSetId).toBe('nanjing-open');
      expect(loaded.format).toBe(1);
      store.commit(loaded);
      expect(
        JSON.parse(String(store.db.prepare('SELECT body FROM rooms WHERE id=?').get(four.id)?.body))
          .format,
      ).toBe(2);
    } finally {
      store.close();
    }
  });

  it('keeps new Node receipts mode-sensitive while reading old acknowledgement records', () => {
    const store = new Store(':memory:');
    try {
      const value = room();
      const session = store.session();
      const ack = { commandId: 'create-mode-001', ok: true, roomId: value.id };
      store.commit(value, session, ack, 'duo-fingerprint');
      expect(store.receipt(session, ack.commandId, 'duo-fingerprint')).toEqual(ack);
      expect(() => store.receipt(session, ack.commandId, 'four-fingerprint')).toThrow('操作编号');
      store.db
        .prepare('INSERT INTO commands VALUES (?,?,?)')
        .run(session, 'legacy-001', JSON.stringify({ ...ack, commandId: 'legacy-001' }));
      expect(store.receipt(session, 'legacy-001', 'unknown-history')).toEqual({
        ...ack,
        commandId: 'legacy-001',
      });
    } finally {
      store.close();
    }
  });

  it.each([
    'missing-mode',
    'wrong-mode',
    'wrong-count',
    'wrong-total',
    'wrong-version',
    'legacy-duo',
    'unknown-mode',
    'bad-member',
    'duplicate-member',
    'bad-mouth',
    'bad-fact',
    'phantom-transfer',
  ])('rejects incompatible archives without changing their input: %s', (kind) => {
    const raw = JSON.parse(JSON.stringify(room()));
    if (kind === 'missing-mode') delete raw.ruleSetId;
    if (kind === 'wrong-mode') raw.match.currentHand.ruleSetId = 'nanjing-open';
    if (kind === 'wrong-count') raw.members.push(null);
    if (kind === 'wrong-total') raw.match.totalEffectiveDealerTurns = 16;
    if (kind === 'wrong-version') raw.rules = 'V1.0.11';
    if (kind === 'legacy-duo') raw.format = 1;
    if (kind === 'unknown-mode') raw.ruleSetId = 'unknown';
    if (kind === 'bad-member') raw.members[0] = 42;
    if (kind === 'duplicate-member') raw.members[1].session = raw.members[0].session;
    if (kind === 'bad-mouth')
      raw.match.currentHand.threeMouthState[1] = { status: 'active', payerPlayerIndex: 2 };
    if (kind === 'bad-fact') raw.match.currentHand.handProgressFacts.packageSettlementCount = -1;
    if (kind === 'phantom-transfer')
      raw.scores.push({ hand: 1, reason: 'invalid', transfers: [{ from: 2, to: 1, amount: 10 }] });
    const before = structuredClone(raw);
    expect(() => restoreRoomRules(raw)).toThrow();
    expect(raw).toEqual(before);
  });

  it('rejects phantom seats and disabled-rule events in a two-player archive', () => {
    for (const fields of [
      { type: 'tile-drawn', hand: 1, seat: 2 },
      { type: 'special-rule-confirmed', hand: 1, seat: 0, rule: 'four-winds-gathered' },
    ]) {
      const value = room();
      const before = JSON.stringify(value);
      expect(() => appendTableEvents(value, [fields as never])).toThrow();
      expect(JSON.stringify(value)).toBe(before);
    }
  });

  it('requires two real confirmations, preserves them on restore, pauses, and ignores stale tokens', () => {
    const value = room();
    ordinaryWin(value);
    const token = reviewToken(value, secret);
    const handIndex = value.match!.currentHandIndex;
    expect(value.scores.at(-1)?.calculation).toMatchObject({ payments: 1 });
    expect(() => confirmNextHand(value, 2, token, online, secret)).toThrow();
    confirmNextHand(value, 0, token, online, secret);
    expect(value.nextHandReady).toEqual([0]);
    const restored = restoreRoomRules(JSON.parse(JSON.stringify(value)));
    expect(() => confirmNextHand(restored, 1, token, new Set(['p0']), secret)).toThrow();
    confirmNextHand(restored, 1, token, online, secret);
    expect(restored.match!.currentHandIndex).toBe(handIndex + 1);
    expect(restored.match!.currentHand.players).toHaveLength(2);
    expect(() => confirmNextHand(restored, 1, token, online, secret)).toThrow();
  });

  it('automatically completes exactly eight effective dealer turns and never starts a ninth', () => {
    const value = room();
    for (let turn = 1; turn <= 8; turn++) {
      expect(value.match!.effectiveDealerTurn).toBe(turn);
      ordinaryWin(value);
      expect(value.status).toBe(turn === 8 ? 'completed' : 'playing');
      if (turn < 8) {
        const token = reviewToken(value, secret);
        confirmNextHand(value, 0, token, online, secret);
        confirmNextHand(value, 1, token, online, secret);
      }
    }
    expect(value.match!.completedHands).toHaveLength(8);
    expect(value.remainingMs).toBeNull();
    expect(() => confirmNextHand(value, 0, reviewToken(value, secret), online, secret)).toThrow();
  });
});
