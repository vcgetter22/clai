# Pricing catalog research notes

Compiled 2026-09-03 for `clai`. Companion file: `pricing-catalog.draft.json` (126 models, 99 verified live / 27 unverified, 23 non-token prices, 34 subscription plans). JSON validated with `node -e "JSON.parse(...)"`.

**Verification rule applied:** `"verified": true` only where a number was read on an official vendor page *during this session*, with that exact URL in `"source"`. Everything else is `"verified": false` with the reasoning and best-available figure (never invented) in `"note"`.

---

## 1. Sources actually read this session (by provider)

| Provider | Pages read | Outcome |
|---|---|---|
| Anthropic | `platform.claude.com/docs/en/about-claude/pricing`, `.../models/overview`, `.../about-claude/model-deprecations` | Full model-pricing table, full deprecation history table with exact dates. **Best-covered provider.** |
| OpenAI | `developers.openai.com/api/docs/pricing` (raw browser text, incl. expanding the "All models" dropdown), `.../api/docs/models` | Full current + legacy pricing table via browser interaction. `openai.com/api/pricing/` (404) and `openai.com/chatgpt/pricing/` (403 + Cloudflare challenge) failed. |
| Google | `ai.google.dev/gemini-api/docs/pricing`, `cloud.google.com/vertex-ai/generative-ai/pricing` (redirects to the rebranded "Agent Platform" pricing page) | Extremely thorough — also yielded xAI, DeepSeek, Meta Llama, and Mistral **partner** pricing tables on the same Google page. |
| xAI | `docs.x.ai/docs/models` | Full current pricing; confirmed legacy names (grok-4, grok-3, grok-3-mini, grok-code-fast-1) are gone. |
| Mistral | `mistral.ai/pricing/api` | Full current pricing table; devstral/magistral/pixtral absent. |
| DeepSeek | `api-docs.deepseek.com/quick_start/pricing/` | Full current V4 pricing (peak/off-peak, cache hit/miss). |
| Cohere | `cohere.com/pricing` (WebFetch content extraction) | Legacy Command family confirmed; command-a-03-2025 and embed-v4 explicitly **not** on the page. |
| Perplexity | `docs.perplexity.ai/getting-started/pricing` | sonar, sonar-pro, sonar-reasoning-pro, sonar-deep-research confirmed. |
| Amazon Bedrock | `aws.amazon.com/bedrock/pricing/` | **Failed** — heavy client-rendered SPA; per-provider rate tables only populate after clicking a JS tab, and browser automation against it repeatedly timed out / returned stale-looking content (see §3). |

---

## 2. Coverage summary vs. the requested list

- **Anthropic**: All requested models present, including the full historical retirement chain (Claude 2/2.1/1.x back to 2024, though those pre-date the "still billed" cutoff and were left out of the JSON as out of scope). 17/21 verified live.
- **OpenAI**: Far larger current catalog than expected — GPT-5.x has progressed through 5.1/5.2/5.4/5.5 to a **GPT-5.6 "Sol/Terra/Luna"** flagship generation, plus a "Daybreak" cybersecurity sub-line (gpt-5.6-cyber) and Codex now at gpt-5.3-codex. All confirmed live. Gaps: embeddings (no Embeddings section on the live pricing page at all — see §3), whisper-1/tts-1/gpt-4o-mini-tts, gpt-image-1, computer-use-preview, codex-mini-latest.
- **Google**: Gemini has a whole **3.x generation** (3, 3.1, 3.5, 3.6, 3.7, 3.8) not in the task's base assumptions. No plain GA "Gemini 3 Pro" row was found — only "Gemini 3.1 Pro Preview" — flagged in that model's note.
- **xAI, Mistral, DeepSeek**: current-generation lineups have all moved on from the model names in the task brief (grok-4→grok-4.6 etc., mistral -latest names now display as "Large 3/Medium 3.5/Small 4", deepseek-chat/reasoner→deepseek-v4-flash/pro). See §4.
- **Cohere, Perplexity**: mostly covered; a few current-gen items (command-a-03-2025, embed-v4, sonar-reasoning non-pro) could not be confirmed live.
- **Meta Llama, Amazon Nova**: Llama verified via Google's Vertex partner catalog (not Bedrock directly). Nova entirely unverified — Bedrock's own page could not be scraped.
- **OpenRouter aliases**: NOT scraped from a live top-30 list — `openrouter.ai/models` renders its model grid via client-side JS/virtualization that resisted both WebFetch and browser `get_page_text` (only nav chrome and filter counts came through). Two real slugs were incidentally confirmed (`google/gemini-3.8-flash`, `anthropic/claude-fable-5.1`) via an early fetch, validating the standard `provider/model-id` convention. All other OpenRouter aliases in the JSON are **constructed** from that convention, not individually scraped — treat them as "likely correct format" rather than verified.

