# Permissions

The `acpe-bot` GitHub App follows the principle of least privilege. Only the minimum permissions required for version bumps and releases are requested.

## Repository Permissions

| Permission | Level | Required for |
|---|---|---|
| **Contents** | Read & write | Push version bump commits to `main`, create git tags for releases |
| **Metadata** | Read-only | Implicitly required by all GitHub Apps. Allows reading basic repo metadata |
| **Pull requests** | Read & write | Post deployment preview URL comments on pull requests |

## Organization Permissions

None required. The bot operates at the repository level only.

## Account Permissions

None required. The bot acts on its own behalf (as an installation), not on behalf of any user.

## Webhook Subscriptions

None. The bot does not receive webhook events. It is used exclusively as a credential provider for GitHub Actions workflows, where `actions/create-github-app-token@v2` generates short-lived installation access tokens on demand.

## What Each Permission Enables

### Contents (Read & write)

Used in bump workflows to:
- Check out the repository with a token that allows pushing back to `main`
- Push version bump commits (modified `package.json` files)
- Create git tags (via `softprops/action-gh-release`)
- Create GitHub releases (requires contents write access)

API endpoints used:
- `POST /repos/{owner}/{repo}/git/refs` (create tags)
- `POST /repos/{owner}/{repo}/releases` (create releases)
- `PATCH /repos/{owner}/{repo}/releases/{release_id}` (promote releases)
- Git push via HTTPS with the token as password

### Metadata (Read-only)

Implicit permission. Allows:
- `GET /repos/{owner}/{repo}` (read repository info)
- `GET /repos/{owner}/{repo}/releases` (list releases)

### Pull requests (Read & write)

Used in deploy workflows to:
- Post preview deployment URL comments on PRs
- Find existing comments to avoid duplicates

API endpoints used:
- `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` (create comment)
- `GET /repos/{owner}/{repo}/issues/{issue_number}/comments` (find existing comments)

## Why Not Workflows Permission?

The bump script only modifies `package.json` files and runs Biome formatting. It never touches `.github/workflows/` files. The `Workflows` permission is only needed for pushing changes to workflow files, which this bot does not do.

If a future use case requires modifying workflow files, the permission can be added via the app's settings page. Existing installations will be prompted to approve the new permission.

## Token Scoping at Runtime

Even with these permissions granted to the app, individual tokens can be further scoped at generation time using `actions/create-github-app-token@v2`:

```yaml
- uses: actions/create-github-app-token@v2
  with:
    app-id: ${{ vars.ACPE_BOT_APP_ID }}
    private-key: ${{ secrets.ACPE_BOT_PRIVATE_KEY }}
    repositories: "acpm-registry"  # Limit to specific repos
```

This means a workflow in repo A cannot use the generated token to access repo B unless explicitly listed.
