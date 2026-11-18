// App shell for the local server: state, routing, header, filters, processing and data views.

import { esc, attr, fmtN, fmtPct, fmtBytes, fmtAgo, fmtDate, $, $$, installTooltip, setLanguageRanking, download, card, toCsv } from './ui.js';
import * as V from './views.js';
import { summarizeRepo, summarizeMany } from './engine/aggregate.js';
import { ENGINE_VERSION } from './engine/classify.js';

const UI_KEY = 'repo-stats-ui';
const loadUi = () => { try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}'); } catch { return {}; } };

async function api(path, data) {
  const res = await fetch(path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out?.error || `${res.status} ${path}`);
  return out;
}

const app = {
  server: null,        // /api/status when served by the local server, else null (static/demo mode)
  dataset: null,       // 'local' | 'import:<name>'
  meta: null,
  repos: [],
  job: null,
  listing: null,       // { repos, errors, loading }
  filter: { q: '', owner: '', vis: '', lang: '', forks: true, archived: true },
  ui: Object.assign({ table: { sort: 'code', dir: 'desc', cols: V.DEFAULT_COLS }, files: { q: '', cat: '', kind: '', lang: '', preset: 'longest', sort: '' }, compare: [], theme: '' }, loadUi()),
  saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify({ table: app.ui.table, compare: app.ui.compare, theme: app.ui.theme, scanOpts: app.ui.scanOpts })); } catch {} },
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
  async reanalyze(fullName) {
    try { await api('/api/scan', { repos: [fullName], force: true, history: app.ui.scanOpts?.history ?? true, keepClones: app.ui.scanOpts?.keepClones ?? true }); pollJob(); location.hash = '#/process'; }
    catch (e) { alert(e.message); }
  },
};
window.repoStats = app; // handy for debugging in the console

const ROUTES = [
  ['overview', 'Overview'], ['repos', 'Repositories'], ['languages', 'Languages'], ['owners', 'Owners'],
  ['files', 'Files'], ['activity', 'Activity'], ['compare', 'Compare'], ['process', 'Process'], ['data', 'Data'], ['method', 'Methodology'],
];

function header() {
  const r = route();
  const v = app.meta?.viewer;
  const user = v ? `<a class="user-chip" href="${attr(v.url)}" target="_blank" rel="noopener" data-tip="Signed in to the GitHub CLI as @${attr(v.login)}"><img src="${attr(v.avatarUrl)}" alt="" width="28" height="28"><span>${esc(v.login)}</span></a>` : '';
  const dsLabel = app.dataset?.startsWith('import:') ? `<span class="badge" data-tip="Viewing an imported report, not the local data">${esc(app.dataset.slice(7))}</span>${app.server ? ' <button class="btn small" data-action="back-local">Back to my data</button>' : ''}` : '';
  return `<div class="hdr-inner">
    <a class="brand" href="#/"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="12" width="4" height="9" rx="1" fill="var(--s1)"/><rect x="10" y="7" width="4" height="14" rx="1" fill="var(--s3)"/><rect x="17" y="3" width="4" height="18" rx="1" fill="var(--s2)"/></svg>Repo Stats</a>
    <nav>${ROUTES.map(([k, l]) => `<a href="#/${k}" class="${r.name === k ? 'active' : ''}">${l}</a>`).join('')}</nav>
    <span class="spacer"></span>${dsLabel}
    ${app.job?.running ? `<a href="#/process" class="badge live">Processing ${app.job.done}/${app.job.total}</a>` : ''}
    <button class="icon-btn" data-action="theme" aria-label="Toggle theme" data-tip="Theme: ${app.ui.theme || 'auto'}">${app.ui.theme === 'dark' ? '☾' : app.ui.theme === 'light' ? '☀' : '◐'}</button>
    ${user}
  </div>`;
}

function route() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [name, ...rest] = h.split('/');
  return { name: name || (app.repos.length ? 'overview' : 'home'), arg: rest.join('/') };
}

// ------------------------------------------------------------ rendering

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
  return `<div class="hero">
    <h1>How much code have you written?</h1>
    <p class="lead">Clone every repository you can reach, count maintained lines of code, comments, tests and documentation words, and keep lockfiles, build output and vendored code out of the totals.</p>
    <p>${app.server ? '<a class="btn primary big" href="#/process">Choose repositories</a>' : '<span class="note">Start the local server (<code>npm start</code>) to process your own repositories.</span>'}
    <button class="btn big" data-action="demo">Load demo data</button></p>
  </div>`;
}

