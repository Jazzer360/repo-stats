// Small DOM/formatting helpers and dependency-free charts (HTML/SVG strings).

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const attr = esc;
export const fmtN = (n) => n == null || Number.isNaN(n) ? '–' : Math.round(n).toLocaleString();
export function fmtK(n) {
  if (n == null) return '–';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(0) + 'K';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}
export const fmtPct = (x, d) => x == null || !isFinite(x) ? '–' : `${(x * 100).toFixed(d ?? (x !== 0 && Math.abs(x) < 0.1 ? 1 : 0))}%`;
export { fmtBytes, fmtDuration } from './engine/aggregate.js';
export function fmtDate(s) { return s ? new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '–'; }
export function fmtAgo(s) {
  if (!s) return '–';
  const d = (Date.now() - Date.parse(s)) / 864e5;
  if (d < 1) return 'today';
  if (d < 2) return 'yesterday';
  if (d < 45) return `${Math.round(d)} days ago`;
  if (d < 365 * 1.5) return `${Math.round(d / 30.4)} months ago`;
  return `${(d / 365).toFixed(1)} years ago`;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// -------------------------------------------------------------- colours

export const CAT_COLOR = {
  code: 'var(--s1)', config: 'var(--s2)', docs: 'var(--s3)', data: 'var(--s4)',
  generated: 'var(--s5)', assets: 'var(--s6)', vendored: 'var(--s7)', other: 'var(--other)',
};
export const KIND_COLOR = { source: 'var(--s1)', test: 'var(--s2)', example: 'var(--s3)', script: 'var(--s4)', bench: 'var(--s5)' };
const LANG_SLOTS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)'];
let langColorMap = {};
/** Assign slots by rank over the whole dataset once, so filtering never repaints a language. */
export function setLanguageRanking(names) {
  langColorMap = {};
  names.slice(0, LANG_SLOTS.length).forEach((n, i) => { langColorMap[n] = LANG_SLOTS[i]; });
}
export const langColor = (name) => langColorMap[name] || 'var(--other)';
export const isTopLang = (name) => name in langColorMap;

// -------------------------------------------------------------- charts

/** Single 100% stacked bar with legend. segs: [{label, value, color, tip?}] */
export function stackBar(segs, { fmt = fmtN, legend = true, height = 14, unit = '' } = {}) {
  const total = segs.reduce((a, s) => a + (s.value || 0), 0);
  if (!total) return '<div class="empty-note">No data</div>';
  const parts = segs.filter(s => s.value > 0).map(s => {
    const pct = (s.value / total) * 100;
    const tip = s.tip || `<b>${esc(s.label)}</b><br>${fmt(s.value)}${unit} · ${pct.toFixed(1)}%`;
    return `<span class="seg" style="flex:${s.value} 1 0;background:${s.color}" data-tip="${attr(tip)}"></span>`;
  }).join('');
  const leg = legend ? `<div class="legend">${segs.filter(s => s.value > 0).map(s => `<span class="lg"><i style="background:${s.color}"></i>${esc(s.label)} <span class="muted">${((s.value / total) * 100).toFixed(1)}%</span></span>`).join('')}</div>` : '';
  return `<div class="stackbar" style="height:${height}px">${parts}</div>${leg}`;
}

