import { config } from '../config.ts';
import { fetchJson } from '../http.ts';
import { replaceDaily, replaceEntries, replaceHighlights, type EntryRow } from '../db.ts';
import type { Source, SyncResult } from './types.ts';

type PlayerResponse = {
  trackedSince?: string | null;
  totals?: { total_seconds?: number; sessions?: number; games?: number };
  byDay?: Array<{ day: string; total_seconds: number; sessions: number }>;
  byDayGames?: Array<{
    day: string;
    title_id: string;
    title_name: string;
    source?: string;
    total_seconds: number;
    sessions: number;
    iconUrl?: string | null;
  }>;
  topGames?: Array<{
    title_name: string;
    total_seconds: number;
    sessions: number;
    source?: string;
    iconUrl?: string | null;
  }>;
};

/** Maps platform codes to human-readable names. */
const PLATFORM_LABELS: Record<string, string> = {
  nintendo: 'Nintendo',
  psn: 'PlayStation',
  steam: 'Steam',
  xbox: 'Xbox',
  ps3: 'PlayStation 3',
  psvita: 'PS Vita',
};

const platformLabel = (source?: string): string | null =>
  source ? (PLATFORM_LABELS[source] ?? source) : null;

export const gowithme: Source = {
  id: 'gowithme',
  enabled: config.sources.gowithme.enabled,

  async sync(year: number): Promise<SyncResult> {
    const { baseUrl, player } = config.sources.gowithme;
    // byDayGames is an opt-in day × title aggregate; without include the profile stays small.
    const url =
      `${baseUrl}/api/player?name=${encodeURIComponent(player)}` +
      `&period=year&include=byDayGames`;
    const data = await fetchJson<PlayerResponse>(url);

    // period=year is tied to the current year, so we filter ourselves:
    // that way last year's summary does not pick up extra from fresh data.
    const prefix = `${year}-`;
    const days = (data.byDay ?? []).filter((row) => row.day.startsWith(prefix));
    const dayGames = (data.byDayGames ?? []).filter((row) => row.day.startsWith(prefix));

    replaceDaily(
      'gowithme',
      year,
      days.map((row) => ({ day: row.day, seconds: row.total_seconds, items: row.sessions })),
    );

    // One journal row per game per day, not raw sessions and not the whole day.
    const entries: EntryRow[] = dayGames.map((game) => ({
      externalId: `${game.day}|${game.title_id}`,
      day: game.day,
      seconds: game.total_seconds,
      title: game.title_name,
      subtitle: platformLabel(game.source),
      meta: {
        titleId: game.title_id,
        sessions: game.sessions,
        iconUrl: game.iconUrl ? `${baseUrl}${game.iconUrl}` : null,
      },
    }));
    replaceEntries('gowithme', year, entries);

    replaceHighlights(
      'gowithme',
      year,
      (data.topGames ?? []).slice(0, 100).map((game) => ({
        title: game.title_name,
        subtitle: platformLabel(game.source),
        seconds: game.total_seconds,
        iconUrl: game.iconUrl ? `${baseUrl}${game.iconUrl}` : null,
      })),
    );

    const seconds = days.reduce((sum, row) => sum + row.total_seconds, 0);
    const trackedSince = data.trackedSince ? data.trackedSince.slice(0, 10) : null;

    return {
      coversFrom: trackedSince,
      granularity: 'day',
      summary: `${days.length} days, ${Math.round(seconds / 3600)} h, games in journal: ${entries.length}`,
    };
  },
};
