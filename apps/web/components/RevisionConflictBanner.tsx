/** ACCEPTANCE §REVISION CONFLICT: never silently retry, never overwrite — the operator reloads. */
export function RevisionConflictBanner({ onReload }: { onReload: () => void }) {
  return (
    <div className="banner banner-conflict" role="alert">
      <span>Draw changed by another operator. Reload the current revision before applying this action.</span>
      <button className="btn btn-primary" onClick={onReload}>
        Reload
      </button>
    </div>
  );
}