// ------------------------------------------------------------ processing

const defaultScanOpts = () => ({ personal: true, collaborator: false, orgs: [], forks: false, archived: true, history: true, maxRepoMb: 1000, force: false, keepClones: true, concurrency: 3 });

function processView() {
  if (!app.server) return `<div class="prose"><h2>Processing runs on the local server</h2><p>This page was opened without the server, so only imported reports and the demo work. Start it with:</p><pre>npm start</pre></div>`;
  const s = app.server;
  if (!s.git) return `<div class="note warn">git isn't installed or isn't on PATH. Install git and restart the server.</div>`;
  if (!s.gh) return `<div class="prose"><h2>Install the GitHub CLI</h2><p>Repo Stats uses the GitHub CLI (<code>gh</code>) to list your repositories and to give git access to private ones. Install it from cli.github.com, then run:</p><pre>gh auth login</pre><p>and reload this page. You can still add local folders below.</p></div>` + localFolderCard();
  if (!s.authed) return `<div class="prose"><h2>Sign in to the GitHub CLI</h2><p>In a terminal, run:</p><pre>gh auth login</pre><p>then reload this page.${s.error ? ` <span class="muted">(${esc(s.error)})</span>` : ''}</p></div>` + localFolderCard();
  const o = app.ui.scanOpts || (app.ui.scanOpts = defaultScanOpts());
  const orgs = app.meta?.orgs || [];
  const L = app.listing;
  const running = app.job?.running;
  let html = `<div class="grid g2">
    ${card('1. Where to look', `
      <label class="check block"><input type="checkbox" data-opt="personal" ${o.personal ? 'checked' : ''}> Repositories I own</label>
      <label class="check block"><input type="checkbox" data-opt="collaborator" ${o.collaborator ? 'checked' : ''}> Repositories I’m a collaborator on</label>
      <h4>Organizations</h4>
      ${orgs.length ? orgs.map(g => `<label class="check block"><input type="checkbox" data-org="${attr(g.login)}" ${o.orgs.includes(g.login) ? 'checked' : ''}> <img src="${attr(g.avatarUrl)}" width="18" height="18" alt="" class="av"> ${esc(g.name || g.login)} <span class="muted">@${esc(g.login)}</span></label>`).join('') : '<p class="muted small">No organizations visible to the GitHub CLI. If you’re in some, run <code>gh auth refresh -s read:org</code>.</p>'}
      <div class="btn-row"><button class="btn primary" data-action="list" ${L?.loading || running ? 'disabled' : ''}>${L?.loading ? '<span class="spin"></span> Listing…' : L ? 'Refresh list' : 'List repositories'}</button></div>`)}
    ${card('2. Options', `
      <label class="check block"><input type="checkbox" data-opt="history" ${o.history ? 'checked' : ''}> Commit history (weekly activity, your share, when you code)</label>
      <label class="check block"><input type="checkbox" data-opt="keepClones" ${o.keepClones ? 'checked' : ''}> Keep clones so re-runs only fetch changes</label>
      <label class="check block"><input type="checkbox" data-opt="force" ${o.force ? 'checked' : ''}> Re-analyze even if unchanged</label>
      <label class="block">Skip repositories larger than <input type="number" class="input num-in" data-opt="maxRepoMb" value="${o.maxRepoMb}" min="0" step="100"> MB (0 = no limit)</label>
      <label class="block">Parallel clones <input type="number" class="input num-in" data-opt="concurrency" value="${o.concurrency}" min="1" max="6"></label>
      <p class="muted small">Data folder: <code>${esc(s.home)}</code>. Clones go in <code>clones/</code>, results in <code>report.json</code>.</p>
      <div class="btn-row"><button class="btn small" data-action="clear-clones" ${running ? 'disabled' : ''}>Delete cached clones</button></div>`)}
  </div>`;
  if (L && !L.loading) html += repoPicker(L, o, running);
  html += localFolderCard();
  html += jobCard();
  return html;
}

