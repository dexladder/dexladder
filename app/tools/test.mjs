// Compiles test/*.test.ts with esbuild (no ts runtime needed) and runs them with node:test.
import { build } from 'esbuild';
import { readdirSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(APP, '.test-out');
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT);
const tests = readdirSync(join(APP, 'test')).filter(f => f.endsWith('.test.ts'));
await build({
  entryPoints: tests.map(f => join(APP, 'test', f)), outdir: OUT, outExtension: { '.js': '.mjs' },
  bundle: true, format: 'esm', platform: 'node', target: 'node20', packages: 'external', logLevel: 'silent', loader: { '.md': 'text' },
});
const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...tests.map(f => join(OUT, f.replace(/\.ts$/, '.mjs')))], { stdio: 'inherit' });
process.exit(r.status ?? 1);
