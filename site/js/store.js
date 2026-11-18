// IndexedDB persistence of analysis results (never the auth token).
// Each dataset (a signed-in login, or an imported report) is stored separately.

const DB = 'repo-stats';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const repos = db.createObjectStore('repos', { keyPath: 'key' });
      repos.createIndex('dataset', 'dataset');
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  }));
}

export async function saveRepo(dataset, repo) {
  try { await tx('repos', 'readwrite', s => s.put({ ...repo, key: `${dataset}|${repo.fullName}`, dataset })); } catch (e) { console.warn('cache write failed', e); }
}
export async function deleteRepo(dataset, fullName) {
  try { await tx('repos', 'readwrite', s => s.delete(`${dataset}|${fullName}`)); } catch {}
}
export async function loadRepos(dataset) {
  try {
    return await tx('repos', 'readonly', s => s.index('dataset').getAll(dataset));
  } catch { return []; }
}
export async function saveMeta(dataset, value) {
  try { await tx('meta', 'readwrite', s => s.put({ key: dataset, ...value })); } catch {}
}
export async function loadMeta(dataset) {
  try { return (await tx('meta', 'readonly', s => s.get(dataset))) || null; } catch { return null; }
}
export async function listDatasets() {
  try { return await tx('meta', 'readonly', s => s.getAll()); } catch { return []; }
}
export async function clearDataset(dataset) {
  const repos = await loadRepos(dataset);
  try {
    await tx('repos', 'readwrite', s => { for (const r of repos) s.delete(r.key); });
    await tx('meta', 'readwrite', s => s.delete(dataset));
  } catch {}
}