function repoPicker(L, o, running) {
  const rows = L.repos.filter(r => (o.forks || !r.fork) && (o.archived || !r.archived));
  const sel = app.ui.selected || (app.ui.selected = new Set(rows.filter(r => !r.empty).map(r => r.fullName)));
  const n = rows.filter(r => sel.has(r.fullName)).length;
  const mb = rows.filter(r => sel.has(r.fullName)).reduce((a, r) => a + (r.diskKb || 0), 0) / 1024;
  const state = (r) => r.cached === 'current' ? '<span class="badge" data-tip="Unchanged since the last analysis; reused">cached</span>' : r.cached === 'stale' ? '<span class="badge warn" data-tip="New commits since the last analysis">changed</span>' : r.cached ? `<span class="badge">${esc(r.cached)}</span>` : '';
  return card(`3. Pick repositories <span class="muted">${fmtN(n)} of ${fmtN(rows.length)} selected · ~${fmtN(mb)} MB to clone</span>`, `
    ${L.errors?.length ? `<div class="note warn">${L.errors.map(esc).join('<br>')}</div>` : ''}
    <div class="toolbar"><label class="check"><input type="checkbox" data-opt="forks" ${o.forks ? 'checked' : ''}> Show forks</label><label class="check"><input type="checkbox" data-opt="archived" ${o.archived ? 'checked' : ''}> Show archived</label>
      <span class="spacer"></span><button class="btn small" data-action="sel-all">Select all</button><button class="btn small" data-action="sel-none">None</button><button class="btn small" data-action="sel-changed">Only new/changed</button></div>
    <div class="table-wrap pick"><table class="tbl compact"><thead><tr><th></th><th>Repository</th><th>Language (GitHub)</th><th class="num">Size</th><th>Last push</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><input type="checkbox" data-pick="${attr(r.fullName)}" ${sel.has(r.fullName) ? 'checked' : ''} ${r.empty ? 'disabled' : ''}></td><td><span class="muted">${esc(r.owner)}/</span><b>${esc(r.name)}</b>${r.private ? '<span class="badge">private</span>' : ''}${r.fork ? '<span class="badge">fork</span>' : ''}${r.archived ? '<span class="badge warn">archived</span>' : ''}${r.empty ? '<span class="badge">empty</span>' : ''}</td><td>${esc(r.ghLanguage || '')}</td><td class="num">${fmtBytes((r.diskKb || 0) * 1024)}</td><td>${fmtAgo(r.pushedAt)}</td><td>${state(r)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="btn-row">${running ? '<button class="btn danger" data-action="cancel-scan">Cancel</button>' : `<button class="btn primary big" data-action="start-scan" ${n ? '' : 'disabled'}>Process ${fmtN(n)} repositories</button>`}
    <label class="check"><input type="checkbox" data-opt="prune" ${o.prune ? 'checked' : ''}> Also drop previously processed repos that aren’t in this list</label></div>`);
}

function localFolderCard() {
  const locals = app.repos.filter(r => r.localPath);
  return card('Local folders', `<p class="muted small">Analyze any git repository on this computer, including ones that aren’t on GitHub.</p>
    <div class="toolbar"><input class="input grow" id="local-path" placeholder="Path to a git repository, e.g. ~/src/my-project"><button class="btn" data-action="add-local" ${app.job?.running ? 'disabled' : ''}>Analyze folder</button></div>
    ${locals.length ? `<p class="small">${locals.map(r => `<a href="#/repos/${encodeURIComponent(r.fullName)}">${esc(r.fullName)}</a> <span class="muted">${esc(r.localPath)}</span>`).join('<br>')}</p>` : ''}`);
}

function jobCard() {
  const j = app.job;
  if (!j) return '';
  const pct = j.total ? (j.done / j.total) * 100 : 0;
  const items = j.order.map(name => {
    const it = j.items[name];
    const st = it.state;
    const icon = st === 'done' ? '✓' : st === 'cached' ? '↺' : st === 'error' ? '⚠' : st === 'skipped' ? '–' : st === 'running' ? '<span class="spin"></span>' : '·';
    const detail = st === 'running' ? esc(it.phase || '') : st === 'error' || st === 'skipped' ? esc(it.msg || '') : st === 'cached' ? 'unchanged' : st === 'done' ? `${fmtN(it.files)} files` : 'queued';
    return `<li class="pi ${st}"><span class="pi-i">${icon}</span><span class="pi-n">${st === 'done' || st === 'cached' ? `<a href="#/repos/${encodeURIComponent(name)}">${esc(name)}</a>` : esc(name)}</span><span class="pi-d muted small">${detail}</span></li>`;
  }).join('');
  const elapsed = Math.round(((j.finished || Date.now()) - j.started) / 1000);
  return card(j.running ? 'Processing…' : j.cancelled ? 'Cancelled' : 'Finished', `
    <div class="meter big"><i style="width:${pct}%"></i></div>
    <p>${fmtN(j.done)} of ${fmtN(j.total)} · ${j.counts.done} analyzed · ${j.counts.cached} unchanged · ${j.counts.error} errors · ${j.counts.skipped} skipped · ${elapsed < 120 ? `${elapsed}s` : `${Math.round(elapsed / 60)} min`}</p>
    ${j.running ? '<div class="btn-row"><button class="btn danger" data-action="cancel-scan">Cancel</button></div>' : `<div class="btn-row"><a class="btn primary" href="#/overview">See the results</a></div>`}
    <ul class="progress-list">${items}</ul>`);
}