/** Horizontal bars. rows: [{label, value, color, sub?, href?, tip?, segs?}] */
export function hbars(rows, { fmt = fmtN, max, labelWidth = 150, valueLabel = (r) => fmt(r.value), empty = 'No data' } = {}) {
  if (!rows.length) return `<div class="empty-note">${empty}</div>`;
  const m = max ?? Math.max(...rows.map(r => r.value), 1);
  return `<div class="hbars" style="--lw:${labelWidth}px">${rows.map(r => {
    const w = Math.max(0.004, r.value / m);
    const bar = r.segs
      ? `<span class="hb-bar hb-stack" style="width:calc((100% - var(--vw)) * ${w.toFixed(4)})">${r.segs.filter(s => s.value > 0).map(s => `<span style="flex:${s.value} 1 0;background:${s.color}" data-tip="${attr(s.tip || `<b>${esc(s.label)}</b><br>${fmt(s.value)}`)}"></span>`).join('')}</span>`
      : `<span class="hb-bar" style="width:calc((100% - var(--vw)) * ${w.toFixed(4)});background:${r.color || 'var(--s1)'}" data-tip="${attr(r.tip || `<b>${esc(r.label)}</b><br>${fmt(r.value)}`)}"></span>`;
    const label = r.href ? `<a href="${attr(r.href)}">${esc(r.label)}</a>` : esc(r.label);
    return `<div class="hb-row"><span class="hb-label" title="${attr(r.label)}">${label}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span><span class="hb-track">${bar}<span class="hb-val">${valueLabel(r)}</span></span></div>`;
  }).join('')}</div>`;
}

/** Vertical columns. points: [{label, value, tip?, color?}] */
export function columns(points, { fmt = fmtN, height = 160, color = 'var(--s1)', labelEvery = 1, yTicks = true } = {}) {
  if (!points.length) return '<div class="empty-note">No data</div>';
  const raw = Math.max(...points.map(p => p.value), 1);
  const max = raw < 4 ? Math.ceil(raw) : niceMax(raw);
  const ticks = yTicks ? (max < 4 ? [0, max] : [0, max / 2, max]) : [];
  const cols = points.map((p, i) => {
    const h = (p.value / max) * 100;
    return `<div class="col" data-tip="${attr(p.tip || `<b>${esc(p.label)}</b><br>${fmt(p.value)}`)}"><span class="col-bar" style="height:${h}%;background:${p.color || color}"></span><span class="col-label">${i % labelEvery === 0 ? esc(p.label) : ''}</span></div>`;
  }).join('');
  return `<div class="columns" style="height:${height}px">${yTicks ? `<div class="col-axis">${[...ticks].reverse().map(t => `<span>${fmtK(t)}</span>`).join('')}</div>` : ''}<div class="col-plot"><div class="col-grid">${ticks.map(t => `<i style="bottom:${(t / max) * 100}%"></i>`).join('')}</div>${cols}</div></div>`;
}

/** Up/down weekly columns: additions above the axis, deletions below. weeks: [[ts, add, del, commits]] */
export function diverging(weeks, { height = 160, upLabel = 'Additions', downLabel = 'Deletions' } = {}) {
  if (!weeks.length) return '<div class="empty-note">No history</div>';
  const maxUp = Math.max(...weeks.map(w => w[1]), 1), maxDn = Math.max(...weeks.map(w => w[2]), 1);
  // clip extreme weeks (mass imports) to the 98th percentile so normal weeks are visible
  const clip = (arr) => { const s = [...arr].sort((a, b) => a - b); return Math.max(1, s[Math.floor(s.length * 0.98)] || s.at(-1)); };
  const capUp = Math.min(maxUp, clip(weeks.map(w => w[1]))), capDn = Math.min(maxDn, clip(weeks.map(w => w[2])));
  const cap = Math.max(capUp, capDn);
  const cols = weeks.map(w => {
    const up = Math.min(1, w[1] / cap) * 50, dn = Math.min(1, w[2] / cap) * 50;
    const tip = `<b>Week of ${new Date(w[0] * 1000).toLocaleDateString()}</b><br>+${fmtN(w[1])} / −${fmtN(w[2])} lines<br>${fmtN(w[3])} commits`;
    return `<div class="dv" data-tip="${attr(tip)}"><span class="dv-up" style="height:${up}%"></span><span class="dv-dn" style="height:${dn}%"></span></div>`;
  }).join('');
  const first = new Date(weeks[0][0] * 1000), last = new Date(weeks.at(-1)[0] * 1000);
  return `<div class="diverging" style="height:${height}px">${cols}<i class="dv-axis"></i></div>
    <div class="axis-row"><span>${first.toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}</span><span>${last.toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}</span></div>
    <div class="legend"><span class="lg"><i style="background:var(--s1)"></i>${upLabel}</span><span class="lg"><i style="background:var(--s8)"></i>${downLabel}</span><span class="muted small">Weeks above the 98th percentile are clipped.</span></div>`;
}

