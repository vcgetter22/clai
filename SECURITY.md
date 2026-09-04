# Security and privacy

## What clai reads
Usage metadata only: token counts, model ids, timestamps, session and project labels, git branch names, app versions, and provider-reported costs. Connectors pre-filter transcript lines and parse nothing else; export importers count tokens and discard text.

## What clai never does
- Store or transmit prompt or response content.
- Log credentials. Secrets are masked in output.
- Call undocumented vendor endpoints or reuse consumer OAuth tokens.
- Listen on non-loopback interfaces in local mode (`clai dashboard` binds to 127.0.0.1).

## Where data lives
- Local: `~/.clai/clai.db` (SQLite) and `~/.clai/credentials.json` (mode 0600). Override with `CLAI_HOME`.
- Team server: `$CLAI_HOME` on the server; members' events carry the actor key of their token; working directories and git remotes are stripped by the client before syncing unless `--keep-paths` is passed.

## `clai ask`
Generates read-only SQL with Claude (SELECT/WITH only, no semicolons, forced LIMIT) and sends aggregated rows to the model; set `ANTHROPIC_API_KEY` yourself. Do not use it with a shared team database if aggregated rows would reveal information you do not want to send to a model provider.

## Reporting a vulnerability
Open a private security advisory on the repository or email the maintainers listed in `package.json`. We aim to acknowledge within two business days.
