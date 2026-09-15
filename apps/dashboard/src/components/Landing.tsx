import { useState } from 'react';
import { SignIn } from './SignIn';

interface Props {
  onTokenSubmit: () => void;
  tokenError?: string | null;
}

/**
 * The landing page of the hosted service: what an unauthenticated visitor sees at the root in
 * hosted mode (`health.auth.kind === 'supabase'`). Self-hosted team servers keep the bare token
 * prompt and local mode never gates. Layout and copy follow docs/design-principles.md: the hero
 * is a real figure with its basis, ledger sections, one accent, no illustration.
 */

// The hero figure: the author's own machine, August 2026, one Claude Max 5x plan, priced at
// Anthropic list prices by `clai report` (docs/launch-post.md). Replace with a newer month by
// editing these four constants; never type a number the product did not produce.
const HERO = { usd: 3865, planLabel: 'Claude Max 5x', planUsd: 100, month: 'August 2026' } as const;

const PLANS: { key: string; label: string; usd: number }[] = [
  { key: 'claude-pro', label: 'Claude Pro', usd: 20 },
  { key: 'claude-max-5x', label: 'Claude Max 5x', usd: 100 },
  { key: 'claude-max-20x', label: 'Claude Max 20x', usd: 200 },
  { key: 'chatgpt-plus', label: 'ChatGPT Plus', usd: 20 },
  { key: 'chatgpt-pro', label: 'ChatGPT Pro', usd: 200 },
  { key: 'cursor-pro', label: 'Cursor Pro', usd: 20 },
  { key: 'copilot-pro', label: 'GitHub Copilot Pro', usd: 10 },
  { key: 'custom', label: 'Another plan', usd: 0 },
];

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

function Calculator() {
  const [planKey, setPlanKey] = useState('claude-max-5x');
  const [customUsd, setCustomUsd] = useState(50);
  const [usage, setUsage] = useState(HERO.usd);
  const plan = PLANS.find((p) => p.key === planKey) ?? PLANS[0]!;
  const price = planKey === 'custom' ? customUsd : plan.usd;
  const multiple = price > 0 ? usage / price : null;
  return (
    <div className="landing-calc">
      <div className="form-field">
        <label htmlFor="calc-plan">Plan</label>
        <select id="calc-plan" value={planKey} onChange={(e) => setPlanKey(e.target.value)}>
          {PLANS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
              {p.usd ? ` · $${p.usd}/month` : ''}
            </option>
          ))}
        </select>
      </div>
      {planKey === 'custom' && (
        <div className="form-field">
          <label htmlFor="calc-price">Plan price per month, USD</label>
          <input id="calc-price" type="number" min={1} step={1} value={customUsd} onChange={(e) => setCustomUsd(Number(e.target.value) || 0)} />
        </div>
      )}
      <div className="form-field">
        <label htmlFor="calc-usage">Last month's usage at API list prices, USD</label>
        <input id="calc-usage" type="number" min={0} step={1} value={usage} onChange={(e) => setUsage(Number(e.target.value) || 0)} />
      </div>
      <p className="landing-calc-result">
        {multiple === null ? (
          <span className="muted">Enter a plan price.</span>
        ) : (
          <>
            <span className="landing-figure mono">{multiple.toFixed(1)}×</span>
            <span className="muted">
              {' '}
              {usd(usage)} of API-priced work for {usd(price)} a month. Above 1.0× the plan pays for itself; below it, pay per token.
            </span>
          </>
        )}
      </p>
      <p className="privacy-note">
        The usage figure is the first line of <code>npx @claii/cli report</code>. Nothing here is sent anywhere.
      </p>
    </div>
  );
}

