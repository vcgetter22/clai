import type { Budget, CostConfidence, DeclaredSubscription, LastRun, Seat, SourceInfo, TokenUsage, UsageEvent } from '../types';
import { ACTIVE_MODEL_KEYS, ACTOR_POOL, LOCAL_ACTOR, PROJECTS, SOURCES, findModel, type MockActor } from './catalog';
import { chance, hashSeed, mulberry32, pick, randFloat, randInt, randSoft, weightedPick, type Rng } from './rng';

const DAYS = 60;
const SEED = hashSeed('clai-mock-v1');

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter.toString(36)}`;
}

function dayStartUtc(daysAgo: number): Date {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - daysAgo);
  return start;
}

function computeCost(model: ReturnType<typeof findModel>, u: TokenUsage): number {
  const M = 1_000_000;
  const usd = (u.input / M) * model.input + (u.output / M) * model.output + (u.cacheRead / M) * model.cacheRead + (u.cacheWrite5m / M) * model.cacheWrite5m + (u.cacheWrite1h / M) * model.cacheWrite1h;
  return Math.round(usd * 1e6) / 1e6;
}

type SizeClass = 'small' | 'medium' | 'large';

const SIZE_RANGES: Record<SizeClass, { input: [number, number]; cacheBase: [number, number]; output: [number, number] }> = {
  small: { input: [150, 1800], cacheBase: [0, 2500], output: [80, 700] },
  medium: { input: [1800, 14000], cacheBase: [2500, 38000], output: [400, 2800] },
  large: { input: [9000, 55000], cacheBase: [18000, 185000], output: [900, 5500] },
};

function buildUsage(rng: Rng, sizeClass: SizeClass, isFirstInSession: boolean, model: string): TokenUsage {
  const r = SIZE_RANGES[sizeClass];
  const input = Math.round(randSoft(rng, r.input[0], r.input[1]));
  const cacheBase = Math.round(randSoft(rng, r.cacheBase[0], r.cacheBase[1]));
  const use1h = chance(rng, 0.06);
  let cacheRead = 0;
  let cacheWrite5m = 0;
  let cacheWrite1h = 0;
  if (isFirstInSession) {
    if (use1h) cacheWrite1h = cacheBase;
    else cacheWrite5m = cacheBase;
  } else {
    cacheRead = cacheBase;
    if (chance(rng, 0.4)) {
      const incr = Math.round(cacheBase * randFloat(rng, 0.02, 0.12));
      if (use1h) cacheWrite1h = incr;
      else cacheWrite5m = incr;
    }
  }
  const output = Math.round(randSoft(rng, r.output[0], r.output[1]));
  const usage: TokenUsage = { input, output, cacheRead, cacheWrite5m, cacheWrite1h, requests: 1 };
  if (model === 'gpt-5-codex') usage.reasoning = Math.round(output * randFloat(rng, 0.3, 0.6));
  if (chance(rng, 0.04)) usage.webSearches = randInt(rng, 1, 3);
  return usage;
}

interface BuildEventArgs {
  rng: Rng;
  ts: string;
  source: string;
  provider: string;
  model: string;
  surface: string;
  billing: string;
  plan?: string;
  actor: MockActor;
  project: string | null;
  sessionId?: string;
  usage: TokenUsage;
  confidence?: CostConfidence;
}

function buildEvent(args: BuildEventArgs): UsageEvent {
  const price = findModel(args.model);
  const confidence: CostConfidence = args.confidence ?? 'computed';
  let computedUsd: number | null = confidence === 'none' ? null : computeCost(price, args.usage);
  let billedUsd: number | null = null;
  if (confidence === 'billed' && computedUsd !== null) {
    billedUsd = Math.round(computedUsd * randFloat(args.rng, 0.97, 1.03) * 1e6) / 1e6;
  }
  const actorRecord: Record<string, string> = args.actor.key === 'me' ? { userId: 'local-user' } : { userId: args.actor.key, email: args.actor.email, name: args.actor.name };
  const context: Record<string, unknown> = {};
  if (args.sessionId) context.sessionId = args.sessionId;
  if (args.project) context.project = args.project;
  return {
    id: nextId('evt'),
    ts: args.ts,
    source: args.source,
    provider: args.provider,
    model: args.model,
    modelKey: confidence === 'none' ? null : args.model,
    surface: args.surface as UsageEvent['surface'],
    billing: args.billing as UsageEvent['billing'],
    plan: args.plan,
    granularity: 'request',
    actor: actorRecord,
    context,
    usage: args.usage,
    cost: { billedUsd, computedUsd, currency: 'USD', confidence },
  };
}

function pickActor(rng: Rng, teamMode: boolean, dayOffsetFromToday: number): MockActor {
  if (!teamMode) return LOCAL_ACTOR;
  // Devon goes quiet for the most recent 30 days — the deliberate "idle seat" story on the People page.
  const pool = dayOffsetFromToday < 30 ? ACTOR_POOL.filter((a) => a.key !== 'devon@clai.dev') : ACTOR_POOL;
  const weights: [MockActor, number][] = pool.map((a) => [a, a.key === 'aria@clai.dev' ? 3 : a.key === 'priya@clai.dev' ? 2.4 : a.key === 'sam@clai.dev' ? 2 : a.key === 'devon@clai.dev' ? 1.6 : 1.2]);
  return weightedPick(rng, weights);
}

function pickProject(rng: Rng): string | null {
  if (chance(rng, 0.08)) return null;
  const weights: [string, number][] = [
    ['clai-dashboard', 0.32],
    ['clai-server', 0.24],
    ['marketing-site', 0.14],
    ['infra-scripts', 0.12],
    ['mobile-app', 0.1],
    ['data-pipeline', 0.08],
  ];
  return weightedPick(rng, weights);
}

const SESSION_SOURCES: [string, number][] = [
  ['claude-code', 0.5],
  ['codex-cli', 0.32],
  ['gemini-cli', 0.18],
];

function providerOf(source: string): string {
  if (source === 'claude-code' || source === 'anthropic-admin') return 'anthropic';
  if (source === 'codex-cli') return 'openai';
  if (source === 'gemini-cli') return 'google';
  return 'other';
}

function modelsFor(source: string): [string, number][] {
  if (source === 'claude-code') {
    return [
      ['claude-opus-5', 0.16],
      ['claude-sonnet-5', 0.64],
      ['claude-haiku-4-5', 0.2],
    ];
  }
  if (source === 'codex-cli') return [['gpt-5-codex', 1]];
  if (source === 'gemini-cli') return [['gemini-2.5-flash', 1]];
  return [
    ['claude-opus-5', 0.25],
    ['claude-sonnet-5', 0.5],
    ['claude-haiku-4-5', 0.25],
  ];
}

function planFor(source: string): string {
  if (source === 'claude-code') return 'max_20x';
  if (source === 'codex-cli') return 'plus';
  return 'ai_pro';
}

export interface MockDataset {
  events: UsageEvent[];
  subscriptions: DeclaredSubscription[];
  budgets: Budget[];
  seats: Seat[];
  sources: SourceInfo[];
  lastRuns: LastRun[];
}

function generate(teamMode: boolean): MockDataset {
  const rng = mulberry32(SEED ^ (teamMode ? 0x9e3779b9 : 0));
  const events: UsageEvent[] = [];
  const now = new Date();
  const todayFraction = (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440;

  for (let offset = DAYS - 1; offset >= 0; offset--) {
    const dayStart = dayStartUtc(offset);
    const weekday = dayStart.getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const recency = (DAYS - 1 - offset) / (DAYS - 1);
    const trend = 0.6 + 0.7 * recency;
    const weekendFactor = isWeekend ? 0.35 : 1;
    const spike = offset === 11 || offset === 33; // two deliberate spike days -> anomaly insight material
    const noise = randSoft(rng, 0.82, 1.18);
    let dayFactor = trend * weekendFactor * (spike ? 2.4 : 1) * noise;
    if (offset === 0) dayFactor *= Math.max(0.12, todayFraction); // partial "today"

    const baseSessions = 6.5;
    const sessionCount = Math.max(0, Math.round(baseSessions * dayFactor));

    for (let s = 0; s < sessionCount; s++) {
      const source = weightedPick(rng, SESSION_SOURCES);
      const provider = providerOf(source);
      const project = pickProject(rng);
      const actor = pickActor(rng, teamMode, offset);
      const sessionId = nextId('ses');
      const startMinute = Math.round(randSoft(rng, 6 * 60, 22 * 60)); // biased toward waking hours
      let clock = new Date(dayStart.getTime() + startMinute * 60_000);
      const requestCount = randInt(rng, 3, 26);
      const useApiBilling = chance(rng, 0.08);
      const billing = useApiBilling ? 'api' : 'subscription';
      const plan = useApiBilling ? undefined : planFor(source);
      const models = modelsFor(source);

      for (let i = 0; i < requestCount; i++) {
        const sizeClass = weightedPick<SizeClass>(rng, [
          ['small', 0.58],
          ['medium', 0.32],
          ['large', 0.1],
        ]);
        const model = weightedPick(rng, models);
        const usage = buildUsage(rng, sizeClass, i === 0, model);
        let confidence: CostConfidence = 'computed';
        if (chance(rng, 0.015)) confidence = 'none';
        else if (chance(rng, 0.03)) confidence = 'estimated';
        events.push(
          buildEvent({
            rng,
            ts: clock.toISOString(),
            source,
            provider,
            model,
            surface: 'cli-agent',
            billing,
            plan,
            actor,
            project,
            sessionId,
            usage,
            confidence,
          }),
        );
        clock = new Date(clock.getTime() + randInt(rng, 15, 260) * 1000);
      }
    }

    // Direct API usage via the Anthropic admin/usage export — separate from any CLI session.
    const adminCount = Math.round(randSoft(rng, 0, 5) * dayFactor);
    for (let i = 0; i < adminCount; i++) {
      const minute = Math.round(randSoft(rng, 0, 1440));
      const ts = new Date(dayStart.getTime() + minute * 60_000).toISOString();
      const model = weightedPick<string>(rng, [
        ['claude-opus-5', 0.3],
        ['claude-sonnet-5', 0.45],
        ['claude-haiku-4-5', 0.25],
      ]);
      const sizeClass = weightedPick<SizeClass>(rng, [
        ['small', 0.5],
        ['medium', 0.35],
        ['large', 0.15],
      ]);
      const usage = buildUsage(rng, sizeClass, chance(rng, 0.5), model);
      const project = chance(rng, 0.5) ? pickProject(rng) : null;
      events.push(
        buildEvent({
          rng,
          ts,
          source: 'anthropic-admin',
          provider: 'anthropic',
          model,
          surface: 'api',
          billing: 'api',
          actor: pickActor(rng, teamMode, offset),
          project,
          usage,
          confidence: 'billed',
        }),
      );
    }
  }

  events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  const subscriptions: DeclaredSubscription[] = [
    { id: 'sub-max20x', provider: 'anthropic', plan: 'max_20x', label: 'Claude Max 20x', priceMonthly: 200, appliesTo: { sources: ['claude-code'] } },
    { id: 'sub-chatgptplus', provider: 'openai', plan: 'plus', label: 'ChatGPT Plus (Codex)', priceMonthly: 20, appliesTo: { sources: ['codex-cli'] } },
    { id: 'sub-googleaipro', provider: 'google', plan: 'ai_pro', label: 'Google AI Pro', priceMonthly: 19.99, appliesTo: { sources: ['gemini-cli'] } },
  ];
  const budgets: Budget[] = [
    { id: 'budget-overall', name: 'Overall monthly cap', amountUsd: 600, period: 'month' },
    { id: 'budget-dashboard', name: 'clai-dashboard project', amountUsd: 150, period: 'month', scope: { project: 'clai-dashboard' } },
  ];
  const seats: Seat[] = teamMode
    ? [
        { actorKey: 'aria@clai.dev', label: 'Aria Chen', provider: 'anthropic', plan: 'team_standard', priceMonthly: 25 },
        { actorKey: 'devon@clai.dev', label: 'Devon Ruiz', provider: 'anthropic', plan: 'team_standard', priceMonthly: 25 },
        { actorKey: 'priya@clai.dev', label: 'Priya Nair', provider: 'openai', plan: 'business', priceMonthly: 30 },
      ]
    : [];

  const sources: SourceInfo[] = SOURCES.map((source) => {
    const rows = events.filter((e) => e.source === source);
    return {
      source,
      events: rows.length,
      first: rows.length ? rows[0]!.ts : null,
      last: rows.length ? rows[rows.length - 1]!.ts : null,
    };
  });

  const lastRuns: LastRun[] = SOURCES.map((source) => {
    const rows = events.filter((e) => e.source === source);
    const todaysRows = rows.filter((e) => e.ts.slice(0, 10) === now.toISOString().slice(0, 10));
    const started = new Date(now.getTime() - randInt(rng, 2, 30) * 60_000).toISOString();
    const finished = new Date(new Date(started).getTime() + randInt(rng, 2, 20) * 1000).toISOString();
    return {
      source,
      started_at: started,
      finished_at: finished,
      events_seen: todaysRows.length,
      events_inserted: todaysRows.length,
      events_updated: randInt(rng, 0, 2),
      unpriced: 0,
      ok: 1,
      error: null,
    };
  });

  return { events, subscriptions, budgets, seats, sources, lastRuns };
}

const cache = new Map<boolean, MockDataset>();

/** Deterministic per-process; regenerating is cheap-ish but we still memoize per mode. */
export function getDataset(teamMode: boolean): MockDataset {
  let ds = cache.get(teamMode);
  if (!ds) {
    ds = generate(teamMode);
    cache.set(teamMode, ds);
  }
  return ds;
}

export { ACTIVE_MODEL_KEYS };
