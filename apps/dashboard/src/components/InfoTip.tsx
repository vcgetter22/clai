/** Small hover/focus info bubble. Used to explain "API-equivalent" pricing inline without cluttering the label. */
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="info-tip">
      <button type="button" className="info-tip-trigger" aria-label={text}>
        i
      </button>
      <span className="info-tip-bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}
