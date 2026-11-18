// Local git operations: clone/update a repository into the cache and analyze a
// working tree with the shared engine. Used by the server and the CLI.
//
// Authentication for private repos is delegated to the GitHub CLI's git
// credential helper (`gh auth git-credential`): git asks gh, gh answers git.
// This code never sees, stores or logs a token.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { analyzeEntries } from '../site/js/engine/analyze.js';
import { ENGINE_VERSION } from '../site/js/engine/classify.js';

const pexec = promisify(execFile);
const GH_CRED = ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential'];

export async function git(cwd, args, opts = {}) {
  const { stdout } = await pexec('git', args, { cwd, maxBuffer: 1 << 30, encoding: 'utf8', windowsHide: true, ...opts });
  return stdout;
}

/** Clone, or bring an existing clone up to date with the default branch. Returns the HEAD oid. */
export async function cloneOrUpdate(fullName, dir, { branch, expectedOid, signal } = {}) {
  const url = `https://github.com/${fullName}.git`;
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (existsSync(join(dir, '.git'))) {
    const head = (await git(dir, ['rev-parse', 'HEAD']).catch(() => '')).trim();
    if (expectedOid && head === expectedOid) return head;
    await git(dir, [...GH_CRED, 'fetch', '--quiet', '--no-tags', 'origin', branch || 'HEAD'], { env, signal });
    await git(dir, ['checkout', '--quiet', '--force', '-B', branch || 'main', 'FETCH_HEAD'], { signal });
  } else {
    await mkdir(dirname(dir), { recursive: true });
    await rm(dir, { recursive: true, force: true });
    await git(undefined, [...GH_CRED, 'clone', '--quiet', '--no-tags', ...(branch ? ['--branch', branch] : []), url, dir], { env, signal });
  }
  return (await git(dir, ['rev-parse', 'HEAD'])).trim();
}

function weekStart(ts) { const d = new Date(ts * 1000); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.getTime() / 1000; }

/**
 * Commit history of HEAD from git log. `isMine(name, email)` marks the user's
 * own commits; emails are used only for that test and never stored.
 */
export async function history(dir, isMine = () => false) {
  try { if ((await git(dir, ['rev-parse', '--is-shallow-repository'])).trim() === 'true') return null; } catch {}
  let log;
  try { log = await git(dir, ['log', '--no-merges', '--format=@@%at\t%aN\t%aE', '--shortstat', 'HEAD']); } catch { return null; }
  const weeks = new Map();
  const authors = new Map();
  const punch = Array.from({ length: 7 }, () => Array(24).fill(0));
  const punchMine = Array.from({ length: 7 }, () => Array(24).fill(0));
  const mine = { login: null, commits: 0, additions: 0, deletions: 0, firstCommit: null, lastCommit: null };
  let first = Infinity, last = 0, cur = null;
  for (const line of log.split('\n')) {
    if (line.startsWith('@@')) {
      const [ts, name, email] = line.slice(2).split('\t');
      const t = +ts;
      first = Math.min(first, t); last = Math.max(last, t);
      const w = weekStart(t);
      if (!weeks.has(w)) weeks.set(w, [w, 0, 0, 0]);
      const a = authors.get(name) || { login: name, commits: 0, additions: 0, deletions: 0 };
      authors.set(name, a);
      const me = isMine(name, email);
      cur = { w: weeks.get(w), a, me };
      cur.w[3]++; a.commits++;
      // local time of the commit isn't in %at; use UTC hour shifted by the author's offset? keep UTC-free: use local machine time
      const d = new Date(t * 1000);
      punch[d.getDay()][d.getHours()]++;
      if (me) {
        punchMine[d.getDay()][d.getHours()]++;
        mine.commits++; mine.login = mine.login || name;
        const iso = d.toISOString();
        if (!mine.firstCommit || iso < mine.firstCommit) mine.firstCommit = iso;
        if (!mine.lastCommit || iso > mine.lastCommit) mine.lastCommit = iso;
      }
    } else if (cur && line.includes('changed')) {
      const ins = +(/(\d+) insertion/.exec(line)?.[1] || 0), del = +(/(\d+) deletion/.exec(line)?.[1] || 0);
      cur.w[1] += ins; cur.w[2] += del; cur.a.additions += ins; cur.a.deletions += del;
      if (cur.me) { mine.additions += ins; mine.deletions += del; }
    }
  }
  const total = +(await git(dir, ['rev-list', '--count', 'HEAD'])).trim();
  return {
    commits: total,
    firstCommit: first === Infinity ? null : new Date(first * 1000).toISOString(),
    lastCommit: last ? new Date(last * 1000).toISOString() : null,
    weekly: [...weeks.values()].sort((a, b) => a[0] - b[0]),
    contributors: [...authors.values()].sort((a, b) => b.commits - a.commits).slice(0, 200),
    contributorCount: authors.size,
    mine: mine.commits ? mine : null,
    punch, punchMine,
    source: 'git',
  };
}

/** Analyze the tracked files at HEAD of a working tree. */
export async function analyzeWorkingTree(dir) {
  const ls = await git(dir, ['ls-files', '-z', '--cached', '-s']);
  const entries = [];
  for (const row of ls.split('\0')) {
    if (!row) continue;
    const tab = row.indexOf('\t');
    const mode = row.slice(0, row.indexOf(' '));
    const path = row.slice(tab + 1);
    if (mode === '160000' || mode === '120000') continue; // submodule / symlink
    try { entries.push({ path, size: (await stat(join(dir, path))).size }); } catch {}
  }
  const readMany = async (list) => {
    const m = new Map();
    await Promise.all(list.map(async (e) => {
      try { m.set(e.path, await readFile(join(dir, e.path), 'utf8')); } catch { m.set(e.path, null); }
    }));
    return m;
  };
  return analyzeEntries(entries, readMany, { concurrency: 2 });
}

/** Repo metadata for a plain local folder (not from the GitHub API). */
export async function localMeta(dir) {
  let remote = '';
  try { remote = (await git(dir, ['remote', 'get-url', 'origin'])).trim(); } catch {}
  const m = /github\.com[:/]([^/]+)\/([^/]+?)(\.git)?$/.exec(remote);
  const owner = m?.[1] || 'local';
  const name = m?.[2] || basename(dir);
  const headOid = (await git(dir, ['rev-parse', 'HEAD'])).trim();
  const defaultBranch = (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  return { fullName: `${owner}/${name}`, owner, name, url: m ? `https://github.com/${owner}/${name}` : null, defaultBranch, headOid, private: null, fork: false, archived: false, localPath: dir };
}

export async function analyzeRepoDir(dir, meta, { withHistory = true, isMine } = {}) {
  const files = await analyzeWorkingTree(dir);
  const rec = { ...meta, status: 'ok', engine: ENGINE_VERSION, analyzedAt: new Date().toISOString(), files, history: withHistory ? await history(dir, isMine) : null };
  if (rec.history) {
    rec.createdAt ||= rec.history.firstCommit;
    rec.pushedAt ||= rec.history.lastCommit;
  }
  return rec;
}
