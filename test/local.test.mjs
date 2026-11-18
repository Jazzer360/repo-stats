// Local git pipeline: analysis of a working tree, history, "mine" detection, clone/update.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { analyzeRepoDir, localMeta } from '../server/local.mjs';


test('analyzes a local repository with history and recognises my commits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rs-test-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/app.py'), 'import os\n# hi\nprint(1)\n');
    writeFileSync(join(dir, 'README.md'), 'Some words here\n');
    writeFileSync(join(dir, 'uv.lock'), 'lock\n');
    writeFileSync(join(dir, 'untracked.py'), 'x = 1\n');
    execFileSync('git', ['add', 'src', 'README.md', 'uv.lock'], { cwd: dir });
    const env = (n, e) => ({ ...process.env, GIT_AUTHOR_NAME: n, GIT_AUTHOR_EMAIL: e, GIT_COMMITTER_NAME: n, GIT_COMMITTER_EMAIL: e });
    execFileSync('git', ['commit', '-qm', 'one'], { cwd: dir, env: env('Me', 'me@example.com') });
    writeFileSync(join(dir, 'src/app.py'), 'import os\n# hi\nprint(1)\nprint(2)\n');
    execFileSync('git', ['commit', '-qam', 'two'], { cwd: dir, env: env('Other', 'other@example.com') });
    const meta = await localMeta(dir);
    assert.equal(meta.owner, 'local');
    const rec = await analyzeRepoDir(dir, meta, { isMine: (n, e) => e === 'me@example.com' });
    const paths = rec.files.map(f => f.p).sort();
    assert.deepEqual(paths, ['README.md', 'src/app.py', 'uv.lock']); // untracked ignored
    assert.equal(rec.files.find(f => f.p === 'src/app.py').cd, 3);
    assert.equal(rec.history.commits, 2);
    assert.equal(rec.history.mine.commits, 1);
    assert.equal(rec.history.contributors.length, 2);
    assert.ok(!JSON.stringify(rec).includes('@example.com'), 'emails must not be stored');
    assert.equal(rec.history.punch.flat().reduce((a, b) => a + b, 0), 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
