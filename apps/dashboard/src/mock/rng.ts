/** Small deterministic PRNG so mock data is stable across reloads (same seed -> same shape). */

export type Rng = () => number;

export function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32 — fast, tiny, good-enough statistical quality for synthetic demo data. */
export function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function randFloat(rng: Rng, min: number, max: number): number {
  return rng() * (max - min) + min;
}

/** Irwin-Hall(4)-ish sum for a softer, more natural-looking spread than flat uniform. */
export function randSoft(rng: Rng, min: number, max: number): number {
  const u = (rng() + rng() + rng() + rng()) / 4;
  return min + u * (max - min);
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  const item = arr[Math.floor(rng() * arr.length)];
  if (item === undefined) throw new Error('pick() from empty array');
  return item;
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

export function weightedPick<T>(rng: Rng, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r <= 0) return item;
  }
  const last = items[items.length - 1];
  if (!last) throw new Error('weightedPick() from empty array');
  return last[0];
}
