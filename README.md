# acpe-bot

A GitHub App that provides scoped, short-lived tokens for automated version bumps and releases. Can be installed in any organization -- no secret sharing required.

All token generation uses GitHub Actions OIDC. Workflows prove their identity via OIDC and the token vending service returns a scoped installation token. No org-level secrets are needed in consuming repositories.

## Why a GitHub App?

The `acpe-bot` GitHub App replaces the use of Personal Access Tokens (PATs) in CI/CD workflows. Key benefits:

| Aspect | PAT | GitHub App |
|---|---|---|
| Token lifetime | Long-lived (months/years) | 1 hour (auto-generated per run) |
| Scope | Broad repo + workflow scopes | Narrow per-permission (contents, PRs) |
| Attribution | Commits appear as a real user | Commits appear as `acpe-bot[bot]` |
| Revocation | Manual | Automatic expiry; key rotation is easy |
| Audit trail | Tied to a person | Tied to the app, visible in org audit log |

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Workflow (any org where acpe-bot is installed)                   │
│                                                                  │
│  1. Request GitHub OIDC token (proves caller identity)           │
│  2. POST oidc_token + owner to token vending service             │
│                        │                                         │
└────────────────────────┼─────────────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Token vending service (AWS Lambda)                              │
│                                                                  │
│  3. Verify OIDC token against GitHub's JWKS (issuer + audience)  │
│  4. Authenticate as acpe-bot (JWT signed with private key)       │
│  5. Generate installation access token for caller's org          │
│  6. Return short-lived token                                     │
└──────────────────────────────────────────────────────────────────┘
```

The private key never leaves AWS. Workflows authenticate via GitHub Actions OIDC -- zero secrets to share.

## Quick start

**Prerequisites:** An org admin installs the app from [github.com/apps/acpe-bot](https://github.com/apps/acpe-bot).

```yaml
permissions:
  id-token: write   # Required for OIDC token
  contents: write

steps:
  - name: Generate acpe-bot token
    id: acpe-bot-token
    uses: acp-io/acpe-bot@main

  - name: Checkout with bot token
    uses: actions/checkout@v4
    with:
      fetch-depth: 0
      token: ${{ steps.acpe-bot-token.outputs.token }}
```

### Configure git identity

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
├── action.yml                          # Action entry point (composite, OIDC)
├── .github/
│   └── workflows/
│       └── ci.yml                      # CI: type check, build, Pulumi preview
├── infra/                              # Pulumi project for token vending service
│   ├── Pulumi.yaml
│   ├── index.ts                        # Entry point
│   ├── tsup.ts                         # Build config for Lambda bundles
│   ├── functions/
│   │   └── token-vending/
│   │       └── index.ts                # Lambda handler
│   └── services/
│       ├── lambda/
│       │   └── index.ts                # Lambda + Function URL + IAM
│       └── secret-manager/
│           └── index.ts                # Secrets Manager resources
├── docs/
│   ├── setup.md                        # Registration and installation guide
│   ├── permissions.md                  # Permission rationale
│   └── migration.md                    # PAT to acpe-bot migration guide
└── examples/
    ├── bump-canary.yml               # Auto canary bump on push to main
    ├── bump-stage.yml                # Manual stage promotion
    ├── bump-prod.yml                 # Manual prod promotion
    └── deploy.yml                    # Multi-env Vercel deployment
```

## Documentation

- [Setup guide](docs/setup.md) -- How to register and configure the app
- [Permissions](docs/permissions.md) -- What permissions the app needs and why
- [Migration guide](docs/migration.md) -- How to migrate from PAT-based workflows

## Examples

- [bump-canary.yml](examples/bump-canary.yml) -- Automatic canary version bump on push to main
- [bump-stage.yml](examples/bump-stage.yml) -- Manual promotion from canary to release
- [bump-prod.yml](examples/bump-prod.yml) -- Manual promotion from pre-release to latest
- [deploy.yml](examples/deploy.yml) -- Multi-environment Vercel deployment with PR preview comments
