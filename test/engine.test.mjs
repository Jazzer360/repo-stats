import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPath, parseGitattributes } from '../site/js/engine/classify.js';
import { countCode, countWords, analyzeProse, analyzeContent, splitLines } from '../site/js/engine/count.js';
import { analyzeEntries } from '../site/js/engine/analyze.js';
import { summarizeRepo } from '../site/js/engine/aggregate.js';

const cls = (p, size = 100, attrs) => { const r = classifyPath(p, size, attrs); return `${r.cat}/${r.kind}`; };

test('lockfiles and build output are generated', () => {
  for (const p of ['uv.lock', 'package-lock.json', 'web/yarn.lock', 'go.sum', 'Cargo.lock', 'poetry.lock', 'pnpm-lock.yaml', 'x/foo.lock'])
    assert.equal(cls(p), 'generated/lockfile', p);
  assert.equal(cls('dist/app.js'), 'generated/build-output');
  assert.equal(cls('static/app.min.js'), 'generated/minified');
  assert.equal(cls('api/v1/user.pb.go'), 'generated/codegen');
  assert.equal(cls('proto/user_pb2.py'), 'generated/codegen');
  assert.equal(cls('src/__snapshots__/a.test.ts.snap'), 'generated/snapshot');
  assert.equal(cls('app/migrations/0001_initial.py'), 'generated/migration');
  assert.equal(cls('Forms/Main.Designer.cs'), 'generated/codegen');
});

test('build/ folder only counts as output for web/binary artefacts', () => {
  assert.equal(cls('build/bundle.js'), 'generated/build-output');
  assert.equal(cls('build/scripts/release.py'), 'code/script');
});

test('vendored', () => {
  assert.equal(cls('node_modules/react/index.js'), 'vendored/directory');
  assert.equal(cls('vendor/github.com/x/y.go'), 'vendored/directory');
  assert.equal(cls('static/js/jquery-3.6.0.min.js'), 'vendored/library');
});

test('code kinds', () => {
  assert.equal(cls('src/main.py'), 'code/source');
  assert.equal(cls('tests/test_api.py'), 'code/test');
  assert.equal(cls('pkg/server_test.go'), 'code/test');
  assert.equal(cls('src/button.spec.tsx'), 'code/test');
  assert.equal(cls('MyApp.Tests/FooTests.cs'), 'code/test');
  assert.equal(cls('examples/basic/main.go'), 'code/example');
  assert.equal(cls('scripts/deploy.sh'), 'code/script');
});

test('config vs code', () => {
  assert.equal(cls('package.json'), 'config/build');
  assert.equal(cls('pyproject.toml'), 'config/build');
  assert.equal(cls('vite.config.ts'), 'config/build');
  assert.equal(cls('setup.py'), 'config/build');
  assert.equal(cls('.github/workflows/ci.yml'), 'config/ci');
  assert.equal(cls('Dockerfile'), 'config/deploy');
  assert.equal(cls('.eslintrc.json'), 'config/lint');
  assert.equal(cls('.gitignore'), 'config/vcs');
  assert.equal(cls('src/settings.yaml'), 'config/app');
  assert.equal(cls('CLAUDE.md'), 'config/env');
});

test('docs and data', () => {
  assert.equal(cls('README.md'), 'docs/readme');
  assert.equal(cls('docs/guide.md'), 'docs/guide');
  assert.equal(cls('CHANGELOG.md'), 'docs/changelog');
  assert.equal(cls('LICENSE'), 'docs/legal');
  assert.equal(cls('LICENSE-APACHE'), 'docs/legal');
  assert.equal(cls('notebooks/eda.ipynb'), 'docs/notebook');
  assert.equal(cls('tests/fixtures/users.json'), 'data/fixture');
  assert.equal(cls('src/big.json', 500 * 1024), 'data/large');
  assert.equal(cls('locales/en.json'), 'data/i18n');
  assert.equal(cls('logo.png'), 'assets/image');
  assert.equal(cls('parts/bracket.step'), 'assets/cad');
});

