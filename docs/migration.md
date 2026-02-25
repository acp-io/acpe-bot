# Migration Guide: PAT to acpe-bot

How to migrate existing workflows from Personal Access Tokens (`BUMP_PAT` / `ACPM_WEB_COMPONENTS_BUMP_PAT`) to the `acpe-bot` GitHub App.

## Prerequisites

1. The `acpe-bot` GitHub App is registered and installed (see [setup.md](setup.md))
2. Org-level variable `ACPE_BOT_APP_ID` and secret `ACPE_BOT_PRIVATE_KEY` are configured
3. The app is installed on the target repository

## Migration Steps

### Step 1: Add the token generation step

Add this as the **first step** in your job, before the checkout step:

```yaml
steps:
  - name: Generate acpe-bot token
    id: acpe-bot-token
    uses: acp-io/acpe-bot/.github/actions/generate-token@main
    with:
      app-id: ${{ vars.ACPE_BOT_APP_ID }}
      private-key: ${{ secrets.ACPE_BOT_PRIVATE_KEY }}
```

### Step 2: Replace PAT references

Replace every occurrence of the PAT secret with the generated token.

#### Checkout

```yaml
# Before
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
    token: ${{ secrets.BUMP_PAT }}

# After
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
    token: ${{ steps.acpe-bot-token.outputs.token }}
```

#### Git push

```yaml
# Before
- uses: ad-m/github-push-action@master
  with:
    github_token: ${{ secrets.BUMP_PAT }}
    branch: ${{ github.ref_name }}

# After
- uses: ad-m/github-push-action@master
  with:
    github_token: ${{ steps.acpe-bot-token.outputs.token }}
    branch: ${{ github.ref_name }}
```

#### Release creation

```yaml
# Before
- uses: softprops/action-gh-release@v1
  with:
    token: ${{ secrets.BUMP_PAT }}
    tag_name: ${{ steps.get-version.outputs.tag }}

# After
- uses: softprops/action-gh-release@v1
  with:
    token: ${{ steps.acpe-bot-token.outputs.token }}
    tag_name: ${{ steps.get-version.outputs.tag }}
```

#### gh CLI

```yaml
# Before
- env:
    GH_TOKEN: ${{ secrets.BUMP_PAT }}
  run: gh release edit "$TAG" --prerelease=false --latest

# After
- env:
    GH_TOKEN: ${{ steps.acpe-bot-token.outputs.token }}
  run: gh release edit "$TAG" --prerelease=false --latest
```

### Step 3: Update git identity

Replace `github-actions[bot]` with `acpe-bot[bot]`:

```yaml
# Before
- name: Configure git user
  run: |
    git config --local user.email "41898282+github-actions[bot]@users.noreply.github.com"
    git config --local user.name "github-actions[bot]"

# After
- name: Configure git user
  run: |
    git config --local user.name "acpe-bot[bot]"
    git config --local user.email "<APP_ID>+acpe-bot[bot]@users.noreply.github.com"
```

Replace `<APP_ID>` with the actual numeric app ID.

### Step 4: Test the pipeline

1. Push a change to `main` -- verify `bump-canary` creates a canary version commit and release
2. Run `bump-stage` manually -- verify it promotes the canary to a clean release version
3. Run `bump-prod` manually -- verify it promotes the pre-release to latest
4. Open a PR -- verify deploy preview comments appear (if using the deploy workflow)

### Step 5: Remove the PAT

Once all workflows are verified:

1. Go to the repository (or org) secrets settings
2. Delete `BUMP_PAT` (or `ACPM_WEB_COMPONENTS_BUMP_PAT`)
3. Revoke the PAT in the personal account that created it (Settings > Developer settings > Personal access tokens)

## Full Before/After Example

### Before (bump-canary.yml with PAT)

```yaml
jobs:
  bump-canary:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.BUMP_PAT }}

      - name: Configure git user
        run: |
          git config --local user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git config --local user.name "github-actions[bot]"

      # ... bump, push, release steps all use ${{ secrets.BUMP_PAT }}
```

### After (bump-canary.yml with acpe-bot)

```yaml
jobs:
  bump-canary:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Generate acpe-bot token
        id: acpe-bot-token
        uses: acp-io/acpe-bot/.github/actions/generate-token@main
        with:
          app-id: ${{ vars.ACPE_BOT_APP_ID }}
          private-key: ${{ secrets.ACPE_BOT_PRIVATE_KEY }}

      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ steps.acpe-bot-token.outputs.token }}

      - name: Configure git user
        run: |
          git config --local user.name "acpe-bot[bot]"
          git config --local user.email "<APP_ID>+acpe-bot[bot]@users.noreply.github.com"

      # ... bump, push, release steps all use ${{ steps.acpe-bot-token.outputs.token }}
```

## Troubleshooting

### Token generation fails with "could not create installation access token"

- Verify the app is installed on the repository
- Verify `ACPE_BOT_APP_ID` variable and `ACPE_BOT_PRIVATE_KEY` secret are set correctly
- Check if the private key has been rotated without updating the secret

### Push fails with "permission denied"

- Verify the app has **Contents: Read & write** permission
- Verify the app installation has access to the target repository

### Release creation fails

- Verify the app has **Contents: Read & write** permission (releases require contents write)
- Check that the tag doesn't already exist

### Commits don't trigger subsequent workflows

This is expected and desired behavior. GitHub Apps tokens, like `GITHUB_TOKEN`, do not trigger `push` events for downstream workflows by default. However, `actions/create-github-app-token@v2` generates tokens that **do** trigger subsequent workflow runs -- matching the behavior of the old PAT approach.

If workflows are not triggering, verify you are using the app token (not `GITHUB_TOKEN`) for the checkout and push steps.
