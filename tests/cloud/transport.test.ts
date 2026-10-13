import { afterEach, expect, it, vi } from 'vitest';
import { CloudSocket } from '../../apps/web/src/cloud-socket';
import type { RoomView } from '@nanjing-mahjong/shared-types';
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('sends actions while a poll is slow and ignores that stale poll after acknowledgment', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('navigator', { sendBeacon: vi.fn() });
  const old = { id: '123456', status: 'waiting', revision: 1 } as RoomView;
  const fresh = { ...old, revision: 2 };
  let releasePoll!: (value: Response) => void;
  const requested: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string) => {
      requested.push(path);
      if (path === '/api/connect') return Promise.resolve(Response.json({ state: old }));
      if (path === '/api/stream') return Promise.resolve(Response.json({ unsupported: true }));
      if (path === '/api/poll')
        return new Promise<Response>((r) => {
          releasePoll = r;
        });
      return Promise.resolve(
        Response.json({ state: fresh, ack: { commandId: 'abcdefgh', ok: true } }),
      );
    }),
  );
  const states: RoomView[] = [];
  const socket = new CloudSocket();
  socket.on('room:state', (s) => states.push(s));
  socket.connect();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(requested).toEqual(['/api/connect', '/api/stream', '/api/poll']);
  const ack = vi.fn();
  socket.timeout(6000).emit('room:ready', { commandId: 'abcdefgh', ready: true }, ack);
  await vi.advanceTimersByTimeAsync(0);
  expect(requested.at(-1)).toBe('/api/command');
  expect(ack).toHaveBeenCalledWith(null, { commandId: 'abcdefgh', ok: true });
  releasePoll(Response.json({ state: old }));
  await vi.advanceTimersByTimeAsync(0);
  expect(states.map((s) => s.revision)).toEqual([1, 2]);
  socket.disconnect();
});

it('cancels the old stream before an action so buffered state cannot overwrite its result', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('navigator', { sendBeacon: vi.fn() });
  const old = { id: '123456', status: 'waiting', revision: 1 } as RoomView;
  const fresh = { ...old, revision: 2 };
  let push!: ReadableStreamDefaultController<Uint8Array>;
  const canceled = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      push = c;
    },
    cancel: canceled,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string) => {
      if (path === '/api/connect') return Promise.resolve(Response.json({ state: old }));
      if (path === '/api/stream')
        return Promise.resolve(
          new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } }),
        );
      return Promise.resolve(
        Response.json({ state: fresh, ack: { commandId: 'abcdefgh', ok: true } }),
      );
    }),
  );
  const socket = new CloudSocket(),
    states: number[] = [];
  socket.on('room:state', (s) => states.push(s.revision));
  socket.connect();
  await vi.advanceTimersByTimeAsync(500);
  socket.timeout(6000).emit('room:ready', { commandId: 'abcdefgh', ready: true }, () => {});
  await vi.advanceTimersByTimeAsync(0);
  push.enqueue(new TextEncoder().encode(JSON.stringify({ state: old }) + '\n'));
  await vi.advanceTimersByTimeAsync(0);
  expect(states).toEqual([1, 2]);
  expect(canceled).toHaveBeenCalled();
  socket.disconnect();
});
