# Releasing clai

## Before the first publish
1. Claim the npm organization `clai` (the bare package name `clai` belongs to an unrelated React library). Fallback names if the org is unavailable: `clai-cli`, `clai-server`, `clai-dashboard`, with the binary still called `clai`.
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