test('.gitattributes overrides', () => {
  const rules = parseGitattributes('api/generated/** linguist-generated\nthird/*.js linguist-vendored\ndocs/** linguist-documentation\n*.txt -linguist-vendored');
  assert.equal(cls('api/generated/client.ts', 100, rules), 'generated/attribute');
  assert.equal(cls('third/lib.js', 100, rules), 'vendored/attribute');
  assert.equal(cls('docs/example.py', 100, rules), 'docs/guide');
});

test('comment counting handles strings, blocks and docstrings', () => {
  const js = splitLines(`// header
const url = "http://example.com"; // trailing
/* block
   still block */
let x = 1; /* inline */

/** TODO: doc */`);
  assert.deepEqual(countCode(js, 'JavaScript'), { code: 2, comment: 4, blank: 1, todos: 1 });
  const py = splitLines(`"""Module docstring
spanning lines."""
import os  # comment
s = "# not a comment"

# FIXME later`);
  assert.deepEqual(countCode(py, 'Python'), { code: 2, comment: 3, blank: 1, todos: 1 });
  const rs = splitLines(`/* outer /* nested */ still */\nfn a<'a>() {} // c`);
  assert.deepEqual(countCode(rs, 'Rust'), { code: 1, comment: 1, blank: 0, todos: 0 });
});

test('words: tokens with letters; markdown strips code and urls', () => {
  assert.equal(countWords('Hello, world! 123 -- a1 ünïcode'), 4);
  const md = `---\ntitle: x\n---\n# Title here\n\nSee [the docs](https://example.com/a/b) now.\n\n\`\`\`py\nprint("not words")\nx = 1\n\`\`\`\n| a | b |\n`;
  const r = analyzeProse(md, 'Markdown');
  assert.equal(r.words, 2 + 4 + 2); // "#" has no letter; table cells a, b
  assert.equal(r.samples, 2);
  assert.equal(r.headings, 1);
});

test('generated header and minified detection', () => {
  const g = analyzeContent({ cat: 'code', kind: 'source', lang: 'Go' }, '// Code generated by mockgen. DO NOT EDIT.\npackage x\n');
  assert.equal(g.cat, 'generated');
  const notGen = analyzeContent({ cat: 'config', kind: 'vcs', lang: 'INI' }, '# Generated by Cargo\n/target\n');
  assert.equal(notGen.cat, 'config');
  const prose = analyzeContent({ cat: 'docs', kind: 'guide', lang: 'Markdown' }, 'Please do not modify files in the checkout.\n');
  assert.equal(prose.cat, 'docs');
  const min = analyzeContent({ cat: 'code', kind: 'source', lang: 'JavaScript' }, 'var a=1;'.repeat(2000));
  assert.equal(min.cat, 'generated');
  assert.equal(min.kind, 'minified');
});

test('pipeline + summary', async () => {
  const files = { 'src/a.py': 'import os\n# c\n\nprint(1)\n', 'tests/test_a.py': 'def test():\n    pass\n', 'README.md': 'Hello there world\n', 'uv.lock': 'x'.repeat(50), '.gitattributes': 'gen/** linguist-generated\n', 'gen/b.py': 'x=1\n' };
  const entries = Object.entries(files).map(([path, t]) => ({ path, size: t.length }));
  const out = await analyzeEntries(entries, async (list) => new Map(list.map(e => [e.path, files[e.path]])));
  const s = summarizeRepo({ files: out, private: false });
  assert.equal(s.code, 4);
  assert.equal(s.codeKinds.test.code, 2);
  assert.equal(s.byCat.docs.words, 3);
  assert.equal(s.byCat.generated.files, 2);
  assert.ok(s.health.readme && s.health.tests && !s.health.license);
});
