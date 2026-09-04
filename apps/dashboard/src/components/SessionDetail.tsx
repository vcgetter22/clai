import { useEffect } from 'react';
import type { Session } from '../types';
import { formatDateTime, formatDurationBetween, formatTokens, formatUsd, titleCase } from '../format';
import { modelColor } from '../colors';

interface Props {
  session: Session;
  timeZone: string;
  onClose: () => void;
}

export function SessionDetail({ session, timeZone, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Session detail">
        <div className="panel-header">
          <h2>Session detail</h2>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <dl className="kv-grid">
          <dt>Project</dt>
          <dd>{session.project ?? '—'}</dd>
          <dt>Source</dt>
          <dd>{titleCase(session.source)}</dd>
          <dt>Provider</dt>
          <dd>{titleCase(session.provider)}</dd>
          <dt>Started</dt>
          <dd>{formatDateTime(session.started, timeZone)}</dd>
          <dt>Ended</dt>
          <dd>{formatDateTime(session.ended, timeZone)}</dd>
          <dt>Duration</dt>
          <dd>{formatDurationBetween(session.started, session.ended)}</dd>
          <dt>Requests</dt>
          <dd>{session.events}</dd>
          <dt>Max context</dt>
          <dd>{formatTokens(session.maxContext)} tokens</dd>
          <dt>Cost</dt>
          <dd>{formatUsd(session.usd)}</dd>
        </dl>

        <div>
          <div className="section-title" style={{ marginBottom: 8 }}>
            Models
          </div>
          <div className="chart-legend">
            {session.models.map((m) => (
              <span className="legend-item" key={m}>
                <span className="legend-swatch" style={{ background: modelColor(m) }} />
                {m}
              </span>
            ))}
          </div>
        </div>

        <div>
          <div className="section-title" style={{ marginBottom: 8 }}>
            Token usage
          </div>
          <dl className="kv-grid">
            <dt>Input</dt>
            <dd>{formatTokens(session.usage.input)}</dd>
            <dt>Cache read</dt>
            <dd>{formatTokens(session.usage.cacheRead)}</dd>
            <dt>Cache write (5m)</dt>
            <dd>{formatTokens(session.usage.cacheWrite5m)}</dd>
            <dt>Cache write (1h)</dt>
            <dd>{formatTokens(session.usage.cacheWrite1h)}</dd>
            <dt>Output</dt>
            <dd>{formatTokens(session.usage.output)}</dd>
            {!!session.usage.reasoning && (
              <>
                <dt>Reasoning</dt>
                <dd>{formatTokens(session.usage.reasoning)}</dd>
              </>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}