function bindProcess(root) {
  root.addEventListener('change', (e) => {
    const o = app.ui.scanOpts;
    const t = e.target;
    if (t.dataset.opt) { o[t.dataset.opt] = t.type === 'checkbox' ? t.checked : +t.value; app.saveUi(); if (t.dataset.opt === 'forks' || t.dataset.opt === 'archived') { app.ui.selected = null; render(); } }
    if (t.dataset.org) { const set = new Set(o.orgs); t.checked ? set.add(t.dataset.org) : set.delete(t.dataset.org); o.orgs = [...set]; app.saveUi(); }
    if (t.dataset.pick) { t.checked ? app.ui.selected.add(t.dataset.pick) : app.ui.selected.delete(t.dataset.pick); render(); }
  });
  $('#local-path', root)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addLocal(); });
}

async function listRepos() {
  const o = app.ui.scanOpts;
  app.listing = { loading: true };
  app.ui.selected = null;
  render();
  try { app.listing = await api('/api/list', { personal: o.personal, collaborator: o.collaborator, orgs: o.orgs }); }
  catch (e) { app.listing = null; alert(`Could not list repositories: ${e.message}`); }
  render();
}

async function startScan() {
  const o = app.ui.scanOpts;
  const rows = app.listing.repos.filter(r => (o.forks || !r.fork) && (o.archived || !r.archived));
  const repos = rows.filter(r => app.ui.selected.has(r.fullName)).map(r => r.fullName);
  try { await api('/api/scan', { repos, history: o.history, force: o.force, keepClones: o.keepClones, maxRepoMb: o.maxRepoMb, concurrency: o.concurrency, prune: o.prune }); pollJob(); }
  catch (e) { alert(e.message); }
}

async function addLocal() {
  const p = $('#local-path')?.value.trim();
  if (!p) return;
  try {
    const meta = await api('/api/local', { path: p });
    await api('/api/scan', { repos: [meta.fullName], history: app.ui.scanOpts?.history ?? true, force: true });
    pollJob();
  } catch (e) { alert(e.message); }
}

