// App shell: state, routing, header, global filters, processing and data views.

import { esc, attr, fmtN, fmtPct, fmtBytes, fmtAgo, fmtDate, $, $$, installTooltip, setLanguageRanking, download, card } from './ui.js';
import * as V from './views.js';
import { summarizeRepo, summarizeMany } from './engine/aggregate.js';
import { ENGINE_VERSION } from './engine/classify.js';
import { GitHub, fetchViewer, listRepos } from './github.js';
import { runScan } from './scan.js';
import * as auth from './auth.js';
import * as store from './store.js';

const UI_KEY = 'repo-stats-ui';
const loadUi = () => { try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}'); } catch { return {}; } };

const app = {
  dataset: null,
  meta: null,
  repos: [],
  loggedIn: false,
  gh: null,
  rate: null,
  filter: { q: '', owner: '', vis: '', lang: '', forks: true, archived: true },
  ui: Object.assign({ table: { sort: 'code', dir: 'desc', cols: V.DEFAULT_COLS }, files: { q: '', cat: '', kind: '', lang: '', preset: 'longest', sort: '' }, compare: [], theme: '' }, loadUi()),
  scan: null,
  saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify({ table: app.ui.table, compare: app.ui.compare, theme: app.ui.theme })); } catch {} },
  filtered({ includeFailed = false } = {}) {
    const f = app.filter;
    const terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    return app.repos.filter(r => {
      if (!includeFailed && r.status !== 'ok') return false;
      if (f.owner && r.owner !== f.owner) return false;
      if (f.vis === 'private' && !r.private) return false;
      if (f.vis === 'public' && r.private !== false) return false;
      if (!f.forks && r.fork) return false;
      if (!f.archived && r.archived) return false;
      if (f.lang && !(r.status === 'ok' && summarizeRepo(r).byLang[f.lang])) return false;
      if (terms.length) {
        const s = r.status === 'ok' ? summarizeRepo(r) : null;
        const hay = [r.fullName, r.description, ...(r.topics || []), ...(s ? Object.keys(s.byLang) : [])].join(' ').toLowerCase();
        for (const t of terms) {
          const m = /^(topic|lang|owner):(.+)$/.exec(t);
          if (m) {
            if (m[1] === 'topic' && !(r.topics || []).some(x => x.toLowerCase() === m[2])) return false;
            if (m[1] === 'lang' && !(s && Object.keys(s.byLang).some(l => l.toLowerCase() === m[2]))) return false;
            if (m[1] === 'owner' && r.owner.toLowerCase() !== m[2]) return false;
          } else if (!hay.includes(t)) return false;
        }
      }
      return true;
    });
  },
  render: () => render(),
};
window.repoStats = app; // handy for debugging in the console

// ------------------------------------------------------------ routing

const ROUTES = [
  ['overview', 'Overview'], ['repos', 'Repositories'], ['languages', 'Languages'], ['owners', 'Owners'],
  ['files', 'Files'], ['activity', 'Activity'], ['compare', 'Compare'], ['process', 'Process'], ['data', 'Data'], ['method', 'Methodology'],
];
function route() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [name, ...rest] = h.split('/');
  return { name: name || (app.repos.length ? 'overview' : 'home'), arg: rest.join('/') };
}

// ------------------------------------------------------------ rendering

function header() {
  const r = route();
  const v = app.meta?.viewer;
  const user = app.loggedIn && v
    ? `<details class="dropdown user-menu"><summary><img src="${attr(v.avatarUrl)}" alt="" width="28" height="28"><span>${esc(v.login)}</span></summary><div class="dd-menu right"><a href="${attr(v.url)}" target="_blank" rel="noopener">GitHub profile ↗</a><button data-action="logout">Sign out</button></div></details>`
    : auth.loginConfigured() ? `<button class="btn primary" data-action="login">${ghIcon()} Sign in with GitHub</button>` : '';
  const dsLabel = app.dataset?.startsWith('import:') ? `<span class="badge" data-tip="Viewing an imported report">${esc(app.dataset.slice(7))}</span>` : '';
  return `<div class="hdr-inner">
    <a class="brand" href="#/"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="12" width="4" height="9" rx="1" fill="var(--s1)"/><rect x="10" y="7" width="4" height="14" rx="1" fill="var(--s3)"/><rect x="17" y="3" width="4" height="18" rx="1" fill="var(--s2)"/></svg>Repo Stats</a>
    <nav>${ROUTES.map(([k, l]) => `<a href="#/${k}" class="${r.name === k ? 'active' : ''}">${l}</a>`).join('')}</nav>
    <span class="spacer"></span>${dsLabel}
    ${app.scan?.running ? `<a href="#/process" class="badge live">Processing ${app.scan.done}/${app.scan.total || '…'}</a>` : ''}
    <button class="icon-btn" data-action="theme" aria-label="Toggle theme" data-tip="Theme: ${app.ui.theme || 'auto'}">${app.ui.theme === 'dark' ? '☾' : app.ui.theme === 'light' ? '☀' : '◐'}</button>
    ${user}
  </div>`;
}

