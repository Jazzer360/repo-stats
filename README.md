# Repo Stats

Local dashboard of statistics across your GitHub repositories (personal, collaborator, and organization), plus any local git folder. A small Node server lists repos through the GitHub CLI, clones them with git, analyzes the tracked files, and serves the dashboard on `http://localhost:4173`. No dependencies, nothing leaves your machine.

## Run

Needs Node 20+, git, and the GitHub CLI signed in (`gh auth login`; for org repos `gh auth refresh -s read:org`).

```bash
npm start
```

Opens the browser. **Process** → pick scopes → **List repositories** → select → **Process**. Results appear as each repo finishes.

- Data folder: `~/.repo-stats/` (`REPO_STATS_HOME` overrides). `clones/` holds clones, `report.json` the results.
- Re-runs skip repos whose default-branch commit is unchanged; kept clones only `git fetch`.
- Port: `node server/index.mjs --port 5000`.
- Auth: git uses `gh auth git-credential` as its credential helper for the clone/fetch commands it runs. The app never reads or stores a token, and your global git config isn't changed.
- Server listens on 127.0.0.1 only, rejects other Host headers and cross-origin POSTs.

## What it measures

| Category | Contents | Unit |
|---|---|---|
| Code | maintained source, ~90 languages; split into source / tests / examples / scripts / benchmarks | code lines (non-blank, non-comment); comment and blank lines separate; TODO/FIXME count |
| Config & build | manifests, CI, containers/deploy, lint, editor/env, git, app config (incl. build files written as code: `vite.config.ts`, `setup.py`) | non-blank, non-comment lines |
| Documentation | Markdown, rST, AsciiDoc, TeX, text, notebook prose; README / guide / changelog / legal / community | words (token containing a letter), with code samples, URLs and markup removed; licences excluded from headline totals |
| Data | fixtures, datasets, i18n, config-format files >100 KB | bytes, lines |
| Generated | lockfiles (`uv.lock`, `package-lock.json`…), build output, minified, source maps, snapshots, migrations, codegen, files headed "DO NOT EDIT" / "@generated" | bytes; excluded from line totals |
| Assets | images, fonts, media, archives, binaries, Office/PDF, CAD, models | bytes |
| Vendored | `node_modules/`, `vendor/`, `third_party/`, known libraries | bytes |
| Other | unrecognised text | lines, words |

`.gitattributes` `linguist-generated` / `linguist-vendored` / `linguist-documentation` / `linguist-language` override classification. Full rules: **Methodology** page and `site/js/engine/classify.js`.

History (optional, from `git log` on the default branch, no merges): weekly commits and churn, contributors by name, your commits and lines, weekday×hour punch card. Your commits = author email matches your git `user.email`, a GitHub account email, or your noreply address, or author name matches your login/name. Emails are compared, never stored.

## Views

Overview (tiles, highlights, composition, languages, code by purpose, hygiene, size distribution, churn) · Repositories (sortable table, column picker, composition bars, health score, CSV) → detail overlay (treemap, file browser, longest/largest files, weekly commits, churn, growth, contributors, re-analyze) · Languages · Owners · Files (path/regex search across everything, presets, CSV) · Activity (contribution calendar, per-year contributions, monthly heat table, punch card, your share) · Compare (≤4 repos) · Process · Data (export JSON/CSV, open another report, remove repos) · Methodology.

Global filter bar: search (`lang:`, `topic:`, `owner:`), owner, visibility, language, forks, archived. `/` focuses search.

## Layout

```
server/index.mjs     HTTP server + JSON API, processing queue
server/local.mjs     clone/fetch, git log history, working-tree analysis
server/gh.mjs        gh CLI wrapper (status, GraphQL, identities)
server/queries.mjs   GraphQL: viewer/orgs/contributions, repo listing
site/                dashboard (static, no build step)
  js/engine/         classification, counting, aggregation
  demo/report.json   demo data (uv, swr, grpc-gateway, click, bubbletea)
cli/analyze.mjs      no-server analyzer → report JSON (open on the Data page)
test/                engine tests
```

## CLI

```bash
node cli/analyze.mjs ~/src/repo-a https://github.com/org/repo.git --out report.json
```

## Limits

- Text files >1 MB aren't read (large "code" → generated/oversized; others → data).
- Submodules and symlinks aren't followed; Git LFS files count as pointer files.
- Line churn in history includes generated files.
- Health score is a hygiene checklist (README 20, tests 20, LICENSE 15 for public repos, CI 15, docs 10, .gitignore/lint/CONTRIBUTING/changelog 5 each), not a quality measure.

## Development

```bash
npm test
```
