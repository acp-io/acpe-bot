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

4. Under "Where can this GitHub App be installed?", select **Only on this account**
5. Click **Create GitHub App**

## 2. Note the App ID

After creation, you'll land on the app's settings page. The **App ID** is displayed near the top (e.g., `123456`). This is different from the Client ID.

## 3. Generate a Private Key

1. On the app settings page, scroll to **Private keys**
2. Click **Generate a private key**
3. A `.pem` file will download -- keep this safe

## 4. Store Credentials

### Org-level (recommended)

Store credentials at the org level so all `acp-io` repositories can use them:

1. Go to [acp-io org variables](https://github.com/organizations/acp-io/settings/variables/actions)
   - Create variable: `ACPE_BOT_APP_ID` = the numeric app ID
2. Go to [acp-io org secrets](https://github.com/organizations/acp-io/settings/secrets/actions)
   - Create secret: `ACPE_BOT_PRIVATE_KEY` = full contents of the `.pem` file (including `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----`)

### Repository-level (alternative)

If you only need the bot for a single repo, add the variable and secret at the repository level under Settings > Secrets and variables > Actions.

## 5. Install the App

1. Go to the app settings page > **Install App** (left sidebar)
2. Click **Install** next to the `acp-io` organization
3. Choose repository access:
   - **All repositories** -- gives `acpe-bot` access to every repo in the org
   - **Only select repositories** -- pick specific repos (e.g., `acpm-registry`)

## 6. Verify the Setup

Create a test workflow in any repo where the app is installed:

```yaml
name: Test acpe-bot
on: workflow_dispatch

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Generate acpe-bot token
        id: acpe-bot-token
        uses: acp-io/acpe-bot/.github/actions/generate-token@main
        with:
          app-id: ${{ vars.ACPE_BOT_APP_ID }}
          private-key: ${{ secrets.ACPE_BOT_PRIVATE_KEY }}

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
3. Update the `ACPE_BOT_PRIVATE_KEY` secret with the new `.pem` contents
4. Delete the old private key from the app settings page

Both keys are valid simultaneously until you delete the old one, so there's no downtime.
