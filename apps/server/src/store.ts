import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { CommandAck } from '@nanjing-mahjong/shared-types';
import type { SavedRoom } from './table.js';

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commands(session TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(session,id));`);
    const version = this.db.prepare("SELECT value FROM metadata WHERE key='version'").get();
    if (version && version.value !== '1:V1.0.8') {
      this.db.close();
      throw new Error('存档版本不兼容，请使用对应版本恢复');
    }
    this.db.prepare("INSERT OR IGNORE INTO metadata VALUES ('version','1:V1.0.8')").run();
    this.db
      .prepare("INSERT OR IGNORE INTO metadata VALUES ('secret',?)")
      .run(randomBytes(32).toString('hex'));
  }
  secret(): string {
    return String(this.db.prepare("SELECT value FROM metadata WHERE key='secret'").get()!.value);
  }
  session(token?: string): string {
    if (token && this.db.prepare('SELECT token FROM sessions WHERE token=?').get(token))
      return token;
    const next = randomBytes(32).toString('hex');
    this.db.prepare('INSERT INTO sessions VALUES (?,?)').run(next, Date.now());
    return next;
  }
  hasSession(token: string): boolean {
    return !!this.db.prepare('SELECT token FROM sessions WHERE token=?').get(token);
  }
  rooms(): SavedRoom[] {
    return this.db
      .prepare('SELECT body FROM rooms')
      .all()
      .map((row) => {
        const room = JSON.parse(String(row.body)) as SavedRoom;
        if (room.format !== 1 || room.rules !== 'V1.0.8') throw new Error('房间存档版本不兼容');
        return room;
      });
  }
  receipt(session: string, id: string): CommandAck | undefined {
    const row = this.db
      .prepare('SELECT body FROM commands WHERE session=? AND id=?')
      .get(session, id);
    return row ? (JSON.parse(String(row.body)) as CommandAck) : undefined;
  }
  commit(room: SavedRoom | undefined, session?: string, ack?: CommandAck): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (room)
        this.db
          .prepare('INSERT OR REPLACE INTO rooms VALUES (?,?)')
          .run(room.id, JSON.stringify(room));
      if (session && ack)
        this.db
          .prepare('INSERT INTO commands VALUES (?,?,?)')
          .run(session, ack.commandId, JSON.stringify(ack));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  async backup(path: string): Promise<void> {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    await backup(this.db, path);
  }
  close(): void {
    this.db.close();
  }
}
