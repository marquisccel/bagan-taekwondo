'use client';

import { useEffect, useState } from 'react';

/** A live wall clock, ticking every second -- shared by the topbar clock and the dashboard's
 * time-of-day greeting so neither ever shows a stale time. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
