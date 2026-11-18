// Minimal GitHub REST + GraphQL client for the browser, with rate-limit
// tracking and polite retry on secondary limits.

const API = 'https://api.github.com';

export class GitHub {
  constructor(getToken, onRate) {
    this.getToken = getToken;
    this.onRate = onRate || (() => {});
    this.rate = { core: null, graphql: null };
  }

  async _fetch(url, init = {}, attempt = 0) {
    const token = await this.getToken();
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    let res;
    try {
      res = await fetch(url.startsWith('http') ? url : API + url, { ...init, headers, signal: init.signal });
    } catch (e) {
      if (e.name === 'AbortError' || attempt >= 3) throw e;
      await sleep(1000 * 2 ** attempt, init.signal);
      return this._fetch(url, init, attempt + 1);
    }
    const resource = res.headers.get('x-ratelimit-resource');
    if (resource && res.headers.get('x-ratelimit-remaining') != null) {
      this.rate[resource] = {
        remaining: +res.headers.get('x-ratelimit-remaining'),
        limit: +res.headers.get('x-ratelimit-limit'),
        reset: +res.headers.get('x-ratelimit-reset') * 1000,
      };
      this.onRate(this.rate);
    }
    if ((res.status === 403 || res.status === 429) && attempt < 6) {
      const retryAfter = +res.headers.get('retry-after');
      const remaining = res.headers.get('x-ratelimit-remaining');
      let wait;
      if (retryAfter) wait = retryAfter * 1000;
      else if (remaining === '0') wait = Math.max(1000, +res.headers.get('x-ratelimit-reset') * 1000 - Date.now() + 1000);
      else if (res.status === 429 || /secondary rate/i.test(await res.clone().text())) wait = 60000 * (attempt + 1);
      if (wait) {
        this.onRate(this.rate, { waitingUntil: Date.now() + wait });
        await sleep(wait, init.signal);
        return this._fetch(url, init, attempt + 1);
      }
    }
    if (res.status >= 500 && attempt < 3) {
      await sleep(1500 * 2 ** attempt, init.signal);
      return this._fetch(url, init, attempt + 1);
    }
    return res;
  }

