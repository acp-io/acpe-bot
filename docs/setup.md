# Setup Guide

How to register, configure, and install the `acpe-bot` GitHub App.

## 1. Register the GitHub App

1. Go to [acp-io org app settings](https://github.com/organizations/acp-io/settings/apps/new)
2. Fill in the registration form:

| Field | Value |
|---|---|
| GitHub App name | `acpe-bot` |
| Homepage URL | `https://github.com/acp-io/acpe-bot` |
| Webhooks > Active | **Unchecked** (no webhook server needed) |

3. Set **Repository permissions** (see [permissions.md](permissions.md) for rationale):

| Permission | Access |
|---|---|
| Contents | Read & write |
| Metadata | Read-only |
| Pull requests | Read & write |

4. Under "Where can this GitHub App be installed?", select **Any account**
5. Click **Create GitHub App**

## 2. Note the App ID

After creation, you'll land on the app's settings page. The **App ID** is displayed near the top (e.g., `123456`). This is different from the Client ID.

## 3. Generate a Private Key

1. On the app settings page, scroll to **Private keys**
2. Click **Generate a private key**
3. A `.pem` file will download -- keep this safe

## 4. Deploy the Token Vending Service

The token vending service is an AWS Lambda that holds the private key and generates installation tokens for any org where `acpe-bot` is installed. Workflows authenticate via GitHub Actions OIDC -- no secrets are shared with consuming repositories.

```bash
cd infra
pnpm install
pnpm run build:functions
pulumi config set app-id <your-app-id>
pulumi config set --secret private-key "$(cat path/to/private-key.pem)"
pulumi up
```

After deployment, Pulumi outputs the `functionUrl` -- this is the endpoint baked into the action. Update `ACPE_BOT_ENDPOINT` in `action.yml` with this URL.

## 5. Install the App

### In the acp-io org (owner)

1. Go to the app settings page > **Install App** (left sidebar)
2. Click **Install** next to the `acp-io` organization
3. Choose repository access:
   - **All repositories** -- gives `acpe-bot` access to every repo in the org
   - **Only select repositories** -- pick specific repos (e.g., `acpm-registry`)

### In an external org

1. An org admin navigates to [github.com/apps/acpe-bot](https://github.com/apps/acpe-bot)
2. Click **Install** and select the target organization
3. Choose repository access (all or select repositories)
4. No secrets needed -- use the `generate-token` action in workflows

## 6. Verify the Setup

```yaml
name: Test acpe-bot
on: workflow_dispatch

permissions:
  id-token: write
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Generate acpe-bot token
        id: acpe-bot-token
        uses: acp-io/acpe-bot@main

      - name: Test token
        env:
          GH_TOKEN: ${{ steps.acpe-bot-token.outputs.token }}
        run: gh api repos/${{ github.repository }} --jq '.full_name'
```

Run it manually via Actions > Test acpe-bot > Run workflow. If it prints the repo name, the setup is correct.

## Git Identity

When the bot pushes commits, configure the git identity to attribute them to the app:

```yaml
- name: Configure git identity
  run: |
    git config --local user.name "acpe-bot[bot]"
    git config --local user.email "<APP_ID>+acpe-bot[bot]@users.noreply.github.com"
```

Replace `<APP_ID>` with the actual numeric app ID from step 2. This makes commits show up as authored by `acpe-bot[bot]` in the GitHub UI.

## Private Key Rotation

To rotate the private key:

1. Go to the app settings page > **Private keys**
2. Click **Generate a private key** (creates a new one)
3. Update the Pulumi config:
   ```bash
   pulumi config set --secret private-key "$(cat new-key.pem)"
   pulumi up
   ```
4. Delete the old private key from the app settings page

Both keys are valid simultaneously until you delete the old one, so there's no downtime. The private key only exists in AWS Secrets Manager -- no GitHub org secrets to update.