function filterBar() {
  const owners = [...new Set(app.repos.map(r => r.owner))].sort();
  const langs = Object.entries(summarizeMany(app.repos.filter(r => r.status === 'ok')).byLang).sort((a, b) => b[1].code - a[1].code).map(([l]) => l);
  const f = app.filter;
  const n = app.filtered().length, total = app.repos.filter(r => r.status === 'ok').length;
  const active = f.q || f.owner || f.vis || f.lang || !f.forks || !f.archived;
  return `<div class="filters">
    <input type="search" class="input grow" id="flt-q" placeholder="Search repos: name, description, topic… (try lang:python, topic:api, owner:acme)" value="${attr(f.q)}" aria-label="Search repositories">
    <select class="select" id="flt-owner" aria-label="Owner"><option value="">All owners</option>${owners.map(o => `<option ${f.owner === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
    <select class="select" id="flt-vis" aria-label="Visibility"><option value="">Public & private</option><option value="public" ${f.vis === 'public' ? 'selected' : ''}>Public</option><option value="private" ${f.vis === 'private' ? 'selected' : ''}>Private</option></select>
    <select class="select" id="flt-lang" aria-label="Language"><option value="">Any language</option>${langs.map(l => `<option ${f.lang === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    <label class="check"><input type="checkbox" id="flt-forks" ${f.forks ? 'checked' : ''}> Forks</label>
    <label class="check"><input type="checkbox" id="flt-archived" ${f.archived ? 'checked' : ''}> Archived</label>
    <span class="muted small nowrap">${n === total ? `${fmtN(total)} repos` : `${fmtN(n)} of ${fmtN(total)} repos`}</span>
    ${active ? '<button class="btn small" data-action="clear-filters">Clear</button>' : ''}
  </div>`;
}

const FILTERED_VIEWS = new Set(['overview', 'repos', 'languages', 'owners', 'files', 'activity']);

function render() {
  const r = route();
  $('#hdr').innerHTML = header();
  const main = $('#main');
  const scrollY = window.scrollY;
  const fresh = main.dataset.route !== r.name;
  main.dataset.route = r.name;
  let html = '';
  const showFilters = FILTERED_VIEWS.has(r.name) && app.repos.length;
  try {
    switch (r.name) {
      case 'home': html = home(); break;
      case 'overview': html = V.overview(app); break;
      case 'repos': html = V.repoList(app); break;
      case 'languages': html = V.languages(app, r.arg); break;
      case 'owners': html = V.owners(app); break;
      case 'files': html = V.files(app); break;
      case 'activity': html = V.activity(app); break;
      case 'compare': html = V.compare(app); break;
      case 'process': html = processView(); break;
      case 'data': html = dataView(); break;
      case 'method': html = V.methodology(); break;
      default: html = '<div class="empty-state"><h2>Not found</h2></div>';
    }
  } catch (e) {
    console.error(e);
    html = `<div class="note warn">Something went wrong rendering this view: ${esc(e.message)}</div>`;
  }
  // keep filter input focus across re-renders
  const focused = document.activeElement?.id;
  const selStart = document.activeElement?.selectionStart;
  main.innerHTML = (showFilters ? filterBar() : '') + `<div class="view view-${r.name}">${html}</div>`;
  const view = $('.view', main);
  if (r.name === 'repos') V.bindRepoList(app, view);
  if (r.name === 'files') V.bindFiles(app, view);
  if (r.name === 'compare') V.bindCompare(app, view);
  if (r.name === 'process') bindProcess(view);
  if (r.name === 'data') bindData(view);
  if (focused && $('#' + focused)) { const el = $('#' + focused); el.focus(); try { el.setSelectionRange(selStart, selStart); } catch {} }
  if (!fresh) window.scrollTo(0, scrollY);
  else window.scrollTo(0, 0);
  // overlay for #/repos/<owner>/<name>
  const ov = $('#overlay');
  if (r.name === 'repos' && r.arg) {
    if (ov.dataset.repo !== r.arg || !ov.classList.contains('open')) {
      ov.innerHTML = V.repoOverlay(app, r.arg);
      ov.dataset.repo = r.arg;
      ov.classList.add('open');
      document.body.classList.add('no-scroll');
      ov.scrollTop = 0;
      V.bindOverlay(app, ov, r.arg);
    }
  } else if (ov.classList.contains('open')) {
    ov.classList.remove('open'); ov.dataset.repo = ''; ov.innerHTML = '';
    document.body.classList.remove('no-scroll');
  }
}

function ghIcon() {
  return '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
}

function home() {
  const configured = auth.loginConfigured();
  return `<div class="hero">
    <h1>Statistics for every repository you can reach</h1>
    <p class="lead">Sign in with GitHub, choose your personal repos and any organizations, and get maintained lines of code, comment and test ratios, documentation word counts, config vs code vs generated breakdowns, language mix, activity and repository hygiene, all computed in your browser.</p>
    <p>${configured ? `<button class="btn primary big" data-action="login">${ghIcon()} Sign in with GitHub</button>` : `<span class="note">Sign-in isn’t configured on this deployment yet (see the README). You can still import a report made by the command-line analyzer.</span>`}
    <a class="btn big" href="#/data">Import a report</a> <button class="btn big" data-action="demo">Load demo data</button></p>
    <div class="grid g3 features">
      ${card('Meaningful units', '<p>Code in code lines (no blanks or comments), docs in words (one long paragraph = many short lines), generated and binary files in bytes.</p>')}
      ${card('Generated ≠ maintained', '<p>Lockfiles like uv.lock and package-lock.json, build output, minified bundles, snapshots and codegen are detected and kept out of line counts.</p>')}
      ${card('Private by design', '<p>Your browser talks to GitHub directly. Results are cached locally and only re-processed when a repo’s default branch changes.</p>')}
    </div></div>`;
}

// ------------------------------------------------------------ processing

function processView() {
  if (!auth.loginConfigured()) return `<div class="prose"><h2>Processing needs sign-in</h2><p>This deployment has no GitHub app configured. An administrator needs to set <code>clientId</code> and <code>exchangeUrl</code> in <code>config.js</code> (see the README).</p><p>Meanwhile you can run the command-line analyzer locally and import its report on the <a href="#/data">Data</a> page:</p><pre>node cli/analyze.mjs ~/src/repo-a ~/src/repo-b --out report.json</pre></div>`;
  if (!app.loggedIn) return `<div class="empty-state"><h2>Sign in to process your repositories</h2><p><button class="btn primary big" data-action="login">${ghIcon()} Sign in with GitHub</button></p><p class="muted small">Read access to repository contents is needed to count lines. With a GitHub App sign-in that access is read-only.</p></div>`;
  const s = app.scan;
  const o = app.ui.scanOpts || (app.ui.scanOpts = { personal: true, collaborator: false, orgs: [], forks: false, archived: true, history: true, maxRepoMb: 500, force: false });
  const orgs = app.meta?.orgs || [];
  const rate = app.rate;
  const rateHtml = rate ? ['core', 'graphql'].filter(k => rate[k]).map(k => { const r = rate[k]; return `<div class="rate"><span>${k === 'core' ? 'REST' : 'GraphQL'} API</span><div class="meter"><i style="width:${(r.remaining / r.limit) * 100}%"></i></div><span class="muted small">${fmtN(r.remaining)} / ${fmtN(r.limit)} left, resets ${new Date(r.reset).toLocaleTimeString()}</span></div>`; }).join('') : '';
  const opts = `<div class="grid g2">
    ${card('What to process', `
      <label class="check block"><input type="checkbox" data-opt="personal" ${o.personal ? 'checked' : ''}> Repositories I own</label>
      <label class="check block"><input type="checkbox" data-opt="collaborator" ${o.collaborator ? 'checked' : ''}> Repositories I’m a collaborator on</label>
      <h4>Organizations</h4>
      ${orgs.length ? orgs.map(g => `<label class="check block"><input type="checkbox" data-org="${attr(g.login)}" ${o.orgs.includes(g.login) ? 'checked' : ''}> <img src="${attr(g.avatarUrl)}" width="18" height="18" alt="" class="av"> ${esc(g.name || g.login)} <span class="muted">@${esc(g.login)}</span></label>`).join('') : '<p class="muted small">No organizations visible. If you belong to some, the org may need to approve this app (Organization settings → Third-party access / GitHub Apps).</p>'}
    `)}
    ${card('Options', `
      <label class="check block"><input type="checkbox" data-opt="forks" ${o.forks ? 'checked' : ''}> Include forks</label>
      <label class="check block"><input type="checkbox" data-opt="archived" ${o.archived ? 'checked' : ''}> Include archived repositories</label>
      <label class="check block"><input type="checkbox" data-opt="history" ${o.history ? 'checked' : ''}> Fetch commit history (weekly commits, churn, contributors; slower)</label>
      <label class="check block"><input type="checkbox" data-opt="force" ${o.force ? 'checked' : ''}> Re-analyze everything (ignore cache)</label>
      <label class="block">Skip repositories larger than <input type="number" class="input num-in" data-opt="maxRepoMb" value="${o.maxRepoMb}" min="0" step="50"> MB on disk (0 = no limit)</label>
      <p class="muted small">Unchanged repositories (same default-branch commit) are reused from this browser’s cache, so re-running is cheap.</p>
      <div class="btn-row">${s?.running ? '<button class="btn danger" data-action="cancel-scan">Cancel</button>' : '<button class="btn primary big" data-action="start-scan">Start processing</button>'}</div>
    `)}
  </div>`;
  let progress = '';
  if (s) {
    const pct = s.total ? (s.done / s.total) * 100 : 0;
    const items = s.order.map(name => {
      const it = s.items[name];
      const st = it.state;
      const icon = st === 'done' ? '✓' : st === 'cached' ? '↺' : st === 'error' ? '⚠' : st === 'skipped' ? '–' : st === 'running' ? '<span class="spin"></span>' : '·';
      const detail = st === 'running' ? `${it.phase === 'tree' ? 'reading file list' : it.phase === 'history' ? 'fetching history' : `${fmtN(it.d)} / ${fmtN(it.t)} files`}` : st === 'error' || st === 'skipped' ? esc(it.msg || '') : st === 'cached' ? 'unchanged, from cache' : st === 'done' ? `${fmtN(it.files)} files · ${fmtN(it.code)} code lines` : 'queued';
      return `<li class="pi ${st}"><span class="pi-i">${icon}</span><span class="pi-n">${esc(name)}</span><span class="pi-d muted small">${detail}</span>${st === 'running' && it.t ? `<span class="meter small"><i style="width:${(it.d / it.t) * 100}%"></i></span>` : ''}</li>`;
    }).join('');
    progress = card(s.running ? 'Processing…' : s.cancelled ? 'Cancelled' : 'Finished', `
      <div class="meter big"><i style="width:${pct}%"></i></div>
      <p>${fmtN(s.done)} of ${fmtN(s.total)} repositories · ${s.counts.cached} from cache · ${s.counts.done} analyzed · ${s.counts.error} errors · ${s.counts.skipped} skipped · ${fmtAgo(new Date(s.started).toISOString()).replace(' ago', '')} elapsed</p>
      ${s.waiting ? `<p class="note warn">Rate limited by GitHub; resuming at ${new Date(s.waiting).toLocaleTimeString()}.</p>` : ''}
      ${rateHtml}
      ${s.log.length ? `<div class="log">${s.log.slice(-6).map(l => `<div>${esc(l)}</div>`).join('')}</div>` : ''}
      <ul class="progress-list">${items}</ul>`);
  } else if (rateHtml) progress = card('GitHub API budget', rateHtml);
  return opts + progress;
}

function bindProcess(root) {
  root.addEventListener('change', (e) => {
    const o = app.ui.scanOpts;
    const t = e.target;
    if (t.dataset.opt) o[t.dataset.opt] = t.type === 'checkbox' ? t.checked : +t.value;
    if (t.dataset.org) { const set = new Set(o.orgs); t.checked ? set.add(t.dataset.org) : set.delete(t.dataset.org); o.orgs = [...set]; }
  });
}

let renderQueued = false;
function renderSoon() { if (renderQueued) return; renderQueued = true; setTimeout(() => { renderQueued = false; const n = route().name; if (n === 'process' || !document.querySelector(':focus')) render(); else $('#hdr').innerHTML = header(); }, 400); }

async function startScan() {
  const o = app.ui.scanOpts;
  if (!o.personal && !o.collaborator && !o.orgs.length) { alert('Choose at least one scope.'); return; }
  const ctl = new AbortController();
  const s = app.scan = { running: true, controller: ctl, started: Date.now(), total: 0, done: 0, order: [], items: {}, counts: { cached: 0, done: 0, error: 0, skipped: 0 }, log: [], waiting: null };
  render();
  const cached = await store.loadRepos(app.dataset);
  const byName = new Map(app.repos.map(r => [r.fullName, r]));
  try {
    const repos = await runScan(app.gh, app.dataset, app.meta.viewer, cached, {
      scopes: { personal: o.personal, collaborator: o.collaborator, orgs: o.orgs },
      includeForks: o.forks, includeArchived: o.archived, history: o.history, maxRepoMb: o.maxRepoMb, force: o.force, signal: ctl.signal,
    }, {
      onLog: (m) => { s.log.push(m); renderSoon(); },
      onList: (list) => { s.total = list.length; s.order = list.map(r => r.fullName); for (const r of list) s.items[r.fullName] = { state: 'queued' }; renderSoon(); },
      onRepoStart: (r) => { s.items[r.fullName] = { state: 'running', phase: 'tree', d: 0, t: 0 }; renderSoon(); },
      onRepoProgress: (r, d, t, phase) => { Object.assign(s.items[r.fullName], { phase, d, t }); renderSoon(); },
      onRepoDone: (r, rec, fromCache) => {
        const state = fromCache ? 'cached' : rec.status === 'ok' ? 'done' : rec.status === 'error' ? 'error' : 'skipped';
        s.items[r.fullName] = { state, msg: rec.error || (rec.status === 'empty' ? 'empty repository' : ''), files: rec.files?.length, code: rec.status === 'ok' ? summarizeRepo(rec).code : 0 };
        s.counts[state === 'cached' ? 'cached' : state === 'done' ? 'done' : state === 'error' ? 'error' : 'skipped']++;
        s.done++;
        byName.set(rec.fullName, rec);
        app.repos = [...byName.values()];
        rankLanguages();
        renderSoon();
      },
    });
    // drop cached repos that are no longer in scope (deleted, transferred, or scope unticked)
    const keep = new Set(repos.map(r => r.fullName));
    for (const r of app.repos) if (!keep.has(r.fullName)) await store.deleteRepo(app.dataset, r.fullName);
    app.repos = app.repos.filter(r => keep.has(r.fullName));
    await store.saveMeta(app.dataset, { ...app.meta, lastRun: new Date().toISOString(), scanOpts: o });
  } catch (e) {
    if (e.name === 'AbortError') s.cancelled = true;
    else { s.log.push(`Error: ${e.message}`); console.error(e); }
  }
  s.running = false;
  rankLanguages();
  render();
}

async function reanalyze(fullName) {
  const r = app.repos.find(x => x.fullName === fullName);
  if (!r) return;
  const btn = $('[data-action="reanalyze"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Analyzing…'; }
  const o = app.ui.scanOpts || { history: true };
  // List just this repo's owner scope cheaply by re-fetching the single repo through the org/user listing is heavy; use the cached metadata.
  await runScanSingle(r, o.history);
  $('#overlay').dataset.repo = '';
  render();
}

async function runScanSingle(r, history) {
  const { fetchTree, makeBlobReader, fetchHistory } = await import('./github.js');
  const { analyzeEntries } = await import('./engine/analyze.js');
  try {
    const [owner, name] = r.fullName.split('/');
    const d = await app.gh.graphql(`query($o:String!,$n:String!){repository(owner:$o,name:$n){defaultBranchRef{name target{... on Commit{oid history{totalCount}}}} pushedAt stargazerCount forkCount}}`, { o: owner, n: name });
    const t = d.repository.defaultBranchRef?.target;
    const rec = { ...r, headOid: t?.oid || r.headOid, commitCount: t?.history?.totalCount ?? r.commitCount, pushedAt: d.repository.pushedAt, stars: d.repository.stargazerCount, forks: d.repository.forkCount, engine: ENGINE_VERSION, analyzedAt: new Date().toISOString() };
    const tree = await fetchTree(app.gh, rec);
    rec.truncated = tree.truncated;
    rec.files = await analyzeEntries(tree.entries, makeBlobReader(app.gh, rec), { concurrency: 2 });
    if (history) rec.history = await fetchHistory(app.gh, rec, app.meta.viewer.login) || r.history;
    rec.status = 'ok'; delete rec.error;
    await store.saveRepo(app.dataset, rec);
    app.repos = app.repos.map(x => x.fullName === rec.fullName ? rec : x);
  } catch (e) { alert(`Re-analysis failed: ${e.message}`); }
}

// ------------------------------------------------------------ data view

function dataView() {
  const meta = app.meta;
  const ok = app.repos.filter(r => r.status === 'ok');
  const files = ok.reduce((a, r) => a + r.files.length, 0);
  return `<div class="grid g2">
    ${card('Current dataset', app.dataset ? `<p><b>${esc(app.dataset.startsWith('gh:') ? `Signed-in account @${app.dataset.slice(3)}` : `Imported report “${app.dataset.slice(7)}”`)}</b></p>
      <p class="muted">${fmtN(app.repos.length)} repositories (${fmtN(ok.length)} analyzed) · ${fmtN(files)} files${meta?.lastRun ? ` · last processed ${fmtAgo(meta.lastRun)}` : ''}${meta?.generatedAt ? ` · report generated ${fmtDate(meta.generatedAt)}` : ''}</p>
      <div class="btn-row"><button class="btn" data-action="export-json">Export report (JSON)</button><button class="btn" data-action="export-summary">Export summary (CSV)</button><button class="btn danger" data-action="clear-dataset">Delete cached data</button></div>
      <p class="muted small">The JSON report contains every file path and count, and can be re-imported here or shared with someone who should see it. It includes private repository names and paths: treat it like the repositories themselves.</p>` : '<p class="muted">No dataset loaded.</p>')}
    ${card('Import a report', `<p>Load a report exported from this site or produced by the command-line analyzer.</p>
      <label class="dropzone" id="dropzone"><input type="file" accept=".json,application/json" id="import-file" hidden><span>Drop a report JSON here or <u>choose a file</u></span></label>
      <h4>Command-line analyzer</h4><p class="small">Runs the same engine against local clones, with full git history and no API limits:</p>
      <pre>node cli/analyze.mjs ~/src/repo-a ~/src/repo-b --out report.json</pre>`)}
  </div>
  <div id="datasets-host"></div>`;
}

function bindData(root) {
  const fileIn = $('#import-file', root);
  const dz = $('#dropzone', root);
  const handle = async (file) => {
    try {
      const report = JSON.parse(await file.text());
      await importReport(report, file.name.replace(/\.json$/i, ''));
    } catch (e) { alert(`Could not import: ${e.message}`); }
  };
  fileIn?.addEventListener('change', () => fileIn.files[0] && handle(fileIn.files[0]));
  dz?.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz?.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz?.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); e.dataTransfer.files[0] && handle(e.dataTransfer.files[0]); });
  store.listDatasets().then(list => {
    const host = $('#datasets-host', root);
    if (!host || !list.length) return;
    host.innerHTML = card('Datasets in this browser', `<table class="tbl compact"><thead><tr><th>Dataset</th><th>Saved</th><th></th></tr></thead><tbody>${list.map(d => `<tr><td>${esc(d.key)}</td><td>${fmtAgo(d.lastRun || d.importedAt || d.generatedAt)}</td><td class="num">${d.key === app.dataset ? '<span class="badge">current</span>' : `<button class="btn small" data-switch="${attr(d.key)}">Open</button>`} <button class="btn small danger" data-delete-ds="${attr(d.key)}">Delete</button></td></tr>`).join('')}</tbody></table>`);
  });
}

