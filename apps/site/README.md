# getclai.vercel.app

The public site for clai: what it is, the clai for Mac download and the Terminal installer. Plain static files in `public/` (no build step), deployed by the Vercel project `getclai` (root directory `apps/site`, production branch `main`).

- `public/index.html`, `styles.css`, `site.js`: the page. It follows the "clai for Mac and getclai.vercel.app" section of docs/design-principles.md; both colour schemes, reduced motion respected, no third-party requests.
- `public/install.sh`: `curl -fsSL https://getclai.vercel.app/install.sh | sh` downloads the latest release zip for the Mac's CPU, checks it against the release's checksums.txt, installs to /Applications (or ~/Applications) and opens it.
- `vercel.json`: `/download/mac` (Apple silicon) and `/download/mac-intel` redirect to the assets of the latest GitHub release (`clai-mac-arm64.dmg`, `clai-mac-x64.dmg`); `/download/zip/arm64|x64` and `/download/checksums` likewise.
- `public/panel-light.png`, `panel-dark.png`: the real app drawn with sample data (`clai --render`, produced by the mac workflow's smoke test and published in its `screenshots` artifact). `icon-180.png` and `og.png` come from `scripts/render-assets.mjs`.

Preview locally: `npx serve apps/site/public` (redirects only work on Vercel).
