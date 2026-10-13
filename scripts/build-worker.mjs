import { build } from 'esbuild';
import { mkdir, cp, writeFile, readFile } from 'node:fs/promises';
await mkdir('dist/server', { recursive: true });
await build({
  entryPoints: ['cloud/worker.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  external: ['node:*'],
  conditions: ['workerd', 'worker', 'browser'],
  minify: true,
});
await cp('apps/web/dist', 'dist/client', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await cp('drizzle', 'dist/.openai/drizzle', { recursive: true });
const config = JSON.parse(await readFile('wrangler.json', 'utf8'));
config.main = 'index.js';
config.assets.directory = '../client';
config.d1_databases[0].migrations_dir = '../.openai/drizzle';
await writeFile('dist/server/wrangler.json', JSON.stringify(config, null, 2) + '\n');