async function importReport(report, name) {
  if (!report || !Array.isArray(report.repos)) throw new Error('Not a Repo Stats report (no "repos" array).');
  const dataset = `import:${name}`;
  await store.clearDataset(dataset);
  for (const r of report.repos) await store.saveRepo(dataset, r);
  const meta = { viewer: report.viewer || null, orgs: report.orgs || [], contributions: report.contributions || null, generatedAt: report.generatedAt, importedAt: new Date().toISOString(), source: report.source };
  await store.saveMeta(dataset, meta);
  await openDataset(dataset);
  location.hash = '#/overview';
}

function exportReport() {
  const report = { schema: 1, engine: ENGINE_VERSION, source: app.meta?.source || 'web', generatedAt: new Date().toISOString(), viewer: app.meta?.viewer || null, orgs: app.meta?.orgs || [], contributions: app.meta?.contributions || null, repos: app.repos.map(({ key, dataset, ...r }) => r) };
  download(`repo-stats-${(app.dataset || 'report').replace(/[^\w.-]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(report));
}

// ------------------------------------------------------------ datasets

function rankLanguages() {
  const agg = summarizeMany(app.repos.filter(r => r.status === 'ok'));
  setLanguageRanking(Object.entries(agg.byLang).sort((a, b) => b[1].code - a[1].code).map(([l]) => l));
}

async function openDataset(dataset) {
  app.dataset = dataset;
  app.meta = await store.loadMeta(dataset);
  app.repos = await store.loadRepos(dataset);
  try { localStorage.setItem('repo-stats-dataset', dataset); } catch {}
  rankLanguages();
  render();
}

// ------------------------------------------------------------ actions

document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-action]');
  if (a) {
    const act = a.dataset.action;
    if (act === 'login') auth.startLogin();
    if (act === 'logout') { auth.logout(); app.loggedIn = false; app.gh = null; render(); }
    if (act === 'theme') { app.ui.theme = app.ui.theme === '' ? 'dark' : app.ui.theme === 'dark' ? 'light' : ''; applyTheme(); app.saveUi(); render(); }
    if (act === 'clear-filters') { Object.assign(app.filter, { q: '', owner: '', vis: '', lang: '', forks: true, archived: true }); render(); }
    if (act === 'close-overlay') history.length > 1 && /^#\/repos\/./.test(location.hash) ? (location.hash = '#/repos') : (location.hash = '#/repos');
    if (act === 'start-scan') startScan();
    if (act === 'cancel-scan') app.scan?.controller.abort();
    if (act === 'reanalyze') reanalyze(a.dataset.repo);
    if (act === 'compare-add') { if (!app.ui.compare.includes(a.dataset.repo)) app.ui.compare = [...app.ui.compare, a.dataset.repo].slice(-4); app.saveUi(); location.hash = '#/compare'; }
    if (act === 'export-json') exportReport();
    if (act === 'export-summary') {
      const { toCsv } = await import('./ui.js');
      const rows = [['repository', 'owner', 'private', 'fork', 'archived', 'primary_language', 'code_lines', 'comment_lines', 'comment_ratio', 'test_share', 'doc_words', 'config_lines', 'generated_bytes', 'vendored_bytes', 'tree_bytes', 'files', 'todos', 'health', 'commits', 'stars', 'created', 'pushed']];
      for (const r of app.filtered()) { const s = summarizeRepo(r); rows.push([r.fullName, r.owner, r.private, r.fork, r.archived, s.primaryLang, s.code, s.byCat.code.comment, s.commentRatio.toFixed(4), s.testShare.toFixed(4), s.proseWords, s.configLines, s.generatedBytes, s.vendoredBytes, s.total.bytes, s.total.files, s.todos, s.healthScore, r.history?.commits ?? r.commitCount ?? '', r.stars ?? '', r.createdAt || '', r.pushedAt || '']); }
      download('repo-summary.csv', toCsv(rows), 'text/csv');
    }
    if (act === 'clear-dataset') {
      if (!confirm('Delete the cached analysis for this dataset from this browser? Nothing on GitHub is affected.')) return;
      await store.clearDataset(app.dataset);
      app.repos = []; app.meta = app.dataset?.startsWith('gh:') ? { viewer: app.meta?.viewer, orgs: app.meta?.orgs, contributions: app.meta?.contributions } : null;
      if (app.meta) await store.saveMeta(app.dataset, app.meta);
      render();
    }
    if (act === 'demo') {
      try { const res = await fetch('demo/report.json'); await importReport(await res.json(), 'demo'); } catch (err) { alert('Demo data not available: ' + err.message); }
    }
    return;
  }
  const sw = e.target.closest('[data-switch]');
  if (sw) { await openDataset(sw.dataset.switch); location.hash = '#/overview'; return; }
  const del = e.target.closest('[data-delete-ds]');
  if (del) {
    if (!confirm(`Delete cached dataset “${del.dataset.deleteDs}” from this browser?`)) return;
    await store.clearDataset(del.dataset.deleteDs);
    if (del.dataset.deleteDs === app.dataset) { app.repos = []; }
    render(); return;
  }
  const ow = e.target.closest('[data-owner]');
  if (ow) { app.filter.owner = ow.dataset.owner; location.hash = '#/repos'; return; }
  const lr = e.target.closest('tr[data-lang]');
  if (lr) { const l = lr.dataset.lang; location.hash = route().arg === l ? '#/languages' : `#/languages/${encodeURIComponent(l)}`; return; }
  // click on overlay backdrop closes it
  if (e.target.id === 'overlay') location.hash = '#/repos';
});

