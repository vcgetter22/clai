# Team server

The team server is the same engine as the CLI, running centrally: members sync their local usage, admins connect provider APIs, everyone gets the dashboard with per-person, per-project and per-model cost.

## Run

```bash
# Docker
docker compose up -d            # see docker-compose.yml; first start prints a bootstrap admin token

# or plain Node 22.13+
CLAI_HOME=/var/lib/clai PORT=8787 npx @claii/server
```

Environment: `PORT` (8787), `HOST` (0.0.0.0), `CLAI_HOME` (data dir), `CLAI_DB` (db path), `CLAI_TZ` (reporting timezone), `CLAI_ADMIN_TOKEN` / `CLAI_ADMIN_EMAIL` (bootstrap admin), `CLAI_PULL_INTERVAL_MINUTES` (60; 0 disables), plus provider keys (`ANTHROPIC_ADMIN_KEY`, `OPENAI_ADMIN_KEY`, `OPENROUTER_API_KEY`, `CURSOR_API_KEY`, `GITHUB_TOKEN`) or `$CLAI_HOME/credentials.json`.

Put the server behind TLS (Caddy, nginx, a cloud load balancer) on a private network.

## Tokens and members

```bash
# create a member token (admin token in $ADMIN)
curl -s -X POST https://clai.acme.internal/api/admin/tokens \
  -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"actorKey":"jane@acme.com","label":"Jane laptop","role":"member"}'
# -> { "token": "clai_mem_...", ... }
```

Members are identified by the token's `actorKey` (use the work email). Member tokens can only ingest usage as themselves and can only read their own data; admins see everyone.

## Member setup

```bash
npm i -g @claii/cli
clai config set identity.email jane@acme.com
clai plan set anthropic team_premium          # optional: the seat the member has
clai sync --server https://clai.acme.internal --token clai_mem_...
```

Run `clai sync` from a cron job or launchd agent (hourly is plenty). Working directories and git remotes are stripped by default (`--keep-paths` to include them). Only usage metadata is sent, never content.

## Admin connectors

Configure on the server host (or in the compose environment):

```bash
CLAI_HOME=/var/lib/clai npx @claii/cli connect anthropic-admin --set adminKey=sk-ant-admin...
CLAI_HOME=/var/lib/clai npx @claii/cli connect openai-admin --set adminKey=sk-admin-...
CLAI_HOME=/var/lib/clai npx @claii/cli connect cursor-admin --set apiKey=key_...
CLAI_HOME=/var/lib/clai npx @claii/cli connect github-copilot --set token=ghp_... --set org=acme
```

The server pulls every `CLAI_PULL_INTERVAL_MINUTES`; `clai pull` runs one immediately.

## Seats and budgets

```bash
CLAI_HOME=/var/lib/clai npx @claii/cli seat add jane@acme.com anthropic team_premium
CLAI_HOME=/var/lib/clai npx @claii/cli budget set "Platform team" 2500 --project platform
```

Idle seats (no activity in 30 days) appear in Insights with the monthly waste; budgets show used and projected percentages with a breach date.

## Data and privacy

One SQLite database under `$CLAI_HOME` (WAL mode). Back it up by copying the file. Credentials are in `credentials.json` (mode 0600) and never in the database. Delete a member's data with `DELETE FROM events WHERE actor_key = ?` (a `clai admin forget <actor>` command is on the roadmap).
