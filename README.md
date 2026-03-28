# Sam's Code

Sam's Code is a desktop app for coding agents, with first-class support for Codex and Claude.

## Quick Start

- Run `npx samscode` to see the latest desktop release links for your OS
- Or download the desktop app from the GitHub releases page

## Development

- `bun install`
- `bun run dev` for the desktop workflow
- `bun run start` to launch the built desktop app

## CLI

- `npx samscode` shows the latest GitHub release page and the best direct desktop download for your OS
- `npm i -g samscode` installs the same helper as a global command
- The npm helper lives in `apps/cli`; the internal server lives in `apps/server` and is bundled into the desktop app

## Notes

- This project is still early and may change quickly
- Before finishing changes, run `bun fmt`, `bun lint`, and `bun typecheck`

## Version Change

- To bump the project's version, use:

```
node scripts/update-release-package-versions.ts X.Y.Z
bun install --lockfile-only --ignore-scripts
```
