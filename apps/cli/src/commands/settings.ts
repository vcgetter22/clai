import type { Command } from 'commander';
import { PROVIDERS, type Budget, type DeclaredSubscription, type ProviderId, type Seat, type SourceId } from '@claii/core';
import { openContext, type GlobalOptions } from '../context.js';
import { dim, formatUsd, heading, ok, printJson, table, warn } from '../ui.js';

function providerOf(s: string): ProviderId {
  const p = s.toLowerCase() as ProviderId;
  if (!PROVIDERS.includes(p)) throw new Error(`Unknown provider "${s}". Known: ${PROVIDERS.join(', ')}`);
  return p;
}

export function registerSettings(program: Command): void {
  // ------------------------------------------------------------------ plan
  const plan = program.command('plan').description('Declare the subscriptions you pay for so clai can value them (Claude Max, ChatGPT Plus, Cursor, Copilot, ...)');
  plan
    .command('list')
    .description('Show declared plans and the known plan catalog')
    .option('--catalog', 'list all known plans', false)
    .action((opts: { catalog: boolean }, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const subs = ctx.store.listSubscriptions();
        if (ctx.json) return printJson({ subscriptions: subs, catalog: opts.catalog ? ctx.catalog.subscriptions : undefined });
        console.log(heading('Declared plans'));
        if (subs.length === 0) console.log(dim('  none. Example: clai plan set anthropic max_20x'));
        else console.log(table(['id', 'provider', 'plan', 'price/mo', 'seats', 'label'], subs.map((s) => [s.id, s.provider, s.plan, formatUsd(s.priceMonthly), String(s.seats ?? 1), s.label ?? ''])));
        if (opts.catalog) {
          console.log('');
          console.log(heading('Known plans'));
          console.log(table(['provider', 'plan', 'display', 'price/mo', 'seat-based', 'verified'], ctx.catalog.subscriptions.map((p) => [p.provider, p.plan, p.display, p.priceMonthly === null ? 'custom' : formatUsd(p.priceMonthly), p.seatBased ? 'yes' : 'no', p.verified ? 'yes' : 'no'])));
        }
      } finally {
        ctx.close();
      }
    });
  plan
    .command('set <provider> <plan>')
    .description('Declare a plan, e.g. `clai plan set anthropic max_20x` or `clai plan set openai plus --price 20`')
    .option('--price <usd>', 'monthly price (defaults to the catalog price)')
    .option('--seats <n>', 'number of seats', '1')
    .option('--label <text>', 'display label')
    .option('--sources <ids>', 'comma-separated sources this plan covers (default: all non-API usage of the provider)')
    .option('--id <id>', 'custom id (default provider-plan)')
    .action((provider: string, planKey: string, opts: { price?: string; seats: string; label?: string; sources?: string; id?: string }, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const p = providerOf(provider);
        const known = ctx.catalog.subscriptions.find((s) => s.provider === p && s.plan === planKey);
        if (!known && opts.price === undefined) {
          const options = ctx.catalog.subscriptions.filter((s) => s.provider === p).map((s) => s.plan);
          throw new Error(`Unknown plan "${planKey}" for ${p}. Known: ${options.join(', ') || 'none'}. Pass --price to declare a custom plan.`);
        }
        const price = opts.price !== undefined ? Number(opts.price) : (known?.priceMonthly ?? 0);
        if (!Number.isFinite(price) || price < 0) throw new Error('--price must be a non-negative number');
        const sub: DeclaredSubscription = {
          id: opts.id ?? `${p}-${planKey}`,
          provider: p,
          plan: planKey,
          label: opts.label ?? known?.display,
          priceMonthly: price,
          seats: Number(opts.seats) || 1,
          appliesTo: opts.sources ? { sources: opts.sources.split(',').map((s) => s.trim()) as SourceId[] } : undefined,
        };
        ctx.store.putSubscription(sub);
        if (ctx.json) return printJson({ subscription: sub });
        console.log(ok(`Declared ${sub.label ?? sub.plan} at ${formatUsd(price)}/mo${sub.seats && sub.seats > 1 ? ` x ${sub.seats} seats` : ''} (id ${sub.id})`));
        console.log(dim('  Local usage of this provider will be attributed to the plan. Run `clai scan --full` to relabel already-ingested usage.'));
      } finally {
        ctx.close();
      }
    });
  plan
    .command('remove <id>')
    .description('Remove a declared plan')
    .action((id: string, _o: unknown, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const removed = ctx.store.deleteSubscription(id);
        if (ctx.json) return printJson({ removed });
        console.log(removed ? ok(`Removed ${id}`) : warn(`No plan with id ${id}`));
      } finally {
        ctx.close();
      }
    });

  // ---------------------------------------------------------------- budget
  const budget = program.command('budget').description('Monthly budgets with projections and breach warnings');
  budget
    .command('list')
    .action((_o: unknown, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const budgets = ctx.store.listBudgets();
        if (ctx.json) return printJson({ budgets });
        console.log(heading('Budgets'));
        if (budgets.length === 0) return console.log(dim('  none. Example: clai budget set "AI tools" 300'));
        console.log(table(['id', 'name', 'amount/mo', 'scope'], budgets.map((b) => [b.id, b.name, formatUsd(b.amountUsd), b.scope ? JSON.stringify(b.scope) : 'all'])));
      } finally {
        ctx.close();
      }
    });
  budget
    .command('set <name> <amount>')
    .description('Create or update a monthly budget, optionally scoped')
    .option('--provider <id>')
    .option('--source <id>')
    .option('--project <name>')
    .option('--actor <key>')
    .option('--id <id>')
    .action((name: string, amount: string, opts: { provider?: string; source?: string; project?: string; actor?: string; id?: string }, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const amountUsd = Number(amount);
        if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error('amount must be a positive number of USD per month');
        const scope: Budget['scope'] = {};
        if (opts.provider) scope.provider = providerOf(opts.provider);
        if (opts.source) scope.source = opts.source as SourceId;
        if (opts.project) scope.project = opts.project;
        if (opts.actor) scope.actorKey = opts.actor;
        const b: Budget = { id: opts.id ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, amountUsd, period: 'month', scope: Object.keys(scope).length ? scope : undefined };
        ctx.store.putBudget(b);
        if (ctx.json) return printJson({ budget: b });
        console.log(ok(`Budget "${name}" set to ${formatUsd(amountUsd)}/month${b.scope ? ` for ${JSON.stringify(b.scope)}` : ''}`));
      } finally {
        ctx.close();
      }
    });
  budget
    .command('remove <id>')
    .action((id: string, _o: unknown, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const removed = ctx.store.deleteBudget(id);
        if (ctx.json) return printJson({ removed });
        console.log(removed ? ok(`Removed ${id}`) : warn(`No budget with id ${id}`));
      } finally {
        ctx.close();
      }
    });

  // ------------------------------------------------------------------ seat
  const seat = program.command('seat').description('Paid seats per person (team mode) for idle-seat detection');
  seat
    .command('list')
    .action((_o: unknown, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const seats = ctx.store.listSeats();
        if (ctx.json) return printJson({ seats });
        console.log(heading('Seats'));
        if (seats.length === 0) return console.log(dim('  none. Example: clai seat add jane@acme.com anthropic team_premium'));
        console.log(table(['actor', 'provider', 'plan', 'price/mo', 'label'], seats.map((s) => [s.actorKey, s.provider, s.plan, formatUsd(s.priceMonthly), s.label ?? ''])));
      } finally {
        ctx.close();
      }
    });
  seat
    .command('add <actorKey> <provider> <plan>')
    .option('--price <usd>')
    .option('--label <text>')
    .action((actorKey: string, provider: string, planKey: string, opts: { price?: string; label?: string }, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const p = providerOf(provider);
        const known = ctx.catalog.subscriptions.find((s) => s.provider === p && s.plan === planKey);
        const price = opts.price !== undefined ? Number(opts.price) : (known?.priceMonthly ?? 0);
        const s: Seat = { actorKey, provider: p, plan: planKey, priceMonthly: price, label: opts.label };
        ctx.store.putSeat(s);
        if (ctx.json) return printJson({ seat: s });
        console.log(ok(`Seat ${actorKey}: ${known?.display ?? planKey} at ${formatUsd(price)}/mo`));
      } finally {
        ctx.close();
      }
    });
  seat
    .command('remove <actorKey>')
    .action((actorKey: string, _o: unknown, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const removed = ctx.store.deleteSeat(actorKey);
        if (ctx.json) return printJson({ removed });
        console.log(removed ? ok(`Removed seat ${actorKey}`) : warn(`No seat for ${actorKey}`));
      } finally {
        ctx.close();
      }
    });

  // ---------------------------------------------------------------- config
  const config = program.command('config').description('Settings: timezone, identity (email/name/device used when syncing to a team)');
  config
    .command('list')
    .action((_o: unknown, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const all = ctx.store.allSettings();
        if (ctx.json) return printJson(all);
        console.log(heading('Settings') + dim(`  ${ctx.store.path}`));
        console.log(table(['key', 'value'], Object.entries(all)));
      } finally {
        ctx.close();
      }
    });
  config
    .command('set <key> <value>')
    .description('Keys: timezone, identity.email, identity.name, identity.device, sync.server')
    .action((key: string, value: string, _o: unknown, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        if (key === 'timezone') {
          try {
            new Intl.DateTimeFormat('en-US', { timeZone: value });
          } catch {
            throw new Error(`Invalid IANA timezone "${value}"`);
          }
          ctx.store.recomputeDays(value);
          if (ctx.json) return printJson({ key, value });
          return console.log(ok(`Timezone set to ${value}; day totals recomputed.`));
        }
        ctx.store.setSetting(key, value);
        if (ctx.json) return printJson({ key, value });
        console.log(ok(`${key} = ${value}`));
      } finally {
        ctx.close();
      }
    });
}
