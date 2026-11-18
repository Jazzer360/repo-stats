// Deployment settings. Neither value is secret: the client secret lives only in
// the token-exchange worker (see README.md, Setup).
window.REPO_STATS_CONFIG = {
  // Client ID of the GitHub App (recommended: read-only permissions) or OAuth App.
  clientId: '',
  // URL of the deployed token-exchange worker, e.g. https://repo-stats-auth.<you>.workers.dev
  exchangeUrl: '',
  // OAuth App scopes. Ignored by GitHub Apps, whose permissions are set on the app itself.
  scopes: 'repo read:org read:user',
};
