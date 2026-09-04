import type { SummaryResponse } from '../types';
import { formatUsd } from '../format';
import { InfoTip } from './InfoTip';

const API_EQUIVALENT_HINT = "Usage covered by a subscription is valued at the provider's API list price so plans and pay-as-you-go can be compared.";

/** "Claude Max 20x: $412 API-equivalent this month = 2.1x its $200 price." */
export function SubscriptionCard({ row }: { row: SummaryResponse['subscriptions'][number] }) {
  const { subscription, mtdUsd, projectedUsd, multiple } = row;
  const label = subscription.label ?? `${subscription.provider} ${subscription.plan}`;
  const basis = projectedUsd || mtdUsd;
  return (
    <div className="sub-card">
      <div className="flex-between">
        <span className="sub-name">{label}</span>
        <InfoTip text={API_EQUIVALENT_HINT} />
      </div>
      <div className="sub-headline">
        {formatUsd(basis)} <span className="mult">API-equivalent</span>
      </div>
      <p className="sub-sub">
        this month = <strong className="tabular">{multiple.toFixed(1)}x</strong> its {formatUsd(subscription.priceMonthly)} price
      </p>
      <p className="sub-sub muted">{formatUsd(mtdUsd)} month-to-date</p>
    </div>
  );
}
