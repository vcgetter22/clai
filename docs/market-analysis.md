# clai market analysis (executive version, 2026-09-03)

Full sourced research with URLs and dates: `research/market-analysis.md`, `research/anthropic-sources.md`, `research/openai-sources.md`, `research/other-sources.md`, `research/pricing-notes.md`.

## Momentum

- Enterprise generative-AI spend: $1.7B (2023) to $11.5B (2024) to $37B (2025), of which foundation-model APIs $12.5B and coding/dev tools $7.3B (Menlo Ventures, Dec 2025). Model-API spend doubled in H1 2025 alone.
- The vendor race flips monthly: Anthropic 32% usage share mid-2025, 40% enterprise spend share end-2025, 43.5% of US businesses using Anthropic vs 39.7% OpenAI (Ramp AI Index, Aug 2026). 37% of organizations run five or more models. A single-vendor tracker is stale on arrival.
- Business AI adoption crossed 50% in March 2026. Spend is concentrated: the top 1% of businesses spend a median $7,400 per employee; the median firm $11.95 (Ramp, Aug 2026).
- Seats at scale: ChatGPT Enterprise 4M+ seats, GitHub Copilot 4.7M paid, Microsoft 365 Copilot 20M+ paid seats, Cursor ~$4B ARR with large corporates now ~60% of revenue.
- FinOps has moved: 98% of organizations now manage AI spend (31% two years ago), AI cost management is the #1 skill gap, and FOCUS 1.4 (June 2026) added the first token-economics columns. An "AI FinOps" job title exists.
- Shadow AI: 57-66% of professionals use unsanctioned AI tools; large firms carry 250+ unauthorized AI tools; 51-53% of SaaS seats go unused.

## Pain, with evidence

- Claude weekly limits (Aug 2025) and repeated limit shocks (Jan 2026, Mar 2026: "20x max usage gone in 19 minutes", 330+ comments). Users report $1,850 to $15,000 of API-equivalent usage per month on $100-300 plans, and one $50,000-equivalent month on a $200 plan.
- Cursor's June 2025 switch to $20 of usage credits produced surprise overages, a CEO apology and 2026 repeats ($4,600 in six weeks for a five-person team).
- GitHub Copilot's September 2026 credit cliff (-37% Business, -44% Enterprise allowances) with the advice "export per-seat credit consumption before the reset".
- "Most IT and finance teams layer two or three tools to cover both per-seat and per-token bills" (Torii, 2026). Agencies reconstructing client usage after the fact miss 15-20%.
- Demand proof: ccusage 13.2k stars and 84.6k weekly npm downloads; CodexBar, Claude-Code-Usage-Monitor, ccflare, cursor-stats, browser extensions; Toolspend #2 on Product Hunt (Feb 2026); Claude Usage Tracker launched twice in 2026.

## Competitive landscape

Five buckets, each solving a slice:

1. Developer observability (Helicone $79-799/mo, Langfuse $29-2,499/mo, LangSmith $39/user, Portkey, LiteLLM, Braintrust, Arize, Datadog/New Relic): instrument your own app's LLM calls; blind to subscriptions and seats.
2. Cloud FinOps with AI connectors (Vantage, CloudZero, Finout, Apptio): enterprise-priced, cloud-bill DNA.
3. SaaS management adding AI modules (Zylo, Torii, Productiv, Zluri, Spendflo, Vendr, Josys): quote-based, procurement-led, no individual entry point.
4. Fintech cards (Cledara, Ramp, Brex): only see what is paid on their card.
5. Single-user OSS utilities (ccusage, CodexBar, extensions): free, trusted, one machine, no team layer, no business model.

Whitespace: nobody unifies subscription seats and API/token cost in one data model, starts free and local, scales to a team product without re-platforming, and speaks to both the engineer and the finance buyer. FOCUS-1.4-native token export is unclaimed. The window is open but not empty (Toolspend, tokenkarma, Claude Usage Tracker; Torii/Zylo moving down-market).

## ICP ranking (pain x reach x willingness to pay)

1. Engineering leads at 10-200 person software companies: own the Cursor/Copilot renewal, get blindsided by expensed subscriptions, self-serve buyers, already the ccusage demographic.
2. Individual developers on Max/Pro/Cursor: largest reach, best-evidenced pain, low willingness to pay: the trust and distribution funnel.
3. IT/finance/FinOps at 200-2,000 person companies: biggest checks, strongest tailwind, slower cycles, incumbents circling.
4. AI-native startups with API bills; 5. Agencies billing back; 6. Universities.

## Pricing

| Tier | Price | Why |
|---|---|---|
| Free (local) | $0 | The market has normalized free local trackers; this tier buys trust and distribution. |
| Plus (individual) | $7/month | Raycast Pro parity ($8-10); expensable without approval; cloud sync, history, alerts, extension. |
| Team | $5/seat/month, 5-seat minimum | Far under Helicone Team ($799 flat) and Langfuse bands; self-serve, no procurement under ~50 seats. |
| Business / Enterprise | ~$8-15/seat or 0.3-0.8% of tracked spend, ~$1,500-2,000/month floor | FOCUS export, SSO/SCIM, audit, EU residency, chargeback; a fraction of SaaS-management suites. |

Illustrative year-1 model: 50k free users, 3-5% to Plus ($125-210k ARR), 200 teams x 12 seats ($144k ARR), 5 business logos at $30k ($150k ARR): roughly $400-500k ARR. Not a forecast.

## Go-to-market

npm/Homebrew CLI, GitHub OSS core, awesome-claude-code lists, Product Hunt (category proven), r/ClaudeAI, r/ClaudeCode, r/cursor, Show HN with real usage, VS Code / Raycast / Claude Code plugin surfaces, Slack app for team digests, FinOps Foundation community, vendor integration listings.

Content that already has demand: "what your $200 Max plan is worth in API dollars", the Copilot credit cliff seat audit, "30 days of Claude Code across 40 engineers", FOCUS 1.4 token columns in an afternoon, the honest roundup of DIY trackers.

Launch moves: ship the free CLI and get listed in curated lists in week one; Product Hunt with the "every AI plan you pay for, in one free local app" framing; the Copilot cliff piece and a no-login plan-value calculator; Show HN once usage exists; white-glove the first 10-20 Team logos found in the public rate-limit threads.

## Risks and answers

- Vendors ship native dashboards: no vendor will show its competitors side by side; the moat is cross-vendor unification plus individual-to-team continuity.
- Local formats and APIs change without notice: connector abstraction, fixture tests, treat format changes as routine maintenance (as ccusage does), prefer official APIs as they expand (FOCUS trend).
- ToS: read only local files the client writes and official admin APIs; browser collection strictly opt-in and disclosed; no consumer OAuth token reuse. Legal review before Team connectors ship.
- Trust for a company-wide collector: metadata-only as a hard architectural line, open-source client, SOC 2 before Business pricing, EU region option.
- Platform risk (vendors restricting third-party tools at scale): unresolved; monitor.

## Open questions answered by this analysis

- Who first? Engineering leads at 10-200 person companies, reached through the free individual tool.
- Free vs paid line? Free is local and single-machine; paid starts where data leaves the machine (sync, alerts, team views).
- Name: `clai` is taken on npm by an unrelated React package; ship as `@claii/cli` (bin `clai`) or `clai-cli`; secure the domain and the npm org early.
