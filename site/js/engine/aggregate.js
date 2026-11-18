// Roll-ups over per-file records. Pure functions, no DOM.

import { CATEGORY_ORDER } from './languages.js';

const blankStats = () => ({ files: 0, bytes: 0, lines: 0, code: 0, comment: 0, blank: 0, words: 0, todos: 0 });
function add(s, f) {
  s.files++; s.bytes += f.s; s.lines += f.n || 0; s.code += f.cd || 0; s.comment += f.cm || 0;
  s.blank += f.bl || 0; s.words += f.w || 0; s.todos += f.t || 0;
}
function merge(a, b) { for (const k in b) a[k] = (a[k] || 0) + b[k]; return a; }

const cache = new WeakMap();

/** Full summary of one analyzed repo (memoised per repo object). */
export function summarizeRepo(repo) {
  if (cache.has(repo)) return cache.get(repo);
  const files = repo.files || [];
  const byCat = Object.fromEntries(CATEGORY_ORDER.map(c => [c, blankStats()]));
  const byLang = {};          // code-category languages only
  const byKind = {};          // `${cat}/${kind}`
  const configByLang = {};
  const docsByKind = {};
  let notebooks = 0;
  const health = {
    readme: false, license: false, tests: false, ci: false, gitignore: false, docs: false,
    contributing: false, changelog: false, lint: false, container: false, lockfile: false,
  };
  let longest = null, largest = null;
  for (const f of files) {
    add(byCat[f.c] || (byCat[f.c] = blankStats()), f);
    const kk = `${f.c}/${f.k}`;
    add(byKind[kk] || (byKind[kk] = blankStats()), f);
    if (f.c === 'code' || (f.c === 'docs' && f.k === 'notebook')) {
      const l = f.c === 'docs' ? (f.x?.nbLang || 'Python') : (f.l || 'Unknown');
      if (f.cd || f.c === 'code') add(byLang[l] || (byLang[l] = blankStats()), { ...f, w: 0 });
      if (f.k === 'notebook') notebooks++;
    }
    if (f.c === 'config') add(configByLang[f.l || 'Other'] || (configByLang[f.l || 'Other'] = blankStats()), f);
    if (f.c === 'docs') add(docsByKind[f.k] || (docsByKind[f.k] = blankStats()), f);
    if (f.c === 'code' && (!longest || (f.cd || 0) > (longest.cd || 0))) longest = f;
    if (!largest || f.s > largest.s) largest = f;
    const depth = f.p.split('/').length;
    if (f.k === 'readme' && depth === 1) health.readme = true;
    if (f.k === 'readme' && depth <= 2 && /^(\.github|docs?)\//i.test(f.p)) health.readme = true;
    if (f.k === 'legal' && /^(licen[cs]e|copying)/i.test(f.p.split('/').pop()) && depth <= 2) health.license = true;
    if (f.c === 'code' && f.k === 'test') health.tests = true;
    if (f.c === 'config' && f.k === 'ci') health.ci = true;
    if (f.p === '.gitignore') health.gitignore = true;
    if (f.c === 'docs' && f.k === 'guide') health.docs = true;
    if (f.k === 'community' && /contributing/i.test(f.p)) health.contributing = true;
    if (f.k === 'changelog') health.changelog = true;
    if (f.c === 'config' && f.k === 'lint') health.lint = true;
    if (f.c === 'config' && f.k === 'deploy') health.container = true;
    if (f.k === 'lockfile') health.lockfile = true;
  }
  const code = byCat.code;
  const codeKinds = {};
  for (const k of ['source', 'test', 'example', 'script', 'bench']) codeKinds[k] = byKind[`code/${k}`] || blankStats();
  const langs = Object.entries(byLang).sort((a, b) => b[1].code - a[1].code);
  const total = Object.values(byCat).reduce((a, s) => merge(a, { ...s }), blankStats());
  const s = {
    byCat, byLang, byKind, configByLang, docsByKind, codeKinds, notebooks, health, longest, largest, total,
    primaryLang: langs[0]?.[0] || null,
    code: code.code,
    commentRatio: code.code + code.comment ? code.comment / (code.code + code.comment) : 0,
    testShare: code.code ? codeKinds.test.code / code.code : 0,
    docWords: byCat.docs.words,
    proseWords: (byCat.docs.words || 0) - (docsByKind.legal?.words || 0),
    configLines: byCat.config.code,
    generatedBytes: byCat.generated.bytes,
    generatedShare: total.bytes ? byCat.generated.bytes / total.bytes : 0,
    vendoredBytes: byCat.vendored.bytes,
    todos: total.todos,
    avgFileLines: code.files ? code.code / code.files : 0,
    healthScore: 0,
  };
  // health score: weighted checklist, out of 100
  const weights = { readme: 20, license: repo.private ? 0 : 15, tests: 20, ci: 15, gitignore: 5, docs: 10, lint: 5, contributing: 5, changelog: 5 };
  const max = Object.values(weights).reduce((a, b) => a + b, 0);
  let got = 0;
  for (const [k, w] of Object.entries(weights)) if (health[k]) got += w;
  s.healthScore = Math.round((got / max) * 100);
  cache.set(repo, s);
  return s;
}

/** Aggregate many repos into account-level totals. */
export function summarizeMany(repos) {
  const byCat = Object.fromEntries(CATEGORY_ORDER.map(c => [c, blankStats()]));
  const byLang = {};
  const byKind = {};
  const docsByKind = {};
  const configByLang = {};
  const langRepos = {};
  const codeKinds = {};
  let commits = 0, myCommits = 0, notebooks = 0;
  const healthCounts = {};
  for (const r of repos) {
    const s = summarizeRepo(r);
    for (const c in s.byCat) merge(byCat[c] || (byCat[c] = blankStats()), s.byCat[c]);
    for (const l in s.byLang) { merge(byLang[l] || (byLang[l] = blankStats()), s.byLang[l]); (langRepos[l] ||= []).push(r); }
    for (const k in s.byKind) merge(byKind[k] || (byKind[k] = blankStats()), s.byKind[k]);
    for (const k in s.docsByKind) merge(docsByKind[k] || (docsByKind[k] = blankStats()), s.docsByKind[k]);
    for (const k in s.configByLang) merge(configByLang[k] || (configByLang[k] = blankStats()), s.configByLang[k]);
    for (const k in s.codeKinds) merge(codeKinds[k] || (codeKinds[k] = blankStats()), s.codeKinds[k]);
    for (const k in s.health) healthCounts[k] = (healthCounts[k] || 0) + (s.health[k] ? 1 : 0);
    commits += r.history?.commits || r.commitCount || 0;
    myCommits += r.history?.mine?.commits || 0;
    notebooks += s.notebooks;
  }
  const code = byCat.code;
  const total = Object.values(byCat).reduce((a, s) => merge(a, { ...s }), blankStats());
  return {
    repos: repos.length, byCat, byLang, byKind, docsByKind, configByLang, langRepos, codeKinds, healthCounts, total,
    commits, myCommits, notebooks,
    commentRatio: code.code + code.comment ? code.comment / (code.code + code.comment) : 0,
    testShare: code.code ? (codeKinds.test?.code || 0) / code.code : 0,
  };
}

/** Directory tree with rolled-up stats, for treemaps and the file browser. */
export function buildTree(files, filter = () => true) {
  const root = { name: '', path: '', children: new Map(), stats: blankStats(), cats: {}, file: null };
  for (const f of files) {
    if (!filter(f)) continue;
    const parts = f.p.split('/');
    let node = root;
    add(node.stats, f); node.cats[f.c] = (node.cats[f.c] || 0) + f.s;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      let child = node.children.get(name);
      if (!child) {
        child = { name, path: parts.slice(0, i + 1).join('/'), children: new Map(), stats: blankStats(), cats: {}, file: null };
        node.children.set(name, child);
      }
      add(child.stats, f); child.cats[f.c] = (child.cats[f.c] || 0) + f.s;
      if (i === parts.length - 1) child.file = f;
      node = child;
    }
  }
  return root;
}

