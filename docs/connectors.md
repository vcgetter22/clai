# Connector matrix

Reliability tiers: **A** official API or vendor-written local file with exact token counts; **B** official data export with estimated tokens; **C** adoption-only data (no tokens or cost). Unofficial endpoints (claude.ai usage page, `api.anthropic.com/api/oauth/usage`, `chatgpt.com/backend-api/wham/usage`, `cursor.com/api/usage`) are deliberately excluded: Anthropic prohibits third-party use of consumer OAuth tokens (enforced 2026-04-04) and the others are undocumented.

| Source | id | Tier | What it yields | Attribution | Cost basis | Status |
|---|---|---|---|---|---|---|
| Claude Code transcripts (`~/.claude/projects/**.jsonl`, agent files) | `claude-code` | A | per-request input / cache read / cache write 5m+1h / output, web searches, model, session, cwd, git branch, version, effort | local user (identity setting), project from cwd | computed (API-equivalent); plan declared via `clai plan set` | built + tested on real data |
| Codex CLI rollouts (`~/.codex/sessions`, `archived_sessions`, `.zst`, pi/omp agents) | `codex-cli` | A | per-call deltas of cumulative usage: uncached input, cached input, cache writes, output, reasoning; model from turn_context; plan_type from rate-limit snapshots | local user, project from cwd, git branch | computed; billing api vs subscription from auth mode | built + tested |
| Gemini CLI (`~/.gemini`, telemetry outfile) | `gemini-cli` | A (telemetry) / partial (chats) | per-response tokens incl. cached and thoughts when telemetry is enabled | local user | computed | built, fixture-tested; verify on a real install |
| OpenCode (`~/.local/share/opencode/storage`) | `opencode` | A | per-message tokens incl. cache read/write and the tool's own cost | local user, session cwd | computed, tool estimate as fallback | built, fixture-tested |
| Cline / Roo Code (VS Code globalStorage tasks) | `cline` | A | per-request tokensIn/Out, cache reads/writes, cost | local user, workspace | computed | built, fixture-tested |
| Aider (`.aider.chat.history.md`) | `aider` | A- | per-message sent/received tokens and cost lines | local user, repo dir | tool estimate / computed when model known | built, fixture-tested |
| Anthropic Admin API: usage_report/messages, cost_report | `anthropic-admin` | A | hourly/daily buckets by api key, workspace, model, service tier, context window; billed USD by workspace/description | api key name, workspace name | billed + computed | built, fixture-tested; verify on a live org |
| Anthropic Claude Code Analytics (usage_report/claude_code) | `anthropic-admin` | A | per-user per-day tokens by model, sessions, lines, commits, PRs, tool acceptance | user email | computed (+ provider estimate in meta) | built, fixture-tested |
| Claude Enterprise Analytics API (`/v1/organizations/analytics/*`) | `anthropic-admin` (analytics key) | A | org-wide usage and cost for claude.ai Enterprise orgs | user / dimension | billed + computed | built, fixture-tested; shapes partly UNVERIFIED, verify on a live org |
| OpenAI Admin: usage/completions (+ embeddings, images, audio), costs | `openai-admin` | A | daily buckets by project, user, api key, model, batch; billed USD by project and line item | project, user, api key names | billed + computed | built, fixture-tested |
| OpenRouter activity / key / credits | `openrouter` | A | daily rows per model and provider with USD, prompt/completion/reasoning tokens | key label | billed | built, fixture-tested |
| Cursor Admin API (filtered usage events, daily usage, members, spend) | `cursor-admin` | A | per-request model, kind, token usage and cents; per-user daily requests, lines, tabs, active flag | user email | billed (cents) + computed | built, fixture-tested |
| GitHub Copilot (2026 metrics reports NDJSON, billing seats, AI credits usage) | `github-copilot` | A/C | per-user credits used, seat activity, premium request / AI credit billing | login | billed (credits) | built, fixture-tested; NDJSON fields partly UNVERIFIED |
| claude.ai data export | `claude-export` | B | message counts by default (the export records neither tokens nor model); `--estimate --model` opts into a chars/3.6 estimate | account | none / estimated | built, fixture-tested |
| ChatGPT data export | `chatgpt-export` | B | per-message tokens via o200k/cl100k tokenizer chosen by model, model from model_slug | account | estimated | built, fixture-tested |
| Claude Code OpenTelemetry (OTLP receiver) | `otel` | A | claude_code.token.usage / cost.usage metrics and api_request events with user.email, organization.id | email, org | computed | roadmap (team server receiver) |
| AWS Bedrock (Cost Explorer, CloudWatch, invocation logs) | planned | A | per-model tokens, billed USD, identity ARN | IAM identity | billed | roadmap |
| Azure OpenAI (Cost Management, Monitor metrics) | planned | A | per-deployment tokens and cost | deployment | billed | roadmap |
| Vertex AI / Gemini API (Cloud Billing export, Monitoring) | planned | A | per-model tokens and SKU cost | project | billed | roadmap |
| Microsoft 365 Copilot reports, Google Workspace Gemini reports | planned | C | last-activity per user per app (seat utilisation only) | user | seat price | roadmap |
| LiteLLM / Helicone / Portkey / Cloudflare AI Gateway | planned | A | per-request usage and spend for routed traffic | virtual key / user | billed or computed | roadmap |
| Browser extension (claude.ai / chatgpt.com limit widgets) | planned, opt-in | B | remaining 5-hour / weekly limits | account | n/a | roadmap (Plus) |

Connector authoring rules: deterministic `naturalKey`; incremental state via `ctx.state`; only usage fields extracted; injected `fetch` for tests; `verify()` makes one cheap request; every event carries `billing` and, when known, `plan`.
