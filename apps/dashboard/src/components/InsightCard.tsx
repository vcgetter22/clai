import type { Insight } from '../types';
import { formatUsd } from '../format';

export function InsightCard({ insight }: { insight: Insight }) {
  return (
    <div className={`insight-card ${insight.severity}`}>
      <div className="insight-bar" aria-hidden="true" />
      <div className="insight-body">
        <div className="insight-top">
          <div>
            <div className="insight-title">{insight.title}</div>
            <div className="insight-detail">{insight.detail}</div>
          </div>
          {typeof insight.impactUsdPerMonth === 'number' && insight.impactUsdPerMonth > 0 && <span className="impact-chip">{formatUsd(insight.impactUsdPerMonth)}/mo</span>}
        </div>
        {insight.action && <div className="insight-action">{insight.action}</div>}
        <details className="insight-evidence">
          <summary>Evidence</summary>
          <pre>{JSON.stringify(insight.evidence, null, 2)}</pre>
        </details>
      </div>
    </div>
  );
}
