import { useEffect, useState } from 'react';
import { formatRelativeTime } from '@/lib/format';

/**
 * Returns a live-updating relative time string for the given timestamp.
 *
 * Re-render cadence adapts to the age of the timestamp:
 *  - < 1 min  → every 10 s  (so "just now" transitions to "1 min ago" promptly)
 *  - < 1 hour → every 30 s
 *  - otherwise → every 60 s
 */
export function useRelativeTime(timestamp: number | undefined): string | null {
  const [_tick, setTick] = useState(0);

  useEffect(() => {
    if (timestamp == null) {
      return;
    }

    function tick() {
      setTick((value) => value + 1);
    }

    function scheduleInterval(): ReturnType<typeof setInterval> {
      const ageSeconds = Math.floor((Date.now() - timestamp!) / 1000);
      const ms =
        ageSeconds < 60 ? 10_000 : // < 1 min → every 10 s
        ageSeconds < 3600 ? 30_000 : // < 1 hour → every 30 s
        60_000; // otherwise → every 60 s
      return setInterval(tick, ms);
    }

    let id = scheduleInterval();

    // Re-calibrate interval every 60 s so cadence adapts as the timestamp ages
    const recalibrate = setInterval(() => {
      clearInterval(id);
      id = scheduleInterval();
    }, 60_000);

    return () => {
      clearInterval(id);
      clearInterval(recalibrate);
    };
  }, [timestamp]);

  return timestamp != null ? formatRelativeTime(timestamp) : null;
}