  async rest(path, opts = {}) {
    const res = await this._fetch(path, opts);
    if (opts.raw) return res;
    if (!res.ok) throw new ApiError(res.status, `${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 ? null : res.json();
  }

  async paginate(path, opts = {}) {
    const out = [];
    let url = path + (path.includes('?') ? '&' : '?') + 'per_page=100';
    while (url) {
      const res = await this._fetch(url, opts);
      if (!res.ok) throw new ApiError(res.status, `${res.status} ${path}`);
      out.push(...(await res.json()));
      const link = res.headers.get('link') || '';
      url = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1] || null;
    }
    return out;
  }

  async graphql(query, variables = {}, opts = {}) {
    const res = await this._fetch('/graphql', { method: 'POST', body: JSON.stringify({ query, variables }), signal: opts.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, body.message || `GraphQL ${res.status}`);
    if (body.errors?.length && !opts.allowPartial) throw new ApiError(200, body.errors.map(e => e.message).join('; '));
    return opts.allowPartial ? body : body.data;
  }
}

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}

// ---------------------------------------------------------------- queries

const REPO_FIELDS = `
  databaseId name nameWithOwner owner { login __typename }
  isPrivate isFork isArchived isTemplate isEmpty isMirror visibility
  description url homepageUrl createdAt pushedAt updatedAt
  stargazerCount forkCount watchers { totalCount }
  issues(states: OPEN) { totalCount } pullRequests(states: OPEN) { totalCount }
  releases { totalCount }
  diskUsage primaryLanguage { name }
  licenseInfo { spdxId name }
  repositoryTopics(first: 10) { nodes { topic { name } } }
  parent { nameWithOwner }
  defaultBranchRef { name target { ... on Commit { oid committedDate history { totalCount } } } }
`;

export async function fetchViewer(gh) {
  const d = await gh.graphql(`query {
    viewer {
      login name avatarUrl url createdAt bio company
      followers { totalCount } following { totalCount }
      starredRepositories { totalCount } gists { totalCount }
      repositories(ownerAffiliations: OWNER) { totalCount }
      organizations(first: 100) { nodes { login name avatarUrl description url } }
      contributionsCollection {
        contributionYears
        contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
      }
    }
  }`);
  const v = d.viewer;
  const years = v.contributionsCollection.contributionYears || [];
  let perYear = [];
  if (years.length) {
    const q = years.map(y => `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") {
      totalCommitContributions totalPullRequestContributions totalIssueContributions
      totalPullRequestReviewContributions totalRepositoriesWithContributedCommits restrictedContributionsCount }`).join('\n');
    const yd = await gh.graphql(`query { viewer { ${q} } }`).catch(() => null);
    if (yd) perYear = years.map(y => ({ year: y, ...yd.viewer[`y${y}`] })).sort((a, b) => a.year - b.year);
  }
  return {
    viewer: {
      login: v.login, name: v.name, avatarUrl: v.avatarUrl, url: v.url, createdAt: v.createdAt, bio: v.bio, company: v.company,
      followers: v.followers.totalCount, following: v.following.totalCount, stars: v.starredRepositories.totalCount,
      gists: v.gists.totalCount, ownedRepos: v.repositories.totalCount,
    },
    orgs: v.organizations.nodes.filter(Boolean),
    contributions: {
      total: v.contributionsCollection.contributionCalendar.totalContributions,
      days: v.contributionsCollection.contributionCalendar.weeks.flatMap(w => w.contributionDays.map(d => [d.date, d.contributionCount])),
      years: perYear,
    },
  };
}

function normalizeRepo(n) {
  const t = n.defaultBranchRef?.target;
  return {
    id: n.databaseId, fullName: n.nameWithOwner, owner: n.owner.login, ownerType: n.owner.__typename, name: n.name,
    private: n.isPrivate, visibility: n.visibility?.toLowerCase(), fork: n.isFork, archived: n.isArchived, template: n.isTemplate,
    empty: n.isEmpty, mirror: n.isMirror, description: n.description, url: n.url, homepage: n.homepageUrl,
    createdAt: n.createdAt, pushedAt: n.pushedAt, updatedAt: n.updatedAt,
    stars: n.stargazerCount, forks: n.forkCount, watchers: n.watchers.totalCount,
    openIssues: n.issues.totalCount, openPRs: n.pullRequests.totalCount, releases: n.releases.totalCount,
    diskKb: n.diskUsage, ghLanguage: n.primaryLanguage?.name || null,
    license: n.licenseInfo ? (n.licenseInfo.spdxId !== 'NOASSERTION' ? n.licenseInfo.spdxId : n.licenseInfo.name) : null,
    topics: n.repositoryTopics.nodes.map(x => x.topic.name), parent: n.parent?.nameWithOwner || null,
    defaultBranch: n.defaultBranchRef?.name || null, headOid: t?.oid || null, lastCommitAt: t?.committedDate || null,
    commitCount: t?.history?.totalCount ?? null,
  };
}

/** List repos for the viewer (personal scope) or an organization. */
export async function listRepos(gh, { org = null, affiliations = ['OWNER', 'COLLABORATOR'], signal } = {}) {
  const out = [];
  let cursor = null;
  for (;;) {
    const q = org
      ? `query($c: String, $org: String!) { organization(login: $org) { repositories(first: 50, after: $c, orderBy: {field: PUSHED_AT, direction: DESC}) { pageInfo { hasNextPage endCursor } nodes { ${REPO_FIELDS} } } } }`
      : `query($c: String) { viewer { repositories(first: 50, after: $c, ownerAffiliations: [${affiliations.join(',')}], affiliations: [${affiliations.join(',')}], orderBy: {field: PUSHED_AT, direction: DESC}) { pageInfo { hasNextPage endCursor } nodes { ${REPO_FIELDS} } } } }`;
    const d = await gh.graphql(q, org ? { c: cursor, org } : { c: cursor }, { signal });
    const conn = org ? d.organization.repositories : d.viewer.repositories;
    out.push(...conn.nodes.filter(Boolean).map(normalizeRepo));
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}

/** Recursive tree of the default branch head. Returns { entries, truncated, submodules, symlinks }. */
export async function fetchTree(gh, repo, signal) {
  const t = await gh.rest(`/repos/${repo.fullName}/git/trees/${repo.headOid}?recursive=1`, { signal });
  const entries = [];
  let submodules = 0, symlinks = 0;
  for (const e of t.tree) {
    if (e.type === 'blob') {
      if (e.mode === '120000') { symlinks++; continue; }
      entries.push({ path: e.path, size: e.size, sha: e.sha });
    } else if (e.type === 'commit') submodules++;
  }
  return { entries, truncated: !!t.truncated, submodules, symlinks };
}

const gqlString = (s) => JSON.stringify(s);

/** Returns readMany(entries) for analyzeEntries: batched GraphQL blob reads with REST fallback. */
export function makeBlobReader(gh, repo, signal) {
  const [owner, name] = repo.fullName.split('/');
  return async (entries) => {
    const m = new Map();
    const fields = entries.map((e, i) => `f${i}: object(expression: ${gqlString(`${repo.headOid}:${e.path}`)}) { ... on Blob { text isBinary isTruncated } }`).join('\n');
    const body = await gh.graphql(`query($o: String!, $n: String!) { repository(owner: $o, name: $n) { ${fields} } }`, { o: owner, n: name }, { signal, allowPartial: true });
    const repoData = body.data?.repository || {};
    const fallback = [];
    entries.forEach((e, i) => {
      const b = repoData[`f${i}`];
      if (!b) { fallback.push(e); return; }
      if (b.isBinary) { m.set(e.path, '\0'); return; }
      if (b.isTruncated || b.text == null) { fallback.push(e); return; }
      m.set(e.path, b.text);
    });
    for (const e of fallback) {
      try {
        const res = await gh.rest(`/repos/${repo.fullName}/git/blobs/${e.sha}`, { signal, raw: true, headers: { Accept: 'application/vnd.github.raw+json' } });
        if (!res.ok) { m.set(e.path, null); continue; }
        const buf = new Uint8Array(await res.arrayBuffer());
        m.set(e.path, new TextDecoder('utf-8', { fatal: false }).decode(buf));
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        m.set(e.path, null);
      }
    }
    return m;
  };
}

/**
 * Commit history from /stats/contributors (computed asynchronously by GitHub:
 * 202 means "come back shortly"). Returns null if still not ready.
 */
export async function fetchHistory(gh, repo, viewerLogin, signal) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await gh.rest(`/repos/${repo.fullName}/stats/contributors`, { signal, raw: true });
    if (res.status === 202) { await sleep(2000 + attempt * 2500, signal); continue; }
    if (res.status === 204 || res.status === 409) return { commits: 0, weekly: [], contributors: [], source: 'api' };
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    const weeks = new Map();
    const contributors = [];
    for (const c of data) {
      let a = 0, d = 0;
      for (const w of c.weeks) {
        if (!w.a && !w.d && !w.c) continue;
        const cur = weeks.get(w.w) || [w.w, 0, 0, 0];
        cur[1] += w.a; cur[2] += w.d; cur[3] += w.c; weeks.set(w.w, cur);
        a += w.a; d += w.d;
      }
      contributors.push({ login: c.author?.login || '(unknown)', avatar: c.author?.avatar_url || null, commits: c.total, additions: a, deletions: d });
    }
    contributors.sort((x, y) => y.commits - x.commits);
    const weekly = [...weeks.values()].sort((x, y) => x[0] - y[0]);
    const mine = contributors.find(c => c.login.toLowerCase() === (viewerLogin || '').toLowerCase()) || null;
    return {
      commits: repo.commitCount ?? contributors.reduce((s, c) => s + c.commits, 0),
      firstCommit: weekly.length ? new Date(weekly[0][0] * 1000).toISOString() : null,
      weekly, contributors, mine, source: 'api',
    };
  }
  return null;
}
