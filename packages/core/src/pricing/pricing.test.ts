import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog.js';
import { computeCost, whatIfCost } from './cost.js';
import { inferProvider, normalizeModelId, resolveModel } from './resolve.js';
import { emptyUsage } from '../types.js';

describe('normalizeModelId', () => {
  it('strips bedrock region/vendor prefixes and version suffixes', () => {
    expect(normalizeModelId('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toEqual({ key: 'claude-sonnet-4-5-20250929', providerHint: 'anthropic', free: false });
    expect(normalizeModelId('anthropic.claude-opus-5')).toMatchObject({ key: 'claude-opus-5', providerHint: 'anthropic' });
  });
  it('handles vertex @date and google models/ prefix', () => {
    expect(normalizeModelId('claude-opus-4-5@20251101').key).toBe('claude-opus-4-5-20251101');
    expect(normalizeModelId('models/gemini-2.5-pro').key).toBe('gemini-2.5-pro');
    expect(normalizeModelId('publishers/anthropic/models/claude-sonnet-5')).toMatchObject({ key: 'claude-sonnet-5', providerHint: 'anthropic' });
  });
  it('handles openrouter vendor prefixes, dotted claude versions and :free', () => {
    expect(normalizeModelId('anthropic/claude-sonnet-4.5')).toMatchObject({ key: 'claude-sonnet-4-5', providerHint: 'anthropic' });
    expect(normalizeModelId('openai/gpt-5:free')).toMatchObject({ key: 'gpt-5', providerHint: 'openai', free: true });
    expect(normalizeModelId('google/gemini-2.5-flash:thinking').key).toBe('gemini-2.5-flash');
  });
});

describe('resolveModel', () => {
  it('resolves exact ids and dated snapshots', () => {
    expect(resolveModel(CATALOG, 'claude-opus-5').price?.id).toBe('claude-opus-5');
    expect(resolveModel(CATALOG, 'claude-sonnet-4-5-20250929').price?.id).toBe('claude-sonnet-4-5');
    expect(resolveModel(CATALOG, 'claude-haiku-4-5-20251001').price?.id).toBe('claude-haiku-4-5');
    expect(resolveModel(CATALOG, 'gpt-4o-2024-08-06').price?.id).toBe('gpt-4o');
  });
  it('resolves unknown dated snapshots of known models by stripping the date', () => {
    const r = resolveModel(CATALOG, 'claude-opus-5-20260601');
    expect(r.price?.id).toBe('claude-opus-5');
    expect(r.match).toBe('normalized');
  });
  it('resolves bedrock and openrouter ids', () => {
    expect(resolveModel(CATALOG, 'us.anthropic.claude-sonnet-4-5-20250929-v1:0').price?.id).toBe('claude-sonnet-4-5');
    expect(resolveModel(CATALOG, 'anthropic/claude-opus-4.1').price?.id).toBe('claude-opus-4-1');
    expect(resolveModel(CATALOG, 'openai/gpt-5-mini').price?.id).toBe('gpt-5-mini');
  });
  it('falls back to longest prefix match', () => {
    expect(resolveModel(CATALOG, 'gpt-5-mini-2026-01-01').price?.id).toBe('gpt-5-mini');
    expect(resolveModel(CATALOG, 'gemini-2.5-flash-lite-preview-09-2025').price?.id).toBe('gemini-2.5-flash-lite');
  });
  it('treats synthetic models as zero-cost', () => {
    const r = resolveModel(CATALOG, '<synthetic>');
    expect(r.match).toBe('synthetic');
    expect(r.price).toBeNull();
  });
  it('returns none for unknown models', () => {
    expect(resolveModel(CATALOG, 'totally-unknown-model-9000').match).toBe('none');
  });
  it('does not cross providers when a hint is given', () => {
    expect(resolveModel(CATALOG, 'gpt-5', 'anthropic').price).toBeNull();
  });
  it('infers providers from ids', () => {
    expect(inferProvider(CATALOG, 'grok-9-ultra')).toBe('xai');
    expect(inferProvider(CATALOG, 'claude-next')).toBe('anthropic');
    expect(inferProvider(CATALOG, 'o7')).toBe('openai');
  });
});

describe('computeCost', () => {
  const opus5 = resolveModel(CATALOG, 'claude-opus-5').price!;
  const sonnet45 = resolveModel(CATALOG, 'claude-sonnet-4-5').price!;

  it('prices anthropic tokens with cache tiers', () => {
    const c = computeCost(CATALOG, opus5, { ...emptyUsage(), input: 1_000_000, output: 100_000, cacheRead: 2_000_000, cacheWrite5m: 500_000, cacheWrite1h: 100_000, requests: 1 });
    expect(c.input).toBeCloseTo(5, 6);
    expect(c.output).toBeCloseTo(2.5, 6);
    expect(c.cacheRead).toBeCloseTo(1.0, 6);
    expect(c.cacheWrite5m).toBeCloseTo(3.125, 6);
    expect(c.cacheWrite1h).toBeCloseTo(1.0, 6);
    expect(c.total).toBeCloseTo(12.625, 6);
    expect(c.longContextApplied).toBe(false);
  });
  it('matches a real Claude Code message cost (77k 1h cache write + 774 output on Sonnet 5)', () => {
    const sonnet5 = resolveModel(CATALOG, 'claude-sonnet-5').price!;
    const c = computeCost(CATALOG, sonnet5, { ...emptyUsage(), input: 2, output: 774, cacheWrite1h: 77_025, requests: 1 });
    // 2/1e6*2 + 774/1e6*10 + 77025/1e6*4 = 0.000004 + 0.00774 + 0.3081
    expect(c.total).toBeCloseTo(0.315844, 6);
  });
  it('applies the long-context tier only above the threshold on models that have one', () => {
    const gemini = resolveModel(CATALOG, 'gemini-2.5-pro').price!;
    const below = computeCost(CATALOG, gemini, { ...emptyUsage(), input: 150_000, output: 1000, requests: 1 });
    const above = computeCost(CATALOG, gemini, { ...emptyUsage(), input: 250_000, output: 1000, requests: 1 });
    expect(below.longContextApplied).toBe(false);
    expect(below.input).toBeCloseTo(0.1875, 6); // 150k * $1.25
    expect(above.longContextApplied).toBe(true);
    expect(above.input).toBeCloseTo(0.625, 6); // 250k * $2.50
    expect(above.output).toBeCloseTo(0.015, 6); // 1k * $15
    // Anthropic 1M-context models bill the whole window at one rate.
    const opusAbove = computeCost(CATALOG, opus5, { ...emptyUsage(), input: 250_000, output: 1000, requests: 1 });
    expect(opusAbove.longContextApplied).toBe(false);
    expect(opusAbove.input).toBeCloseTo(1.25, 6);
    // Sonnet 4.5's 1M beta keeps the >200K premium (2x input, 1.5x output).
    const sonnetAbove = computeCost(CATALOG, sonnet45, { ...emptyUsage(), input: 250_000, output: 1000, requests: 1 });
    expect(sonnetAbove.longContextApplied).toBe(true);
    expect(sonnetAbove.input).toBeCloseTo(1.5, 6);
    expect(sonnetAbove.output).toBeCloseTo(0.0225, 6);
  });
  it('does not detect long context for bucketed data unless told', () => {
    const gemini = resolveModel(CATALOG, 'gemini-2.5-pro').price!;
    const c = computeCost(CATALOG, gemini, { ...emptyUsage(), input: 5_000_000, output: 0, requests: 100 }, { detectLongContext: false });
    expect(c.longContextApplied).toBe(false);
    const forced = computeCost(CATALOG, gemini, { ...emptyUsage(), input: 5_000_000, output: 0, requests: 100 }, { detectLongContext: false, longContext: true });
    expect(forced.longContextApplied).toBe(true);
  });
  it('applies batch discount and free variants', () => {
    const u = { ...emptyUsage(), input: 1_000_000, output: 0, requests: 1 };
    expect(computeCost(CATALOG, opus5, u, { batch: true }).total).toBeCloseTo(2.5, 6);
    expect(computeCost(CATALOG, opus5, u, { free: true }).total).toBe(0);
  });
  it('adds web search fees', () => {
    const c = computeCost(CATALOG, opus5, { ...emptyUsage(), requests: 1, webSearches: 100 });
    expect(c.webSearches).toBeCloseTo(1.0, 6);
    expect(c.total).toBeCloseTo(1.0, 6);
  });
  it('uses openai cached input prices', () => {
    const gpt5 = resolveModel(CATALOG, 'gpt-5').price!;
    const c = computeCost(CATALOG, gpt5, { ...emptyUsage(), input: 1_000_000, cacheRead: 1_000_000, output: 1_000_000, requests: 1 });
    expect(c.input).toBeCloseTo(1.25, 6);
    expect(c.cacheRead).toBeCloseTo(0.125, 6);
    expect(c.output).toBeCloseTo(10, 6);
  });
  it('what-if between models', () => {
    const sonnet5 = resolveModel(CATALOG, 'claude-sonnet-5').price!;
    const w = whatIfCost(CATALOG, opus5, sonnet5, { ...emptyUsage(), input: 1_000_000, output: 1_000_000, requests: 1 });
    expect(w.fromUsd).toBeCloseTo(30, 6);
    expect(w.toUsd).toBeCloseTo(12, 6);
    expect(w.savingsUsd).toBeCloseTo(18, 6);
  });
});

describe('catalog integrity', () => {
  it('has unique ids and aliases', () => {
    const seen = new Set<string>();
    for (const m of CATALOG.models) {
      expect(seen.has(m.id), `duplicate id ${m.id}`).toBe(false);
      seen.add(m.id);
      for (const a of m.aliases) {
        expect(seen.has(a), `alias ${a} collides`).toBe(false);
        seen.add(a);
      }
      expect(m.input).toBeGreaterThanOrEqual(0);
      expect(m.output).toBeGreaterThanOrEqual(0);
    }
  });
});
