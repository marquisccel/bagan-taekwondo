/** The flow the team actually uses day to day, shared between a tournament's own pages
 * (tournaments/[id]/layout.tsx) and the "Semua Turnamen" list (tournaments/page.tsx) so the tab bar
 * looks and behaves identically wherever you are -- moving to "Semua Turnamen" is switching tabs,
 * not leaving the app, so the other tabs must stay visible instead of disappearing. */
export const TOURNAMENT_TABS = [
  { href: '', label: 'Ringkasan' },
  { href: '/jadwal', label: 'Jadwal' },
  { href: '/peserta', label: 'Peserta' },
] as const;
