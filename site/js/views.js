// Dashboard views. Each view is render(app) -> HTML string, plus optional bind(app, root).

import {
  esc, attr, fmtN, fmtK, fmtPct, fmtBytes, fmtDuration, fmtDate, fmtAgo, $, $$,
  CAT_COLOR, KIND_COLOR, langColor, stackBar, hbars, columns, diverging, lineChart, calendar, treemap,
  tile, card, download, toCsv,
} from './ui.js';
import { summarizeRepo, summarizeMany, buildTree, mergeWeekly, insights } from './engine/aggregate.js';
import { CATEGORY_ORDER, CATEGORY_LABEL } from './engine/languages.js';

const KIND_LABEL = {
  source: 'Source', test: 'Tests', example: 'Examples', script: 'Scripts & tools', bench: 'Benchmarks',
  readme: 'READMEs', guide: 'Guides & docs', changelog: 'Changelogs', legal: 'Licences & legal', community: 'Community', notebook: 'Notebooks',
  build: 'Build & dependencies', ci: 'CI / automation', deploy: 'Containers & deploy', lint: 'Lint & format', env: 'Editor, env & AI', vcs: 'Git', app: 'App config',
  lockfile: 'Lockfiles', 'build-output': 'Build output', codegen: 'Code generation', minified: 'Minified', snapshot: 'Test snapshots', migration: 'DB migrations', oversized: 'Oversized (>1 MB)', attribute: '.gitattributes',
  directory: 'Vendor directories', library: 'Known libraries',
  fixture: 'Fixtures / test data', dataset: 'Datasets', i18n: 'Translations', large: 'Large files', text: 'Text data',
  image: 'Images', vector: 'SVG', font: 'Fonts', audio: 'Audio', video: 'Video', archive: 'Archives', binary: 'Binaries', document: 'Office & PDF', cad: 'CAD / 3D', model: 'ML models', database: 'Databases',
  unknown: 'Unrecognised', empty: 'Empty files',
};
export const kindLabel = (k) => KIND_LABEL[k] || k;
const catLabel = (c) => CATEGORY_LABEL[c] || c;

const repoHref = (r) => `#/repos/${encodeURIComponent(r.fullName)}`;

function primaryMeasure(cat, s) {
  if (cat === 'code' || cat === 'config') return `${fmtN(s.code)} lines`;
  if (cat === 'docs') return `${fmtN(s.words)} words`;
  if (cat === 'data' || cat === 'other') return s.lines ? `${fmtN(s.lines)} lines` : fmtBytes(s.bytes);
  return fmtBytes(s.bytes);
}

function catTable(byCat, { onlyNonEmpty = true } = {}) {
  const rows = CATEGORY_ORDER.filter(c => !onlyNonEmpty || byCat[c]?.files).map(c => {
    const s = byCat[c];
    return `<tr><td><i class="sw" style="background:${CAT_COLOR[c]}"></i>${catLabel(c)}</td><td class="num">${fmtN(s.files)}</td><td class="num">${fmtBytes(s.bytes)}</td><td class="num">${primaryMeasure(c, s)}</td></tr>`;
  }).join('');
  return `<table class="tbl compact"><thead><tr><th>Category</th><th class="num">Files</th><th class="num">Size</th><th class="num">Measured as</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function compositionCard(byCat, title = 'What the repositories are made of') {
  const segs = CATEGORY_ORDER.map(c => ({ label: catLabel(c), value: byCat[c]?.bytes || 0, color: CAT_COLOR[c] }));
  return card(title, stackBar(segs, { fmt: fmtBytes }) + catTable(byCat), {
    sub: 'Share of tracked bytes at the default branch head. Each category is measured in the unit that means something for it.',
  });
}

function langRows(byLang, limit = 12, total) {
  const entries = Object.entries(byLang).filter(([, s]) => s.code > 0).sort((a, b) => b[1].code - a[1].code);
  const tot = total ?? entries.reduce((a, [, s]) => a + s.code, 0);
  const top = entries.slice(0, limit);
  const rest = entries.slice(limit);
  const rows = top.map(([l, s]) => ({ label: l, value: s.code, color: langColor(l), sub: `${fmtN(s.files)} files`, href: `#/languages/${encodeURIComponent(l)}` }));
  if (rest.length) rows.push({ label: `${rest.length} more`, value: rest.reduce((a, [, s]) => a + s.code, 0), color: 'var(--other)' });
  return hbars(rows, { valueLabel: (r) => `${fmtN(r.value)} <span class="muted">${fmtPct(r.value / tot)}</span>` });
}

function codeKindsBar(codeKinds) {
  const segs = ['source', 'test', 'example', 'script', 'bench'].map(k => ({ label: kindLabel(k), value: codeKinds[k]?.code || 0, color: KIND_COLOR[k] }));
  return stackBar(segs, { unit: ' lines' });
}

function kindBreakdown(byKind, cat, measure = 'bytes') {
  const rows = Object.entries(byKind).filter(([k]) => k.startsWith(cat + '/')).map(([k, s]) => ({ label: kindLabel(k.split('/')[1]), value: s[measure], sub: `${fmtN(s.files)} files`, color: CAT_COLOR[cat] }))
    .filter(r => r.value > 0).sort((a, b) => b.value - a.value);
  return hbars(rows, { fmt: measure === 'bytes' ? fmtBytes : fmtN, labelWidth: 170 });
}

// ============================================================ OVERVIEW

