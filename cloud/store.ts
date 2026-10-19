import { randomBytes } from 'node:crypto';
import type { CommandAck } from '@nanjing-mahjong/shared-types';
import { restoreRoomRules, roomForSave } from '../apps/server/src/table.js';
import type { SavedRoom } from '../apps/server/src/table.js';
export const LEASE_MS = 6000;
export const IDLE_MS = 30 * 60 * 1000;
export interface CloudRoom extends SavedRoom {
  cloudFormat: 1;
  lastActivity?: number;
  secret: string;
  clockAt: number | null;
}
export interface Session {
  token: string;
  room_id: string | null;
  peer: string | null;
  last_seen: number;
  created: number;
}
export interface RoomRecord {
  id: string;
  body: string;
  version: number;
  operation: string;
}
export interface RequestContext {
  session: Session | null;
  loaded: { record: RoomRecord; room: CloudRoom } | null;
  online: Set<string>;
  receipt: { body: string; fingerprint: string } | null;
}
export class CloudStore {
  constructor(readonly db: Pick<D1Database, 'prepare' | 'batch'>) {}
  /** Two small statements for the hot path; expiry cleanup stays on the slow path. */
  async poll(token: string, peer: string): Promise<RequestContext> {
    const now = Date.now();
    const results = await this.db.batch([
      this.db
        .prepare(
          `SELECT s.*, r.body AS room_body, r.version AS room_version,
        (SELECT json_group_array(token) FROM cloud_sessions WHERE room_id=s.room_id AND peer IS NOT NULL AND last_seen>=?) AS online
        FROM cloud_sessions s LEFT JOIN cloud_rooms r ON r.id=s.room_id WHERE s.token=?`,
        )
        .bind(now - LEASE_MS, token),
      this.db
        .prepare('UPDATE cloud_sessions SET last_seen=? WHERE token=? AND peer=? AND last_seen<?')
        .bind(now, token, peer, now - 1000),
    ]);
    const row = results[0]!.results[0] as unknown as
      (Session & { room_body: string | null; room_version: number; online: string }) | undefined;
    if (!row) return { session: null, loaded: null, online: new Set(), receipt: null };
    const { room_body, room_version, online, ...session } = row;
    const room = room_body ? (JSON.parse(room_body) as CloudRoom) : null;
    if (room && room.cloudFormat !== 1) throw new Error('存档版本不兼容');
    if (room) restoreRoomRules(room);
    if (session.room_id && (!room || !room.lastActivity || room.lastActivity <= now - IDLE_MS))
      return this.context(token, peer);
    const present = new Set<string>(JSON.parse(online));
    if (session.peer === peer) present.add(token);
    return {
      session,
      loaded: room
        ? { room, record: { id: room.id, body: room_body!, version: room_version, operation: '' } }
        : null,
      online: present,
      receipt: null,
    };
  }
  /** One round trip; identity, heartbeat and state share a transaction. */
  async context(
    token: string,
    peer: string,
    roomId?: string,
    commandId?: string,
  ): Promise<RequestContext> {
    const now = Date.now();
    const results = await this.db.batch([
      // An inactive room expires even if its browsers continue to send heartbeats.
      this.db
        .prepare(
          "DELETE FROM cloud_rooms WHERE COALESCE(json_extract(body,'$.lastActivity'),(SELECT MAX(created) FROM cloud_commands WHERE room_id=cloud_rooms.id),0)<=? AND id IN (?,(SELECT room_id FROM cloud_sessions WHERE token=?))",
        )
        .bind(now - IDLE_MS, roomId ?? null, token),
      this.db.prepare(
        'UPDATE cloud_sessions SET room_id=NULL WHERE room_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cloud_rooms WHERE id=cloud_sessions.room_id)',
      ),
      this.db.prepare('SELECT * FROM cloud_sessions WHERE token=?').bind(token),
      this.db
        .prepare('UPDATE cloud_sessions SET last_seen=? WHERE token=? AND peer=?')
        .bind(now, token, peer),
      this.db
        .prepare(
          `SELECT r.*,
        (SELECT json_group_array(token) FROM cloud_sessions WHERE room_id=r.id AND peer IS NOT NULL AND last_seen>=?) AS online
        FROM cloud_rooms r WHERE r.id=COALESCE(?,(SELECT room_id FROM cloud_sessions WHERE token=?))
        AND EXISTS(SELECT 1 FROM cloud_sessions WHERE token=? AND peer=?)`,
        )
        .bind(now - LEASE_MS, roomId ?? null, token, token, peer),
      this.db
        .prepare('SELECT body,fingerprint FROM cloud_commands WHERE session=? AND id=?')
        .bind(token, commandId ?? ''),
    ]);
    const session = (results[2]!.results[0] as unknown as Session | undefined) ?? null;
    const row = results[4]!.results[0] as unknown as (RoomRecord & { online: string }) | undefined;
    let loaded: RequestContext['loaded'] = null;
    if (row) {
      const room = JSON.parse(row.body) as CloudRoom;
      if (room.cloudFormat !== 1) throw new Error('存档版本不兼容');
      if (room) restoreRoomRules(room);
      loaded = { record: row, room };
    }
    return {
      session,
      loaded,
      online: new Set(row ? (JSON.parse(row.online) as string[]) : []),
      receipt: (results[5]!.results[0] as unknown as RequestContext['receipt']) ?? null,
    };
  }
  async session(token: string): Promise<Session | null> {
    return this.db
      .prepare('SELECT * FROM cloud_sessions WHERE token=?')
      .bind(token)
      .first<Session>();
  }
  async createSession(): Promise<Session> {
    const token = randomBytes(32).toString('hex'),
      created = Date.now();
    await this.db
      .prepare('INSERT INTO cloud_sessions(token,created,last_seen) VALUES(?,?,0)')
      .bind(token, created)
      .run();
    return { token, created, room_id: null, peer: null, last_seen: 0 };
  }
  async connect(session: string, peer: string): Promise<void> {
    await this.db
      .prepare('UPDATE cloud_sessions SET peer=?,last_seen=? WHERE token=?')
      .bind(peer, Date.now(), session)
      .run();
  }
  async heartbeat(session: string, peer: string): Promise<boolean> {
    const result = await this.db
      .prepare('UPDATE cloud_sessions SET last_seen=? WHERE token=? AND peer=?')
      .bind(Date.now(), session, peer)
      .run();
    return result.meta.changes === 1;
  }
  async disconnect(session: string, peer: string): Promise<void> {
    await this.db
      .prepare('UPDATE cloud_sessions SET last_seen=0 WHERE token=? AND peer=?')
      .bind(session, peer)
      .run();
  }
  async online(roomId: string, now = Date.now()): Promise<Set<string>> {
    const result = await this.db
      .prepare(
        'SELECT token FROM cloud_sessions WHERE room_id=? AND peer IS NOT NULL AND last_seen>=?',
      )
      .bind(roomId, now - LEASE_MS)
      .all<{ token: string }>();
    return new Set(result.results.map((row) => row.token));
  }
  async room(id: string): Promise<{ record: RoomRecord; room: CloudRoom } | null> {
    const record = await this.db
      .prepare('SELECT * FROM cloud_rooms WHERE id=?')
      .bind(id)
      .first<RoomRecord>();
    if (!record) return null;
    const room = JSON.parse(record.body) as CloudRoom;
    if (room.cloudFormat !== 1) throw new Error('存档版本不兼容');
    if (room) restoreRoomRules(room);
    return { record, room };
  }
  async receipt(
    session: string,
    id: string,
  ): Promise<{ body: string; fingerprint: string } | null> {
    return this.db
      .prepare('SELECT body,fingerprint FROM cloud_commands WHERE session=? AND id=?')
      .bind(session, id)
      .first();
  }
  async commit(args: {
    room: CloudRoom;
    version: number | null;
    session: string;
    peer: string;
    nextRoom: string | null;
    ack: CommandAck;
    fingerprint: string;
  }): Promise<boolean> {
    const { room, version, session, peer, nextRoom, ack, fingerprint } = args,
      op = randomBytes(16).toString('hex');
    room.lastActivity = Date.now();
    const access =
      'EXISTS(SELECT 1 FROM cloud_sessions WHERE token=? AND peer=? AND (room_id IS NULL OR room_id=?))';
    const noReceipt = 'NOT EXISTS(SELECT 1 FROM cloud_commands WHERE session=? AND id=?)';
    const write =
      version === null
        ? this.db
            .prepare(
              `INSERT OR IGNORE INTO cloud_rooms(id,body,version,operation) SELECT ?,?,0,? WHERE ${access} AND ${noReceipt}`,
            )
            .bind(
              room.id,
              JSON.stringify(roomForSave(room)),
              op,
              session,
              peer,
              room.id,
              session,
              ack.commandId,
            )
        : this.db
            .prepare(
              `UPDATE cloud_rooms SET body=?,version=version+1,operation=? WHERE id=? AND version=? AND ${access} AND ${noReceipt}`,
            )
            .bind(
              JSON.stringify(roomForSave(room)),
              op,
              room.id,
              version,
              session,
              peer,
              room.id,
              session,
              ack.commandId,
            );
    const results = await this.db.batch([
      write,
      this.db
        .prepare(
          'UPDATE cloud_sessions SET room_id=? WHERE token=? AND peer=? AND EXISTS(SELECT 1 FROM cloud_rooms WHERE id=? AND operation=?)',
        )
        .bind(nextRoom, session, peer, room.id, op),
      this.db
        .prepare(
          'INSERT INTO cloud_commands(session,id,fingerprint,body,room_id,created) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM cloud_rooms WHERE id=? AND operation=?)',
        )
        .bind(
          session,
          ack.commandId,
          fingerprint,
          JSON.stringify(ack),
          room.id,
          Date.now(),
          room.id,
          op,
        ),
    ]);
    return results[0]!.meta.changes === 1;
  }
  async saveClock(room: CloudRoom, version: number): Promise<boolean> {
    const result = await this.db
      .prepare(
        'UPDATE cloud_rooms SET body=?,version=version+1,operation=? WHERE id=? AND version=?',
      )
      .bind(JSON.stringify(roomForSave(room)), randomBytes(16).toString('hex'), room.id, version)
      .run();
    return result.meta.changes === 1;
  }
}
