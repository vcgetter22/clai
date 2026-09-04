import { existsSync, readFileSync } from 'node:fs';
import { CATALOG, mergeCatalog, type PricingCatalog } from '@claii/core';
import { pricingOverridePath } from '@claii/store';

/** The effective catalog: built-in seed merged with `$CLAI_HOME/pricing.json` overrides when present. */
export function loadCatalog(env: NodeJS.ProcessEnv = process.env): { catalog: PricingCatalog; overridePath: string; overridden: boolean } {
  const p = pricingOverridePath(env);
  if (!existsSync(p)) return { catalog: CATALOG, overridePath: p, overridden: false };
  try {
    const override = JSON.parse(readFileSync(p, 'utf8')) as Partial<PricingCatalog>;
    return { catalog: mergeCatalog(CATALOG, override), overridePath: p, overridden: true };
  } catch (err) {
    throw new Error(`Cannot parse pricing override at ${p}: ${(err as Error).message}`);
  }
}
