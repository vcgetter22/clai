/** Onboarding panel shown wherever a page needs events and the local database has none yet. */
export function EmptyState() {
  return (
    <div className="empty-state">
      <h2>No usage recorded yet</h2>
      <p>Run a scan to pull usage from Claude Code, Codex CLI and your other connected sources into clai's local database.</p>
      <pre className="code-block">clai scan</pre>
      <p className="privacy-note">clai reads only usage metadata — tokens, costs, timestamps, model and project names — never prompt or response content.</p>
    </div>
  );
}
