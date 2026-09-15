import { config } from '../config.ts';
import { fetchJson } from '../http.ts';
import { rebuildDailyFromEntries, replaceHighlights, upsertEntries, type EntryRow } from '../db.ts';
import type { Source, SyncResult } from './types.ts';

/**
 * Тренировки берутся из intervals.icu, а не из Garmin напрямую: туда они и так
 * прилетают с часов, а доступ несравнимо проще: HTTP Basic с персональным
 * ключом вместо пароля от аккаунта или партнёрской программы Garmin.
 * Весь год приезжает одним запросом.
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

/** Русские названия для типов, которые реально встречаются. */
const TYPE_LABELS: Record<string, string> = {
  Ride: 'Велосипед',
  VirtualRide: 'Велостанок',
  Run: 'Бег',
  VirtualRun: 'Беговая дорожка',
  TrailRun: 'Трейл',
  Walk: 'Ходьба',
  Hike: 'Поход',
  Swim: 'Плавание',
  WeightTraining: 'Силовая',
  Workout: 'Тренировка',
  Yoga: 'Йога',
  Rowing: 'Гребля',
  Elliptical: 'Эллипс',
  Soccer: 'Футбол',
  Tennis: 'Теннис',
  AlpineSki: 'Горные лыжи',
  NordicSki: 'Беговые лыжи',
  Snowboard: 'Сноуборд',
  Hockey: 'Хоккей',
};

const label = (type: string | null | undefined): string =>
  !type ? 'Прочее' : (TYPE_LABELS[type] ?? type);

export const intervals: Source = {
  id: 'intervals',
  // Без ключа источник просто не подключён, на экране так и будет написано.
  enabled: Boolean(config.sources.intervals.apiKey),

  async sync(year: number): Promise<SyncResult> {
    const { apiKey, baseUrl, athleteId } = config.sources.intervals;

    // Basic-авторизация: логин всегда литерал API_KEY, пароль это сам ключ.
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

      // moving_time честнее для «сколько занимался», но у силовых и йоги
      // он часто нулевой, тогда остаётся общая длительность.
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

    // В топе интереснее виды спорта, а не отдельные тренировки.
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
      summary: `${rows.length} тренировок, ${Math.round(seconds / 3600)} ч, видов: ${byType.size}`,
    };
  },
};
