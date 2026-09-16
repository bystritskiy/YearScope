import { config } from '../config.ts';
import { fetchJson } from '../http.ts';
import { rebuildDailyFromEntries, replaceHighlights, upsertEntries, type EntryRow } from '../db.ts';
import type { Source, SyncResult } from './types.ts';

/**
 * Workouts come from intervals.icu rather than Garmin directly: they land there
 * from the watch anyway, and access is incomparably simpler: HTTP Basic with a
 * personal key instead of an account password or Garmin's partner programme.
 * The whole year arrives in one request.
 */

type Activity = {
  id: string;
  name?: string | null;
  type?: string | null;
  start_date_local?: string | null;
  moving_time?: number | null;
  elapsed_time?: number | null;
  distance?: number | null;
  calories?: number | null;
};

/** Human-readable names for the types that actually occur. */
const TYPE_LABELS: Record<string, string> = {
  Ride: 'Cycling',
  VirtualRide: 'Indoor cycling',
  Run: 'Running',
  VirtualRun: 'Treadmill',
  TrailRun: 'Trail running',
  Walk: 'Walking',
  Hike: 'Hiking',
  Swim: 'Swimming',
  WeightTraining: 'Strength',
  Workout: 'Workout',
  Yoga: 'Yoga',
  Rowing: 'Rowing',
  Elliptical: 'Elliptical',
  Soccer: 'Soccer',
  Tennis: 'Tennis',
  AlpineSki: 'Alpine skiing',
  NordicSki: 'Cross-country skiing',
  Snowboard: 'Snowboarding',
  Hockey: 'Hockey',
};

const label = (type: string | null | undefined): string =>
  !type ? 'Other' : (TYPE_LABELS[type] ?? type);

export const intervals: Source = {
  id: 'intervals',
  // Without a key the source is simply not connected, and the screen says so.
  enabled: Boolean(config.sources.intervals.apiKey),

  async sync(year: number): Promise<SyncResult> {
    const { apiKey, baseUrl, athleteId } = config.sources.intervals;

    // Basic auth: the login is always the literal API_KEY, the password is the key itself.
    const authorization = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`;

    const url =
      `${baseUrl}/api/v1/athlete/${encodeURIComponent(athleteId)}/activities` +
      `?oldest=${year}-01-01&newest=${year}-12-31`;

    const activities = await fetchJson<Activity[]>(url, {
      headers: { authorization },
      timeoutMs: 45_000,
    });

    const rows: EntryRow[] = [];
    const byType = new Map<string, number>();

    for (const activity of activities) {
      const day = activity.start_date_local?.slice(0, 10);
      if (!day?.startsWith(`${year}-`)) continue;

      // moving_time is more honest for "how long did I train", but for strength
      // and yoga it is often zero, so the total duration remains.
      const moving = activity.moving_time ?? 0;
      const seconds = moving > 0 ? moving : (activity.elapsed_time ?? 0);
      if (seconds <= 0) continue;

      const type = label(activity.type);
      rows.push({
        externalId: activity.id,
        day,
        seconds,
        title: activity.name?.trim() || type,
        subtitle: type,
        meta: {
          type: activity.type,
          distanceKm: activity.distance ? Math.round(activity.distance / 100) / 10 : null,
          calories: activity.calories ?? null,
        },
      });
      byType.set(type, (byType.get(type) ?? 0) + seconds);
    }

    upsertEntries('intervals', rows);
    rebuildDailyFromEntries('intervals', year);

    // Sport types are more interesting in the top than individual workouts.
    replaceHighlights(
      'intervals',
      year,
      [...byType.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 100)
        .map(([type, seconds]) => ({ title: type, subtitle: null, seconds })),
    );

    const seconds = rows.reduce((sum, row) => sum + row.seconds, 0);

    return {
      coversFrom: null,
      granularity: 'day',
      summary: `${rows.length} workouts, ${Math.round(seconds / 3600)} h, types: ${byType.size}`,
    };
  },
};
