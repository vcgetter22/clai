# Security and privacy

## What clai reads
Usage metadata only, from files the AI tools write on your Mac: token counts, model ids, timestamps and request ids. Lines are filtered before parsing and only usage fields are taken; OpenCode's database is queried with `json_extract`, so message text stays in it.

## What clai never does
- Store, log or send prompt, code or response content.
- Read other apps' login tokens, cookies or credentials, or call undocumented vendor endpoints.
- Look inside Desktop, Documents, Downloads, iCloud Drive, other apps' containers or removable volumes, or follow a link into them.
- Use the Keychain, Apple Events or the network for anything but the two requests below.

## Network
Once a day, and only while "Check for updates and current prices" is on: `GET https://getclai.vercel.app/prices.json` and `GET https://api.github.com/repos/vcgetter22/clai/releases/latest`. Neither carries anything about your usage.

## Where data lives
`~/Library/Application Support/clai/ledger.json` (daily totals: day, tool, model, token and request counts), `~/Library/Application Support/clai/prices.json` (a fetched price list) and the app's preferences.

## Reporting a vulnerability
Open a private security advisory on https://github.com/vcgetter22/clai/security/advisories. We aim to acknowledge within two business days.
