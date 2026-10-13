import type { CommandAck, RoomCommand, RoomEvent, RoomView } from '@nanjing-mahjong/shared-types';
type Listeners = {
  connect: () => void;
  disconnect: () => void;
  connect_error: () => void;
  'session:replaced': () => void;
  'room:left': () => void;
  'room:expired': () => void;
  'room:state': (state: RoomView) => void;
};
interface Reply {
  state?: RoomView | null;
  ack?: CommandAck;
  left?: boolean;
  disconnect?: boolean;
  error?: { code: string; message: string };
}
export class CloudSocket {
  private listeners = new Map<keyof Listeners, ((value?: unknown) => void)[]>();
  private peer = Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
  private stopped = true;
  private connected = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private lastState = '';
  private hasRoom = false;
  private generation = 0;
  private commandPending = false;
  private pollDelay = 1200;
  private activeStream?: AbortController;
  private streamRetryAt = 0;
  on<K extends keyof Listeners>(event: K, listener: Listeners[K]): this {
    const entries = this.listeners.get(event) ?? [];
    entries.push(listener as (value?: unknown) => void);
    this.listeners.set(event, entries);
    return this;
  }
  private fire(event: keyof Listeners, value?: unknown) {
    if (!this.stopped || event === 'disconnect' || event === 'session:replaced')
      this.listeners.get(event)?.forEach((fn) => fn(value));
  }
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }
  private async request(
    path: string,
    body: Record<string, unknown>,
    timeout = 6000,
  ): Promise<Reply> {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, peer: this.peer }),
      signal: AbortSignal.timeout(timeout),
    });
    const reply = (await response.json()) as Reply;
    if (!response.ok) {
      if (reply.error?.code === 'REPLACED') {
        this.fire('session:replaced');
        this.disconnect();
      }
      throw new Error(reply.error?.message ?? '网络请求失败');
    }
    return reply;
  }
  private apply(reply: Reply) {
    if (this.stopped) return;
    if (reply.state) {
      const serialized = JSON.stringify(reply.state);
      this.hasRoom = true;
      this.pollDelay = reply.state.status === 'playing' ? 150 : 500;
      if (serialized !== this.lastState) {
        this.lastState = serialized;
        this.fire('room:state', reply.state);
      }
    } else if (reply.state === null && this.hasRoom) {
      this.hasRoom = false;
      this.pollDelay = 1200;
      this.lastState = '';
      this.fire('room:left');
      if (!reply.left) this.fire('room:expired');
    }
    if (reply.disconnect) this.disconnect();
  }
  connect() {
    if (!this.stopped) return;
    this.stopped = false;
    this.lastState = '';
    void this.cycle();
    return this;
  }
  private async receiveStream(generation: number) {
    const controller = new AbortController();
    this.activeStream = controller;
    let watchdog = setTimeout(() => controller.abort(), 2500);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch('/api/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer: this.peer }),
        signal: controller.signal,
      });
      if (
        !response.ok ||
        !response.body ||
        !response.headers.get('Content-Type')?.includes('application/x-ndjson')
      )
        throw new Error('Stream unavailable');
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '',
        received = false;
      while (!this.stopped && generation === this.generation) {
        const { done, value } = await reader.read();
        if (done) break;
        clearTimeout(watchdog);
        watchdog = setTimeout(() => controller.abort(), 2500);
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 1000000) throw new Error('Invalid stream');
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const reply = JSON.parse(line) as Reply;
          if (this.stopped || generation !== this.generation) return;
          received = true;
          if (reply.error?.code === 'REPLACED') {
            this.fire('session:replaced');
            this.disconnect();
            return;
          }
          this.apply(reply);
        }
      }
      if (!received && !this.stopped && generation === this.generation)
        throw new Error('Empty stream');
    } finally {
      clearTimeout(watchdog);
      controller.abort();
      await reader?.cancel().catch(() => {});
      if (this.activeStream === controller) this.activeStream = undefined;
    }
  }
  private async cycle() {
    if (this.stopped) return;
    const generation = this.generation;
    try {
      if (this.commandPending) return;
      if (this.connected && this.hasRoom && Date.now() >= this.streamRetryAt) {
        try {
          await this.receiveStream(generation);
        } catch {
          if (generation === this.generation) this.streamRetryAt = Date.now() + 30000;
        }
        return;
      }
      const reply = await this.request(this.connected ? '/api/poll' : '/api/connect', {});
      if (this.stopped || generation !== this.generation) return;
      if (!this.connected) {
        this.connected = true;
        this.fire('connect');
      }
      this.apply(reply);
    } catch {
      if (generation !== this.generation) return;
      if (this.connected) {
        this.connected = false;
        this.fire('disconnect');
      }
      this.fire('connect_error');
    } finally {
      if (!this.stopped)
        this.timer = setTimeout(() => void this.cycle(), this.connected ? this.pollDelay : 1200);
    }
  }
  timeout(ms: number) {
    return {
      emit: (
        event: RoomEvent,
        command: RoomCommand,
        callback: (error: Error | null, ack?: CommandAck) => void,
      ) => {
        void this.enqueue(async () => {
          if (this.stopped) throw new Error('连接已关闭');
          // Polls never block player actions. Epoch checks discard any overlapping poll.
          this.commandPending = true;
          this.generation++;
          this.activeStream?.abort();
          try {
            const reply = await this.request('/api/command', { event, command }, ms);
            if (!reply.ack) throw new Error('服务器未确认操作');
            this.apply(reply);
            callback(null, reply.ack);
          } finally {
            this.commandPending = false;
            this.generation++;
          }
        }).catch((error) => callback(error instanceof Error ? error : new Error('网络请求失败')));
      },
    };
  }
  disconnect() {
    if (this.stopped) return;
    this.stopped = true;
    this.activeStream?.abort();
    clearTimeout(this.timer);
    if (this.connected) {
      this.connected = false;
      this.fire('disconnect');
    }
    const payload = new Blob([JSON.stringify({ peer: this.peer })], { type: 'application/json' });
    navigator.sendBeacon('/api/disconnect', payload);
  }
}
export function io(options: { autoConnect: boolean }): CloudSocket {
  const socket = new CloudSocket();
  if (options.autoConnect) socket.connect();
  return socket;
}