let qTimer;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'flt-q') return;
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { app.filter.q = e.target.value; render(); }, 200);
});
document.addEventListener('change', (e) => {
  const id = e.target.id;
  if (id === 'flt-owner') app.filter.owner = e.target.value;
  else if (id === 'flt-vis') app.filter.vis = e.target.value;
  else if (id === 'flt-lang') app.filter.lang = e.target.value;
  else if (id === 'flt-forks') app.filter.forks = e.target.checked;
  else if (id === 'flt-archived') app.filter.archived = e.target.checked;
  else return;
  render();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#overlay').classList.contains('open')) location.hash = '#/repos';
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { const q = $('#flt-q'); if (q) { e.preventDefault(); q.focus(); } }
});

function applyTheme() {
  if (app.ui.theme) document.documentElement.dataset.theme = app.ui.theme;
  else delete document.documentElement.dataset.theme;
}

// ------------------------------------------------------------ boot

async function boot() {
  applyTheme();
  installTooltip();
  window.addEventListener('hashchange', render);
  try { await auth.handleRedirect(); } catch (e) { alert(e.message); }
  app.loggedIn = auth.isLoggedIn();
  if (app.loggedIn) {
    app.gh = new GitHub(auth.getToken, (rate, extra) => { app.rate = rate; if (app.scan) app.scan.waiting = extra?.waitingUntil || null; });
    try {
      const info = await fetchViewer(app.gh);
      const dataset = `gh:${info.viewer.login}`;
      const prev = await store.loadMeta(dataset);
      await store.saveMeta(dataset, { ...(prev || {}), ...info, source: 'web' });
      if (prev?.scanOpts) app.ui.scanOpts = prev.scanOpts;
      await openDataset(dataset);
      if (!app.repos.length && route().name === 'home') location.hash = '#/process';
      return;
    } catch (e) {
      console.error(e);
      if (e.status === 401) { auth.logout(); app.loggedIn = false; }
      else alert(`Could not reach GitHub: ${e.message}`);
    }
  }
  let last = null;
  try { last = localStorage.getItem('repo-stats-dataset'); } catch {}
  if (last && !last.startsWith('gh:')) await openDataset(last);
  else if (last && last.startsWith('gh:')) {
    // signed out, but cached results remain viewable
    const meta = await store.loadMeta(last);
    if (meta) await openDataset(last); else render();
  } else render();
}

boot();
