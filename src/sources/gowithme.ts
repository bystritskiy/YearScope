import { config } from '../config.ts';
import { fetchJson } from '../http.ts';
import { replaceDaily, replaceHighlights } from '../db.ts';
import type { Source, SyncResult } from './types.ts';

type PlayerResponse = {
  trackedSince?: string | null;
  totals?: { total_seconds?: number; sessions?: number; games?: number };
  byDay?: Array<{ day: string; total_seconds: number; sessions: number }>;
  topGames?: Array<{
    title_name: string;
    total_seconds: number;
    sessions: number;
    source?: string;
    iconUrl?: string | null;
  }>;
};

/** Раскладка кодов площадок в человеческие названия. */
const PLATFORM_LABELS: Record<string, string> = {
  nintendo: 'Nintendo',
  psn: 'PlayStation',
  steam: 'Steam',
  xbox: 'Xbox',
  ps3: 'PlayStation 3',
  psvita: 'PS Vita',
};

export const gowithme: Source = {
  id: 'gowithme',
  enabled: config.sources.gowithme.enabled,

  async sync(year: number): Promise<SyncResult> {
    const { baseUrl, player } = config.sources.gowithme;
    const url = `${baseUrl}/api/player?name=${encodeURIComponent(player)}&period=year`;
    const data = await fetchJson<PlayerResponse>(url);

    // period=year привязан к текущему году, поэтому фильтруем сами:
    // так сводка за прошлый год не наберёт лишнего из свежих данных.
    const prefix = `${year}-`;
    const days = (data.byDay ?? []).filter((row) => row.day.startsWith(prefix));

    replaceDaily(
      'gowithme',
      year,
      days.map((row) => ({ day: row.day, seconds: row.total_seconds, items: row.sessions })),
    );

    replaceHighlights(
      'gowithme',
      year,
      (data.topGames ?? []).slice(0, 10).map((game) => ({
        title: game.title_name,
        subtitle: game.source ? (PLATFORM_LABELS[game.source] ?? game.source) : null,
        seconds: game.total_seconds,
        iconUrl: game.iconUrl ? `${baseUrl}${game.iconUrl}` : null,
      })),
    );

    const seconds = days.reduce((sum, row) => sum + row.total_seconds, 0);
    const trackedSince = data.trackedSince ? data.trackedSince.slice(0, 10) : null;

    return {
      coversFrom: trackedSince,
      granularity: 'day',
      summary: `${days.length} дней, ${Math.round(seconds / 3600)} ч, игр: ${data.totals?.games ?? 0}`,
    };
  },
};
