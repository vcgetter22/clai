# Draft launch post: What your $200 Claude Max plan is actually worth

*Working draft for the blog, Product Hunt maker comment and the Show HN text. Numbers are from a real machine; swap in your own before publishing.*

Last month my Claude Code sessions consumed 7.5 billion input tokens and 21 million output tokens. At Anthropic's list prices that is $3,865 of API usage. My Max 5x plan costs $100. That is 39x. I only know this because I wrote a tool to count it, and counting turned out to be harder than it looks. (ccusage, the most-used open-source tracker, reads the same files with its own price table and lands on the same $3,864.54 for the month, to the cent.)

## Nobody shows you this number

Anthropic shows a percentage of a weekly limit. OpenAI shows a message cap. Cursor shows credits. GitHub is switching Copilot to AI credits with a 37 to 44 percent cut to the promotional allowance this month. Each dashboard shows what you paid one vendor; none shows what you used, in dollars, across all of them. If you run a team, add the seats nobody logs into and the API keys nobody remembers creating.

## clai

`npx @claii/cli scan` reads the usage records your tools already keep on disk (Claude Code, Codex CLI, Gemini CLI, OpenCode, Cline, Aider), prices every token against a maintained catalog of 147 models, and shows you:

- what each plan is worth in API-equivalent dollars, and whether to upgrade, keep or drop it,
- a month-end projection with confidence, and budgets with a breach date,
- the days that spiked and the sessions that cost the most,
- where the money actually goes: 82 percent of mine was Opus 5, and 93 percent of the agent cost was cache reads and writes, because every turn of a long session re-sends the whole conversation.

It is local and free. Nothing leaves your machine. It reads token counts, model ids and timestamps, never prompt text. Teams run the same engine as a server and connect the Anthropic, OpenAI, Cursor, Copilot and OpenRouter admin APIs for per-person cost.

## Two things I learned counting tokens

**Claude Code's `/stats` double counts.** Claude Code writes one transcript line per streamed content block (thinking, text, tool call), and each line repeats the message's usage. Its own daily counters add up every line; on three days I checked they matched the line-by-line sum exactly. The API bills each request once. So `/stats` shows about twice the tokens you are billed for.

**The popular fix undercounts.** The obvious dedup, keeping the first line per message, is what ccusage does. But the final output token count only appears on the last line of a message. On my machine that is the difference between 13.1M and 21.2M output tokens, or $3,716 and $3,878 for the month. clai keeps one event per request and takes the maximum across its lines.

## Try it

```bash
npx @claii/cli scan
npx @claii/cli plan set anthropic max_20x
npx @claii/cli insights
```

Then tell me your multiple.
