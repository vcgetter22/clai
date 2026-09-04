import type { ReactNode } from 'react';
import type { CostConfidence } from '../types';

export type BadgeTone = 'good' | 'neutral' | 'warning' | 'critical' | 'outline';

interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
}

/** Status colors are reserved for state (good/warning/critical) and always ship with an icon-ish dot + label, never color alone. */
export function Badge({ tone = 'neutral', dot, children }: BadgeProps) {
  const showDot = dot ?? tone !== 'outline';
  return (
    <span className={`badge badge-${tone}`}>
      {showDot && <span className="badge-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

const CONFIDENCE_MAP: Record<CostConfidence, { tone: BadgeTone; label: string }> = {
  billed: { tone: 'good', label: 'Billed' },
  computed: { tone: 'neutral', label: 'Computed' },
  estimated: { tone: 'warning', label: 'Estimated' },
  none: { tone: 'critical', label: 'Unpriced' },
};

export function ConfidenceBadge({ confidence }: { confidence: CostConfidence }) {
  const m = CONFIDENCE_MAP[confidence];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

/** Only renders when notable — an unverified catalog price is the exception, not the default. */
export function VerifiedBadge({ verified }: { verified: boolean }) {
  if (verified) return null;
  return (
    <Badge tone="warning" dot={false}>
      Unverified price
    </Badge>
  );
}

export function RetiredBadge({ retired }: { retired: string | null }) {
  if (!retired) return null;
  return (
    <Badge tone="neutral" dot={false}>
      Retired {retired}
    </Badge>
  );
}

export function TierBadge({ tier }: { tier: string }) {
  return <Badge tone="outline">{tier}</Badge>;
}
