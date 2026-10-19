# Releasing clai

## Before the first publish
1. The npm organization is `claii` (the bare `clai` name belongs to an unrelated React library); packages are `@claii/*` and the binary is still called `clai`.
2. Add `"publishConfig": { "access": "public" }` to each scoped package (required for public scoped packages).
3. Pick a version and set it in every workspace `package.json` and every internal dependency (`"@claii/core": "0.1.0"`); a small script or `npm version --workspaces` keeps them aligned.
4. `npm install && npm run build && npm test`; run `node apps/cli/bin/clai.js scan` against your own machine and compare with `clai doctor`.

## Publish order (internal dependencies must exist first)
```bash
npm publish -w @claii/core
npm publish -w @claii/store
npm publish -w @claii/connectors
npm publish -w @claii/dashboard      # ships dist/ only (run npm run build first)
npm publish -w @claii/server
npm publish -w @claii/cli
```

Check `npx @claii/cli@latest --version` from a clean directory and on Node 22.13 (the minimum) as well as the current LTS.

## Homebrew (optional)
A formula that wraps `npm install -g @claii/cli` or a Node-bundled tarball; keep it in a `homebrew-clai` tap repository.

## Docker
`docker build -t ghcr.io/<org>/clai-server:<version> .` and push; the image runs the team server with the data volume at `/var/lib/clai`.

## Catalog refresh
Regenerate `packages/core/src/pricing/catalog.research.json` from a refreshed `research/pricing-catalog.draft.json` with `node scripts/merge-pricing.mjs`, bump `version` in `SEED_CATALOG`, run tests (the catalog integrity test catches alias collisions), and note changes in `docs/decisions.md`. Users pick up the new prices on upgrade and can run `clai pricing reprice`.

## clai for Mac
1. Bump the workspace version (all packages move together since 0.4.0) and push; `.github/workflows/mac.yml` builds, tests and smoke-tests the app on macos-26 and uploads `clai-mac` and `screenshots` artifacts.
2. Tag the commit `mac-v<version>` and push the tag; the workflow's release job publishes `clai-mac-arm64.dmg`, `clai-mac-x64.dmg`, the two zips and `checksums.txt` as a GitHub release, which becomes "latest".
3. getclai.vercel.app needs no change for a new release: `/download/mac`, `/download/mac-intel` and `install.sh` always resolve to the latest release. Update the version shown on the page (`data-version` in apps/site/public/index.html) and, if the panel changed, `panel-light.png` / `panel-dark.png` from the `screenshots` artifact.
4. Signing: ad hoc until the repository has the Developer ID secrets listed in apps/mac/README.md; then the same workflow signs and notarizes.

## 0.4.0 (all packages, clai for Mac)
- CLI: `clai snapshot [--scan]`, one JSON document (schema 1) with everything a glanceable surface shows; `clai login` defaults to https://clai-cloud.vercel.app.
- Server: `computeSnapshot`; local scan results carry `found` and `paths`; `dashboardDistDir()` also honours `CLAI_DASHBOARD_DIR` and a `dashboard/` folder next to a bundled engine; the team server reports its package version.
- Core: provider and source labels (`providerLabel`, `sourceProvider`).
- Dashboard: the hosted landing page links clai for Mac and GitHub support instead of cobank.ai.
- Workspace: every package and internal pin at 0.4.0 (fixes `npm ci` on npm 11, which CI's Node 24 job uses).
- New: clai for Mac 0.4.0 (apps/mac), getclai.vercel.app (apps/site).

## 0.3.1 (`@claii/dashboard` only)
- Hosted landing page: unauthenticated visitors in hosted mode see the landing (hero figure with its basis, plan-value calculator, what clai reads, pricing table, sign-in card, legal footer) instead of a bare sign-in card. Self-hosted team servers and local mode are unchanged.

## 0.3.2 (`@claii/cli` only)
- Structure: every command title is a ruled line with its range or elapsed time; `report` opens with a totals card (spend with basis, requests, tokens, today, month with projection, last month) and its breakdowns are ruled sub-sections.
- Colour: one colour per provider held constant across views, mirroring the dashboard palette (Anthropic green, OpenAI blue, Google amber, Cursor magenta, GitHub grey, Mistral cyan) on provider, model and source rows and their bars; everything else keeps the single accent.
- Motion: figures count up and bars fill once when a block first appears (about a quarter second, terminal only; off with `--quiet`, `--json`, pipes, CI, `TERM=dumb` or `CLAI_NO_MOTION=1`).

## 0.3.1 (`@claii/cli` only)
- Declares `@claii/server` as a dependency: the CLI imports it (`loadCatalog`, `runLocalScan`, `computeSummary`) but the workspace hid the missing entry, so `npx @claii/cli` 0.2.0 and 0.3.0 fail with ERR_MODULE_NOT_FOUND on a standalone install. The other five packages stay at 0.3.0.

## 0.3.0 (first published version)
- CLI: progress line with elapsed time while `scan`, `sync`, `import`, `pull` and `login` work (stderr, terminal only; off with `--quiet`, `--json`, pipes and CI); a summary card after `scan` with the basis label; grouped, styled help; the ledger palette from docs/design-principles.md (one green accent, amber warnings, red critical) instead of cyan.
- Core: `formatUsd` groups thousands (`$2,957`).
- Server: `runLocalScan` accepts optional `ScanHooks` (`onStart`, `onResult`) for progress display.
- 0.2.0 was never published (npm 2FA); the version is retired.
