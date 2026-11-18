#!/usr/bin/env node
// Repo Stats local server.
//
//   node server/index.mjs [--port 4173] [--open]
//
// Serves the dashboard and a small JSON API on 127.0.0.1 only. Lists repos via
// the GitHub CLI, clones them into the cache folder with git, analyzes them and
// keeps the results in report.json there.
//
// Cache folder: $REPO_STATS_HOME, default ~/.repo-stats  (clones/ + report.json)

import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, extname, normalize, sep } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ghStatus, GhCli, myIdentities } from './gh.mjs';
import { cloneOrUpdate, analyzeRepoDir, localMeta, git } from './local.mjs';
import { fetchViewer, listRepos } from './queries.mjs';
import { ENGINE_VERSION } from '../site/js/engine/classify.js';

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const PORT = +argVal('--port', process.env.PORT || 4173);
const HOME = resolve(process.env.REPO_STATS_HOME || join(homedir(), '.repo-stats'));
const CLONES = join(HOME, 'clones');
const REPORT = join(HOME, 'report.json');
const SITE = fileURLToPath(new URL('../site/', import.meta.url));

const gh = new GhCli();
let report = { schema: 1, engine: ENGINE_VERSION, source: 'local', viewer: null, orgs: [], contributions: null, repos: [] };
let listed = new Map(); // fullName -> repo metadata from the last listing
let job = null;

// ------------------------------------------------------------ persistence

async function loadReport() {
  try { report = { ...report, ...JSON.parse(await readFile(REPORT, 'utf8')) }; } catch {}
}
let saving = Promise.resolve();
function saveReport() {
  report.generatedAt = new Date().toISOString();
  saving = saving.then(async () => {
    await mkdir(HOME, { recursive: true });
    const tmp = REPORT + '.tmp';
    await writeFile(tmp, JSON.stringify(report));
    await rename(tmp, REPORT);
  }).catch(e => console.error('save failed:', e.message));
  return saving;
}
function upsert(rec) {
  const i = report.repos.findIndex(r => r.fullName === rec.fullName);
  if (i >= 0) report.repos[i] = rec; else report.repos.push(rec);
}
const cloneDir = (fullName) => join(CLONES, ...fullName.split('/').map(s => s.replace(/[^\w.-]/g, '_')));

// ------------------------------------------------------------ processing

async function runJob(names, opts) {
  const ctl = new AbortController();
  job = { running: true, started: Date.now(), order: names, items: Object.fromEntries(names.map(n => [n, { state: 'queued' }])), counts: { cached: 0, done: 0, error: 0, skipped: 0 }, done: 0, total: names.length, log: [], controller: ctl };
  const isMine = await myIdentities(report.viewer);
  const queue = [...names];
  const work = async () => {
    while (queue.length && !ctl.signal.aborted) {
      const name = queue.shift();
      const meta = listed.get(name) || report.repos.find(r => r.fullName === name);
      const it = job.items[name];
      const finish = (state, extra = {}) => { Object.assign(it, { state, ...extra }); job.counts[state]++; job.done++; };
      if (!meta) { finish('error', { msg: 'unknown repository; list repositories again' }); continue; }
      const prev = report.repos.find(r => r.fullName === name);
      try {
        if (meta.localPath) {
          it.state = 'running'; it.phase = 'analyzing';
          const fresh = await localMeta(meta.localPath);
          if (!opts.force && prev?.status === 'ok' && prev.headOid === fresh.headOid && prev.engine === ENGINE_VERSION) { finish('cached'); continue; }
          const rec = await analyzeRepoDir(meta.localPath, { ...prev, ...fresh }, { withHistory: opts.history, isMine });
          upsert(rec); await saveReport();
          finish('done', { files: rec.files.length });
          continue;
        }
        if (meta.empty || !meta.headOid) { upsert({ ...meta, status: 'empty', engine: ENGINE_VERSION, files: [] }); finish('skipped', { msg: 'empty repository' }); continue; }
        if (opts.maxRepoMb && meta.diskKb > opts.maxRepoMb * 1024) {
          upsert({ ...meta, status: 'skipped', engine: ENGINE_VERSION, files: [], error: `${Math.round(meta.diskKb / 1024)} MB on GitHub, over the ${opts.maxRepoMb} MB limit` });
          finish('skipped', { msg: `${Math.round(meta.diskKb / 1024)} MB, over limit` }); continue;
        }
        if (!opts.force && prev?.status === 'ok' && prev.headOid === meta.headOid && prev.engine === ENGINE_VERSION && (!opts.history || prev.history)) {
          upsert({ ...prev, ...meta, files: prev.files, history: prev.history, status: 'ok' });
          finish('cached'); continue;
        }
        it.state = 'running';
        const dir = cloneDir(name);
        it.phase = existsSync(join(dir, '.git')) ? 'fetching' : 'cloning';
        const oid = await cloneOrUpdate(name, dir, { branch: meta.defaultBranch, expectedOid: meta.headOid, signal: ctl.signal });
        it.phase = 'analyzing';
        const rec = await analyzeRepoDir(dir, { ...meta, headOid: oid }, { withHistory: opts.history, isMine });
        rec.createdAt = meta.createdAt; rec.pushedAt = meta.pushedAt;
        upsert(rec);
        if (!opts.keepClones) await rm(dir, { recursive: true, force: true });
        await saveReport();
        finish('done', { files: rec.files.length });
      } catch (e) {
        if (ctl.signal.aborted) { it.state = 'queued'; break; }
        const msg = (e.stderr || e.message || String(e)).trim().split('\n').slice(-1)[0];
        upsert({ ...meta, status: 'error', error: msg, engine: ENGINE_VERSION, files: prev?.files || [] });
        finish('error', { msg });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency || 3, 6)) }, work));
  // forget repos that dropped out of the listed scopes, if asked
  if (opts.prune && !ctl.signal.aborted) {
    const keep = new Set([...listed.keys(), ...report.repos.filter(r => r.localPath).map(r => r.fullName)]);
    report.repos = report.repos.filter(r => keep.has(r.fullName));
  }
  await saveReport();
  job.running = false;
  job.cancelled = ctl.signal.aborted;
  job.finished = Date.now();
}

