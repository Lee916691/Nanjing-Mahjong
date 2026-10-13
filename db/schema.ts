import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
export const sessions = sqliteTable(
  'cloud_sessions',
  {
    token: text('token').primaryKey(),
    created: integer('created').notNull(),
    roomId: text('room_id'),
    peer: text('peer'),
    lastSeen: integer('last_seen').notNull().default(0),
  },
  (table) => [index('cloud_sessions_room').on(table.roomId)],
);
export const rooms = sqliteTable('cloud_rooms', {
  id: text('id').primaryKey(),
  body: text('body').notNull(),
  version: integer('version').notNull().default(0),
  operation: text('operation').notNull(),
});
export const commands = sqliteTable(
  'cloud_commands',
  {
    session: text('session').notNull(),
    id: text('id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    body: text('body').notNull(),
    roomId: text('room_id').notNull(),
    created: integer('created').notNull(),
  },
  (table) => [primaryKey({ columns: [table.session, table.id] })],
);