/** Sum weekly history across repos -> sorted [[weekTs, additions, deletions, commits]] */
export function mergeWeekly(repos) {
  const m = new Map();
  for (const r of repos) for (const [w, a, d, c] of r.history?.weekly || []) {
    const cur = m.get(w) || [w, 0, 0, 0];
    cur[1] += a; cur[2] += d; cur[3] += c; m.set(w, cur);
  }
  return [...m.values()].sort((a, b) => a[0] - b[0]);
}

/** Plain-language findings, most interesting first. */
export function insights(repos, agg, viewer) {
  const out = [];
  if (!repos.length) return out;
  const pct = (x) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
  const fmt = (n) => Math.round(n).toLocaleString();
  const langs = Object.entries(agg.byLang).sort((a, b) => b[1].code - a[1].code);
  const code = agg.byCat.code.code;
  if (langs.length && code) {
    const [l, s] = langs[0];
    out.push({ icon: 'lang', text: `<b>${l}</b> is ${pct(s.code / code)} of all maintained code (${fmt(s.code)} lines across ${agg.langRepos[l].length} repo${agg.langRepos[l].length === 1 ? '' : 's'}).` });
  }
  const sums = repos.map(r => [r, summarizeRepo(r)]);
  const byCode = sums.filter(([, s]) => s.code > 0).sort((a, b) => b[1].code - a[1].code);
  if (byCode.length > 1 && code) {
    const top = byCode.slice(0, Math.max(1, Math.ceil(byCode.length * 0.2)));
    const share = top.reduce((a, [, s]) => a + s.code, 0) / code;
    out.push({ icon: 'pareto', text: `The top ${top.length} repo${top.length === 1 ? '' : 's'} (20%) hold ${pct(share)} of the code. Biggest: <b>${byCode[0][0].name}</b> with ${fmt(byCode[0][1].code)} lines.` });
  }
  const gen = agg.byCat.generated.bytes, tot = agg.total.bytes;
  if (gen && tot) {
    const lock = agg.byKind['generated/lockfile']?.bytes || 0;
    out.push({ icon: 'gen', text: `Generated files are ${pct(gen / tot)} of tracked bytes; lockfiles alone are ${fmtBytes(lock)}. They're excluded from line counts.` });
  }
  if (agg.byCat.vendored.bytes) out.push({ icon: 'vendor', text: `${fmtBytes(agg.byCat.vendored.bytes)} of vendored third-party code is checked in across ${sums.filter(([, s]) => s.byCat.vendored.files).length} repo(s).` });
  const noTests = sums.filter(([, s]) => s.code > 200 && !s.health.tests);
  if (noTests.length) out.push({ icon: 'warn', text: `${noTests.length} repo${noTests.length === 1 ? ' has' : 's have'} over 200 lines of code and no recognisable tests${noTests.length <= 4 ? ': ' + noTests.map(([r]) => `<b>${r.name}</b>`).join(', ') : ''}.` });
  const noReadme = sums.filter(([, s]) => !s.health.readme && s.total.files > 0);
  if (noReadme.length) out.push({ icon: 'warn', text: `${noReadme.length} repo${noReadme.length === 1 ? ' has' : 's have'} no README at the root.` });
  const pubNoLicense = sums.filter(([r, s]) => r.private === false && !r.fork && !s.health.license && s.code > 0);
  if (pubNoLicense.length) out.push({ icon: 'warn', text: `${pubNoLicense.length} public repo${pubNoLicense.length === 1 ? ' has' : 's have'} no LICENSE file, so others can't legally reuse the code.` });
  if (code) out.push({ icon: 'comment', text: `${pct(agg.commentRatio)} of non-blank code lines are comments. Tests are ${pct(agg.testShare)} of code lines.` });
  const commented = byCode.filter(([, s]) => s.code > 500).sort((a, b) => b[1].commentRatio - a[1].commentRatio);
  if (commented.length > 2) out.push({ icon: 'comment', text: `Most commented: <b>${commented[0][0].name}</b> (${pct(commented[0][1].commentRatio)}). Least: <b>${commented.at(-1)[0].name}</b> (${pct(commented.at(-1)[1].commentRatio)}).` });
  const words = agg.byCat.docs.words - (agg.docsByKind.legal?.words || 0);
  if (words) out.push({ icon: 'docs', text: `${fmt(words)} words of documentation (excluding licences), about ${fmtDuration(words / 238)} of reading. That's ${fmt(code ? words / (code / 1000) : 0)} words per 1,000 lines of code.` });
  const now = Date.now();
  const stale = repos.filter(r => r.pushedAt && now - Date.parse(r.pushedAt) > 365 * 864e5 && !r.archived);
  if (stale.length) out.push({ icon: 'clock', text: `${stale.length} non-archived repo${stale.length === 1 ? ' has' : 's have'} not been pushed to in over a year. Consider archiving.` });
  if (agg.total.todos) {
    const worst = sums.sort((a, b) => b[1].todos - a[1].todos)[0];
    out.push({ icon: 'todo', text: `${fmt(agg.total.todos)} TODO / FIXME / HACK comments; <b>${worst[0].name}</b> has the most (${fmt(worst[1].todos)}).` });
  }
  if (agg.myCommits && agg.commits) out.push({ icon: 'me', text: `You authored ${fmt(agg.myCommits)} of the ${fmt(agg.commits)} commits (${pct(agg.myCommits / agg.commits)}) on the default branches analyzed.` });
  return out;
}

export function fmtBytes(b) {
  if (b == null) return '–';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
export function fmtDuration(minutes) {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  if (h < 24) return `${h.toFixed(h < 10 ? 1 : 0)} hours`;
  return `${(h / 8).toFixed(0)} working days`;
}
