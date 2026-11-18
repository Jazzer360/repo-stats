#!/usr/bin/env node
// Local analyzer: runs the same engine as the website against local clones and
// writes a report JSON the website can import (Data -> Import report).
//
//   node cli/analyze.mjs <dir-or-git-url> [...more] [--out report.json] [--no-history]
//   node cli/analyze.mjs --gh-user <login> [--include-forks]   (clones public repos via `git`)
//
// Only tracked files at HEAD are analyzed (git ls-files), so local build output
// and untracked junk never count. Author emails are never recorded.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, statSync, rmSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeEntries } from '../site/js/engine/analyze.js';
import { ENGINE_VERSION } from '../site/js/engine/classify.js';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const out = flag('--out') || 'repo-stats-report.json';
const noHistory = bool('--no-history');
const keep = bool('--keep-clones');
if (!args.length || bool('--help')) {
  console.log('usage: node cli/analyze.mjs <dir|git-url> [...] [--out file] [--no-history] [--keep-clones]');
  process.exit(args.length ? 0 : 1);
}

const git = (cwd, ...a) => execFileSync('git', a, { cwd, maxBuffer: 1 << 30, encoding: 'utf8' });

function weekStart(ts) { const d = new Date(ts * 1000); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.getTime() / 1000; }

function history(dir) {
  try { if (git(dir, 'rev-parse', '--is-shallow-repository').trim() === 'true') { console.error('  (shallow clone: skipping history)'); return null; } } catch {}
  let log;
  try { log = git(dir, 'log', '--no-merges', '--format=@@%at\t%aN', '--shortstat', 'HEAD'); } catch { return null; }
  const weeks = new Map();
  const authors = new Map();
  let commits = 0, first = Infinity, last = 0, cur = null;
  for (const line of log.split('\n')) {
    if (line.startsWith('@@')) {
      const [ts, name] = line.slice(2).split('\t');
      const t = +ts; commits++;
      first = Math.min(first, t); last = Math.max(last, t);
      const w = weekStart(t);
      if (!weeks.has(w)) weeks.set(w, [w, 0, 0, 0]);
      cur = { w: weeks.get(w), a: authors.get(name) || { login: name, commits: 0, additions: 0, deletions: 0 } };
      authors.set(name, cur.a);
      cur.w[3]++; cur.a.commits++;
    } else if (cur && line.includes('changed')) {
      const ins = +(/(\d+) insertion/.exec(line)?.[1] || 0), del = +(/(\d+) deletion/.exec(line)?.[1] || 0);
      cur.w[1] += ins; cur.w[2] += del; cur.a.additions += ins; cur.a.deletions += del;
    }
  }
  const total = +git(dir, 'rev-list', '--count', 'HEAD').trim();
  return {
    commits: total,
    firstCommit: first === Infinity ? null : new Date(first * 1000).toISOString(),
    lastCommit: last ? new Date(last * 1000).toISOString() : null,
    weekly: [...weeks.values()].sort((a, b) => a[0] - b[0]),
    contributors: [...authors.values()].sort((a, b) => b.commits - a.commits).slice(0, 500),
    contributorCount: authors.size,
    source: 'git',
  };
}

async function analyzeDir(dir, meta = {}) {
  const ls = git(dir, 'ls-files', '-z', '--cached', '-s').split('\0').filter(Boolean);
  const entries = [];
  for (const row of ls) {
    const [info, path] = row.split('\t');
    const mode = info.split(' ')[0];
    if (mode === '160000' || mode === '120000') continue; // submodule / symlink
    const full = join(dir, path);
    if (!existsSync(full)) continue;
    entries.push({ path, size: statSync(full).size });
  }
  const readMany = async (list) => {
    const m = new Map();
    for (const e of list) { try { m.set(e.path, readFileSync(join(dir, e.path), 'utf8')); } catch { m.set(e.path, null); } }
    return m;
  };
  const t0 = Date.now();
  const files = await analyzeEntries(entries, readMany, { concurrency: 1 });
  let remote = '';
  try { remote = git(dir, 'remote', 'get-url', 'origin').trim(); } catch {}
  const m = /github\.com[:/]([^/]+)\/([^/.]+?)(\.git)?$/.exec(remote);
  const owner = meta.owner || m?.[1] || 'local';
  const name = meta.name || m?.[2] || basename(dir);
  const head = git(dir, 'rev-parse', 'HEAD').trim();
  const branch = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  const rec = {
    fullName: `${owner}/${name}`, owner, name, url: m ? `https://github.com/${owner}/${name}` : null,
    defaultBranch: branch, headOid: head, private: null, fork: false, archived: false,
    status: 'ok', engine: ENGINE_VERSION, analyzedAt: new Date().toISOString(), files,
    history: noHistory ? null : history(dir),
  };
  if (rec.history) { rec.createdAt = rec.history.firstCommit; rec.pushedAt = rec.history.lastCommit; }
  console.error(`  ${rec.fullName}: ${files.length} files in ${Date.now() - t0} ms`);
  return rec;
}

const repos = [];
const tmp = mkdtempSync(join(tmpdir(), 'repo-stats-'));
try {
  for (const target of args) {
    let dir = target;
    if (/^(https?:|git@)/.test(target)) {
      dir = join(tmp, basename(target).replace(/\.git$/, ''));
      console.error(`cloning ${target}`);
      execFileSync('git', ['clone', '--quiet', '--filter=blob:none', '--no-checkout', target, dir]);
      git(dir, 'checkout', '--quiet');
    }
    console.error(`analyzing ${resolve(dir)}`);
    repos.push(await analyzeDir(resolve(dir)));
  }
} finally {
  if (!keep) rmSync(tmp, { recursive: true, force: true });
}

const report = { schema: 1, engine: ENGINE_VERSION, source: 'cli', generatedAt: new Date().toISOString(), viewer: null, orgs: [], repos };
writeFileSync(out, JSON.stringify(report));
console.error(`wrote ${out} (${repos.length} repos)`);
