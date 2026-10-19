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
1. Push the change; `.github/workflows/mac.yml` builds, tests and smoke-tests the app on macos-26 and uploads `clai-mac` and `screenshots` artifacts. The app's version comes from its tag (`mac-v0.4.1` builds 0.4.1), so an app-only release needs no npm version bump; the engine inside reports the CLI's version, and the npm packages move together on their own schedule (above).
2. Publish `mac-v<version>`, either way:
   - push a tag: `git tag mac-v<version> <commit> && git push origin mac-v<version>`;
   - or GitHub's web form: Releases, "Draft a new release", type `mac-v<version>` as a new tag on the branch that holds the release commit, then Publish.

   The workflow's release job builds again and attaches `clai-mac-arm64.dmg`, `clai-mac-x64.dmg`, the two zips and `checksums.txt` with the standard notes (replacing notes typed into the form). The release becomes "latest". From the web form, the download links return GitHub's 404 for about ten minutes, until the files are attached. Claude Code cloud sessions cannot push tags, so this step is the founder's.
3. getclai.vercel.app needs no change for a new release: `/download/mac`, `/download/mac-intel` and `install.sh` always resolve to the latest release. Update the version shown on the page (`data-version` in apps/site/public/index.html) and, if the panel changed, `panel-light.png` / `panel-dark.png` from the `screenshots` artifact.
4. Signing: ad hoc until the repository has the Developer ID secrets listed in apps/mac/README.md; then the same workflow signs and notarizes.

## clai for Mac 0.4.2 (not released yet; on `main` since 0.4.1)
- Says what it cannot see: on a day without usage on this Mac the Today pill reads "none on this Mac"; the month card, the Today pill (on hover) and Settings explain that cloud sessions and claude.ai chats leave no logs on the Mac.
- Engine (also in npm 0.4.0, which is published from `main` after 0.4.2): Claude Opus 5.5, Sonnet 5.5 and Haiku 5.5 are priced at their own rates (Opus 5.5 was priced as Opus 5); the first scan after a catalog change reprices stored usage.

## clai for Mac 0.4.1 (app only; npm stays at 0.4.0)
- Quieter look: no bubbles, gloss or glow; SF Pro instead of the rounded font; flat buttons; system-style tabs; the month on a plain ledger-green card; no count-up or rise-in animations; a new icon without bubbles. getclai.vercel.app follows suit.
- The menu bar shows this month's spend by default, the panel's headline figure. Today and icon-only stay in Settings. With no usage yet today it used to read "$0".
- Release builds take their version from the `mac-v*` tag.

## 0.4.0 (all packages, clai for Mac)
- CLI: `clai snapshot [--scan]`, one JSON document (schema 1) with everything a glanceable surface shows; `clai login` defaults to https://clai-cloud.vercel.app.
- Server: `computeSnapshot`; local scan results carry `found` and `paths`; `dashboardDistDir()` also honours `CLAI_DASHBOARD_DIR` and a `dashboard/` folder next to a bundled engine; the team server reports its package version.
- Core: provider and source labels (`providerLabel`, `sourceProvider`).
- Pricing: Claude Opus 5.5, Sonnet 5.5 and Haiku 5.5 (prompt-length tiers) from the live pricing page, 2026-10-19; the catalog version follows its newest part; `runLocalScan` reprices stored events once per catalog version (`repriceIfCatalogChanged`).
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