// ------------------------------------------------------------ http

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
async function body(req) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 1e6) throw new Error('body too large'); }
  return s ? JSON.parse(s) : {};
}

const routes = {
  'GET /api/status': async () => {
    const s = await ghStatus();
    let gitVersion = null;
    try { gitVersion = (await git(undefined, ['--version'])).trim(); } catch {}
    let cacheBytes = null;
    return { ...s, git: gitVersion, home: HOME, reportRepos: report.repos.length, job: !!job?.running, engine: ENGINE_VERSION, cacheBytes };
  },
  'GET /api/report': async () => report,
  'POST /api/viewer': async () => {
    const info = await fetchViewer(gh);
    Object.assign(report, info);
    await saveReport();
    return info;
  },
  'POST /api/list': async (req) => {
    const { personal = true, collaborator = false, orgs = [] } = await body(req);
    const seen = new Map();
    const errors = [];
    const aff = [personal && 'OWNER', collaborator && 'COLLABORATOR'].filter(Boolean);
    if (aff.length) for (const r of await listRepos(gh, { affiliations: aff })) seen.set(r.fullName, r);
    for (const org of orgs) {
      try { for (const r of await listRepos(gh, { org })) seen.set(r.fullName, r); }
      catch (e) { errors.push(`${org}: ${e.message}`); }
    }
    listed = seen;
    const byName = new Map(report.repos.map(r => [r.fullName, r]));
    const repos = [...seen.values()].map(r => {
      const p = byName.get(r.fullName);
      return { ...r, cached: p ? (p.status === 'ok' && p.headOid === r.headOid && p.engine === ENGINE_VERSION ? 'current' : p.status === 'ok' ? 'stale' : p.status) : null };
    });
    return { repos, errors };
  },
  'POST /api/local': async (req) => {
    const { path } = await body(req);
    const dir = resolve(String(path || '').replace(/^~(?=$|[\\/])/, homedir()));
    if (!existsSync(join(dir, '.git'))) throw Object.assign(new Error(`${dir} is not a git repository`), { status: 400 });
    const meta = await localMeta(dir);
    listed.set(meta.fullName, meta);
    return meta;
  },
  'POST /api/scan': async (req) => {
    if (job?.running) throw Object.assign(new Error('a run is already in progress'), { status: 409 });
    const opts = await body(req);
    const names = (opts.repos || []).filter(n => listed.has(n) || report.repos.some(r => r.fullName === n));
    if (!names.length) throw Object.assign(new Error('no repositories selected'), { status: 400 });
    runJob(names, opts).catch(e => { console.error(e); if (job) { job.running = false; job.log.push(e.message); } });
    return { started: names.length };
  },
  'POST /api/cancel': async () => { job?.controller.abort(); return { ok: true }; },
  'GET /api/job': async () => {
    if (!job) return null;
    const { controller, ...rest } = job;
    return rest;
  },
  'POST /api/remove': async (req) => {
    const { repos = [] } = await body(req);
    const set = new Set(repos);
    report.repos = report.repos.filter(r => !set.has(r.fullName));
    for (const n of repos) await rm(cloneDir(n), { recursive: true, force: true });
    await saveReport();
    return { removed: repos.length };
  },
  'POST /api/clear-clones': async () => { if (job?.running) throw Object.assign(new Error('a run is in progress'), { status: 409 }); await rm(CLONES, { recursive: true, force: true }); return { ok: true }; },
};

const server = createServer(async (req, res) => {
  // Only answer requests addressed to this machine (guards against DNS rebinding),
  // and only same-origin API calls (guards against other sites posting here).
  const host = (req.headers.host || '').split(':')[0];
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return send(res, 403, { error: 'forbidden host' });
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET') {
      const origin = req.headers.origin;
      if (origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'forbidden origin' });
      if (!/application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'json required' });
    }
    const fn = routes[`${req.method} ${url.pathname}`];
    if (!fn) return send(res, 404, { error: 'not found' });
    try { send(res, 200, await fn(req, url)); }
    catch (e) { send(res, e.status || 500, { error: e.message }); }
    return;
  }
  // static files
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(SITE, p));
  if (!file.startsWith(normalize(SITE))) return send(res, 403, 'forbidden', 'text/plain');
  try {
    const data = await readFile(file);
    send(res, 200, data, MIME[extname(file)] || 'application/octet-stream');
  } catch { send(res, 404, 'not found', 'text/plain'); }
});

await loadReport();
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`Repo Stats running at ${url}`);
  console.log(`Data folder: ${HOME}`);
  if (args.includes('--open')) {
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    execFile(cmd[0], cmd[1], () => {});
  }
});
