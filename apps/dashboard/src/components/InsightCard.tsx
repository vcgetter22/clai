import type { Insight } from '../types';
import { formatUsd } from '../format';

/** Number-first sentence on the left, the figure and its basis on the right. */
export function InsightCard({ insight }: { insight: Insight }) {
  const saving = typeof insight.impactUsdPerMonth === 'number' && insight.impactUsdPerMonth > 0 ? insight.impactUsdPerMonth : null;
  const tone = insight.severity === 'critical' ? 'red' : insight.severity === 'opportunity' ? 'accent' : 'ink';
  return (
    <div className={`insight-card ${insight.severity}`}>
      <div className="insight-text">
        <p className="insight-sentence">{insight.title}</p>
        {insight.detail && <p className="insight-detail">{insight.detail}</p>}
        {insight.action && <p className="insight-action">{insight.action}</p>}
        <details className="insight-evidence">
          <summary>evidence</summary>
          <pre>{JSON.stringify(insight.evidence, null, 2)}</pre>
        </details>
      </div>
      {saving !== null && <span className={`insight-figure ${tone}`}>−{formatUsd(saving)} / mo · estimated</span>}
    </div>
  );
}
