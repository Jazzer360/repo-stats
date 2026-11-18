#!/usr/bin/env node
// Analyze local git repositories (or clone URLs) without the server and write
// a report JSON that the dashboard can open (Data -> Open a report).
//
//   node cli/analyze.mjs <dir|git-url> [...] [--out report.json] [--no-history]

import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { git, analyzeRepoDir, localMeta } from '../server/local.mjs';
import { ENGINE_VERSION } from '../site/js/engine/classify.js';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const out = flag('--out') || 'repo-stats-report.json';
const noHistory = bool('--no-history');
if (!args.length || bool('--help')) {
  console.log('usage: node cli/analyze.mjs <dir|git-url> [...] [--out file] [--no-history]');
  process.exit(args.length ? 0 : 1);
}

const repos = [];
const tmp = mkdtempSync(join(tmpdir(), 'repo-stats-'));
try {
  for (const target of args) {
    let dir = target;
    if (/^(https?:|git@)/.test(target)) {
      dir = join(tmp, basename(target).replace(/\.git$/, ''));
      console.error(`cloning ${target}`);
      await git(undefined, ['clone', '--quiet', target, dir]);
    }
    dir = resolve(dir);
    const t0 = Date.now();
    try {
      const rec = await analyzeRepoDir(dir, await localMeta(dir), { withHistory: !noHistory });
      if (/^(https?:|git@)/.test(target)) delete rec.localPath;
      repos.push(rec);
      console.error(`  ${rec.fullName}: ${rec.files.length} files in ${Date.now() - t0} ms${rec.history ? '' : ' (no history)'}`);
    } catch (e) { console.error(`  ${dir}: ${e.message}`); }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
writeFileSync(out, JSON.stringify({ schema: 1, engine: ENGINE_VERSION, source: 'cli', generatedAt: new Date().toISOString(), viewer: null, orgs: [], repos }));
console.error(`wrote ${out} (${repos.length} repos)`);
