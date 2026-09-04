# @claii/cli

See what your AI really costs. `clai` reads the usage records your AI tools already keep (Claude Code, Codex CLI, Gemini CLI, OpenCode, Cline, Aider), pulls provider admin APIs when you connect them (Anthropic, OpenAI, OpenRouter, Cursor, GitHub Copilot), prices every token with a maintained catalog, and turns it into reports, forecasts and savings insights. Local by default: nothing leaves your machine unless you run `clai sync`.

```bash
npx @claii/cli scan          # find and ingest local AI usage
npx @claii/cli report        # totals, forecast, by model / project / provider
npx @claii/cli insights      # what a plan is worth, anomalies, savings
npx @claii/cli dashboard     # web dashboard on 127.0.0.1:4321
```

Declare what you pay for so clai can value it:

```bash
clai plan set anthropic max_20x
clai budget set "AI tools" 300
```

All commands: `scan`, `report [overview|daily|weekly|monthly|models|projects|sessions|providers|sources|people]`, `insights`, `status`, `dashboard`, `plan`, `budget`, `seat`, `config`, `connect`, `disconnect`, `pull`, `import`, `sync`, `export`, `pricing`, `doctor`, `ask`. Every command supports `--json`.

Privacy: clai reads token counts, model ids, timestamps and project labels only. It never reads or stores prompt or response content. Credentials live in `~/.clai/credentials.json` (mode 0600).

Requires Node 22.13 or newer (built-in SQLite, no native modules). Documentation and source: the clai repository (`docs/`).
