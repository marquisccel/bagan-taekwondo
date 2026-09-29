/** ACCEPTANCE §REVISION CONFLICT: never silently retry, never overwrite — the operator reloads. */
export function RevisionConflictBanner({ onReload }: { onReload: () => void }) {
  return (
    <div className="banner banner-conflict" role="alert">
      <span>Drawing telah diperbarui oleh pengguna lain. Muat ulang sebelum melanjutkan.</span>
      <button className="btn btn-primary" onClick={onReload}>
        Muat Ulang
      </button>
    </div>
  );
}
