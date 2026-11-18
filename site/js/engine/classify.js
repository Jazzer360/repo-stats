// Path-based classification. Decides, before any content is read, what a file
// is and whether its contents need to be read at all.
//
// Categories (see languages.js CATEGORY_ORDER):
//   code       hand-maintained source. kinds: source | test | example | script | bench
//   config     build, CI, container, lint, editor, dependency manifests, app config
//   docs       prose, measured in words. kinds: readme | guide | changelog | legal | community | notebook
//   data       fixtures, datasets, i18n strings, large JSON/YAML
//   generated  lockfiles, build output, codegen, minified, snapshots, migrations
//   assets     images, fonts, media, archives, binaries, office docs, CAD
//   vendored   third-party code checked into the repo
//   other      text files nothing else claimed

import { LANGUAGES, BY_EXT, BY_NAME, ASSET_EXT } from './languages.js';

export const ENGINE_VERSION = 3;
export const MAX_CONTENT_BYTES = 1024 * 1024; // larger text files are not read

const LOCKFILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock', 'deno.lock',
  'uv.lock', 'poetry.lock', 'Pipfile.lock', 'pdm.lock', 'pixi.lock', 'conda-lock.yml', 'requirements.lock',
  'Cargo.lock', 'go.sum', 'Gemfile.lock', 'composer.lock', 'mix.lock', 'pubspec.lock', 'Podfile.lock',
  'Package.resolved', 'flake.lock', 'packages.lock.json', 'paket.lock', 'project.assets.json', 'gradle.lockfile',
  'yarn-error.log', 'shrinkwrap.yaml', 'Manifest.toml', 'renv.lock', 'cabal.project.freeze', 'stack.yaml.lock',
  'MODULE.bazel.lock', '.terraform.lock.hcl', 'Chart.lock', 'vcpkg-lock.json', 'gomod2nix.toml',
]);

// Directory names whose contents are build output or tool caches.
const GENERATED_DIRS = /(^|\/)(dist|target|\.next|\.nuxt|\.svelte-kit|\.output|\.parcel-cache|\.angular|coverage|htmlcov|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.tox|\.gradle|\.terraform|\.serverless|storybook-static|_site|\.docusaurus|__generated__|generated|\.dart_tool|DerivedData|\.vs|\.ipynb_checkpoints|[^/]+\.egg-info)\//;

const BUILD_OUTPUT_DIRS = /(^|\/)(build|out|public\/build|bin\/(Debug|Release)|obj\/(Debug|Release))\/.*\.(js|mjs|cjs|css|html|map|json|dll|pdb|exe|wasm)$/i;

