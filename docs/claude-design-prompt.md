# Prompt for Claude Design

Paste everything below the line into Claude Design. It assumes `docs/design-principles.md` is the brief; the rules are repeated inside so the prompt stands alone.

---

You are designing the visual identity and first surfaces for **clai**, an AI usage and cost tracker for developers and the finance leads who approve their tools. clai reads the usage records that Claude Code, Codex, Gemini CLI, Cursor and Copilot already keep, prices every token with a maintained catalog, and shows what each plan is worth, what next month will cost, and where money is wasted. It is free and local for one person and priced per seat for teams. Its promise is honest numbers, so the design must feel like a precise instrument: a bank statement, a multimeter, a good terminal. It must not look like a 2026 AI SaaS template.

## Hard rules
- The hero is a number, rendered in the product's own components, never a slogan or an illustration. Illustrations of AI (brains, sparkles, robots, orbs, neural nets) are banned. No stock photos.
- Palette: ground #F6F7F4, surface #FFFFFF, ink #171D1A, muted #5C665F, rules #D9DFD9, accent (ledger green) #1E7A62 with soft #DDEFE7; warning amber #9A6D00; critical red #A83A3A. Dark theme: ground #101513, surface #161C19, ink #E6EBE7, muted #98A39C, rules #2A3330, accent #4FBE9C with soft #173B31, amber #D9A441, red #E06C6C. One accent, spent sparingly. No gradients, glass, glow, neon-on-black or purple-to-blue.
- Type: Fraunces 500-600 for the wordmark and section titles only; IBM Plex Sans for body; IBM Plex Mono with tabular figures for every number, unit, command and label. Amounts right-align. Formats: $0.0042, $12.35, $1,234; 12.3k and 4.5M tokens. Do not substitute Inter, Space Grotesk, Geist or similar.
- Every figure shows its basis as a small label: "billed", "computed (API-equivalent)" or "estimated".
- Charts: axes start at zero and are labelled, gridlines use the rule color, one color per provider (Anthropic, OpenAI, Google, Cursor, GitHub) held constant everywhere, endpoints emphasized, no smoothing, no axis-less sparklines for numbers that matter.
- Layout: left-aligned, running text about 65 characters wide, sections sized by content, ledgers/tables/label-value lists as first-class components, radius 4-6px, borders and shadows only to lift one element. No card-in-card, no accent rails, no centered hero stack, no 100vh opener.
- Copy is specific and in the user's words. Banned: supercharge, unlock, seamless, AI-powered, 10x, effortless, magic, next-gen. Buttons say what happens.
- Motion only to explain a change, once (a bar filling, a number counting up). Honour reduced motion.
- Design light and dark as equals with checked contrast; visible keyboard focus; 40px targets.
- Where data is collected, state plainly what leaves the machine: nothing in local mode, usage metadata only in team mode.

## Real content to use (do not invent numbers)
- Hero figure: "Your Claude Max 5x plan delivered $3,865 of API-priced work in August. 38.6x its price." Basis label: computed (API-equivalent). Sub-line: 20,791 requests, 7.48B tokens read from cache, 20.1M output tokens.
- Three commands: `npx @claii/cli scan`, `npx @claii/cli insights`, `npx @claii/cli dashboard`.
- Insight examples: "82% of Anthropic spend runs on frontier models. Routing 30% of it to Sonnet 5 would save about $585 per month." "Average agent request carries 359k tokens of context; cache reads are 93% of agent cost." "2026-08-19: $774 spent, 7.9x the typical $98." "3 of 12 paid seats had no activity in 30 days: $375 per month."
- Providers and sources: Claude Code, Codex CLI, Gemini CLI, OpenCode, Cline, Aider, Anthropic Admin API, OpenAI Admin API, OpenRouter, Cursor Admin API, GitHub Copilot, claude.ai and ChatGPT exports.
- Tiers: Free (local, all connectors, dashboard, insights); Plus $7/month (sync across devices, 12-month history, alerts, browser extension for claude.ai and chatgpt.com limits); Team $5/seat/month, 5-seat minimum (member sync, admin connectors, people and idle-seat view, team budgets, exports; self-hosted server is open source); Business by quote (SSO/SCIM, audit log, EU residency, FOCUS 1.4 export, Slack digests, chargeback).
- Privacy line: "clai reads token counts, model ids, timestamps and project labels. It never reads or stores prompt content. In local mode nothing leaves your machine."
- Wordmark: "clai", lowercase, optionally with a small tally glyph (four strokes and a diagonal) in the accent.

## Deliverables
1. Two identity directions on one canvas, each with a wordmark, the palette applied, a type specimen with numbers, and one hero. One direction takes a real risk (for example a receipt/tape metaphor with perforated edges rendered in CSS, or a meter-needle hero), the other is the calm ledger. Then converge on one.
2. Landing page at 1440 and 390 widths, light and dark: hero with the live plan-value figure and a "what is your plan worth" calculator (inputs: plan, last month's tokens in / cached / out; output: the multiple), the three commands, a ledger section showing an overview table with real rows, an insights section with three cards, the privacy statement, the pricing table, a short FAQ, footer.
3. Dashboard overview restyled with the identity, keeping the existing information architecture: filter bar (range, provider, project, billing), four stat tiles (this month, projected month-end with confidence, today, last month delta), daily stacked bars by provider, breakdowns by provider and model, subscription value cards, budget bars, top three insights. 1440 and 1024 widths, light and dark.
4. Pricing page (the four tiers as a comparison table, not cards), and an Open Graph card 1200x630 with the hero number.
5. A tokens sheet: CSS variables for colors, type scale (12/14/16/20/26/34), spacing scale (4/8/12/16/24/32/48), radius, chart series colors per provider, and component names for stat tile, ledger table, basis label, insight card, filter bar.

Show real content on every artboard. Keep everything in the two typefaces and the palette above. When in doubt, remove.
