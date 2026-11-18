// GitHub GraphQL queries (run through `gh api graphql`, see gh.mjs).
// client: anything with graphql(query, variables, opts) -> data


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
      login databaseId name avatarUrl url createdAt bio company
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
      login: v.login, databaseId: v.databaseId, name: v.name, avatarUrl: v.avatarUrl, url: v.url, createdAt: v.createdAt, bio: v.bio, company: v.company,
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

