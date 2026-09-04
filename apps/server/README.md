# @claii/server

The clai team server: the same engine as the CLI, running centrally. Members `clai sync` their local usage, admins connect provider APIs, everyone gets the dashboard with per-person, per-project and per-model cost, seats, budgets and insights.

```bash
CLAI_HOME=/var/lib/clai PORT=8787 npx @claii/server
# first start prints a bootstrap admin token
```

Or with Docker: see `Dockerfile` and `docker-compose.yml` in the repository.

API: `docs/dashboard-api.md`. Operations guide: `docs/team-server.md`. Bearer-token auth with admin and member roles; members can only ingest as themselves and only see their own data. Only usage metadata is ever stored.

Also exported as a library: `createApp`, `listen`, `computeSummary`, `computeInsights`, `runLocalScan`, `runApiPull`, `runImport`, credential helpers and the catalog loader, which the CLI uses for its local dashboard.
