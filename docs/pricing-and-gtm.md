# Pricing and go-to-market

## Tiers

| Tier | Price | Includes | Gate |
|---|---|---|---|
| Free (local) | $0 | CLI, all local connectors, exports import, reports, insights, local dashboard, pricing catalog, `clai ask` with your own key | Single machine; nothing leaves the device |
| Plus | $7/month or $60/year | Hosted sync across devices, 12-month history, budget/anomaly/plan-value alerts (email, Slack), browser extension for claude.ai / chatgpt.com limits, priority catalog updates | Individual accounts |
| Team | $5/seat/month, 5-seat minimum (self-hosted server is free and open source) | Member sync with attribution, admin API connectors (Anthropic, OpenAI, OpenRouter, Cursor, Copilot), people and seats views, team budgets, CSV/JSON export, member/admin tokens | Hosted convenience, support, alerts |
| Business / Enterprise | $8-15/seat or 0.3-0.8% of tracked spend; ~$1,500-2,000/month floor | SSO/SCIM, audit log, EU residency, FOCUS 1.4 export, Slack/Teams digests, chargeback module, priority connectors (Bedrock, Azure, Vertex, M365, gateways), SLA | Contract |

Principles: never charge for what the market treats as free (local, single-user); charge where data crosses a boundary (devices, people, systems) and where the buyer changes (finance/IT).

## Revenue model (illustrative, not a forecast)

- 50,000 free users in year one (ccusage alone does 84.6k weekly downloads); 3-5% to Plus = $125-210k ARR.
- 200 teams x 12 seats x $5 = $144k ARR.
- 5 business logos x $30k = $150k ARR.
- Blended ~$400-500k ARR; the compounding lever is free users championing Team inside their companies.

## Launch sequence

1. Week 1: publish `@claii/cli` (bin `clai`), Homebrew tap, README with a 20-second demo GIF; PRs to awesome-claude-code and similar lists; announce in r/ClaudeAI, r/ClaudeCode, r/cursor with real numbers from the author's own usage (this repo's `clai doctor` cross-check is the credibility hook).
2. Week 2: landing page with the no-login "what is your plan worth" calculator; blog post "What your $200 Max plan is actually worth in API dollars".
3. Week 3: Product Hunt (Tuesday-Thursday) with "every AI plan you pay for, in one free local app"; Show HN once there are real users.
4. Weeks 3-6: reach out to engineering leads in the public rate-limit threads; free white-glove setup of the team server for the first 10-20 logos; capture testimonials and a "30 days across N engineers" post.
5. Month 2+: FinOps Foundation community and FOCUS 1.4 content for the finance buyer; vendor integration listings once connectors are proven against live orgs.

## Positioning

clai is the one place that shows individuals and companies what their AI stack actually costs and who really uses it, unifying subscription seats and API spend into one trustworthy view that starts free and local and scales into a FinOps-ready dashboard for the whole company.

Tagline shortlist: "Know what your AI actually costs." / "One dashboard. Every AI bill." / "See your AI spend before the invoice does."