---

## 3. Sources that resisted extraction (and what was done instead)

- **`aws.amazon.com/bedrock/pricing/`**: A React SPA where selecting a provider (Meta, Amazon, etc.) from a tab list loads that provider's rate table via client-side JS. Repeated browser automation (`scroll_to` + click, both by ref and by coordinate) either landed on the wrong section or the pane became unresponsive/timed out. `get_page_text` reliably returned only the page's static "worked pricing examples" prose for every provider (which references stale/irrelevant models like Llama 2 and old Claude 3.5 Sonnet rates baked into old marketing copy) — this content was explicitly **discarded** rather than used, since it doesn't reflect current per-model rates. Result: Amazon Nova (micro/lite/pro/premier) pricing is entirely `verified: false`, sourced from third-party aggregators via WebSearch instead.
- **OpenAI embeddings** (`text-embedding-3-small/large`, `ada-002`): the live `developers.openai.com/api/docs/pricing` page — read in full, including its expanded "All models" view — has categories for Flagship / Cyber / Multimodal / Tools / Specialized / Finetuning only. **No Embeddings section exists on that page as fetched.** This could mean embeddings moved to a separate, unfetched page, or genuinely aren't merchandised there anymore. Numbers in the JSON are from WebSearch aggregation of third-party sites, not the vendor.
- **`x.ai/grok`, `perplexity.ai/pricing`**: `x.ai` returned HTTP 403 to WebFetch. `perplexity.ai` triggered an active Cloudflare "verifying you are human" interstitial in the browser — per the standing rule against bypassing bot-detection/CAPTCHAs, this was **not** attempted further; subscription prices for both are WebSearch-sourced only.
- **`openai.com/chatgpt/pricing/`**: HTTP 403 via WebFetch; the browser also hit a Cloudflare challenge page. Same treatment — left unverified, WebSearch-sourced.
- **`mistral.ai/products/le-chat`**, **`one.google.com/about/google-ai-plans/`**: both fetched successfully and confirmed plan *names and features*, but the actual price digits render client-side (Google's page came back in German with literal `/Monat` placeholders and no numbers). Subscription price figures for Le Chat and Google AI Pro/Ultra are therefore WebSearch-sourced despite the page itself having been read.
- **`openrouter.ai/models`**: see §2 above.

---

## 4. Notable surprises vs. the cached table / task assumptions

1. **Claude Sonnet 5 pricing is now permanent at $2/$10.** The live Anthropic pricing page explicitly states the previously-announced increase to $3/$15 (scheduled for 2026-09-01, i.e. two days before this research) **will not occur**. This is a direct, dated confirmation worth flagging since "today" is 2026-09-03.
2. **Claude Sonnet 4.5 uniquely keeps a long-context premium.** Every model from the 4.6 generation onward (and Fable 5/5.1) gets the full 1M window at flat standard pricing per Anthropic's own text — but Sonnet 4.5 still doubles input (2x) and multiplies output 1.5x above 200K tokens, confirmed via Google Vertex's partner table (which otherwise mirrors Anthropic's first-party rates exactly). This matches the multiplier pattern in the task's schema skeleton, but it turns out to apply to only **one** currently-billed model, not the whole lineup.
3. **Claude 3.x-generation models have (mostly) fully exited the live pricing table.** Only Opus 4/4.1, Sonnet 4, and Haiku 3.5 get an explicit "retired, except on Bedrock and Google Cloud" carve-out on Anthropic's current pricing page. Claude 3 Haiku, Claude 3.5 Sonnet, Claude 3 Opus, and Claude 3.7 Sonnet get **no such carve-out** — they're simply absent, suggesting they may be more completely gone (though partner platforms set independent schedules, so this isn't certain). Retirement dates for all of these were confirmed precisely from Anthropic's official deprecations page.
4. **OpenAI's naming has moved well past GPT-5**: 5→5.1→5.2→5.4→5.5→5.6, with the current flagships branded "Sol/Terra/Luna" (GPT-5.6) rather than the mini/nano suffix pattern the task assumed, plus a "Daybreak" cyber-security sub-line and Codex now at 5.3. `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-5-pro`, `gpt-4.1`, `gpt-4o` etc. are all still live and billed at their original prices, just no longer flagship.
5. **DeepSeek retired `deepseek-chat`/`deepseek-reasoner` on 2026-07-24.** These are the two model-ID strings a cost tracker with historical logs is most likely to see, and they now return errors rather than resolving. Corroborated by multiple sources including URLs on `api-docs.deepseek.com` itself, though the specific changelog page content wasn't directly re-read this session (kept `verified: false` on the retirement claim out of caution). Replacements: `deepseek-v4-flash` / `deepseek-v4-pro`, both with a 2x peak-hours multiplier (01:00-04:00 & 06:00-10:00 UTC weekdays).
6. **xAI has fully retired the grok-4/grok-3/grok-3-mini/grok-code-fast-1 names** used in the task brief — confirmed by explicit absence from `docs.x.ai/docs/models`. Current lineup: grok-4.6, grok-4.5, grok-4.3, grok-4.20 (reasoning/non-reasoning), grok-build-0.1 (coding), grok-4.1-fast (reasoning/non-reasoning). All xAI models show a uniform 2x/2x (input/output) premium above 200K tokens.
7. **Mistral's `-latest` display names have changed** to version-number branding ("Mistral Large 3", "Medium 3.5", "Small 4") and — per third-party coverage only — **Mistral Small 4 (released 2026-03-16) reportedly absorbed Magistral's reasoning, Pixtral's vision, and Devstral's coding into one configurable model**, which would explain why none of those three appear as separate SKUs on Mistral's own live pricing page anymore. This is flagged as unverified context, not asserted as fact.
8. **Google Cloud's Vertex AI product has been renamed "Agent Platform"** in its own pricing-page title as of this session — noted in case downstream tooling references the old name.
9. **Meta Llama pricing differs meaningfully between the aggregator figures and Google's official Vertex partner table** — e.g. Llama 4 Maverick: aggregators said $0.24/$0.97, Vertex's own page says $0.35/$1.15. The Vertex number is used in the JSON (official page > aggregator), but this is a reminder that Bedrock, Vertex, and any given model's "native" API can all legitimately charge different rates for the same open-weight model.
10. **Google's cache-read multiplier is a clean 0.1x of base input** across every Gemini model checked (not the 0.25x suggested in the task's schema skeleton) — e.g. Gemini 2.5 Pro $1.25 → $0.125 cached, Gemini 3.8 Flash $0.75 → $0.075 cached. Recorded in `rules.google` with an explicit note about the discrepancy from the skeleton's suggested value.
11. **OpenAI now publishes an explicit "Cache writes" price** on its flagship GPT-5.6 models (distinct from "Cached input"), which the schema doesn't have a dedicated field for — mapped into `cache_write_5m` with a clarifying note that it isn't a 5-minute-TTL concept like Anthropic's field of the same name.

---

## 5. Fields deliberately left `null` rather than guessed

- `released` dates: left `null` almost everywhere. Very few pages stated an exact release date for current-generation models; the one included exception is Mistral Small 4 (2026-03-16, itself only third-party-sourced, flagged accordingly) and Cohere Command A (2025-03-13, also third-party-sourced).
- OpenAI GPT-5.6 family `long_context.threshold_input_tokens`: the pricing page labels columns "Short context" / "Long context" without ever stating the numeric token boundary (unlike Anthropic's and Google's explicit "200K" labeling) — left `null` rather than assumed to be 200,000.
- `gemini-3-flash-preview` output price: the captured table row only showed an Input column; no Output figure was visible in the fetched content, so `output: null`.
- Amazon Nova and most OpenAI embedding/audio models: prices are WebSearch-derived, `verified: false`, and cited transparently in each model's `note`.

---

## 6. How to keep this catalog current

- The single highest-value re-check is **`developers.openai.com/api/docs/pricing`** — its "All models" dropdown must be clicked (not just the default collapsed view) to see the full legacy table; a plain WebFetch only returns the default view.
- **`cloud.google.com/vertex-ai/generative-ai/pricing`** is unusually valuable as a *single* source for cross-checking Anthropic, Google, xAI, DeepSeek, Meta, and Mistral partner pricing all on one page — worth re-fetching first on future passes.
- Amazon Bedrock's own pricing page needs a different approach next time (e.g. AWS's pricing API/calculator JSON endpoints, or a headless browser with longer waits per tab) — plain WebFetch and this session's browser-automation attempts both failed.
- Cloudflare-gated pages this session (`perplexity.ai`, `x.ai`, `openai.com/chatgpt/pricing`) should be retried with WebSearch first for a quick sanity check, since direct fetch/browse access could not be obtained without bot-detection bypass (which is out of policy).