let polling = false;
async function pollJob() {
  if (polling) return;
  polling = true;
  let lastDone = -1;
  try {
    for (;;) {
      app.job = await api('/api/job');
      if (app.job && app.job.done !== lastDone) { lastDone = app.job.done; await loadLocal(false); }
      softRender();
      if (!app.job?.running) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    if (app.listing?.repos) {
      // refresh cached badges
      const o = app.ui.scanOpts;
      app.listing = await api('/api/list', { personal: o.personal, collaborator: o.collaborator, orgs: o.orgs }).catch(() => app.listing);
    }
    await loadLocal(false);
    render();
  } finally { polling = false; }
}

function softRender() {
  const n = route().name;
  const busy = document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && n !== 'process';
  if (busy || $('#overlay').classList.contains('open')) $('#hdr').innerHTML = header();
  else render();
}

// ------------------------------------------------------------ data view

function dataView() {
  const ok = app.repos.filter(r => r.status === 'ok');
  const files = ok.reduce((a, r) => a + r.files.length, 0);
  return `<div class="grid g2">
    ${card('Current data', app.dataset ? `<p><b>${esc(app.dataset === 'local' ? 'Local data (this computer)' : `Imported report “${app.dataset.slice(7)}”`)}</b></p>
      <p class="muted">${fmtN(app.repos.length)} repositories (${fmtN(ok.length)} analyzed) · ${fmtN(files)} files${app.meta?.generatedAt ? ` · updated ${fmtAgo(app.meta.generatedAt)}` : ''}</p>
      <div class="btn-row"><button class="btn" data-action="export-json">Export report (JSON)</button><button class="btn" data-action="export-summary">Export summary (CSV)</button>
      ${app.dataset === 'local' && app.server ? '<button class="btn danger" data-action="remove-selected-hint">Remove repositories…</button>' : ''}</div>
      ${app.dataset === 'local' && app.server ? `<p class="muted small">Stored in <code>${esc(app.server.home)}</code>. The report includes private repository names and file paths.</p>` : ''}` : '<p class="muted">No data loaded.</p>')}
    ${card('Open a report', `<p>View a report exported from here or from the command-line analyzer. It’s shown read-only and doesn’t replace your local data.</p>
      <label class="dropzone" id="dropzone"><input type="file" accept=".json,application/json" id="import-file" hidden><span>Drop a report JSON here or <u>choose a file</u></span></label>`)}
  </div>
  ${app.dataset === 'local' && app.server && app.repos.length ? card('Remove repositories from the results', `<div class="toolbar"><input class="input grow" id="rm-filter" placeholder="Filter…"></div><div class="table-wrap pick"><table class="tbl compact"><tbody>${app.repos.map(r => `<tr data-rmrow="${attr(r.fullName.toLowerCase())}"><td><input type="checkbox" data-rm="${attr(r.fullName)}"></td><td>${esc(r.fullName)}</td><td class="muted">${esc(r.status)}</td></tr>`).join('')}</tbody></table></div><div class="btn-row"><button class="btn danger" data-action="remove-repos">Remove checked</button></div>`) : ''}`;
}

function bindData(root) {
  const fileIn = $('#import-file', root);
  const dz = $('#dropzone', root);
  const handle = async (file) => {
    try { openReport(JSON.parse(await file.text()), `import:${file.name.replace(/\.json$/i, '')}`); location.hash = '#/overview'; }
    catch (e) { alert(`Could not open: ${e.message}`); }
  };
  fileIn?.addEventListener('change', () => fileIn.files[0] && handle(fileIn.files[0]));
  dz?.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz?.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz?.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); e.dataTransfer.files[0] && handle(e.dataTransfer.files[0]); });
  $('#rm-filter', root)?.addEventListener('input', (e) => { const q = e.target.value.toLowerCase(); for (const tr of $$('[data-rmrow]', root)) tr.hidden = !tr.dataset.rmrow.includes(q); });
}

