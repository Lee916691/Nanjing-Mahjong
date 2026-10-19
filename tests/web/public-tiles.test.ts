import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { apply, view } from '../../apps/server/src/table';
import { anGangRoom, buGangRoom } from '../../apps/server/test/event-fixture';
import { MahjongTable } from '../../apps/web/src/MahjongTable';
import { MahjongTile } from '../../apps/web/src/MahjongTile';
import { classicGlyphs } from '../../apps/web/src/assets/classic-glyphs';
import { bambooGlyphs } from '../../apps/web/src/assets/bamboo-glyphs';
import { updateTableHistory } from '../../apps/web/src/table-history';
import { soundForEvent, visualForEvent } from '../../apps/web/src/table-feedback';

const online = new Set(['p0', 'p1', 'p2', 'p3']);
it('renders the same public concealed kong back/face/face/back for all seats', () => {
  const room = anGangRoom();
  apply(room, {
    type: 'DECLARE_AN_GANG',
    playerIndex: 0,
    tileFace: { category: 'number', suit: 'wan', rank: 1 },
  });
  for (const self of [0, 1, 2, 3]) {
    const state = view(room, `p${self}`, online, 'public-tiles');
    const html = renderToStaticMarkup(
      createElement(MahjongTable, {
        room: state,
        connected: true,
        pending: false,
        onAction: () => {},
        readable: (s) => s,
      }),
    );
    const meld = html.match(/<div class="meld" aria-label="暗杠 1万">(.*?)<\/div>/s)![1]!;
    expect([...meld.matchAll(/aria-label="(牌背|1万)"/g)].map((match) => match[1])).toEqual([
      '牌背',
      '1万',
      '1万',
      '牌背',
    ]);
    expect(meld).toContain(classicGlyphs['wan-1']!.navy);
    expect(html).not.toContain('wan-1-');
    const history = updateTableHistory(null, state);
    expect(history.records[0]!.text).toBe('玩家0（东位）暗杠成立：1万');
    const event = state.tableEvents[0]!;
    expect(soundForEvent(event)).toBe('operation');
    expect(visualForEvent(event, state)).toEqual({ id: event.id, hand: 1, kind: 'meld', seat: 0 });
  }
});

it('uses public faces for the original numeric artwork without entity IDs', () => {
  for (const [family, label, path] of [
    ['wan', '1万', classicGlyphs['wan-1']!.navy],
    ['tong', '9筒', classicGlyphs['tong-9']!.navy],
    ['tiao', '1条', bambooGlyphs[1]!.jade],
  ]) {
    const html = renderToStaticMarkup(
      createElement(MahjongTile, { tile: { family: family!, label: label! } }),
    );
    expect(html).toContain(path);
    expect(html).toContain(`aria-label="${label}"`);
  }
});

it('keeps the claimed peng tile rotated using its public index without entity IDs', () => {
  const room = buGangRoom();
  const html = renderToStaticMarkup(
    createElement(MahjongTable, {
      room: view(room, 'p0', online, 'public-tiles'),
      connected: true,
      pending: false,
      onAction: () => {},
      readable: (s) => s,
    }),
  );
  expect(html).toContain('class="meld-slot called"');
  expect(html).not.toContain('meld-1');
});
