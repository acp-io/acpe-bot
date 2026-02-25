# acpe-bot

A GitHub App that provides scoped, short-lived tokens for automated version bumps and releases across `acp-io` repositories.

## Why a GitHub App?

The `acpe-bot` GitHub App replaces the use of Personal Access Tokens (PATs) in CI/CD workflows. Key benefits:

| Aspect | PAT | GitHub App |
|---|---|---|
| Token lifetime | Long-lived (months/years) | 1 hour (auto-generated per run) |
| Scope | Broad repo + workflow scopes | Narrow per-permission (contents, PRs) |
| Attribution | Commits appear as a real user | Commits appear as `acpe-bot[bot]` |
| Revocation | Manual | Automatic expiry; key rotation is easy |
| Audit trail | Tied to a person | Tied to the app, visible in org audit log |

## Quick start

### 1. Add secrets to your repository

Ensure your repository (or the `acp-io` org) has:

- **Variable** `ACPE_BOT_APP_ID` -- the app's numeric ID
- **Secret** `ACPE_BOT_PRIVATE_KEY` -- the app's private key (.pem contents)

### 2. Use the composite action

Add the token generation step to your workflow:

```yaml
steps:
  - name: Generate acpe-bot token
    id: acpe-bot-token
    uses: acp-io/acpe-bot/.github/actions/generate-token@main
    with:
      app-id: ${{ vars.ACPE_BOT_APP_ID }}
      private-key: ${{ secrets.ACPE_BOT_PRIVATE_KEY }}

  - name: Checkout with bot token
    uses: actions/checkout@v4
    with:
      fetch-depth: 0
      token: ${{ steps.acpe-bot-token.outputs.token }}
```

### 3. Configure git identity

```yaml
  - name: Configure git identity
    run: |
      git config --local user.name "acpe-bot[bot]"
      git config --local user.email "263902341+acpe-bot[bot]@users.noreply.github.com"
```

> **Note:** The `263902341` is the **user ID** of the `acpe-bot[bot]` account (not the App ID). This is required for GitHub to render the app's avatar on commits. You can verify it with: `gh api '/users/acpe-bot[bot]' --jq .id`

## Repository structure

```
acpe-bot/
├── .github/
│   └── actions/
│       └── generate-token/
│           └── action.yml      # Composite action for token generation
├── docs/
│   ├── setup.md                # Registration and installation guide
│   ├── permissions.md          # Permission rationale
│   └── migration.md            # PAT to acpe-bot migration guide
└── examples/
    ├── bump-canary.yml         # Auto canary bump on push to main
    ├── bump-stage.yml          # Manual stage promotion
    ├── bump-prod.yml           # Manual prod promotion
    └── deploy.yml              # Multi-env Vercel deployment
```

## Documentation

- [Setup guide](docs/setup.md) -- How to register and configure the app
- [Permissions](docs/permissions.md) -- What permissions the app needs and why
- [Migration guide](docs/migration.md) -- How to migrate from PAT-based workflows

## Examples

Full working workflow examples adapted from the `acpm-registry` pipeline:

- [bump-canary.yml](examples/bump-canary.yml) -- Automatic canary version bump on push to main
- [bump-stage.yml](examples/bump-stage.yml) -- Manual promotion from canary to release
- [bump-prod.yml](examples/bump-prod.yml) -- Manual promotion from pre-release to latest
- [deploy.yml](examples/deploy.yml) -- Multi-environment Vercel deployment with PR preview comments
