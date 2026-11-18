// GitHub API access through the GitHub CLI (`gh api`). gh holds the
// credentials; this process only sees API responses.

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);

export async function ghStatus() {
  try { await pexec('gh', ['--version'], { windowsHide: true }); } catch { return { gh: false, authed: false }; }
  try {
    const { stdout } = await pexec('gh', ['api', 'user', '--jq', '.login'], { windowsHide: true });
    return { gh: true, authed: true, login: stdout.trim() };
  } catch (e) {
    return { gh: true, authed: false, error: (e.stderr || e.message || '').trim().split('\n')[0] };
  }
}

/** Minimal client with the same graphql() shape the shared query helpers expect. */
export class GhCli {
  graphql(query, variables = {}, opts = {}) {
    return new Promise((resolve, reject) => {
      const p = spawn('gh', ['api', 'graphql', '--input', '-'], { windowsHide: true, signal: opts.signal });
      let out = '', err = '';
      p.stdout.on('data', d => { out += d; });
      p.stderr.on('data', d => { err += d; });
      p.on('error', reject);
      p.on('close', () => {
        let body;
        try { body = JSON.parse(out); } catch { return reject(new Error(err.trim() || 'gh api graphql failed')); }
        if (!body.data && !body.errors) return reject(new Error(body.message || err.trim() || 'GitHub API error'));
        if (body.errors?.length && !opts.allowPartial) return reject(new Error(body.errors.map(e => e.message).join('; ')));
        resolve(opts.allowPartial ? body : body.data);
      });
      p.stdin.end(JSON.stringify({ query, variables }));
    });
  }
}

/** The user's own commit identities, used only to recognise their commits. */
export async function myIdentities(viewer) {
  const emails = new Set();
  const names = new Set();
  if (viewer?.login) {
    names.add(viewer.login.toLowerCase());
    emails.add(`${viewer.login.toLowerCase()}@users.noreply.github.com`);
  }
  if (viewer?.name) names.add(viewer.name.toLowerCase());
  if (viewer?.databaseId) emails.add(`${viewer.databaseId}+${viewer.login.toLowerCase()}@users.noreply.github.com`);
  try { const { stdout } = await pexec('git', ['config', '--global', 'user.email'], { windowsHide: true }); if (stdout.trim()) emails.add(stdout.trim().toLowerCase()); } catch {}
  try { const { stdout } = await pexec('gh', ['api', 'user/emails', '--jq', '.[].email'], { windowsHide: true }); for (const e of stdout.split('\n')) if (e.trim()) emails.add(e.trim().toLowerCase()); } catch {}
  return (name, email) => emails.has((email || '').toLowerCase()) || /\+?[^@]*@users\.noreply\.github\.com$/i.test(email || '') && names.has((email.split('@')[0].split('+').pop() || '').toLowerCase()) || names.has((name || '').toLowerCase());
}