export function overview(app) {
  const repos = app.filtered();
  if (!repos.length) return noRepos(app);
  const agg = summarizeMany(repos);
  const v = app.meta?.viewer;
  const code = agg.byCat.code;
  const proseWords = agg.byCat.docs.words - (agg.docsByKind.legal?.words || 0);
  const hist = repos.filter(r => r.history).length;
  let html = '';
  if (v) {
    html += `<div class="profile">
      <img src="${attr(v.avatarUrl)}" alt="" width="56" height="56">
      <div><h2>${esc(v.name || v.login)} <span class="muted">@${esc(v.login)}</span></h2>
      <p class="muted">On GitHub since ${fmtDate(v.createdAt)} · ${fmtN(v.followers)} followers · ${fmtN(v.following)} following · ${fmtN(v.ownedRepos)} owned repos · ${fmtN(v.stars)} starred · ${fmtN((app.meta.orgs || []).length)} orgs</p></div>
    </div>`;
  }
  html += `<div class="tiles">
    ${tile('Repositories', fmtN(repos.length), repos.some(r => r.private != null) ? `${fmtN(repos.filter(r => r.private).length)} private · ${fmtN(repos.filter(r => r.private === false).length)} public` : `${fmtN(new Set(repos.map(r => r.owner)).size)} owners`)}
    ${tile('Lines of code', fmtK(code.code), `${fmtN(code.files)} files · excludes generated & vendored`, `<b>${fmtN(code.code)}</b> non-blank, non-comment lines in maintained source files`)}
    ${tile('Comment lines', fmtPct(agg.commentRatio), `${fmtK(code.comment)} lines of comments`, 'Comment lines ÷ (code + comment lines)')}
    ${tile('Test code', fmtPct(agg.testShare), `${fmtK(agg.codeKinds.test?.code || 0)} lines in tests`)}
    ${tile('Doc words', fmtK(proseWords), `≈ ${fmtDuration(proseWords / 238)} to read`, 'Prose words in docs, READMEs, changelogs and notebooks, excluding code samples, URLs and licence text')}
    ${tile('Config & build', fmtK(agg.byCat.config.code), `lines in ${fmtN(agg.byCat.config.files)} files`)}
    ${tile('Generated', fmtPct(agg.total.bytes ? agg.byCat.generated.bytes / agg.total.bytes : 0), `${fmtBytes(agg.byCat.generated.bytes)} of ${fmtBytes(agg.total.bytes)}`, 'Lockfiles, build output, codegen, minified bundles, snapshots')}
    ${tile('Commits', fmtK(agg.commits), agg.myCommits ? `${fmtK(agg.myCommits)} by you` : 'on default branches')}
  </div>`;

  const ins = insights(repos, agg, v);
  html += `<div class="grid g2">`;
  html += card('Highlights', `<ul class="insights">${ins.map(i => `<li class="ins-${i.icon}">${i.text}</li>`).join('')}</ul>`);
  html += compositionCard(agg.byCat);
  html += card('Languages', langRows(agg.byLang, 10, code.code), { sub: 'Maintained code lines by language (excludes generated, vendored, config).', actions: '<a href="#/languages">All languages →</a>' });
  html += card('Code by purpose', codeKindsBar(agg.codeKinds) + `<p class="small muted">Classified by path: test folders and *_test / *.spec files are tests; examples/, samples/, demo/ are examples; scripts/, tools/, bin/ are scripts.</p>`
    + `<h4>Documentation by type</h4>` + hbars(Object.entries(agg.docsByKind).map(([k, s]) => ({ label: kindLabel(k), value: s.words, color: CAT_COLOR.docs, sub: `${fmtN(s.files)} files` })).sort((a, b) => b.value - a.value), { valueLabel: r => `${fmtN(r.value)} words`, labelWidth: 150 })
    + `<h4>Config by type</h4>` + kindBreakdown(agg.byKind, 'config', 'code'));
  html += `</div>`;

  // largest repos stacked by language
  const byCode = repos.map(r => [r, summarizeRepo(r)]).filter(([, s]) => s.code > 0).sort((a, b) => b[1].code - a[1].code);
  const topRepos = byCode.slice(0, 15).map(([r, s]) => {
    const langs = Object.entries(s.byLang).sort((a, b) => b[1].code - a[1].code);
    return { label: r.name, sub: r.owner, value: s.code, href: repoHref(r), segs: langs.map(([l, ls]) => ({ label: l, value: ls.code, color: langColor(l), tip: `<b>${esc(r.name)}</b> · ${esc(l)}<br>${fmtN(ls.code)} lines` })) };
  });
  const hc = agg.healthCounts;
  const healthRows = [['readme', 'README'], ['license', 'LICENSE'], ['tests', 'Tests'], ['ci', 'CI workflow'], ['gitignore', '.gitignore'], ['docs', 'Docs beyond README'], ['lint', 'Lint / format config'], ['contributing', 'CONTRIBUTING'], ['changelog', 'Changelog'], ['container', 'Container / deploy'], ['lockfile', 'Lockfile']]
    .map(([k, l]) => ({ label: l, value: (hc[k] || 0) / repos.length, color: 'var(--s3)', tip: `<b>${l}</b><br>${hc[k] || 0} of ${repos.length} repos` }));
  html += `<div class="grid g2">`;
  html += card('Largest repositories by code', hbars(topRepos, { labelWidth: 170 }), { actions: '<a href="#/repos">All repos →</a>' });
  html += card('Repository hygiene', hbars(healthRows, { max: 1, fmt: v => fmtPct(v), labelWidth: 160 }), { sub: 'Share of repositories that have each item.' });
  // size distribution
  const bins = [[0, 100, '< 100'], [100, 1e3, '100–1K'], [1e3, 1e4, '1K–10K'], [1e4, 1e5, '10K–100K'], [1e5, Infinity, '100K+']];
  const dist = bins.map(([a, b, l]) => ({ label: l, value: repos.filter(r => { const c = summarizeRepo(r).code; return c >= a && c < b; }).length }));
  html += card('Repository size distribution', columns(dist, { height: 150 }), { sub: 'Number of repositories by lines of code.' });
  // activity recency
  const now = Date.now();
  const rec = [[30, 'Last 30 days'], [90, '1–3 months'], [365, '3–12 months'], [730, '1–2 years'], [Infinity, 'Over 2 years']];
  let prev = 0;
  const recRows = rec.map(([d, l]) => { const n = repos.filter(r => { const age = (now - Date.parse(r.pushedAt || r.lastCommitAt || 0)) / 864e5; return age >= prev && age < d; }).length; prev = d; return { label: l, value: n, color: 'var(--s1)' }; });
  html += card('Last activity', hbars(recRows, { labelWidth: 120 }), { sub: 'Repositories by time since last push.' });
  html += `</div>`;
  if (hist) {
    const weekly = mergeWeekly(repos).filter(w => w[0] * 1000 > now - 2 * 365 * 864e5);
    html += card('Code churn, last two years', diverging(weekly), { sub: `Weekly lines added and removed on default branches, ${hist} repos with history.`, actions: '<a href="#/activity">Activity →</a>' });
  }
  return html;
}

function noRepos(app) {
  if (!app.repos.length) return `<div class="empty-state"><h2>No data yet</h2><p>Process your repositories or import a report to see statistics.</p><p><a class="btn primary" href="#/process">Process repositories</a> <a class="btn" href="#/data">Import a report</a></p></div>`;
  return `<div class="empty-state"><h2>No repositories match the filters</h2><p><button class="btn" data-action="clear-filters">Clear filters</button></p></div>`;
}

// ============================================================ REPOSITORIES

const COLUMNS = [
  { key: 'name', label: 'Repository', get: (r) => r.fullName.toLowerCase(), always: true },
  { key: 'comp', label: 'Composition', get: (r, s) => s.total.bytes, cls: 'comp-col', on: true },
  { key: 'lang', label: 'Main language', get: (r, s) => s.primaryLang || '', on: true },
  { key: 'code', label: 'Code lines', get: (r, s) => s.code, num: true, on: true },
  { key: 'comment', label: 'Comments', get: (r, s) => s.commentRatio, num: true, fmt: fmtPct, on: true },
  { key: 'tests', label: 'Tests', get: (r, s) => s.testShare, num: true, fmt: fmtPct, on: true },
  { key: 'words', label: 'Doc words', get: (r, s) => s.proseWords, num: true, on: true },
  { key: 'config', label: 'Config lines', get: (r, s) => s.configLines, num: true },
  { key: 'gen', label: 'Generated', get: (r, s) => s.generatedShare, num: true, fmt: fmtPct, on: true },
  { key: 'files', label: 'Files', get: (r, s) => s.total.files, num: true },
  { key: 'bytes', label: 'Tree size', get: (r, s) => s.total.bytes, num: true, fmt: fmtBytes, on: true },
  { key: 'disk', label: 'Disk (with history)', get: (r) => (r.diskKb || 0) * 1024, num: true, fmt: fmtBytes },
  { key: 'todos', label: 'TODOs', get: (r, s) => s.todos, num: true },
  { key: 'commits', label: 'Commits', get: (r) => r.history?.commits ?? r.commitCount ?? null, num: true, on: true },
  { key: 'mine', label: 'My commits', get: (r) => r.history?.mine?.commits || 0, num: true },
  { key: 'contrib', label: 'Contributors', get: (r) => r.history?.contributors?.length || 0, num: true },
  { key: 'stars', label: 'Stars', get: (r) => r.stars || 0, num: true },
  { key: 'forks', label: 'Forks', get: (r) => r.forks || 0, num: true },
  { key: 'issues', label: 'Open issues', get: (r) => r.openIssues || 0, num: true },
  { key: 'prs', label: 'Open PRs', get: (r) => r.openPRs || 0, num: true },
  { key: 'health', label: 'Health', get: (r, s) => s.healthScore, num: true, on: true },
  { key: 'created', label: 'Created', get: (r) => r.createdAt || '', date: true },
  { key: 'pushed', label: 'Last push', get: (r) => r.pushedAt || '', date: true, on: true },
];

