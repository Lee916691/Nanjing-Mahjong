import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
const server = createApp({
  dbPath:
    process.env.DB_PATH ?? fileURLToPath(new URL('../../../data/mahjong.sqlite', import.meta.url)),
  publicOrigin: process.env.PUBLIC_ORIGIN,
});
const port = Number(process.env.PORT ?? 3000);
server.http.listen(port, process.env.HOST ?? '0.0.0.0', () => {
  console.log(`南京麻将已启动：http://localhost:${port}`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
