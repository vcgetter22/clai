import type { SummaryResponse } from '../types';
import { providerLabel } from '../colors';
import { formatUsd } from '../format';

/** A receipt: plan price, API-priced work, the multiple, and the basis. */
export function SubscriptionCard({ row }: { row: SummaryResponse['subscriptions'][number] }) {
  const { subscription, mtdUsd, projectedUsd, lastMonthUsd, multiple } = row;
  const label = subscription.label ?? `${providerLabel(subscription.provider)} ${subscription.plan}`;
  const work = projectedUsd || mtdUsd;
  return (
    <div className="receipt">
      <div className="receipt-edge top" aria-hidden="true" />
      <div className="receipt-body">
        <div className="receipt-row muted">
          <span>{label}</span>
          <span>{projectedUsd ? 'this month · projected' : 'this month'}</span>
        </div>
        <div className="receipt-rule" />
        <div className="receipt-row">
          <span>plan price</span>
          <span>{formatUsd(subscription.priceMonthly)}</span>
        </div>
        <div className="receipt-row">
          <span>API-priced work</span>
          <span className="strong">{formatUsd(work)}</span>
        </div>
        <div className="receipt-row total">
          <span>its price ×</span>
          <span className="receipt-multiple">{multiple.toFixed(1)}x</span>
        </div>
        <div className="receipt-rule" />
        <div className="receipt-row muted">
          <span>month to date</span>
          <span>{formatUsd(mtdUsd)}</span>
        </div>
        {lastMonthUsd > 0 && (
          <div className="receipt-row muted">
            <span>last month</span>
            <span>{formatUsd(lastMonthUsd)}</span>
          </div>
        )}
        <div className="receipt-row muted">
          <span>basis</span>
          <span>computed (API-equivalent)</span>
        </div>
      </div>
      <div className="receipt-edge bottom" aria-hidden="true" />
    </div>
  );
}
