# getclai.vercel.app

The public site for clai for Mac: what it is, the download and the Terminal installer. Plain static files in `public/` (no build step), deployed by the Vercel project `getclai` (root directory `apps/site`, production branch `main`).

- `public/index.html`, `styles.css`, `site.js`: the page (docs/design.md; both colour schemes, reduced motion respected, no third-party requests).
- `public/install.sh`: `curl -fsSL https://getclai.vercel.app/install.sh | sh` downloads the latest release's `clai-mac.zip`, checks it against `checksums.txt`, installs to /Applications (or ~/Applications) and opens it.
- `public/prices.json`: the price list installed copies fetch once a day; generated from `apps/mac/Sources/ClaiCore/Prices.swift` (`UPDATE_PRICES_JSON=1 swift test --filter SitePriceList` in `apps/mac`).
- `public/panel-light.png`, `panel-dark.png`: the real panel drawn with sample data (`clai --render`, in the mac workflow's `screenshots` artifact).
- `vercel.json`: `/download/mac` (and the older per-architecture links) redirect to the latest release's `clai-mac.dmg`, `/download/zip` to `clai-mac.zip`, `/download/checksums` to `checksums.txt`.

Preview locally: `npx serve apps/site/public` (redirects only work on Vercel).