const GENERATED_FILES = [
  [/\.min\.(js|mjs|css)$/i, 'minified'],
  [/[.-]bundle\.(js|css)$/i, 'minified'],
  [/\.(js|css|mjs)\.map$/i, 'build-output'],
  [/\.map$/i, 'build-output'],
  [/\.pb\.(go|cc|h|swift|dart)$|\.pb\.gw\.go$|_grpc\.pb\.go$|\.pb\.validate\.go$|_pb2(_grpc)?\.pyi?$|_pb\.(js|d\.ts)$|_grpc_pb\.(js|d\.ts)$|\.pb\.rs$/i, 'codegen'],
  [/\.(g|freezed|gr|mocks|config)\.dart$/i, 'codegen'],
  [/\.(g|g\.i|designer|Designer|generated|AssemblyInfo|AssemblyAttributes)\.(cs|vb)$|\.Designer\.cs$|ModelSnapshot\.cs$/, 'codegen'],
  [/(^|\/)zz_generated[^/]*\.go$|_string\.go$|(^|\/)bindata\.go$|_gen\.go$|\.gen\.(go|ts|js)$|\.generated\.\w+$/i, 'codegen'],
  [/(^|\/)Migrations\/\d{14}_[^/]+\.(Designer\.)?cs$/, 'migration'],
  [/(^|\/)migrations\/\d{4}_[^/]+\.py$/, 'migration'],
  [/\.snap$|(^|\/)__snapshots__\//, 'snapshot'],
  [/(^|\/)\.pnp\.(c?js|loader\.mjs)$/, 'codegen'],
  [/(^|\/)(npm-debug|yarn-debug)\.log/, 'build-output'],
  [/\.(tsbuildinfo|pyc|class)$/, 'build-output'],
];

const VENDORED_DIRS = /(^|\/)(node_modules|bower_components|jspm_packages|vendor|vendors|third[_-]?party|3rdparty|external\/[^/]+\/|extern|Pods|Carthage|\.yarn\/(releases|plugins|cache|sdks)|\.venv|venv|env\/lib|site-packages|wwwroot\/lib|deps|_vendor|\.bundle|packages\/[^/]+\.\d+\.\d+[^/]*|Godeps\/_workspace)\//;
const VENDORED_FILES = /(^|\/)(jquery|bootstrap|d3|moment|lodash|underscore|angular|react(-dom)?|vue|three|chart|popper|select2|font-?awesome|modernizr|backbone|handlebars|knockout|require|socket\.io|highlight|prism|codemirror|ace|tinymce|ckeditor|leaflet|mapbox-gl|plotly|echarts|swiper|htmx|alpine|axios|normalize)([.-][\w.-]*)?\.(js|css)$/i;

const DATA_DIRS = /(^|\/)(data|datasets?|fixtures?|__fixtures__|testdata|test[_-]data|test[_-]?files|samples?|seeds?|mocks?|__mocks__|corpus|golden|goldens|resources\/data|sample[_-]data|static\/data)\//i;
const I18N = /(^|\/)(locales?|i18n|l10n|lang|translations?|messages)\/|\.(po|pot|mo|xliff|xlf|strings|stringsdict|arb)$/i;

const TEST_PATH = /(^|\/)(tests?|__tests__|specs?|testing|e2e|cypress|playwright|integration[_-]tests?|unit[_-]tests?|test[_-]?suite|[^/]+\.Tests?|[^/]+\.(Unit|Integration)Tests?)\/|(^|\/)(test_[^/]+\.py|[^/]+_test\.(py|go|rb|exs|dart|cc|cpp|c|rs)|[^/]+\.(test|spec|e2e|cy)\.[cm]?[jt]sx?|[^/]+(Test|Tests|Spec|IT)\.(java|kt|cs|scala|groovy|swift|php|vb)|[^/]+_spec\.rb|conftest\.py)$/;
const EXAMPLE_PATH = /(^|\/)(examples?|samples?|demos?|playground|sandbox|tutorials?|cookbook|starter)\//i;
const BENCH_PATH = /(^|\/)(bench(es|marks?)?|perf)\/|_bench(mark)?\.(go|rs|py)$|\.bench\.[jt]s$/i;
const SCRIPT_PATH = /(^|\/)(scripts?|tools?|bin|hack|ci|\.husky|utils\/scripts|devtools)\//i;

const DOC_KIND = [
  [/(^|\/)README[^/]*$/i, 'readme'],
  [/(^|\/)(CHANGELOG|CHANGES|HISTORY|NEWS|RELEASES?|RELEASE[_-]NOTES)[^/]*$/i, 'changelog'],
  [/(^|\/)(LICEN[CS]E|COPYING|NOTICE|PATENTS|COPYRIGHT|THIRD[_-]PARTY[_-]NOTICES?|EULA)[^/]*$/i, 'legal'],
  [/(^|\/)(CONTRIBUTING|CODE[_-]OF[_-]CONDUCT|SECURITY|SUPPORT|GOVERNANCE|MAINTAINERS|AUTHORS|CONTRIBUTORS|CODEOWNERS|FUNDING|PULL_REQUEST_TEMPLATE|ISSUE_TEMPLATE)[^/]*$|(^|\/)\.github\/(ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE|DISCUSSION_TEMPLATE)\//i, 'community'],
];

// Config sub-kinds, tested in order against the path.
const CONFIG_KIND = [
  [/(^|\/)\.github\/workflows\/|(^|\/)\.github\/actions\/|(^|\/)(\.gitlab-ci\.ya?ml|\.travis\.ya?ml|azure-pipelines[^/]*\.ya?ml|bitbucket-pipelines\.ya?ml|appveyor\.ya?ml|cloudbuild\.ya?ml|Jenkinsfile|\.drone\.ya?ml|codecov\.ya?ml|\.pre-commit-config\.ya?ml|dependabot\.ya?ml|renovate\.json5?|\.releaserc[^/]*|release-please[^/]*|\.goreleaser\.ya?ml)$|(^|\/)\.(circleci|buildkite|azure-pipelines|gitlab|woodpecker)\//i, 'ci'],
  [/(^|\/)(Dockerfile[^/]*|Containerfile|[^/]*\.dockerfile|docker-compose[^/]*\.ya?ml|compose\.ya?ml|\.dockerignore|Chart\.yaml|values[^/]*\.ya?ml|skaffold\.ya?ml|kustomization\.ya?ml|fly\.toml|render\.ya?ml|app\.ya?ml|Procfile|vercel\.json|netlify\.toml|wrangler\.toml|serverless\.ya?ml|template\.ya?ml|samconfig\.toml)$|(^|\/)(\.devcontainer|k8s|kubernetes|helm|charts|deploy|deployment|manifests|\.platform)\//i, 'deploy'],
  [/(^|\/)(\.eslintrc[^/]*|eslint\.config\.[^/]+|\.prettierrc[^/]*|prettier\.config\.[^/]+|\.stylelintrc[^/]*|\.editorconfig|\.clang-(format|tidy)|rustfmt\.toml|\.rustfmt\.toml|clippy\.toml|\.golangci\.ya?ml|ruff\.toml|\.ruff\.toml|\.flake8|\.pylintrc|pylintrc|mypy\.ini|\.mypy\.ini|\.isort\.cfg|\.rubocop[^/]*\.ya?ml|biome\.jsonc?|\.markdownlint[^/]*|\.yamllint[^/]*|commitlint\.config\.[^/]+|\.commitlintrc[^/]*|\.lintstagedrc[^/]*|lint-staged\.config\.[^/]+|\.swiftlint\.ya?ml|detekt\.ya?ml|\.scalafmt\.conf|stylecop\.json|\.globalconfig|\.ruleset|[^/]*\.ruleset|\.cspell\.json|cspell\.json|\.htmlhintrc|\.jshintrc|tslint\.json)$/i, 'lint'],
  [/(^|\/)(\.vscode|\.idea|\.fleet|\.zed|\.cursor|\.claude)\/|(^|\/)([^/]+\.code-workspace|\.vimrc|\.nvmrc|\.node-version|\.python-version|\.ruby-version|\.tool-versions|\.sdkmanrc|global\.json|\.envrc|\.env\.[^/]+|\.env|CLAUDE\.md|AGENTS\.md|\.cursorrules)$/i, 'env'],
  [/(^|\/)(\.gitignore|\.gitattributes|\.gitmodules|\.gitkeep|\.keep|\.mailmap|CODEOWNERS|\.git-blame-ignore-revs|\.npmignore|\.prettierignore|\.eslintignore|\.vscodeignore|\.helmignore|\.gcloudignore|\.slugignore)$/i, 'vcs'],
  [/(^|\/)(package\.json|pyproject\.toml|setup\.py|setup\.cfg|MANIFEST\.in|requirements[^/]*\.(txt|in)|constraints\.txt|Pipfile|environment\.ya?ml|Cargo\.toml|go\.mod|go\.work|Gemfile|[^/]+\.gemspec|Podfile|Brewfile|composer\.json|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradle\.properties|gradlew(\.bat)?|mvnw(\.cmd)?|build\.sbt|project\.clj|deps\.edn|mix\.exs|rebar\.config|pubspec\.yaml|Package\.swift|CMakeLists\.txt|[^/]+\.cmake|Makefile|makefile|GNUmakefile|Justfile|justfile|Taskfile\.ya?ml|meson\.build|BUILD(\.bazel)?|WORKSPACE(\.bazel)?|MODULE\.bazel|[^/]+\.bzl|tsconfig[^/]*\.json|jsconfig[^/]*\.json|deno\.jsonc?|bunfig\.toml|turbo\.json|nx\.json|lerna\.json|pnpm-workspace\.yaml|\.yarnrc(\.yml)?|\.npmrc|\.babelrc[^/]*|babel\.config\.[^/]+|(webpack|rollup|vite|vitest|jest|karma|esbuild|tsup|svelte|astro|next|nuxt|remix|tailwind|postcss|playwright|cypress|nodemon|metro|gatsby-config|gatsby-node|angular|nest-cli|quasar|electron-builder)(\.[\w-]+)?\.(c|m)?[jt]s(on)?|angular\.json|nest-cli\.json|tox\.ini|pytest\.ini|noxfile\.py|conftest\.toml|\.coveragerc|[^/]+\.(csproj|vbproj|fsproj|vcxproj|vcxproj\.filters|sln|slnx|props|targets|nuspec|proj)|Directory\.(Build|Packages)\.(props|targets)|NuGet\.[Cc]onfig|nuget\.config|vcpkg\.json|conanfile\.(txt|py)|flake\.nix|shell\.nix|default\.nix|devbox\.json|mkdocs\.ya?ml|docusaurus\.config\.[jt]s|_config\.ya?ml|book\.toml|\.readthedocs\.ya?ml|sphinx[^/]*\/conf\.py|docs\/conf\.py|hugo\.(toml|ya?ml)|config\.toml)$/i, 'build'],
];

// Code files that are really configuration (manifests written in code).
const CODE_IS_CONFIG = /(^|\/)(setup\.py|noxfile\.py|conanfile\.py|Gemfile|Podfile|Brewfile|[^/]+\.gemspec|Jenkinsfile|build\.gradle\.kts|settings\.gradle\.kts|build\.sbt|Package\.swift|mix\.exs|project\.clj|docs\/conf\.py|(webpack|rollup|vite|vitest|jest|karma|esbuild|tsup|svelte|astro|next|nuxt|remix|tailwind|postcss|playwright|cypress|nodemon|metro|gatsby-config|gatsby-node|electron-builder|babel|prettier|eslint|commitlint|lint-staged|docusaurus)(\.[\w-]+)?\.config\.(c|m)?[jt]s|(\.eslintrc|\.prettierrc|\.stylelintrc|\.babelrc)\.(c|m)?[jt]s|[^/]+\.(cmake|bzl)|BUILD(\.bazel)?|WORKSPACE(\.bazel)?|MODULE\.bazel|flake\.nix|shell\.nix|default\.nix|gradlew|mvnw)$/i;

const TEXTISH_NO_EXT_OK = /(^|\/)(bin|scripts?|tools?|hack|\.husky|\.git-hooks|hooks)\/[^/.]+$/;

export function extOf(path) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return base.startsWith('.') ? base.slice(1).toLowerCase() : '';
  return base.slice(dot + 1).toLowerCase();
}
export function baseOf(path) { return path.slice(path.lastIndexOf('/') + 1); }

export function detectLanguage(path) {
  const base = baseOf(path);
  if (BY_NAME.has(base)) return BY_NAME.get(base);
  const lower = base.toLowerCase();
  if (lower.startsWith('dockerfile') || lower.endsWith('.dockerfile')) return 'Dockerfile';
  if (lower.startsWith('makefile')) return 'Makefile';
  if (/^\.env(\..+)?$/.test(lower)) return 'INI';
  if (/^\.[\w.-]*(rc|ignore|ignores|version|versions|config|settings)$/.test(lower)) return 'INI';
  if (lower === 'module.bazel' || lower.endsWith('.bazel') || lower.endsWith('.bazelrc')) return 'Starlark';
  if (/^requirements[^/]*\.(txt|in)$/.test(lower)) return 'INI';
  // multi-part extensions
  if (lower.endsWith('.d.ts')) return 'TypeScript';
  if (lower.endsWith('.blade.php')) return 'PHP';
  const ext = extOf(path);
  if (BY_EXT.has(ext)) return BY_EXT.get(ext);
  if (/^(licen[cs]e|copying|notice|readme|changelog|changes|authors|contributors|patents|copyright)([-_.][^.]*)?$/.test(lower)) return 'Text';
  return null;
}

// Parse a .gitattributes file into [matcher, attrs] pairs (linguist overrides).
export function parseGitattributes(text, dir = '') {
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const pattern = parts.shift();
    const attrs = {};
    for (const a of parts) {
      let m;
      if ((m = /^-?(linguist-(generated|vendored|documentation|detectable))(=(\w+))?$/.exec(a))) {
        const key = m[2];
        attrs[key] = a.startsWith('-') ? false : (m[4] ? m[4] !== 'false' : true);
      } else if ((m = /^linguist-language=(.+)$/.exec(a))) attrs.language = m[1].replace(/_/g, ' ');
      else if (a === 'binary' || a === '-diff') attrs.binary = true;
    }
    if (Object.keys(attrs).length) rules.push([globToRegex(pattern, dir), attrs]);
  }
  return rules;
}

function globToRegex(glob, dir) {
  let g = glob;
  const anchored = g.includes('/') && !g.endsWith('/') ? true : g.startsWith('/');
  if (g.startsWith('/')) g = g.slice(1);
  if (g.endsWith('/')) g += '**';
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === '*') {
      if (g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else if ('.+^$(){}|[]\\'.includes(ch)) re += '\\' + ch;
    else re += ch;
  }
  const prefix = dir ? dir.replace(/[.+^$(){}|[\]\\]/g, '\\$&') + '/' : '';
  return new RegExp('^' + prefix + (anchored ? '' : '(?:.*/)?') + re + '(?:/.*)?$');
}

function attrsFor(path, rules) {
  const out = {};
  if (!rules) return out;
  for (const [re, attrs] of rules) if (re.test(path)) Object.assign(out, attrs);
  return out;
}

function codeKind(path) {
  if (TEST_PATH.test(path)) return 'test';
  if (BENCH_PATH.test(path)) return 'bench';
  if (EXAMPLE_PATH.test(path)) return 'example';
  if (SCRIPT_PATH.test(path)) return 'script';
  return 'source';
}

function configKind(path) {
  for (const [re, kind] of CONFIG_KIND) if (re.test(path)) return kind;
  return 'app';
}

function docKind(path) {
  for (const [re, kind] of DOC_KIND) if (re.test(path)) return kind;
  return 'guide';
}

/**
 * Classify a file by path and size only.
 * Returns { cat, kind, lang, read } where read=true means the contents should be
 * fetched and passed to analyzeContent() to refine the classification and count.
 */
export function classifyPath(path, bytes, gitattrs, opts = {}) {
  const maxBytes = opts.maxContentBytes ?? MAX_CONTENT_BYTES;
  const a = attrsFor(path, gitattrs);
  const base = baseOf(path);
  const ext = extOf(path);
  let lang = a.language || detectLanguage(path);
  const info = lang ? LANGUAGES[lang] : null;

  if (a.vendored === true) return { cat: 'vendored', kind: 'attribute', lang, read: false };
  if (a.generated === true) return { cat: 'generated', kind: 'attribute', lang, read: false };

  if (LOCKFILES.has(base) || ext === 'lock' || ext === 'lockb') return { cat: 'generated', kind: 'lockfile', lang, read: false };
  if (a.vendored !== false && VENDORED_DIRS.test(path)) return { cat: 'vendored', kind: 'directory', lang, read: false };
  if (a.vendored !== false && VENDORED_FILES.test(path)) return { cat: 'vendored', kind: 'library', lang, read: false };
  if (a.generated !== false) {
    for (const [re, kind] of GENERATED_FILES) if (re.test(path)) return { cat: 'generated', kind, lang, read: false };
    if (BUILD_OUTPUT_DIRS.test(path)) return { cat: 'generated', kind: 'build-output', lang, read: false };
    if (GENERATED_DIRS.test(path) && !(info && info.kind === 'docs')) return { cat: 'generated', kind: 'build-output', lang, read: false };
  }

  const assetKind = ASSET_EXT[ext];
  if (assetKind || a.binary) {
    if (!(lang && !assetKind)) return { cat: 'assets', kind: assetKind || 'binary', lang: null, read: false };
  }
  if (bytes === 0) return { cat: 'other', kind: 'empty', lang, read: false };

  if (I18N.test(path) && (!info || info.kind !== 'code')) return { cat: 'data', kind: 'i18n', lang, read: bytes <= maxBytes };

  if (!info) {
    // Unknown type: read it so we can check for a shebang or binary content.
    if (!ext || TEXTISH_NO_EXT_OK.test(path)) return { cat: 'other', kind: 'unknown', lang: null, read: bytes <= maxBytes };
    return { cat: 'other', kind: 'unknown', lang: null, read: bytes <= 256 * 1024 };
  }

  if (a.documentation === true) return { cat: 'docs', kind: 'guide', lang, read: bytes <= maxBytes };

  let cat, kind;
  switch (info.kind) {
    case 'code':
      if (CODE_IS_CONFIG.test(path)) { cat = 'config'; kind = configKind(path); }
      else { cat = 'code'; kind = codeKind(path); }
      break;
    case 'config': {
      cat = 'config'; kind = configKind(path);
      const dataish = DATA_DIRS.test(path) || (/^(JSON|YAML|XML|CSV)$/.test(lang) && bytes > 100 * 1024 && kind === 'app');
      if (dataish && kind === 'app') { cat = 'data'; kind = DATA_DIRS.test(path) ? 'fixture' : 'large'; }
      break;
    }
    case 'docs':
      if (lang === 'Text' && (DATA_DIRS.test(path) || bytes > 200 * 1024) && !DOC_KIND.some(([re]) => re.test(path))) { cat = 'data'; kind = 'text'; }
      else if (lang === 'Markdown' && configKind(path) === 'env') { cat = 'config'; kind = 'env'; } // CLAUDE.md, AGENTS.md
      else { cat = 'docs'; kind = docKind(path); }
      break;
    case 'notebook': cat = 'docs'; kind = 'notebook'; break;
    case 'data': cat = 'data'; kind = DATA_DIRS.test(path) ? 'fixture' : 'dataset'; break;
    default: cat = 'other'; kind = 'unknown';
  }

  if (bytes > maxBytes) {
    // Too large to read. Big "code" files are almost always bundles or amalgamations.
    if (cat === 'code') return { cat: 'generated', kind: 'oversized', lang, read: false };
    if (cat === 'docs' && kind !== 'notebook') return { cat: 'data', kind: 'large', lang, read: false };
    return { cat: cat === 'config' ? 'data' : cat, kind: 'large', lang, read: false };
  }
  return { cat, kind, lang, read: true };
}

export function isGitattributes(path) { return baseOf(path) === '.gitattributes'; }