export function repoList(app) {
  const all = app.filtered({ includeFailed: true });
  const st = app.ui.table;
  const cols = COLUMNS.filter(c => c.always || st.cols.includes(c.key));
  const col = COLUMNS.find(c => c.key === st.sort) || COLUMNS[3];
  const rows = all.map(r => [r, r.status === 'ok' ? summarizeRepo(r) : null]);
  rows.sort((a, b) => {
    if (!a[1] !== !b[1]) return a[1] ? -1 : 1;
    const va = a[1] ? col.get(a[0], a[1]) : 0, vb = b[1] ? col.get(b[0], b[1]) : 0;
    const d = va < vb ? -1 : va > vb ? 1 : 0;
    return st.dir === 'asc' ? d : -d;
  });
  const okRows = rows.filter(([, s]) => s);
  const maxBytes = Math.max(1, ...okRows.map(([, s]) => s.total.bytes));
  const q = app.filter.q.trim().toLowerCase();
  const hl = (s) => { const e = esc(s); if (!q) return e; const terms = q.split(/\s+/).filter(t => t && !t.includes(':')).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); return terms.length ? e.replace(new RegExp(`(${terms.join('|')})`, 'gi'), '<mark>$1</mark>') : e; };
  const head = cols.map(c => `<th class="${c.num ? 'num' : ''} ${c.cls || ''}"><button data-sort="${c.key}" class="th-btn ${st.sort === c.key ? 'sorted ' + st.dir : ''}">${c.label}</button></th>`).join('');
  const body = rows.map(([r, s]) => {
    const tds = cols.map(c => {
      if (c.key === 'name') {
        const badges = [r.private ? '<span class="badge">private</span>' : '', r.fork ? '<span class="badge">fork</span>' : '', r.archived ? '<span class="badge warn">archived</span>' : '', r.template ? '<span class="badge">template</span>' : '', r.truncated ? '<span class="badge warn" data-tip="GitHub truncated the file tree; some files are missing">partial</span>' : ''].join('');
        return `<td class="name-cell"><a href="${repoHref(r)}"><span class="owner">${hl(r.owner)}/</span><b>${hl(r.name)}</b></a>${badges}${r.description ? `<div class="desc">${hl(r.description)}</div>` : ''}</td>`;
      }
      if (!s) return c.key === 'comp' ? `<td colspan="${cols.length - 1}" class="muted">${r.status === 'error' ? '⚠ ' + esc(r.error || 'error') : r.status === 'skipped' ? esc(r.error || 'skipped') : r.status === 'empty' ? 'Empty repository' : esc(r.status)}</td>` : '';
      if (c.key === 'comp') {
        const w = Math.max(6, Math.sqrt(s.total.bytes / maxBytes) * 100);
        return `<td class="comp-col"><div class="mini" style="width:${w}%">${CATEGORY_ORDER.filter(k => s.byCat[k].bytes).map(k => `<span style="flex:${s.byCat[k].bytes} 1 0;background:${CAT_COLOR[k]}" data-tip="${attr(`<b>${catLabel(k)}</b><br>${fmtBytes(s.byCat[k].bytes)} · ${primaryMeasure(k, s.byCat[k])}`)}"></span>`).join('')}</div></td>`;
      }
      if (c.key === 'lang') return `<td>${s.primaryLang ? `<i class="sw" style="background:${langColor(s.primaryLang)}"></i>${hl(s.primaryLang)}` : '<span class="muted">–</span>'}</td>`;
      if (c.key === 'health') return `<td class="num"><span class="score s${Math.floor(s.healthScore / 25)}" data-tip="${attr(healthTip(s.health, r))}">${s.healthScore}</span></td>`;
      const v = c.get(r, s);
      if (c.date) return `<td class="nowrap" data-tip="${attr(fmtDate(v))}">${v ? fmtAgo(v) : '–'}</td>`;
      return `<td class="num">${(c.fmt || fmtN)(v)}</td>`;
    }).join('');
    return `<tr data-repo="${attr(r.fullName)}" class="${s ? '' : 'failed'}">${tds}</tr>`;
  }).join('');
  const picker = COLUMNS.filter(c => !c.always).map(c => `<label><input type="checkbox" data-col="${c.key}" ${st.cols.includes(c.key) ? 'checked' : ''}> ${c.label}</label>`).join('');
  return `<div class="toolbar"><span class="muted">${fmtN(rows.length)} repositories${okRows.length !== rows.length ? ` (${rows.length - okRows.length} not analyzed)` : ''}</span>
    <span class="spacer"></span>
    <details class="dropdown"><summary class="btn">Columns</summary><div class="dd-menu cols-menu">${picker}</div></details>
    <button class="btn" data-action="export-table">Export CSV</button></div>
    <div class="legend table-legend">${CATEGORY_ORDER.map(c => `<span class="lg"><i style="background:${CAT_COLOR[c]}"></i>${catLabel(c)}</span>`).join('')}<span class="muted small">Composition bar width ∝ √size</span></div>
    <div class="table-wrap"><table class="tbl repos-tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function bindRepoList(app, root) {
  root.addEventListener('click', (e) => {
    const sb = e.target.closest('[data-sort]');
    if (sb) {
      const k = sb.dataset.sort;
      const c = COLUMNS.find(x => x.key === k);
      if (app.ui.table.sort === k) app.ui.table.dir = app.ui.table.dir === 'asc' ? 'desc' : 'asc';
      else { app.ui.table.sort = k; app.ui.table.dir = c.num || c.date || k === 'comp' ? 'desc' : 'asc'; }
      app.saveUi(); app.render();
      return;
    }
    const tr = e.target.closest('tr[data-repo]');
    if (tr && !e.target.closest('a')) location.hash = `#/repos/${encodeURIComponent(tr.dataset.repo)}`;
    if (e.target.closest('[data-action="export-table"]')) {
      const rows = app.filtered().map(r => [r, summarizeRepo(r)]);
      const keys = COLUMNS.filter(c => c.key !== 'comp');
      download('repositories.csv', toCsv([['full_name', ...keys.slice(1).map(c => c.label), 'private', 'fork', 'archived', 'description'], ...rows.map(([r, s]) => [r.fullName, ...keys.slice(1).map(c => c.get(r, s)), r.private, r.fork, r.archived, r.description || ''])]), 'text/csv');
    }
  });
  root.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-col]');
    if (!cb) return;
    const set = new Set(app.ui.table.cols);
    cb.checked ? set.add(cb.dataset.col) : set.delete(cb.dataset.col);
    app.ui.table.cols = COLUMNS.filter(c => set.has(c.key)).map(c => c.key);
    app.saveUi(); app.render();
    requestAnimationFrame(() => $('.cols-menu')?.closest('details')?.setAttribute('open', ''));
  });
}
export const DEFAULT_COLS = COLUMNS.filter(c => c.on).map(c => c.key);

function healthTip(h, r) {
  const items = [['readme', 'README'], ['license', 'LICENSE' + (r.private ? ' (not scored: private)' : '')], ['tests', 'Tests'], ['ci', 'CI'], ['gitignore', '.gitignore'], ['docs', 'Docs'], ['lint', 'Lint config'], ['contributing', 'CONTRIBUTING'], ['changelog', 'Changelog']];
  return '<b>Health checklist</b><br>' + items.map(([k, l]) => `${h[k] ? '✓' : '✗'} ${l}`).join('<br>');
}

// ============================================================ REPO OVERLAY

