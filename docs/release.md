# Release Checklist

This document covers two separate distribution paths:

- Desktop app releases on GitHub Releases (`.exe`, `.dmg`, `.AppImage`)
- The public npm helper package (`apps/cli`, package name `samscode`)

The two flows are intentionally decoupled.

## What the desktop release workflow does

- Trigger: push a tag matching `v*.*.*`
- Runs quality gates first: lint, typecheck, test
- Builds four artifacts in parallel:
  - macOS `arm64` DMG
  - macOS `x64` DMG
  - Linux `x64` AppImage
  - Windows `x64` NSIS installer
- Publishes one GitHub Release with all produced files
  - Versions with a suffix after `X.Y.Z` (for example `1.2.3-alpha.1`) are published as GitHub prereleases
  - Only plain `X.Y.Z` releases are marked as the repository's latest release
- Includes Electron auto-update metadata (for example `latest*.yml` and `*.blockmap`) in release assets
- Signing is optional and auto-detected per platform from secrets

The desktop workflow does not publish the npm helper package.

## Desktop auto-update notes

- Runtime updater: `electron-updater` in `apps/desktop/src/main.ts`
- Update UX:
  - Background checks run on startup delay + interval
  - No automatic download or install
  - The desktop UI shows a rocket update button when an update is available; click once to download, click again after download to restart/install
- Provider: GitHub Releases (`provider: github`) configured at build time
- Repository slug source:
  - `SAMSCODE_DESKTOP_UPDATE_REPOSITORY` (format `owner/repo`), if set
  - otherwise `GITHUB_REPOSITORY` from GitHub Actions
- Temporary private-repo auth workaround:
  - set `SAMSCODE_DESKTOP_UPDATE_GITHUB_TOKEN` (or `GH_TOKEN`) in the desktop app runtime environment
  - the app forwards it as an `Authorization: Bearer <token>` request header for updater HTTP calls
- Required release assets for updater:
  - platform installers (`.exe`, `.dmg`, `.AppImage`, plus macOS `.zip` for Squirrel.Mac update payloads)
  - `latest*.yml` metadata
  - `*.blockmap` files (used for differential downloads)
- macOS metadata note:
  - `electron-updater` reads `latest-mac.yml` for both Intel and Apple Silicon
  - the workflow merges the per-arch mac manifests into one `latest-mac.yml` before publishing the GitHub Release

## Publish the npm helper package

The public npm package lives in `apps/cli` and is named `samscode`.

Run these commands from `apps/cli`:

1. Confirm the name is available:
   - `npm view samscode`
2. Log in to npm:
   - `npm login`
   - `npm whoami`
3. Build the helper:
   - `bun run build`
4. Dry-run the publish:
   - `npm publish --dry-run`
5. Publish for real:
   - `npm publish`

Notes:

- `apps/cli/package.json` already sets `publishConfig.access` to `public`
- The npm helper is independent from the desktop release workflow; publish it whenever you want to claim or update the `samscode` package name

## 1) Dry-run desktop release without signing

Use this first to validate the release pipeline.

1. Confirm no signing secrets are required for this test.
2. Create a test tag:
   - `git tag v0.0.0-test.1`
   - `git push origin v0.0.0-test.1`
3. Wait for `.github/workflows/release.yml` to finish.
4. Verify the GitHub Release contains all platform artifacts.
5. Download each artifact and sanity-check installation on each OS.

## 2) Apple signing + notarization setup (macOS)

Required secrets used by the workflow:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

Checklist:

1. Apple Developer account access:
   - Team has rights to create Developer ID certificates.
2. Create `Developer ID Application` certificate.
3. Export certificate + private key as `.p12` from Keychain.
4. Base64-encode the `.p12` and store as `CSC_LINK`.
5. Store the `.p12` export password as `CSC_KEY_PASSWORD`.
6. In App Store Connect, create an API key (Team key).
7. Add API key values:
   - `APPLE_API_KEY`: contents of the downloaded `.p8`
   - `APPLE_API_KEY_ID`: Key ID
   - `APPLE_API_ISSUER`: Issuer ID
8. Re-run a tag release and confirm macOS artifacts are signed/notarized.

Notes:

- `APPLE_API_KEY` is stored as raw key text in secrets.
- The workflow writes it to a temporary `AuthKey_<id>.p8` file at runtime.

## 3) Azure Trusted Signing setup (Windows)

Required secrets used by the workflow:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`
- `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`

Checklist:

1. Create Azure Trusted Signing account and certificate profile.
2. Record ATS values:
   - Endpoint
   - Account name
   - Certificate profile name
   - Publisher name
3. Create or choose an Entra app registration (service principal).
4. Grant the service principal permissions required by Trusted Signing.
5. Create a client secret for the service principal.
6. Add the Azure secrets listed above in GitHub Actions secrets.
7. Re-run a tag release and confirm the Windows installer is signed.

## 4) Ongoing desktop release checklist

1. Ensure `main` is green in CI.
2. Bump app versions as needed.
   - Shortcut: `bun run release:version -- 0.1.1`
3. Create a release tag: `vX.Y.Z`.
4. Push the tag.
5. Verify workflow steps:
   - preflight passes
   - all matrix builds pass
   - release job uploads expected files
6. Smoke test downloaded artifacts.

`bun run release:version -- <version>` performs the standard release prep chain for a clean worktree:

- updates release package versions
- refreshes `bun.lock`
- commits with `Bump version to <version>`
- pushes the branch
- creates tag `v<version>`
- pushes the tag to `origin`

## 5) Troubleshooting

- macOS build unsigned when expected signed:
  - Check that all Apple secrets are populated and non-empty.
- Windows build unsigned when expected signed:
  - Check that all Azure ATS and auth secrets are populated and non-empty.
- Build fails with signing error:
  - Retry with secrets removed to confirm the unsigned path still works.
  - Re-check certificate/profile names and tenant/client credentials.
