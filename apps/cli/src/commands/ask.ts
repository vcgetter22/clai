import type { Command } from 'commander';
import { openContext, type GlobalOptions } from '../context.js';
import { dim, formatUsd, heading, printJson, table } from '../ui.js';

const SCHEMA = `
Table events (one row per API request or provider bucket):
  id TEXT, ts TEXT (ISO UTC), day TEXT (local YYYY-MM-DD), source TEXT (claude-code, codex-cli, gemini-cli, opencode, anthropic-admin, openai-admin, openrouter, cursor-admin, github-copilot, claude-export, chatgpt-export),
  provider TEXT (anthropic, openai, google, xai, ...), model TEXT (raw id), model_key TEXT (canonical id, NULL if unpriced),
  surface TEXT (api, cli-agent, ide, chat, batch), billing TEXT (api, subscription, unknown), plan TEXT, granularity TEXT (request, message, hour, day),
  actor_key TEXT (email/user id or 'me'), project TEXT, session_id TEXT,
  input_tokens INTEGER (uncached input), cache_read_tokens INTEGER, cache_write_5m_tokens INTEGER, cache_write_1h_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER, requests INTEGER,
  billed_usd REAL (provider-billed, may be NULL), computed_usd REAL (clai's price x tokens), cost_confidence TEXT.
Effective cost = COALESCE(billed_usd, computed_usd). Costs are USD. Context size of a request = input_tokens + cache_read_tokens + cache_write_5m_tokens + cache_write_1h_tokens.
Table subscriptions(id, json), budgets(id, json), seats(actor_key, json) hold declared plans as JSON.
`;

function extractJson(text: string): { sql?: string; explanation?: string } | null {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fence ? fence[1]! : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as { sql?: string; explanation?: string };
  } catch {
    return null;
  }
}

function assertReadOnly(sql: string): string {
  const s = sql.trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(s)) throw new Error('Generated SQL is not a SELECT statement; refusing to run it.');
  if (/;|\b(insert|update|delete|drop|alter|create|attach|pragma|replace|vacuum)\b/i.test(s)) throw new Error('Generated SQL contains a non-read statement; refusing to run it.');
  return /\blimit\b/i.test(s) ? s : `${s} LIMIT 200`;
}

export function registerAsk(program: Command): void {
  program
    .command('ask <question...>')
    .description('Ask a question about your usage in plain language (uses Claude; needs ANTHROPIC_API_KEY or `ant auth login`)')
    .option('--model <id>', 'Claude model', 'claude-opus-5')
    .option('--show-sql', 'print the generated SQL', false)
    .action(async (words: string[], opts: { model: string; showSql: boolean }, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const question = words.join(' ');
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const client = new Anthropic();
        const today = new Date().toISOString().slice(0, 10);
        const gen = await client.messages.create({
          model: opts.model,
          max_tokens: 2048,
          system: `You translate questions about AI usage and cost into a single SQLite SELECT query over this schema:\n${SCHEMA}\nToday is ${today}; the store timezone is ${ctx.store.timeZone}. Prefer the day column for date filters. Return JSON only: {"sql": "...", "explanation": "one sentence"}. Never modify data.`,
          messages: [{ role: 'user', content: question }],
        });
        const text = gen.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('');
        const parsed = extractJson(text);
        if (!parsed?.sql) throw new Error(`Could not get a query from the model. Raw answer:\n${text}`);
        const sql = assertReadOnly(parsed.sql);
        const rows = ctx.store.db.prepare(sql).all() as Record<string, unknown>[];
        const answer = await client.messages.create({
          model: opts.model,
          max_tokens: 1024,
          system: 'You are clai, an AI cost analyst. Answer the user\'s question from the query result in at most five sentences, with concrete numbers (USD, tokens). If the result is empty, say so.',
          messages: [{ role: 'user', content: `Question: ${question}\nSQL: ${sql}\nResult (JSON, up to 200 rows): ${JSON.stringify(rows.slice(0, 200))}` }],
        });
        const answerText = answer.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('');
        const cost = [gen.usage, answer.usage].reduce((a, u) => a + ((u.input_tokens ?? 0) * 5 + (u.output_tokens ?? 0) * 25) / 1e6, 0);
        if (ctx.json) return printJson({ question, sql, explanation: parsed.explanation, rows, answer: answerText });
        console.log(heading('clai ask') + dim(`  ${question}`));
        if (opts.showSql) console.log(dim(`  ${sql}`));
        if (rows.length) {
          const cols = Object.keys(rows[0]!);
          console.log(table(cols, rows.slice(0, 25).map((r) => cols.map((c) => (typeof r[c] === 'number' ? (c.includes('usd') ? formatUsd(r[c] as number) : String(r[c])) : String(r[c] ?? ''))))));
          if (rows.length > 25) console.log(dim(`  ... ${rows.length - 25} more rows`));
          console.log('');
        }
        console.log(answerText.trim());
        console.log(dim(`  (this question cost about ${formatUsd(cost)} on ${opts.model})`));
      } finally {
        await ctx.close();
      }
    });
}
