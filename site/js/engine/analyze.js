// Turns a repository's file list into per-file records, reading contents only
// where needed. The content source is injected so the same pipeline runs on the
// GitHub API (browser) and on a local clone (CLI).

import { classifyPath, parseGitattributes, isGitattributes, MAX_CONTENT_BYTES } from './classify.js';
import { analyzeContent } from './count.js';

/**
 * entries: [{ path, size }] blobs only (no trees / submodules)
 * readMany: async (entries[]) => Map(path -> text|null)
 * opts: { maxContentBytes, batchBytes, batchFiles, onProgress(done,total) }
 * returns [{ p, s, c, k, l, n?, cd?, cm?, bl?, w?, t?, x? }]
 */
export async function analyzeEntries(entries, readMany, opts = {}) {
  const maxContentBytes = opts.maxContentBytes ?? MAX_CONTENT_BYTES;
  const batchBytes = opts.batchBytes ?? 1.5 * 1024 * 1024;
  const batchFiles = opts.batchFiles ?? 60;

  // 1. .gitattributes (root and nested) first, since they override everything.
  const attrFiles = entries.filter(e => isGitattributes(e.path) && e.size < 256 * 1024);
  let rules = [];
  if (attrFiles.length) {
    const texts = await readMany(attrFiles);
    for (const e of attrFiles) {
      const t = texts.get(e.path);
      if (t) {
        const dir = e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : '';
        rules = rules.concat(parseGitattributes(t, dir));
      }
    }
  }

  // 2. classify by path
  const recs = entries.map(e => {
    const r = classifyPath(e.path, e.size, rules, { maxContentBytes });
    return { e, r };
  });

  // 3. read what needs reading, in batches
  const toRead = recs.filter(x => x.r.read);
  const total = toRead.length;
  let done = 0;
  const batches = [];
  let cur = [], curBytes = 0;
  for (const x of toRead) {
    if (cur.length && (cur.length >= batchFiles || curBytes + x.e.size > batchBytes)) { batches.push(cur); cur = []; curBytes = 0; }
    cur.push(x); curBytes += x.e.size;
  }
  if (cur.length) batches.push(cur);

  const results = new Map();
  const concurrency = opts.concurrency ?? 3;
  let bi = 0;
  async function worker() {
    while (bi < batches.length) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const batch = batches[bi++];
      const texts = await readMany(batch.map(x => x.e));
      for (const x of batch) results.set(x.e.path, texts.get(x.e.path) ?? null);
      done += batch.length;
      opts.onProgress?.(done, total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));

  // 4. content analysis
  const files = [];
  for (const { e, r } of recs) {
    let a = { cat: r.cat, kind: r.kind, lang: r.lang, path: e.path };
    if (r.read) a = analyzeContent(a, results.get(e.path));
    const f = { p: e.path, s: e.size, c: a.cat, k: a.kind };
    if (a.lang) f.l = a.lang;
    for (const key of ['n', 'cd', 'cm', 'bl', 'w', 't', 'x']) if (a[key] != null && a[key] !== 0) f[key] = a[key];
    files.push(f);
  }
  return files;
}
