import { DatabaseSync, backup } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
const source = resolve(process.env.DB_PATH ?? 'data/mahjong.sqlite');
const destination = resolve(
  process.argv[2] ??
    'backups/mahjong-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite',
);
if (!existsSync(source) || source === destination || existsSync(destination))
  throw new Error('备份源不存在，或目标已存在');
mkdirSync(dirname(destination), { recursive: true });
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, destination);
  console.log('备份已保存：' + destination);
} finally {
  db.close();
}