export function repoOverlay(app, fullName) {
  const r = app.repos.find(x => x.fullName === fullName);
  if (!r) return `<div class="overlay-inner"><button class="close" data-action="close-overlay" aria-label="Close">×</button><p>Repository not found in this dataset.</p></div>`;
  const head = `<header class="ov-head">
      <div><div class="muted">${esc(r.owner)} /</div><h2>${esc(r.name)} ${r.private ? '<span class="badge">private</span>' : r.private === false ? '<span class="badge">public</span>' : ''}${r.fork ? '<span class="badge">fork</span>' : ''}${r.archived ? '<span class="badge warn">archived</span>' : ''}</h2>
      ${r.description ? `<p>${esc(r.description)}</p>` : ''}
      <p class="muted small">${[r.url ? `<a href="${attr(r.url)}" target="_blank" rel="noopener">Open on GitHub ↗</a>` : '', r.homepage ? `<a href="${attr(r.homepage)}" target="_blank" rel="noopener">Homepage ↗</a>` : '', r.defaultBranch ? `branch <code>${esc(r.defaultBranch)}</code>` : '', r.headOid ? `at <code>${esc(r.headOid.slice(0, 7))}</code>` : '', r.license ? `licence ${esc(r.license)}` : '', r.parent ? `fork of ${esc(r.parent)}` : '', `analyzed ${fmtAgo(r.analyzedAt)}`].filter(Boolean).join(' · ')}</p>
      ${r.topics?.length ? `<p>${r.topics.map(t => `<span class="topic">${esc(t)}</span>`).join('')}</p>` : ''}
      </div>
      <div class="ov-actions">
        ${app.server && app.dataset === 'local' && (r.url || r.localPath) ? `<button class="btn" data-action="reanalyze" data-repo="${attr(r.fullName)}">Re-analyze</button>` : ''}
        <button class="btn" data-action="compare-add" data-repo="${attr(r.fullName)}">Compare</button>
        <button class="close" data-action="close-overlay" aria-label="Close">×</button>
      </div></header>`;
  if (r.status !== 'ok') return `<div class="overlay-inner">${head}<div class="empty-state"><p>${r.status === 'empty' ? 'This repository is empty.' : esc(r.error || r.status)}</p></div></div>`;
  const s = summarizeRepo(r);
  const code = s.byCat.code;
  const h = r.history;
  let html = head;
  html += `<div class="tiles">
    ${tile('Lines of code', fmtN(code.code), `${fmtN(code.files)} files · avg ${fmtN(s.avgFileLines)} lines`)}
    ${tile('Comments', fmtPct(s.commentRatio), `${fmtN(code.comment)} lines`)}
    ${tile('Tests', fmtPct(s.testShare), `${fmtN(s.codeKinds.test.code)} lines`)}
    ${tile('Doc words', fmtN(s.proseWords), `≈ ${fmtDuration(s.proseWords / 238)} reading`)}
    ${tile('Config lines', fmtN(s.configLines), `${fmtN(s.byCat.config.files)} files`)}
    ${tile('Tree size', fmtBytes(s.total.bytes), `${fmtN(s.total.files)} files${r.diskKb ? ` · ${fmtBytes(r.diskKb * 1024)} with history` : ''}`)}
    ${tile('Commits', fmtN(h?.commits ?? r.commitCount), h?.mine ? `${fmtN(h.mine.commits)} by you (${fmtPct(h.mine.commits / (h.commits || 1))})` : (h?.contributors?.length ? `${fmtN(h.contributorCount || h.contributors.length)} contributors` : ''))}
    ${tile('Health', `${s.healthScore}<small>/100</small>`, '', healthTip(s.health, r))}
    ${r.stars != null ? tile('Stars · forks', `${fmtN(r.stars)} · ${fmtN(r.forks)}`, `${fmtN(r.openIssues)} open issues · ${fmtN(r.openPRs)} PRs`) : ''}
  </div>`;
  html += `<div class="grid g2">`;
  html += compositionCard(s.byCat, 'Composition');
  html += card('Languages', langRows(s.byLang, 10, code.code) + `<h4>Code by purpose</h4>` + codeKindsBar(s.codeKinds));
  html += card('Documentation', s.byCat.docs.files ? docTable(r) : '<div class="empty-note">No documentation files</div>');
  html += card('Config, generated & vendored',
    `<h4>Config (lines)</h4>${kindBreakdown(s.byKind, 'config', 'code')}<h4>Generated (bytes)</h4>${kindBreakdown(s.byKind, 'generated')}${s.byCat.vendored.files ? `<h4>Vendored (bytes)</h4>${kindBreakdown(s.byKind, 'vendored')}` : ''}${s.byCat.assets.files ? `<h4>Assets (bytes)</h4>${kindBreakdown(s.byKind, 'assets')}` : ''}`);
  html += `</div>`;
  html += card('Where the code lives', `<div class="tm-crumbs" id="tm-crumbs"></div><div id="tm-host"></div>`, {
    sub: 'Click a folder to zoom in. Colour shows the dominant category.',
    actions: `<select id="tm-metric" class="select"><option value="code">Code lines</option><option value="bytes">Bytes</option><option value="words">Doc words</option><option value="files">Files</option></select>`,
  });
  // top files
  const longest = r.files.filter(f => f.c === 'code').sort((a, b) => (b.cd || 0) - (a.cd || 0)).slice(0, 12);
  const largest = [...r.files].sort((a, b) => b.s - a.s).slice(0, 12);
  html += `<div class="grid g2">`;
  html += card('Longest code files', fileTable(longest, ['l', 'cd', 'cm']));
  html += card('Largest files', fileTable(largest, ['c', 's']));
  html += `</div>`;
  if (h) {
    html += `<div class="grid g2">`;
    const weekly = h.weekly || [];
    if (weekly.length) {
      html += card('Commits per week', columns(fillWeeks(weekly).slice(-104).map(w => ({ label: '', value: w[3], tip: `<b>Week of ${new Date(w[0] * 1000).toLocaleDateString()}</b><br>${fmtN(w[3])} commits` })), { height: 140, yTicks: true }), { sub: 'Last two years, default branch.' });
      html += card('Lines added and removed', diverging(fillWeeks(weekly).slice(-104)));
      // cumulative net lines
      let net = 0;
      const cum = fillWeeks(weekly).map(w => { net += w[1] - w[2]; return [w[0] * 1000, Math.max(0, net)]; });
      html += card('Codebase growth', lineChart([{ name: 'Net lines (all file types)', color: 'var(--s1)', points: cum }], { xfmt: (x) => new Date(x).toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) }), { sub: 'Cumulative additions minus deletions, all tracked files (including generated).' });
    }
    if (h.contributors?.length) {
      const tot = h.contributors.reduce((a, c) => a + c.commits, 0);
      html += card('Contributors', `<table class="tbl compact"><thead><tr><th>Who</th><th class="num">Commits</th><th class="num">Share</th><th class="num">Added</th><th class="num">Removed</th></tr></thead><tbody>${h.contributors.slice(0, 15).map(c => `<tr class="${h.mine && c.login === h.mine.login ? 'me' : ''}"><td>${c.avatar ? `<img class="av" src="${attr(c.avatar)}&s=40" alt="" width="20" height="20">` : ''}${esc(c.login)}</td><td class="num">${fmtN(c.commits)}</td><td class="num">${fmtPct(c.commits / tot)}</td><td class="num">${fmtN(c.additions)}</td><td class="num">${fmtN(c.deletions)}</td></tr>`).join('')}</tbody></table>${h.contributors.length > 15 ? `<p class="muted small">and ${h.contributors.length - 15} more</p>` : ''}`, { sub: 'From git log on the default branch, by author name (no merges).' });
    }
    html += `</div>`;
  }
  html += card('File browser', `<div class="fb-tools"><input type="search" id="fb-search" class="input" placeholder="Filter paths…"><select id="fb-cat" class="select"><option value="">All categories</option>${CATEGORY_ORDER.map(c => `<option value="${c}">${catLabel(c)}</option>`).join('')}</select></div><div id="fb-host"></div>`, { sub: 'Folders roll up their contents. Click a folder to expand it.' });
  return `<div class="overlay-inner">${html}</div>`;
}

function fillWeeks(weekly) {
  if (!weekly.length) return [];
  const m = new Map(weekly.map(w => [w[0], w]));
  const out = [];
  for (let t = weekly[0][0]; t <= weekly.at(-1)[0]; t += 7 * 86400) out.push(m.get(t) || [t, 0, 0, 0]);
  return out;
}

function docTable(r) {
  const docs = r.files.filter(f => f.c === 'docs').sort((a, b) => (b.w || 0) - (a.w || 0));
  const s = summarizeRepo(r);
  const totals = docs.reduce((a, f) => { a.h += f.x?.headings || 0; a.samples += f.x?.samples || 0; a.links += f.x?.links || 0; a.images += f.x?.images || 0; return a; }, { h: 0, samples: 0, links: 0, images: 0 });
  return hbars(Object.entries(s.docsByKind).map(([k, v]) => ({ label: kindLabel(k), value: v.words, color: CAT_COLOR.docs, sub: `${fmtN(v.files)} files` })).sort((a, b) => b.value - a.value), { valueLabel: r => `${fmtN(r.value)} words` })
    + `<p class="small muted">${fmtN(totals.h)} headings · ${fmtN(totals.samples)} lines of code samples · ${fmtN(totals.links)} links · ${fmtN(totals.images)} images</p>`
    + fileTable(docs.slice(0, 8), ['k', 'w']);
}