/** Line/area chart in SVG with hover slices. series: [{name, color, points: [[x(ms), y]]}] */
export function lineChart(series, { height = 180, fmt = fmtN, xfmt = (x) => new Date(x).toLocaleDateString(), area = true } = {}) {
  const all = series.flatMap(s => s.points);
  if (!all.length) return '<div class="empty-note">No data</div>';
  const W = 800, H = height, P = { l: 44, r: 10, t: 10, b: 22 };
  const xs = all.map(p => p[0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
  const ymax = niceMax(Math.max(...all.map(p => p[1]), 1));
  const X = (x) => P.l + ((x - x0) / (x1 - x0 || 1)) * (W - P.l - P.r);
  const Y = (y) => H - P.b - (y / ymax) * (H - P.t - P.b);
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="linechart" preserveAspectRatio="none" role="img">`;
  for (const t of [0, 0.5, 1]) svg += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(ymax * t)}" y2="${Y(ymax * t)}" class="gridline"/><text x="${P.l - 6}" y="${Y(ymax * t) + 4}" class="tick" text-anchor="end">${fmtK(ymax * t)}</text>`;
  for (const s of series) {
    if (!s.points.length) continue;
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    if (area && series.length === 1) svg += `<path d="${d}L${X(s.points.at(-1)[0])},${Y(0)}L${X(s.points[0][0])},${Y(0)}Z" fill="${s.color}" opacity="0.12"/>`;
    svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  }
  svg += `<text x="${P.l}" y="${H - 4}" class="tick">${esc(xfmt(x0))}</text><text x="${W - P.r}" y="${H - 4}" class="tick" text-anchor="end">${esc(xfmt(x1))}</text>`;
  // hover slices from the first series' x positions
  const base = series[0].points;
  base.forEach((p, i) => {
    const xa = i ? (X(base[i - 1][0]) + X(p[0])) / 2 : P.l;
    const xb = i < base.length - 1 ? (X(p[0]) + X(base[i + 1][0])) / 2 : W - P.r;
    const tip = `<b>${esc(xfmt(p[0]))}</b>` + series.map(s => { const q = s.points.find(q => q[0] === p[0]); return q ? `<br><i class="sw" style="background:${s.color}"></i>${esc(s.name)}: ${fmt(q[1])}` : ''; }).join('');
    svg += `<rect class="slice" x="${xa}" y="${P.t}" width="${Math.max(0.5, xb - xa)}" height="${H - P.t - P.b}" data-tip="${attr(tip)}"/>`;
  });
  svg += '</svg>';
  const legend = series.length > 1 ? `<div class="legend">${series.map(s => `<span class="lg"><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return svg + legend;
}

/** GitHub-style contribution calendar. days: [[YYYY-MM-DD, count]] */
export function calendar(days) {
  if (!days.length) return '<div class="empty-note">No contribution data</div>';
  const counts = days.map(d => d[1]).filter(Boolean).sort((a, b) => a - b);
  const q = (p) => counts[Math.floor(counts.length * p)] || 1;
  const steps = [q(0.25), q(0.5), q(0.75)];
  const level = (c) => (c === 0 ? 0 : c <= steps[0] ? 1 : c <= steps[1] ? 2 : c <= steps[2] ? 3 : 4);
  const first = new Date(days[0][0] + 'T00:00:00Z').getUTCDay();
  const cells = [];
  for (let i = 0; i < first; i++) cells.push('<i class="cal-pad"></i>');
  for (const [d, c] of days) cells.push(`<i class="cal l${level(c)}" data-tip="${attr(`<b>${fmtN(c)} contribution${c === 1 ? '' : 's'}</b><br>${new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}`)}"></i>`);
  return `<div class="calendar">${cells.join('')}</div><div class="legend cal-legend"><span class="muted small">Less</span>${[0, 1, 2, 3, 4].map(l => `<i class="cal l${l}"></i>`).join('')}<span class="muted small">More</span></div>`;
}

/** Squarified treemap of a dir node. metric(node) -> number. */
export function treemap(node, { metric, color, height = 380, onTip }) {
  const kids = [...node.children.values()].map(c => ({ c, v: metric(c) })).filter(k => k.v > 0).sort((a, b) => b.v - a.v);
  if (!kids.length) return '<div class="empty-note">Nothing to show at this level</div>';
  const rects = [];
  squarify(kids, 0, 0, 1000, 1000, rects);
  return `<div class="treemap" style="height:${height}px">${rects.map(({ k, x, y, w, h }) => {
    const n = k.c;
    const isDir = n.children.size > 0;
    const label = w > 60 && h > 40 ? `<span>${esc(n.name)}${isDir ? '/' : ''}</span>` : '';
    return `<div class="tm ${isDir ? 'tm-dir' : ''}" data-path="${attr(n.path)}" style="left:${x / 10}%;top:${y / 10}%;width:${w / 10}%;height:${h / 10}%;background:${color(n)}" data-tip="${attr(onTip(n))}">${label}</div>`;
  }).join('')}</div>`;
}
function squarify(items, x, y, w, h, out) {
  const total = items.reduce((a, b) => a + b.v, 0);
  if (!items.length) return;
  if (items.length === 1) { out.push({ k: items[0], x, y, w, h }); return; }
  const short = Math.min(w, h);
  const area = (v) => (v / total) * w * h;
  let row = [], best = Infinity, i = 0;
  while (i < items.length) {
    const cand = [...row, items[i]];
    const s = cand.reduce((a, b) => a + area(b.v), 0);
    const worst = Math.max(...cand.map(c => Math.max((short * short * area(c.v)) / (s * s), (s * s) / (short * short * area(c.v)))));
    if (worst > best && row.length) break;
    row = cand; best = worst; i++;
  }
  const rowSum = row.reduce((a, b) => a + area(b.v), 0);
  if (w >= h) {
    const rw = rowSum / h; let yy = y;
    for (const r of row) { const rh = area(r.v) / rw; out.push({ k: r, x, y: yy, w: rw, h: rh }); yy += rh; }
    squarify(items.slice(i), x + rw, y, w - rw, h, out);
  } else {
    const rh = rowSum / w; let xx = x;
    for (const r of row) { const rw = area(r.v) / rh; out.push({ k: r, x: xx, y, w: rw, h: rh }); xx += rw; }
    squarify(items.slice(i), x, y + rh, w, h - rh, out);
  }
}

export function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function tile(label, value, sub = '', tip = '') {
  return `<div class="tile"${tip ? ` data-tip="${attr(tip)}"` : ''}><div class="tile-label">${esc(label)}</div><div class="tile-value">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}</div>`;
}

export function card(title, body, { sub = '', actions = '', cls = '' } = {}) {
  return `<section class="card ${cls}"><header class="card-h"><div><h3>${title}</h3>${sub ? `<p class="card-sub">${sub}</p>` : ''}</div>${actions ? `<div class="card-actions">${actions}</div>` : ''}</header><div class="card-b">${body}</div></section>`;
}

// -------------------------------------------------------------- tooltip

export function installTooltip() {
  const tip = document.createElement('div');
  tip.id = 'tip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  let cur = null;
  const place = (e) => {
    const pad = 14, r = tip.getBoundingClientRect();
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
    tip.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
  };
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (t === cur) return;
    cur = t;
    if (!t) { tip.classList.remove('show'); return; }
    tip.innerHTML = t.getAttribute('data-tip');
    tip.classList.add('show');
    place(e);
  });
  document.addEventListener('mousemove', (e) => { if (cur) place(e); });
  document.addEventListener('scroll', () => { tip.classList.remove('show'); cur = null; }, true);
}

export function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function toCsv(rows) {
  const q = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return rows.map(r => r.map(q).join(',')).join('\n');
}