export function Landing({ onTokenSubmit, tokenError }: Props) {
  const multiple = (HERO.usd / HERO.planUsd).toFixed(1);
  return (
    <div className="landing">
      <header className="landing-top">
        <span className="wordmark">clai</span>
        <span className="muted mono">a cobank.ai product</span>
        <nav className="landing-nav mono">
          <a href="#pricing">Pricing</a>
          <a href="https://github.com/vcgetter22/clai" target="_blank" rel="noreferrer">
            Source
          </a>
          <a href="#signin">Sign in</a>
        </nav>
      </header>

      <section className="landing-hero">
        <p className="landing-figure mono">
          {usd(HERO.usd)} <span className="landing-multiple">{multiple}×</span>
        </p>
        <p className="landing-lede">
          One {HERO.planLabel} plan (${HERO.planUsd} a month) delivered {usd(HERO.usd)} of API-priced work in {HERO.month}.
        </p>
        <p className="basis-label mono">API-equivalent at Anthropic list prices · one developer's machine · computed by clai report</p>
        <p className="landing-text">
          clai reads the usage records your AI tools already keep on disk and prices every request against a maintained catalog. It shows what each plan is worth, where the money goes, and what next month will cost. Local and free. Hosted Plus keeps twelve months of history across your machines.
        </p>
        <pre className="landing-commands mono">
          {'npx @claii/cli scan\nnpx @claii/cli plan set anthropic max_5x\nnpx @claii/cli report'}
        </pre>
      </section>

      <section className="landing-section">
        <h2>What is your plan worth?</h2>
        <Calculator />
      </section>

      <section className="landing-section">
        <h2>What clai reads</h2>
        <table className="landing-table">
          <tbody>
            <tr>
              <th>Local tools</th>
              <td>Claude Code, Codex CLI, Gemini CLI, OpenCode, Cline, Aider: the transcript and session files on your disk.</td>
            </tr>
            <tr>
              <th>Exports</th>
              <td>claude.ai and ChatGPT data exports; token counts are estimated from text length and labelled estimated.</td>
            </tr>
            <tr>
              <th>Admin APIs (Team)</th>
              <td>Anthropic, OpenAI, OpenRouter, Cursor and Copilot usage and cost endpoints, per person.</td>
            </tr>
            <tr>
              <th>Never</th>
              <td>Prompt or response text. Token counts, model ids, timestamps and project labels only.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="landing-section" id="pricing">
        <h2>Pricing</h2>
        <table className="landing-table landing-pricing">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Price</th>
              <th>Includes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Free, local</th>
              <td className="mono">$0</td>
              <td>The CLI, every local connector, reports, insights, the local dashboard. Nothing leaves the machine.</td>
            </tr>
            <tr>
              <th>Plus</th>
              <td className="mono">$7 / month or $60 / year</td>
              <td>Hosted sync across devices, twelve months of history, budget and plan-value alerts. Sold to businesses at launch (VAT ID at checkout).</td>
            </tr>
            <tr>
              <th>Team</th>
              <td className="mono">$5 / seat / month, five seats minimum</td>
              <td>Member sync with attribution, admin API connectors, people and seat views, team budgets, CSV and JSON export. The self-hosted server is free and open source.</td>
            </tr>
            <tr>
              <th>Business</th>
              <td className="mono">by contract</td>
              <td>SSO, audit log, EU residency guarantee, FOCUS export, priority connectors, SLA.</td>
            </tr>
          </tbody>
        </table>
        <p className="privacy-note">Hosted in the EU (Frankfurt). Only usage metadata leaves your machine, and only when you run clai sync.</p>
      </section>

      <section className="landing-section" id="signin">
        <h2>Sign in</h2>
        <SignIn onTokenSubmit={onTokenSubmit} tokenError={tokenError} embedded />
      </section>

      <footer className="landing-footer mono">
        <a href="/legal/terms.html">Terms</a>
        <a href="/legal/privacy.html">Privacy</a>
        <a href="/legal/dpa.html">DPA</a>
        <a href="/legal/withdrawal.html">Withdrawal</a>
        <a href="/legal/impressum.html">Impressum</a>
        <a href="mailto:clai@cobank.ai">clai@cobank.ai</a>
        <span className="muted">clai, a cobank.ai product</span>
      </footer>
    </div>
  );
}