function exportReport() {
  const report = { schema: 1, engine: ENGINE_VERSION, source: app.meta?.source || 'local', generatedAt: new Date().toISOString(), viewer: app.meta?.viewer || null, orgs: app.meta?.orgs || [], contributions: app.meta?.contributions || null, repos: app.repos };
  download(`repo-stats-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(report));
}

// ------------------------------------------------------------ data loading

function rankLanguages() {
  const agg = summarizeMany(app.repos.filter(r => r.status === 'ok'));
  setLanguageRanking(Object.entries(agg.byLang).sort((a, b) => b[1].code - a[1].code).map(([l]) => l));
}

function openReport(report, dataset) {
  if (!report || !Array.isArray(report.repos)) throw new Error('Not a Repo Stats report (no "repos" array).');
  app.dataset = dataset;
  app.meta = { viewer: report.viewer || null, orgs: report.orgs || [], contributions: report.contributions || null, generatedAt: report.generatedAt, source: report.source };
  app.repos = report.repos;
  rankLanguages();
  render();
}

async function loadLocal(doRender = true) {
  if (!app.server) return;
  if (app.dataset && app.dataset !== 'local') return;
  const report = await api('/api/report');
  app.dataset = 'local';
  app.meta = { viewer: report.viewer, orgs: report.orgs || [], contributions: report.contributions, generatedAt: report.generatedAt, source: 'local' };
  app.repos = report.repos || [];
  rankLanguages();
  if (doRender) render();
}

// ------------------------------------------------------------ actions

document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-action]');
  if (a) {
    const act = a.dataset.action;
    if (act === 'theme') { app.ui.theme = app.ui.theme === '' ? 'dark' : app.ui.theme === 'dark' ? 'light' : ''; applyTheme(); app.saveUi(); render(); }
    if (act === 'clear-filters') { Object.assign(app.filter, { q: '', owner: '', vis: '', lang: '', forks: true, archived: true }); render(); }
    if (act === 'close-overlay') location.hash = '#/repos';
    if (act === 'list') listRepos();
    if (act === 'start-scan') startScan();
    if (act === 'cancel-scan') api('/api/cancel', {}).catch(() => {});
    if (act === 'add-local') addLocal();
    if (act === 'reanalyze') app.reanalyze(a.dataset.repo);
    if (act === 'sel-all' || act === 'sel-none' || act === 'sel-changed') {
      const o = app.ui.scanOpts;
      const rows = app.listing.repos.filter(r => (o.forks || !r.fork) && (o.archived || !r.archived) && !r.empty);
      app.ui.selected = new Set(act === 'sel-none' ? [] : rows.filter(r => act === 'sel-all' || r.cached !== 'current').map(r => r.fullName));
      render();
    }
    if (act === 'clear-clones') { if (confirm('Delete all cached clones? Results are kept; the next run re-clones.')) api('/api/clear-clones', {}).then(() => alert('Clones deleted.')).catch(err => alert(err.message)); }
    if (act === 'compare-add') { if (!app.ui.compare.includes(a.dataset.repo)) app.ui.compare = [...app.ui.compare, a.dataset.repo].slice(-4); app.saveUi(); location.hash = '#/compare'; }
    if (act === 'export-json') exportReport();
    if (act === 'export-summary') {
      const rows = [['repository', 'owner', 'private', 'fork', 'archived', 'primary_language', 'code_lines', 'comment_lines', 'comment_ratio', 'test_share', 'doc_words', 'config_lines', 'generated_bytes', 'vendored_bytes', 'tree_bytes', 'files', 'todos', 'health', 'commits', 'my_commits', 'stars', 'created', 'pushed']];
      for (const r of app.filtered()) { const s = summarizeRepo(r); rows.push([r.fullName, r.owner, r.private, r.fork, r.archived, s.primaryLang, s.code, s.byCat.code.comment, s.commentRatio.toFixed(4), s.testShare.toFixed(4), s.proseWords, s.configLines, s.generatedBytes, s.vendoredBytes, s.total.bytes, s.total.files, s.todos, s.healthScore, r.history?.commits ?? r.commitCount ?? '', r.history?.mine?.commits ?? '', r.stars ?? '', r.createdAt || '', r.pushedAt || '']); }
      download('repo-summary.csv', toCsv(rows), 'text/csv');
    }
    if (act === 'remove-selected-hint') $('#rm-filter')?.scrollIntoView({ behavior: 'smooth' });
    if (act === 'remove-repos') {
      const names = $$('[data-rm]:checked').map(x => x.dataset.rm);
      if (!names.length || !confirm(`Remove ${names.length} repositories from the results and delete their cached clones? Nothing on GitHub is touched.`)) return;
      try { await api('/api/remove', { repos: names }); await loadLocal(); } catch (err) { alert(err.message); }
    }
    if (act === 'back-local') { app.dataset = null; await loadLocal(); location.hash = '#/overview'; }
    if (act === 'demo') {
      try { const res = await fetch('demo/report.json'); openReport(await res.json(), 'import:demo'); location.hash = '#/overview'; } catch (err) { alert('Demo data not available: ' + err.message); }
    }
    return;
  }
  const ow = e.target.closest('[data-owner]');
  if (ow) { app.filter.owner = ow.dataset.owner; location.hash = '#/repos'; return; }
  const lr = e.target.closest('tr[data-lang]');
  if (lr) { const l = lr.dataset.lang; location.hash = route().arg === l ? '#/languages' : `#/languages/${encodeURIComponent(l)}`; return; }
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

// ------------------------------------------------------------ boot

async function boot() {
  applyTheme();
  installTooltip();
  window.addEventListener('hashchange', render);
  try { app.server = await api('/api/status'); } catch { app.server = null; }
  if (app.server) {
    await loadLocal(false);
    if (app.server.authed && (!app.meta?.viewer || app.meta.viewer.login !== app.server.login)) {
      try { const info = await api('/api/viewer', {}); Object.assign(app.meta, info); } catch (e) { console.warn(e); }
    } else if (app.server.authed) {
      // refresh profile/contributions in the background
      api('/api/viewer', {}).then(info => { if (app.dataset === 'local') { Object.assign(app.meta, info); softRender(); } }).catch(() => {});
    }
    if (app.server.job) pollJob();
    if (!app.repos.length && !location.hash) location.hash = '#/process';
  }
  render();
}

boot();
