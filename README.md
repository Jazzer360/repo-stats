# Repo Stats

Static site (GitHub Pages) that signs in with GitHub and computes statistics across a user's repositories and, optionally, their organizations' repositories. Analysis runs in the browser against the GitHub API; results are cached in IndexedDB and only re-processed when a repo's default-branch commit changes. A Node CLI runs the same engine on local clones.

## What it measures

| Category | Contents | Unit |
|---|---|---|
| Code | maintained source, ~90 languages; split into source / tests / examples / scripts / benchmarks | code lines (non-blank, non-comment); comment and blank lines separate |
| Config & build | manifests, CI, containers/deploy, lint, editor/env, git, app config | non-blank, non-comment lines |
| Documentation | Markdown, rST, AsciiDoc, TeX, text, notebook prose; split into README / guide / changelog / legal / community | words (token containing a letter), code samples / URLs / markup stripped; licences excluded from headline totals |
| Data | fixtures, datasets, i18n, config-format files >100 KB | bytes, lines |
| Generated | lockfiles (uv.lock, package-lock.json…), build output, minified, source maps, snapshots, migrations, codegen, "DO NOT EDIT"/"@generated" headers | bytes; excluded from line totals |
| Assets | images, fonts, media, archives, binaries, Office/PDF, CAD, models | bytes (never downloaded) |
| Vendored | node_modules/, vendor/, third_party/, known libraries | bytes |
| Other | unrecognised text | lines, words |

`.gitattributes` `linguist-generated` / `linguist-vendored` / `linguist-documentation` / `linguist-language` override classification. Full rules: the site's **Methodology** page, `site/js/engine/classify.js`.

Views: Overview (tiles, highlights, composition, languages, purpose, hygiene, churn) · Repositories (sortable table, column picker, composition bars, health score, CSV) with a detail overlay (treemap, file browser, longest/largest files, weekly commits, churn, growth, contributors) · Languages · Owners (per org) · Files (search/regex across all repos, presets, CSV) · Activity (contribution calendar, per-year contributions, monthly heat table, your commit share) · Compare (up to 4 repos) · Process · Data (export/import JSON, CSV) · Methodology. Global filter bar: search (`lang:`, `topic:`, `owner:`), owner, visibility, language, forks, archived.

## Layout

```
site/                  GitHub Pages root (no build step, no third-party scripts)
  config.js            clientId + exchangeUrl (not secret)
  js/engine/           classification, counting, aggregation (shared with CLI)
  js/github.js         REST/GraphQL client, repo listing, tree + batched blob reads, history
  js/scan.js           processing run; caching by default-branch commit
  js/auth.js           OAuth code flow + PKCE; token in sessionStorage only
  js/views.js, main.js UI
  demo/report.json     demo data from public repos (uv, swr, grpc-gateway, click, bubbletea)
worker/                token-exchange endpoint (Cloudflare Worker)
cli/analyze.mjs        local analyzer → report JSON
test/                  engine tests (npm test)
```

## Setup

GitHub's token endpoint doesn't allow browser (CORS) calls and needs the client secret, so sign-in requires the small worker in `worker/`. It exchanges the one-time code, stores and logs nothing. Without it, the site still works with imported reports and the demo.

1. **Pages**: repo Settings → Pages → Source: *GitHub Actions*. `.github/workflows/pages.yml` tests and deploys `site/` on push to `main`.
2. **GitHub App** (recommended over an OAuth App: read-only, per-repo access). Settings → Developer settings → GitHub Apps → New:
   - Callback URL: the Pages URL, e.g. `https://ACCOUNT.github.io/repo-stats/`
   - Repository permissions: Contents *Read*, Metadata *Read*. Organization permissions: Members *Read* (to list orgs; my best guess at the minimum, verify).
   - Keep "Expire user authorization tokens" on (the site refreshes through the worker).
   - Install the app on the user account and each org to analyze; it only sees repos it's installed on.
   - OAuth App alternative: works with `scopes: 'repo read:org read:user'`, but `repo` grants **write** access to all private repos, and orgs with OAuth app access restrictions must approve it.
3. **Worker**:
   ```bash
   cd worker
   ```
   ```bash
   npx wrangler secret put GITHUB_CLIENT_ID
   ```
   ```bash
   npx wrangler secret put GITHUB_CLIENT_SECRET
   ```
   Set `ALLOWED_ORIGIN` in `wrangler.toml` to the Pages origin (scheme + host only), then:
   ```bash
   npx wrangler deploy
   ```
   The handler is a standard `fetch(request, env)`; porting to an Azure Function / Netlify / Vercel edge function is a few lines.
4. **config.js**: set `clientId` and `exchangeUrl`; push.

## CLI

```bash
node cli/analyze.mjs ~/src/repo-a ~/src/repo-b https://github.com/org/repo.git --out report.json
```

Analyzes tracked files at HEAD (`git ls-files`), adds history from `git log` (commits, weekly churn, authors by name; emails never recorded; shallow clones skip history). Import the JSON on the Data page. No API limits, no tree truncation.

## Limits

- API mode: GraphQL budget ≈ 1 point per batch of ≤60 files; 5,000/hour. Rate limits are waited out automatically. A repo with 20k readable files costs ~350 requests.
- Trees over 100k entries are truncated by GitHub (flagged "partial").
- Text files >1 MB aren't read (large "code" → generated/oversized).
- History uses `/stats/contributors`: top 100 contributors, weekly, no line counts for repos with 10k+ commits; additions/deletions include generated files.
- Submodules and symlinks aren't followed.

## Development

```bash
npm test
```
```bash
npm run serve
```
Then open http://localhost:8000 and use **Load demo data**. Regenerate the demo with `node cli/analyze.mjs <clones…> --out site/demo/report.json`.
