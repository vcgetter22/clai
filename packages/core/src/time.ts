/** Time helpers. All storage is UTC ISO; reporting uses the local timezone by default. */

export function toIso(d: Date | number | string): string {
  const date = typeof d === 'string' ? new Date(d) : typeof d === 'number' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${String(d)}`);
  return date.toISOString();
}

/** Local calendar day key YYYY-MM-DD for an ISO timestamp, in the given IANA timezone. */
export function dayKey(iso: string, timeZone: string = localTimeZone()): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function monthKey(iso: string, timeZone: string = localTimeZone()): string {
  return dayKey(iso, timeZone).slice(0, 7);
}

export function hourOfDay(iso: string, timeZone: string = localTimeZone()): number {
  const d = new Date(iso);
  const h = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(d);
  return Number(h) % 24;
}

/** 0 = Sunday ... 6 = Saturday, in the given timezone. */
export function weekdayIndex(iso: string, timeZone: string = localTimeZone()): number {
  const d = new Date(iso);
  const w = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(w);
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function daysInMonth(yyyyMm: string): number {
  const [y, m] = yyyyMm.split('-').map(Number);
  if (!y || !m) throw new Error(`Bad month key ${yyyyMm}`);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(dayKeyStr: string, n: number): string {
  const [y, m, d] = dayKeyStr.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + n));
  return date.toISOString().slice(0, 10);
}

/** Enumerate day keys from `from` to `to` inclusive. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 5000) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/**
 * Parse a "since" expression: `7d`, `4w`, `3m`, `24h`, `today`, `week`, `month`, `all`, or YYYY-MM-DD.
 * Returns an ISO timestamp (UTC) or null for `all`.
 */
export function parseSince(expr: string | undefined, now: Date = new Date(), timeZone: string = localTimeZone()): string | null {
  if (!expr || expr === 'all') return null;
  const e = expr.trim().toLowerCase();
  if (e === 'today') {
    const k = dayKey(now.toISOString(), timeZone);
    return localDayStartIso(k, timeZone);
  }
  if (e === 'month' || e === 'mtd') {
    const k = dayKey(now.toISOString(), timeZone);
    return localDayStartIso(`${k.slice(0, 7)}-01`, timeZone);
  }
  if (e === 'week' || e === 'wtd') {
    const k = dayKey(now.toISOString(), timeZone);
    const wd = weekdayIndex(now.toISOString(), timeZone);
    const monday = addDays(k, -((wd + 6) % 7));
    return localDayStartIso(monday, timeZone);
  }
  const m = /^(\d+)\s*([hdwmy])$/.exec(e);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    const ms =
      unit === 'h'
        ? n * 3600e3
        : unit === 'd'
          ? n * 86400e3
          : unit === 'w'
            ? n * 7 * 86400e3
            : unit === 'm'
              ? n * 30 * 86400e3
              : n * 365 * 86400e3;
    return new Date(now.getTime() - ms).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(e)) return localDayStartIso(e, timeZone);
  const d = new Date(expr);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  throw new Error(`Cannot parse --since "${expr}" (use 7d, 4w, 3m, today, week, month, all or YYYY-MM-DD)`);
}

/** ISO instant for local midnight of a YYYY-MM-DD day in the given timezone. */
export function localDayStartIso(day: string, timeZone: string = localTimeZone()): string {
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, 0, 0, 0);
  const offset = tzOffsetMinutes(new Date(guess), timeZone);
  let instant = guess - offset * 60e3;
  const offset2 = tzOffsetMinutes(new Date(instant), timeZone);
  if (offset2 !== offset) instant = guess - offset2 * 60e3;
  return new Date(instant).toISOString();
}

export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUtc - date.getTime()) / 60e3);
}

export function formatUsd(n: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  const abs = Math.abs(n);
  if (opts.compact && abs >= 1000) return `$${(n / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  if (abs >= 100) return `$${n.toFixed(0)}`;
  if (abs >= 1) return `$${n.toFixed(2)}`;
  if (abs >= 0.01) return `$${n.toFixed(3)}`;
  if (abs === 0) return '$0';
  return `$${n.toFixed(4)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`;
  return String(Math.round(n));
}

export function pct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}
