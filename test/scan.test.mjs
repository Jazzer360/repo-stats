// Smoke test of the API processing path with a stubbed GitHub client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScan } from '../site/js/scan.js';

const FILES = { 'README.md': 'Hello docs world\n', 'src/app.ts': 'const a = 1; // c\n', 'package-lock.json': '{}', 'big.ts': 'x' };
function stubGh() {
  const calls = [];
  return {
    calls,
    async graphql(q, vars) {
      calls.push('gql');
      if (q.includes('repositories(')) return { viewer: { repositories: { pageInfo: { hasNextPage: false }, nodes: [{
        databaseId: 1, name: 'r', nameWithOwner: 'me/r', owner: { login: 'me', __typename: 'User' }, isPrivate: true, isFork: false, isArchived: false, isTemplate: false, isEmpty: false, isMirror: false, visibility: 'PRIVATE',
        description: null, url: 'https://github.com/me/r', homepageUrl: null, createdAt: '2020-01-01T00:00:00Z', pushedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        stargazerCount: 0, forkCount: 0, watchers: { totalCount: 0 }, issues: { totalCount: 0 }, pullRequests: { totalCount: 0 }, releases: { totalCount: 0 }, diskUsage: 10,
        primaryLanguage: null, licenseInfo: null, repositoryTopics: { nodes: [] }, parent: null, defaultBranchRef: { name: 'main', target: { oid: 'abc', committedDate: '2026-01-01T00:00:00Z', history: { totalCount: 5 } } } }] } } };
      // blob batch: return text for each alias, truncated for big.ts
      const repo = {};
      for (const m of q.matchAll(/(f\d+): object\(expression: "abc:([^"]+)"\)/g)) repo[m[1]] = m[2] === 'big.ts' ? { isTruncated: true, text: null, isBinary: false } : { text: FILES[m[2]], isBinary: false, isTruncated: false };
      return { data: { repository: repo } };
    },
    async rest(path, opts = {}) {
      calls.push(path);
      if (path.includes('/git/trees/')) return { truncated: false, tree: Object.entries(FILES).map(([p, t]) => ({ path: p, type: 'blob', mode: '100644', size: t.length, sha: 's-' + p })) };
      if (path.includes('/git/blobs/')) return { ok: true, arrayBuffer: async () => new TextEncoder().encode('let big = 1;\n').buffer };
      if (path.includes('/stats/contributors')) return { status: 200, ok: true, json: async () => [{ total: 5, author: { login: 'me' }, weeks: [{ w: 1700000000, a: 10, d: 2, c: 5 }] }] };
      throw new Error('unexpected ' + path);
    },
  };
}

test('runScan analyzes, falls back to REST for truncated blobs, and reuses cache', async () => {
  const gh = stubGh();
  const done = [];
  const opts = { scopes: { personal: true, collaborator: false, orgs: [] }, includeForks: false, includeArchived: true, history: true };
  await runScan(gh, 'gh:me', { login: 'me' }, [], opts, { onRepoDone: (r, rec, cached) => done.push([rec, cached]) });
  const [rec, cached] = done[0];
  assert.equal(cached, false);
  assert.equal(rec.status, 'ok');
  const by = Object.fromEntries(rec.files.map(f => [f.p, f]));
  assert.equal(by['README.md'].w, 3);
  assert.equal(by['src/app.ts'].cd, 1);
  assert.equal(by['package-lock.json'].c, 'generated');
  assert.equal(by['big.ts'].cd, 1);
  assert.ok(gh.calls.some(c => c.includes('/git/blobs/')));
  assert.equal(rec.history.mine.commits, 5);
  // second run with cache: no tree fetch
  const gh2 = stubGh(); const done2 = [];
  await runScan(gh2, 'gh:me', { login: 'me' }, [rec], opts, { onRepoDone: (r, rec2, c) => done2.push(c) });
  assert.deepEqual(done2, [true]);
  assert.ok(!gh2.calls.some(c => c.includes('/git/trees/')));
});