function fileTable(files, cols) {
  if (!files.length) return '<div class="empty-note">None</div>';
  const H = { l: 'Language', cd: 'Code', cm: 'Comments', c: 'Category', s: 'Size', w: 'Words', k: 'Kind', n: 'Lines' };
  const V = {
    l: f => f.l ? `<i class="sw" style="background:${langColor(f.l)}"></i>${esc(f.l)}` : '–', cd: f => fmtN(f.cd || 0), cm: f => fmtN(f.cm || 0),
    c: f => `<i class="sw" style="background:${CAT_COLOR[f.c]}"></i>${catLabel(f.c)} <span class="muted">${esc(kindLabel(f.k))}</span>`, s: f => fmtBytes(f.s), w: f => fmtN(f.w || 0), k: f => esc(kindLabel(f.k)), n: f => fmtN(f.n || 0),
  };
  const num = new Set(['cd', 'cm', 's', 'w', 'n']);
  return `<table class="tbl compact files-tbl"><thead><tr><th>File</th>${cols.map(c => `<th class="${num.has(c) ? 'num' : ''}">${H[c]}</th>`).join('')}</tr></thead><tbody>${files.map(f => `<tr><td class="path" title="${attr(f.p)}">${esc(f.p)}</td>${cols.map(c => `<td class="${num.has(c) ? 'num' : ''}">${V[c](f)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

export function bindOverlay(app, root, fullName) {
  const r = app.repos.find(x => x.fullName === fullName);
  if (!r || r.status !== 'ok') return;
  const tree = buildTree(r.files);
  let node = tree;
  const metricSel = $('#tm-metric', root);
  const metrics = { code: n => n.stats.code, bytes: n => n.stats.bytes, words: n => n.stats.words, files: n => n.stats.files };
  if (!summarizeRepo(r).code) metricSel.value = 'bytes';
  const domCat = (n) => { let best = 'other', v = -1; for (const [c, b] of Object.entries(n.cats)) if (b > v) { v = b; best = c; } return best; };
  const drawTm = () => {
    const metric = metrics[metricSel.value];
    $('#tm-host', root).innerHTML = treemap(node, {
      metric, height: 380,
      color: n => n.file ? (n.file.c === 'code' && n.file.l ? langColor(n.file.l) : CAT_COLOR[n.file.c]) : CAT_COLOR[domCat(n)],
      onTip: n => `<b>${esc(n.path)}${n.children.size ? '/' : ''}</b><br>${fmtN(n.stats.code)} code lines · ${fmtN(n.stats.words)} words<br>${fmtBytes(n.stats.bytes)} · ${fmtN(n.stats.files)} files${n.file ? `<br>${catLabel(n.file.c)} · ${esc(kindLabel(n.file.k))}${n.file.l ? ' · ' + esc(n.file.l) : ''}` : ''}`,
    });
    const parts = node.path ? node.path.split('/') : [];
    $('#tm-crumbs', root).innerHTML = `<button data-tm="">${esc(r.name)}</button>` + parts.map((p, i) => ` / <button data-tm="${attr(parts.slice(0, i + 1).join('/'))}">${esc(p)}</button>`).join('');
  };
  const find = (path) => { let n = tree; if (!path) return n; for (const p of path.split('/')) n = n.children.get(p); return n; };
  metricSel.addEventListener('change', drawTm);
  root.addEventListener('click', (e) => {
    const t = e.target.closest('.tm-dir');
    if (t) { node = find(t.dataset.path); drawTm(); return; }
    const c = e.target.closest('[data-tm]');
    if (c) { node = find(c.dataset.tm); drawTm(); }
  });
  drawTm();

  // file browser
  const fbHost = $('#fb-host', root);
  const open = new Set(['']);
  const drawFb = () => {
    const q = $('#fb-search', root).value.trim().toLowerCase();
    const cat = $('#fb-cat', root).value;
    const t = (q || cat) ? buildTree(r.files, f => (!q || f.p.toLowerCase().includes(q)) && (!cat || f.c === cat)) : tree;
    const rows = [];
    const walk = (n, depth) => {
      const kids = [...n.children.values()].sort((a, b) => (b.children.size > 0) - (a.children.size > 0) || b.stats.bytes - a.stats.bytes);
      for (const k of kids) {
        const isDir = k.children.size > 0;
        const expanded = open.has(k.path) || (q && depth < 6);
        const f = k.file;
        rows.push(`<tr class="${isDir ? 'dir' : ''}" ${isDir ? `data-fb="${attr(k.path)}"` : ''}><td style="padding-left:${8 + depth * 16}px">${isDir ? `<span class="caret">${expanded ? '▾' : '▸'}</span>` : '<span class="caret"></span>'}${isDir ? `<b>${esc(k.name)}/</b>` : esc(k.name)}</td>
          <td>${f ? `<i class="sw" style="background:${CAT_COLOR[f.c]}"></i>${catLabel(f.c)} <span class="muted">${esc(kindLabel(f.k))}</span>` : `<span class="mini inline">${CATEGORY_ORDER.filter(c => k.cats[c]).map(c => `<span style="flex:${k.cats[c]} 1 0;background:${CAT_COLOR[c]}"></span>`).join('')}</span>`}</td>
          <td>${f?.l ? esc(f.l) : ''}</td><td class="num">${fmtN(k.stats.code)}</td><td class="num">${fmtN(k.stats.comment)}</td><td class="num">${fmtN(k.stats.words)}</td><td class="num">${fmtBytes(k.stats.bytes)}</td><td class="num">${isDir ? fmtN(k.stats.files) : ''}</td></tr>`);
        if (isDir && expanded && rows.length < 3000) walk(k, depth + 1);
      }
    };
    walk(t, 0);
    fbHost.innerHTML = `<div class="table-wrap fb"><table class="tbl compact"><thead><tr><th>Path</th><th>Category</th><th>Language</th><th class="num">Code</th><th class="num">Comments</th><th class="num">Words</th><th class="num">Size</th><th class="num">Files</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  };
  fbHost.addEventListener('click', (e) => {
    const tr = e.target.closest('[data-fb]');
    if (!tr) return;
    const p = tr.dataset.fb;
    open.has(p) ? open.delete(p) : open.add(p);
    drawFb();
  });
  $('#fb-search', root).addEventListener('input', drawFb);
  $('#fb-cat', root).addEventListener('change', drawFb);
  drawFb();
}

// ============================================================ LANGUAGES

export function languages(app, focus) {
  const repos = app.filtered();
  if (!repos.length) return noRepos(app);
  const agg = summarizeMany(repos);
  const entries = Object.entries(agg.byLang).filter(([, s]) => s.files).sort((a, b) => b[1].code - a[1].code);
  const total = agg.byCat.code.code;
  const rows = entries.map(([l, s]) => {
    const rs = agg.langRepos[l];
    const open = focus === l;
    const detail = open ? `<tr class="detail"><td colspan="9">${hbars(rs.map(r => ({ r, v: summarizeRepo(r).byLang[l]?.code || 0 })).sort((a, b) => b.v - a.v).slice(0, 25).map(({ r, v }) => ({ label: r.name, sub: r.owner, value: v, color: langColor(l), href: repoHref(r) })), { labelWidth: 200 })}</td></tr>` : '';
    return `<tr class="clickable ${open ? 'open' : ''}" data-lang="${attr(l)}"><td><i class="sw" style="background:${langColor(l)}"></i><b>${esc(l)}</b></td><td class="num">${fmtN(s.code)}</td><td class="num">${fmtPct(s.code / total)}</td><td class="num">${fmtN(s.comment)}</td><td class="num">${fmtPct(s.code + s.comment ? s.comment / (s.code + s.comment) : 0)}</td><td class="num">${fmtN(s.blank)}</td><td class="num">${fmtN(s.files)}</td><td class="num">${fmtN(s.files ? s.code / s.files : 0)}</td><td class="num">${fmtN(rs.length)}</td></tr>${detail}`;
  }).join('');
  const cfg = Object.entries(agg.configByLang).sort((a, b) => b[1].code - a[1].code);
  const docFmt = {};
  for (const r of repos) for (const f of r.files) if (f.c === 'docs') { const k = f.k === 'notebook' ? 'Jupyter Notebook' : (f.l || 'Other'); (docFmt[k] ||= { files: 0, words: 0, bytes: 0 }); docFmt[k].files++; docFmt[k].words += f.w || 0; docFmt[k].bytes += f.s; }
  return card('Programming languages', `<div class="table-wrap"><table class="tbl"><thead><tr><th>Language</th><th class="num">Code lines</th><th class="num">Share</th><th class="num">Comment lines</th><th class="num">Comment %</th><th class="num">Blank</th><th class="num">Files</th><th class="num">Lines/file</th><th class="num">Repos</th></tr></thead><tbody>${rows}</tbody></table></div>`, { sub: 'Maintained code only. Click a language to see which repositories use it. Code in notebooks counts under the notebook’s kernel language.' })
    + `<div class="grid g2">`
    + card('Config & build formats', hbars(cfg.map(([l, s]) => ({ label: l, value: s.code, color: CAT_COLOR.config, sub: `${fmtN(s.files)} files` })), { valueLabel: r => `${fmtN(r.value)} lines` }), { sub: 'Non-blank, non-comment lines.' })
    + card('Documentation formats', hbars(Object.entries(docFmt).sort((a, b) => b[1].words - a[1].words).map(([l, s]) => ({ label: l, value: s.words, color: CAT_COLOR.docs, sub: `${fmtN(s.files)} files` })), { valueLabel: r => `${fmtN(r.value)} words` }), { sub: 'Words of prose.' })
    + `</div>`;
}

// ============================================================ OWNERS / ORGS

export function owners(app) {
  const repos = app.filtered();
  if (!repos.length) return noRepos(app);
  const groups = new Map();
  for (const r of repos) { if (!groups.has(r.owner)) groups.set(r.owner, []); groups.get(r.owner).push(r); }
  const orgInfo = new Map((app.meta?.orgs || []).map(o => [o.login, o]));
  const v = app.meta?.viewer;
  const cards = [...groups.entries()].map(([owner, rs]) => {
    const agg = summarizeMany(rs);
    const info = orgInfo.get(owner);
    const avatar = info?.avatarUrl || (v && v.login === owner ? v.avatarUrl : `https://github.com/${encodeURIComponent(owner)}.png?size=80`);
    const last = rs.map(r => r.pushedAt).filter(Boolean).sort().at(-1);
    const langs = Object.entries(agg.byLang).sort((a, b) => b[1].code - a[1].code);
    return { owner, agg, html: `<section class="card owner-card">
      <header class="owner-h"><img src="${attr(avatar)}" alt="" width="40" height="40"><div><h3>${esc(info?.name || owner)}</h3><div class="muted small">@${esc(owner)} · ${v && v.login === owner ? 'you' : info ? 'organization' : (rs[0].ownerType === 'Organization' ? 'organization' : 'account')}</div></div>
      <button class="btn small" data-owner="${attr(owner)}">Filter to this</button></header>
      <div class="tiles mini-tiles">
        ${tile('Repos', fmtN(rs.length), `${rs.filter(r => r.private).length} private`)}
        ${tile('Code', fmtK(agg.byCat.code.code), 'lines')}
        ${tile('Docs', fmtK(agg.byCat.docs.words - (agg.docsByKind.legal?.words || 0)), 'words')}
        ${tile('Commits', fmtK(agg.commits), agg.myCommits ? `${fmtK(agg.myCommits)} yours` : '')}
      </div>
      ${stackBar(langs.slice(0, 7).map(([l, s]) => ({ label: l, value: s.code, color: langColor(l) })).concat(langs.length > 7 ? [{ label: 'Other', value: langs.slice(7).reduce((a, [, s]) => a + s.code, 0), color: 'var(--other)' }] : []), { height: 10 })}
      <p class="muted small">Last push ${fmtAgo(last)} · ${fmtPct(agg.commentRatio)} comments · ${fmtPct(agg.testShare)} tests · health avg ${Math.round(rs.reduce((a, r) => a + summarizeRepo(r).healthScore, 0) / rs.length)}</p>
    </section>` };
  }).sort((a, b) => b.agg.byCat.code.code - a.agg.byCat.code.code);
  return `<div class="grid g2">${cards.map(c => c.html).join('')}</div>`;
}

// ============================================================ FILES

const FILE_PRESETS = {
  longest: { label: 'Longest code files', cat: 'code', sort: 'cd' },
  largest: { label: 'Largest files', sort: 's' },
  generated: { label: 'Generated files', cat: 'generated', sort: 's' },
  vendored: { label: 'Vendored files', cat: 'vendored', sort: 's' },
  todos: { label: 'Most TODOs', sort: 't' },
  docs: { label: 'Wordiest docs', cat: 'docs', sort: 'w' },
  uncommented: { label: 'Big files with few comments', cat: 'code', sort: 'cd', test: f => (f.cd || 0) > 300 && (f.cm || 0) / ((f.cd || 0) + (f.cm || 0)) < 0.03 },
  unknown: { label: 'Unclassified', cat: 'other', sort: 's' },
};

export function files(app) {
  const st = app.ui.files;
  const repos = app.filtered();
  if (!repos.length) return noRepos(app);
  const preset = FILE_PRESETS[st.preset] || null;
  const cat = st.cat || preset?.cat || '';
  const sort = st.sort || preset?.sort || 's';
  let re = null;
  try { re = st.q ? new RegExp(st.q, 'i') : null; } catch { re = null; }
  const qLower = st.q.toLowerCase();
  const matches = [];
  let totals = { files: 0, bytes: 0, code: 0, words: 0 };
  for (const r of repos) for (const f of r.files) {
    if (cat && f.c !== cat) continue;
    if (st.kind && f.k !== st.kind) continue;
    if (st.lang && f.l !== st.lang) continue;
    if (st.q && !(re ? re.test(f.p) : f.p.toLowerCase().includes(qLower))) continue;
    if (preset?.test && !preset.test(f)) continue;
    matches.push([r, f]);
    totals.files++; totals.bytes += f.s; totals.code += f.cd || 0; totals.words += f.w || 0;
  }
  const key = { s: f => f.s, cd: f => f.cd || 0, w: f => f.w || 0, t: f => f.t || 0, n: f => f.n || 0, p: f => f.p };
  matches.sort((a, b) => sort === 'p' ? a[1].p.localeCompare(b[1].p) : key[sort](b[1]) - key[sort](a[1]));
  const shown = matches.slice(0, 500);
  const kinds = [...new Set(repos.flatMap(r => r.files.filter(f => !cat || f.c === cat).map(f => f.k)))].sort();
  const langs = [...new Set(repos.flatMap(r => r.files.filter(f => !cat || f.c === cat).map(f => f.l).filter(Boolean)))].sort();
  const sortBtn = (k, l) => `<button class="th-btn ${sort === k ? 'sorted desc' : ''}" data-fsort="${k}">${l}</button>`;
  return `<div class="presets">${Object.entries(FILE_PRESETS).map(([k, p]) => `<button class="chip ${st.preset === k ? 'on' : ''}" data-preset="${k}">${p.label}</button>`).join('')}</div>
    <div class="toolbar">
      <input type="search" class="input" id="f-q" placeholder="Path contains… (regex allowed)" value="${attr(st.q)}">
      <select class="select" id="f-cat"><option value="">All categories</option>${CATEGORY_ORDER.map(c => `<option value="${c}" ${cat === c ? 'selected' : ''}>${catLabel(c)}</option>`).join('')}</select>
      <select class="select" id="f-kind"><option value="">All kinds</option>${kinds.map(k => `<option value="${attr(k)}" ${st.kind === k ? 'selected' : ''}>${esc(kindLabel(k))}</option>`).join('')}</select>
      <select class="select" id="f-lang"><option value="">All languages</option>${langs.map(k => `<option ${st.lang === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>
      <span class="spacer"></span><button class="btn" data-action="export-files">Export CSV</button>
    </div>
    <p class="muted">${fmtN(totals.files)} files · ${fmtBytes(totals.bytes)} · ${fmtN(totals.code)} code lines · ${fmtN(totals.words)} words${matches.length > shown.length ? ` · showing the first ${shown.length}` : ''}</p>
    <div class="table-wrap"><table class="tbl compact files-tbl"><thead><tr><th>${sortBtn('p', 'Path')}</th><th>Repository</th><th>Category</th><th>Language</th><th class="num">${sortBtn('cd', 'Code')}</th><th class="num">Comments</th><th class="num">${sortBtn('w', 'Words')}</th><th class="num">${sortBtn('t', 'TODOs')}</th><th class="num">${sortBtn('s', 'Size')}</th></tr></thead>
    <tbody>${shown.map(([r, f]) => `<tr><td class="path" title="${attr(f.p)}">${r.url ? `<a href="${attr(`${r.url}/blob/${r.headOid || r.defaultBranch}/${f.p.split('/').map(encodeURIComponent).join('/')}`)}" target="_blank" rel="noopener">${esc(f.p)}</a>` : esc(f.p)}</td><td><a href="${repoHref(r)}">${esc(r.name)}</a></td><td><i class="sw" style="background:${CAT_COLOR[f.c]}"></i>${esc(kindLabel(f.k))}</td><td>${esc(f.l || '')}</td><td class="num">${fmtN(f.cd || 0)}</td><td class="num">${fmtN(f.cm || 0)}</td><td class="num">${fmtN(f.w || 0)}</td><td class="num">${fmtN(f.t || 0)}</td><td class="num">${fmtBytes(f.s)}</td></tr>`).join('')}</tbody></table></div>`;
}

export function bindFiles(app, root) {
  const st = app.ui.files;
  let t;
  root.addEventListener('input', (e) => {
    if (e.target.id !== 'f-q') return;
    clearTimeout(t);
    t = setTimeout(() => { st.q = e.target.value; app.render(); const el = $('#f-q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 250);
  });
  root.addEventListener('change', (e) => {
    if (e.target.id === 'f-cat') { st.cat = e.target.value; st.kind = ''; st.preset = ''; }
    else if (e.target.id === 'f-kind') st.kind = e.target.value;
    else if (e.target.id === 'f-lang') st.lang = e.target.value;
    else return;
    app.render();
  });
  root.addEventListener('click', (e) => {
    const p = e.target.closest('[data-preset]');
    if (p) { const k = p.dataset.preset; Object.assign(st, { preset: st.preset === k ? '' : k, cat: '', kind: '', sort: '' }); app.render(); return; }
    const s = e.target.closest('[data-fsort]');
    if (s) { st.sort = s.dataset.fsort; app.render(); return; }
    if (e.target.closest('[data-action="export-files"]')) {
      const rows = [['repository', 'path', 'category', 'kind', 'language', 'bytes', 'lines', 'code', 'comment', 'blank', 'words', 'todos']];
      for (const r of app.filtered()) for (const f of r.files) rows.push([r.fullName, f.p, f.c, f.k, f.l || '', f.s, f.n || 0, f.cd || 0, f.cm || 0, f.bl || 0, f.w || 0, f.t || 0]);
      download('files.csv', toCsv(rows), 'text/csv');
    }
  });
}

// ============================================================ ACTIVITY

export function activity(app) {
  const repos = app.filtered();
  const c = app.meta?.contributions;
  let html = '';
  if (c) {
    html += card(`${fmtN(c.total)} contributions in the last year`, calendar(c.days), { sub: 'Commits, pull requests, issues and reviews across GitHub, including private work if your profile counts it.' });
    if (c.years?.length) {
      const yrs = c.years;
      const ser = [['totalCommitContributions', 'Commits', 'var(--s1)'], ['totalPullRequestContributions', 'Pull requests', 'var(--s2)'], ['totalPullRequestReviewContributions', 'Reviews', 'var(--s3)'], ['totalIssueContributions', 'Issues', 'var(--s4)']];
      html += card('Contributions by year', `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Year</th>${ser.map(s => `<th class="num"><i class="sw" style="background:${s[2]}"></i>${s[1]}</th>`).join('')}<th class="num">Repos committed to</th><th class="num">Private (hidden)</th><th style="width:40%"></th></tr></thead><tbody>${yrs.map(y => {
        const tot = ser.reduce((a, s) => a + (y[s[0]] || 0), 0);
        const max = Math.max(...yrs.map(y2 => ser.reduce((a, s) => a + (y2[s[0]] || 0), 0)), 1);
        return `<tr><td>${y.year}</td>${ser.map(s => `<td class="num">${fmtN(y[s[0]])}</td>`).join('')}<td class="num">${fmtN(y.totalRepositoriesWithContributedCommits)}</td><td class="num">${fmtN(y.restrictedContributionsCount)}</td><td><div class="mini" style="width:${(tot / max) * 100}%">${ser.map(s => `<span style="flex:${y[s[0]] || 0} 1 0;background:${s[2]}" data-tip="${attr(`<b>${y.year} · ${s[1]}</b><br>${fmtN(y[s[0]])}`)}"></span>`).join('')}</div></td></tr>`;
      }).join('')}</tbody></table></div>`);
    }
  }
  if (!repos.length) return html + noRepos(app);
  const now = Date.now();
  html += `<div class="grid g2">`;
  // creation timeline
  const byYear = {};
  for (const r of repos) if (r.createdAt) { const y = new Date(r.createdAt).getFullYear(); byYear[y] = (byYear[y] || 0) + 1; }
  const ys = Object.keys(byYear).map(Number).sort();
  const yrPts = ys.length ? Array.from({ length: ys.at(-1) - ys[0] + 1 }, (_, i) => ({ label: String(ys[0] + i), value: byYear[ys[0] + i] || 0 })) : [];
  html += card('Repositories created per year', columns(yrPts, { height: 150, labelEvery: yrPts.length > 12 ? 2 : 1 }));
  // weekday/hour not available without commit-level data; show commit weekly totals instead
  const weekly = mergeWeekly(repos);
  if (weekly.length) {
    const recent = fillWeeks(weekly).filter(w => w[0] * 1000 > now - 365 * 864e5);
    html += card('Commits per week, last 12 months', columns(recent.map(w => ({ label: '', value: w[3], tip: `<b>Week of ${new Date(w[0] * 1000).toLocaleDateString()}</b><br>${fmtN(w[3])} commits` })), { height: 150 }), { sub: 'Default branches of the filtered repositories.' });
    html += `</div>`;
    html += card('Lines added and removed per week', diverging(fillWeeks(weekly).slice(-156)), { sub: 'Last three years, all file types (git’s line counts include generated files and lockfiles).' });
    // monthly activity per repo heat table
    const months = [];
    const d0 = new Date(); d0.setUTCDate(1);
    for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - i, 1)); months.push(d); }
    const repoMonths = repos.filter(r => r.history?.weekly?.length).map(r => {
      const counts = months.map(() => 0);
      for (const [w, , , c] of r.history.weekly) { const d = new Date(w * 1000); const idx = months.findIndex((m, i) => d >= m && (i === 11 || d < months[i + 1])); if (idx >= 0) counts[idx] += c; }
      return [r, counts];
    }).filter(([, c]) => c.some(Boolean)).sort((a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0)).slice(0, 25);
    const maxC = Math.max(1, ...repoMonths.flatMap(([, c]) => c));
    html += card('Most active repositories, by month', repoMonths.length ? `<div class="table-wrap"><table class="tbl compact heat"><thead><tr><th>Repository</th>${months.map(m => `<th>${m.toLocaleDateString(undefined, { month: 'short' })}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>${repoMonths.map(([r, c]) => `<tr><td><a href="${repoHref(r)}">${esc(r.name)}</a></td>${c.map((v, i) => `<td class="hm" style="--a:${v ? 0.15 + 0.85 * Math.sqrt(v / maxC) : 0}" data-tip="${attr(`<b>${esc(r.name)}</b><br>${months[i].toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}: ${fmtN(v)} commits`)}">${v || ''}</td>`).join('')}<td class="num">${fmtN(c.reduce((a, b) => a + b, 0))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-note">No commits in the last 12 months</div>', { sub: 'Commits on the default branch in each of the last 12 months.' });
    // when you code (punch card)
    const pm = repos.reduce((acc, r) => { const p = r.history?.punchMine; if (p) p.forEach((row, d) => row.forEach((v, h) => { acc[d][h] += v; })); return acc; }, Array.from({ length: 7 }, () => Array(24).fill(0)));
    const pa = repos.reduce((acc, r) => { const p = r.history?.punch; if (p) p.forEach((row, d) => row.forEach((v, h) => { acc[d][h] += v; })); return acc; }, Array.from({ length: 7 }, () => Array(24).fill(0)));
    const useMine = pm.flat().some(Boolean);
    const P = useMine ? pm : pa;
    if (P.flat().some(Boolean)) {
      const maxP = Math.max(...P.flat());
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const tot = P.flat().reduce((a, b) => a + b, 0);
      const byDay = P.map(r => r.reduce((a, b) => a + b, 0));
      const byHour = Array.from({ length: 24 }, (_, h) => P.reduce((a, r) => a + r[h], 0));
      const peakH = byHour.indexOf(Math.max(...byHour)), peakD = byDay.indexOf(Math.max(...byDay));
      const weekend = (byDay[0] + byDay[6]) / tot, night = byHour.reduce((a, v, h) => a + (h >= 22 || h < 6 ? v : 0), 0) / tot;
      html += card(useMine ? 'When you commit' : 'When commits happen', `<div class="table-wrap"><table class="tbl compact heat punch"><thead><tr><th></th>${Array.from({ length: 24 }, (_, h) => `<th>${h % 3 === 0 ? h : ''}</th>`).join('')}</tr></thead><tbody>${P.map((row, d) => `<tr><td>${days[d]}</td>${row.map((v, h) => `<td class="hm" style="--a:${v ? 0.12 + 0.88 * (v / maxP) : 0}" data-tip="${attr(`<b>${days[d]} ${h}:00–${h + 1}:00</b><br>${fmtN(v)} commits`)}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="small muted">Busiest: ${days[peakD]}s, around ${peakH}:00. ${fmtPct(weekend)} on weekends, ${fmtPct(night)} between 10pm and 6am. Times are in this computer’s time zone.</p>`, { sub: useMine ? 'Your commits on the default branches, by weekday and hour.' : 'All authors (your commits weren’t recognised; see Methodology).' });
    }
    // my share
    const mine = repos.filter(r => r.history?.contributors?.length).map(r => ({ r, mine: r.history.mine?.commits || 0, total: r.history.contributors.reduce((a, c) => a + c.commits, 0) })).filter(x => x.total).sort((a, b) => b.mine - a.mine).slice(0, 20);
    if (mine.some(x => x.mine)) html += card('Your share of commits', hbars(mine.map(x => ({ label: x.r.name, sub: x.r.owner, value: x.total, href: repoHref(x.r), segs: [{ label: 'You', value: x.mine, color: 'var(--s1)', tip: `<b>${esc(x.r.name)}</b><br>You: ${fmtN(x.mine)} commits (${fmtPct(x.mine / x.total)})` }, { label: 'Others', value: x.total - x.mine, color: 'var(--other)', tip: `<b>${esc(x.r.name)}</b><br>Others: ${fmtN(x.total - x.mine)} commits` }] })), { labelWidth: 170 }) + `<div class="legend"><span class="lg"><i style="background:var(--s1)"></i>You</span><span class="lg"><i style="background:var(--other)"></i>Everyone else</span></div>`);
  } else {
    html += card('Commit history', `<p class="muted">Turn on <b>Fetch commit history</b> when processing to see weekly commits, churn and contributor shares.</p>`);
    html += `</div>`;
  }
  return html;
}

// ============================================================ COMPARE

export function compare(app) {
  const names = app.ui.compare.filter(n => app.repos.some(r => r.fullName === n && r.status === 'ok'));
  const opts = app.repos.filter(r => r.status === 'ok').map(r => `<option value="${attr(r.fullName)}">`).join('');
  let html = `<div class="toolbar"><input class="input" list="cmp-list" id="cmp-add" placeholder="Add a repository to compare (up to 4)…" ${names.length >= 4 ? 'disabled' : ''}><datalist id="cmp-list">${opts}</datalist>${names.map(n => `<span class="chip on">${esc(n)} <button data-cmp-remove="${attr(n)}" aria-label="Remove">×</button></span>`).join('')}</div>`;
  if (!names.length) return html + `<div class="empty-state"><p>Pick repositories above, or use <b>Compare</b> in a repository’s detail panel.</p></div>`;
  const rs = names.map(n => app.repos.find(r => r.fullName === n));
  const ss = rs.map(summarizeRepo);
  const metrics = [
    ['Lines of code', s => s.code, fmtN], ['Code files', s => s.byCat.code.files, fmtN], ['Avg lines per code file', s => s.avgFileLines, fmtN],
    ['Comment ratio', s => s.commentRatio, fmtPct], ['Test share', s => s.testShare, fmtPct], ['Doc words', s => s.proseWords, fmtN],
    ['Doc words per 1K code lines', s => s.code ? s.proseWords / (s.code / 1000) : 0, fmtN], ['Config lines', s => s.configLines, fmtN],
    ['Generated share of bytes', s => s.generatedShare, fmtPct], ['Vendored bytes', s => s.vendoredBytes, fmtBytes], ['Tree size', s => s.total.bytes, fmtBytes],
    ['Files', s => s.total.files, fmtN], ['TODOs', s => s.todos, fmtN], ['Languages', s => Object.keys(s.byLang).length, fmtN], ['Health score', s => s.healthScore, fmtN],
    ['Commits', (s, r) => r.history?.commits ?? r.commitCount, fmtN], ['Contributors', (s, r) => r.history?.contributors?.length, fmtN],
    ['Stars', (s, r) => r.stars, fmtN], ['Created', (s, r) => r.createdAt, fmtDate], ['Last push', (s, r) => r.pushedAt, fmtAgo],
  ];
  html += `<div class="table-wrap"><table class="tbl cmp"><thead><tr><th></th>${rs.map(r => `<th><a href="${repoHref(r)}">${esc(r.fullName)}</a></th>`).join('')}</tr></thead><tbody>
    <tr><td>Composition</td>${ss.map(s => `<td>${stackBar(CATEGORY_ORDER.map(c => ({ label: catLabel(c), value: s.byCat[c].bytes, color: CAT_COLOR[c] })), { legend: false, fmt: fmtBytes })}</td>`).join('')}</tr>
    <tr><td>Languages</td>${ss.map(s => `<td>${stackBar(Object.entries(s.byLang).sort((a, b) => b[1].code - a[1].code).map(([l, v]) => ({ label: l, value: v.code, color: langColor(l) })), { legend: false })}<div class="small muted">${Object.entries(s.byLang).sort((a, b) => b[1].code - a[1].code).slice(0, 3).map(([l, v]) => `${esc(l)} ${fmtPct(v.code / (s.code || 1))}`).join(' · ')}</div></td>`).join('')}</tr>
    ${metrics.map(([l, f, fmt]) => { const vals = ss.map((s, i) => f(s, rs[i])); const nums = vals.filter(v => typeof v === 'number'); const max = Math.max(...nums); return `<tr><td>${l}</td>${vals.map(v => `<td class="num ${typeof v === 'number' && v === max && nums.length > 1 && max > 0 ? 'best' : ''}">${fmt(v)}</td>`).join('')}</tr>`; }).join('')}
  </tbody></table></div>`;
  return html;
}

export function bindCompare(app, root) {
  const inp = $('#cmp-add', root);
  inp?.addEventListener('change', () => {
    const v = inp.value.trim();
    if (app.repos.some(r => r.fullName === v) && !app.ui.compare.includes(v)) { app.ui.compare.push(v); app.saveUi(); app.render(); }
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmp-remove]');
    if (b) { app.ui.compare = app.ui.compare.filter(n => n !== b.dataset.cmpRemove); app.saveUi(); app.render(); }
  });
}

// ============================================================ METHODOLOGY

export function methodology() {
  const cat = (c, body) => `<tr><td><i class="sw" style="background:${CAT_COLOR[c]}"></i><b>${catLabel(c)}</b></td><td>${body}</td></tr>`;
  return `<div class="prose">
  <h2>How the numbers are made</h2>
  <p>Every tracked file at the head of each repository’s default branch is classified into exactly one category, then measured in the unit that means something for that category. Nothing is double counted: a lockfile is never “code”, a licence is never “documentation words” in the headline figure.</p>
  <table class="tbl"><thead><tr><th>Category</th><th>What goes in it, and how it’s measured</th></tr></thead><tbody>
  ${cat('code', 'Hand-maintained source in ~90 languages, including HTML/CSS, SQL, shell, Terraform. <b>Measured in code lines</b>: non-blank lines that aren’t purely comments. Comment and blank lines are counted separately. Sub-divided by purpose from the path: <i>tests</i> (test/, __tests__/, *_test.go, *.spec.ts, test_*.py, *Tests.cs…), <i>examples</i>, <i>scripts &amp; tools</i>, <i>benchmarks</i>, and <i>source</i> for everything else.')}
  ${cat('config', 'Build files and dependency manifests (package.json, pyproject.toml, *.csproj, Makefile, Dockerfile, CMake, Gradle), CI (.github/workflows…), container and deploy (compose, Helm, k8s), lint/format, editor/environment settings, git settings, and other YAML/TOML/JSON/XML/INI. Build manifests written as code (setup.py, vite.config.ts, Gemfile) count here too. <b>Measured in non-blank, non-comment lines.</b>')}
  ${cat('docs', 'Markdown, reStructuredText, AsciiDoc, Org, TeX and plain-text docs, plus the prose cells of Jupyter notebooks. <b>Measured in words</b>: any whitespace-separated token containing a letter. Fenced code samples, URLs, link targets, HTML tags, front matter and comments are removed first, so a 2,000-character one-line paragraph and the same paragraph wrapped across 30 lines count the same. Sub-divided into READMEs, guides, changelogs, community files and licences. Licences are excluded from headline word totals (they’re boilerplate).')}
  ${cat('data', 'Fixtures and test data, datasets (CSV, JSONL…), translation files, and config-format files over 100 KB outside config locations. Measured in bytes and lines.')}
  ${cat('generated', 'Files a tool wrote: lockfiles (uv.lock, package-lock.json, Cargo.lock, go.sum, poetry.lock…), build output (dist/, .next/, bin/Release…), source maps, minified bundles, test snapshots, ORM migrations, protobuf/gRPC/OpenAPI codegen, designer files, anything marked <code>linguist-generated</code> in .gitattributes, and any file whose first lines say it is generated (“DO NOT EDIT”, “@generated”, “This file was automatically generated”…). <b>Measured in bytes</b>; excluded from all line totals.')}
  ${cat('assets', 'Images, SVG, fonts, audio, video, archives, binaries, Office/PDF documents, CAD/3D and ML model files. Bytes only; never downloaded.')}
  ${cat('vendored', 'Third-party code checked into the repo: node_modules/, vendor/, third_party/, Pods/, .venv/, well-known libraries such as jquery.min.js, and anything marked <code>linguist-vendored</code>. Bytes only.')}
  ${cat('other', 'Text files nothing else recognised. Lines and words are counted so you can spot what to classify.')}
  </tbody></table>
  <h3>Overrides</h3>
  <p>The same <code>.gitattributes</code> attributes GitHub Linguist uses are honoured: <code>linguist-generated</code>, <code>linguist-vendored</code>, <code>linguist-documentation</code>, <code>linguist-language=…</code>, plus <code>binary</code>. Add them to a repo to correct a misclassification; the next processing run picks them up.</p>
  <h3>Comment counting</h3>
  <p>A small lexer per language family handles line comments, block comments (nested where the language allows), and string literals, so <code>"http://…"</code> isn’t mistaken for a comment. Python docstrings count as comments. A line with both code and a trailing comment is a code line. TODO / FIXME / HACK / XXX are counted inside comments.</p>
  <h3>Health score</h3>
  <p>A weighted checklist out of 100: README 20, tests 20, LICENSE 15 (public repos only), CI 15, docs beyond the README 10, .gitignore 5, lint config 5, CONTRIBUTING 5, changelog 5. It measures hygiene, not quality.</p>
  <h3>Limits</h3>
  <ul>
    <li>Text files over 1 MB aren’t read. Over-1 MB “code” is treated as generated (it’s almost always a bundle or amalgamation); other large files as data.</li>
    <li>Commit history covers the default branch only, excludes merge commits, and its added/removed line counts include generated files.</li>
    <li>Submodules and symlinks aren’t followed. Git LFS pointer files are counted as small text files.</li>
    <li>Language detection is by file name, extension and shebang. MATLAB vs Objective-C <code>.m</code> files are distinguished by content.</li>
  </ul>
  <h3>Your commits</h3>
  <p>A commit is yours if its author email is your git <code>user.email</code>, one of your GitHub account emails, or your GitHub noreply address, or if the author name matches your GitHub login or name. Emails are only compared, never stored.</p>
  <h3>Privacy</h3>
  <p>Everything runs on this computer. The local server lists repositories through the GitHub CLI, clones them with git (authenticating through the CLI, so this app never handles a token), and writes results to <code>report.json</code> in its data folder. Author emails are never recorded. Nothing is sent anywhere unless you export it.</p>
  </div>`;
}
