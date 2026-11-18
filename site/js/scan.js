// Orchestrates a processing run against the GitHub API: list repos in the
// chosen scopes, skip ones whose default-branch head hasn't changed since the
// cached analysis, analyze the rest, persist each as it finishes.

import { listRepos, fetchTree, makeBlobReader, fetchHistory } from './github.js';
import { analyzeEntries } from './engine/analyze.js';
import { ENGINE_VERSION } from './engine/classify.js';
import { saveRepo } from './store.js';

/**
 * opts: { scopes: { personal: bool, collaborator: bool, orgs: [login] },
 *         includeForks, includeArchived, history, maxRepoMb, force, signal }
 * cb:   { onList(repos), onRepoStart(r), onRepoProgress(r, done, total, phase), onRepoDone(r, rec), onLog(msg) }
 */
export async function runScan(gh, dataset, viewer, cached, opts, cb) {
  const signal = opts.signal;
  const seen = new Map();
  const add = (list) => { for (const r of list) if (!seen.has(r.fullName)) seen.set(r.fullName, r); };
  const aff = [];
  if (opts.scopes.personal) aff.push('OWNER');
  if (opts.scopes.collaborator) aff.push('COLLABORATOR');
  if (aff.length) { cb.onLog?.('Listing your repositories…'); add(await listRepos(gh, { affiliations: aff, signal })); }
  for (const org of opts.scopes.orgs || []) {
    cb.onLog?.(`Listing ${org} repositories…`);
    try { add(await listRepos(gh, { org, signal })); }
    catch (e) { cb.onLog?.(`Could not list ${org}: ${e.message}. The org may restrict third-party app access.`); }
  }
  let repos = [...seen.values()];
  repos = repos.filter(r => (opts.includeForks || !r.fork) && (opts.includeArchived || !r.archived));
  cb.onList?.(repos);

  const cachedBy = new Map(cached.map(r => [r.fullName, r]));
  const queue = [];
  for (const r of repos) {
    const c = cachedBy.get(r.fullName);
    const wantHistory = !!opts.history;
    const fresh = c && c.status === 'ok' && c.headOid === r.headOid && c.engine === ENGINE_VERSION && (!wantHistory || c.history);
    if (fresh && !opts.force) {
      // metadata (stars, issues…) may have changed even if code didn't
      const merged = { ...c, ...r, files: c.files, history: c.history, status: c.status, analyzedAt: c.analyzedAt, engine: c.engine };
      await saveRepo(dataset, merged);
      cb.onRepoDone?.(r, merged, true);
    } else queue.push(r);
  }

  let i = 0;
  async function worker() {
    while (i < queue.length) {
      if (signal?.aborted) return;
      const r = queue[i++];
      cb.onRepoStart?.(r);
      const rec = { ...r, engine: ENGINE_VERSION, analyzedAt: new Date().toISOString(), files: [], history: null };
      try {
        if (r.empty || !r.headOid) rec.status = 'empty';
        else if (opts.maxRepoMb && r.diskKb > opts.maxRepoMb * 1024) { rec.status = 'skipped'; rec.error = `Repository is ${Math.round(r.diskKb / 1024)} MB on disk, over the ${opts.maxRepoMb} MB limit.`; }
        else {
          cb.onRepoProgress?.(r, 0, 1, 'tree');
          const tree = await fetchTree(gh, r, signal);
          rec.truncated = tree.truncated; rec.submodules = tree.submodules; rec.symlinks = tree.symlinks;
          rec.files = await analyzeEntries(tree.entries, makeBlobReader(gh, r, signal), {
            signal, concurrency: 2,
            onProgress: (d, t) => cb.onRepoProgress?.(r, d, t, 'files'),
          });
          if (opts.history) {
            cb.onRepoProgress?.(r, 1, 1, 'history');
            rec.history = await fetchHistory(gh, r, viewer?.login, signal);
          }
          rec.status = 'ok';
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
        rec.status = 'error'; rec.error = e.message;
      }
      await saveRepo(dataset, rec);
      cb.onRepoDone?.(r, rec, false);
    }
  }
  await Promise.all([worker(), worker()]);
  return repos;
}
