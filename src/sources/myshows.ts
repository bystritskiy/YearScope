import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.ts';
import { postJson } from '../http.ts';
import {
  cacheShowRuntime,
  getShowRuntime,
  rebuildDailyFromEntries,
  replaceHighlights,
  upsertEntries,
  type EntryRow,
} from '../db.ts';
import { readXlsx } from '../xlsx.ts';
import type { Source, SyncResult } from './types.ts';

/**
 * myshows has no public way to get watch history: profile.Feed returns the
 * last 25 check-ins and ignores pagination, while profile.Episodes requires
 * auth. So history arrives as a profile export, and the feed picks up what
 * was checked in after it.
 *
 * Both halves give the show by its original title plus the episode number, so
 * the `show|s01e04` key matches, and one episode from two sources collapses
 * into a single record without doubling the time.
 */

type Episode = {
  key: string;
  day: string;
  show: string;
  title: string;
  season: string;
  episode: string;
};

const episodeKey = (show: string, season: string, episode: string): string =>
  `${show.trim().toLowerCase()}|s${season}e${episode}`;

/** The newest export in the import folder; null if there is no folder or no files. */
function findLatestExport(directory: string): string | null {
  try {
    const candidates = readdirSync(directory)
      .filter((name) => name.toLowerCase().endsWith('.xlsx') && !name.startsWith('~$'))
      .map((name) => {
        const path = join(directory, name);
        return { path, mtime: statSync(path).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return candidates[0]?.path ?? null;
  } catch {
    return null;
  }
}

function readExport(path: string, year: number): { episodes: Episode[]; runtimes: Map<string, number> } {
  const sheets = readXlsx(readFileSync(path));

  const runtimes = new Map<string, number>();
  // Sheet names are what myshows writes into the export (Russian UI): 'Сериалы' = shows, 'Эпизоды' = episodes.
  for (const row of (sheets.get('Сериалы') ?? []).slice(1)) {
    const [title, , , runtime] = row;
    const minutes = Number.parseInt(runtime ?? '', 10);
    if (title && Number.isFinite(minutes) && minutes > 0) {
      runtimes.set(title.trim().toLowerCase(), minutes);
    }
  }

  const episodes: Episode[] = [];
  for (const row of (sheets.get('Эпизоды') ?? []).slice(1)) {
    const [show, season, episode, title, watchedAt] = row;
    if (!show || !watchedAt?.startsWith(`${year}-`)) continue;
    episodes.push({
      key: episodeKey(show, season, episode),
      day: watchedAt.slice(0, 10),
      show: show.trim(),
      title: title || `s${season}e${episode}`,
      season,
      episode,
    });
  }

  return { episodes, runtimes };
}

type FeedItem = {
  type: string;
  createdAt: string;
  show?: { id: number; title?: string; titleOriginal?: string };
  episodes?: Array<{ title?: string; seasonNumber: number; episodeNumber: number }>;
};

async function readFeed(year: number): Promise<Episode[]> {
  const { apiUrl, login } = config.sources.myshows;
  const response = await postJson<{ result?: FeedItem[] }>(apiUrl, {
    jsonrpc: '2.0',
    method: 'profile.Feed',
    params: { login, page: 0, pageSize: 25 },
    id: 1,
  });

  const episodes: Episode[] = [];
  for (const item of response.result ?? []) {
    if (item.type !== 'e.check') continue;
    const show = item.show?.titleOriginal ?? item.show?.title;
    const day = item.createdAt?.slice(0, 10);
    if (!show || !day?.startsWith(`${year}-`)) continue;

    for (const episode of item.episodes ?? []) {
      const season = String(episode.seasonNumber);
      const number = String(episode.episodeNumber);
      episodes.push({
        key: episodeKey(show, season, number),
        day,
        show: show.trim(),
        title: episode.title || `s${season}e${number}`,
        season,
        episode: number,
      });
    }
  }
  return episodes;
}

/** Episode runtime: export → cache → API. null if it could not be determined. */
async function resolveRuntime(show: string, fromExport: Map<string, number>): Promise<number | null> {
  const key = show.trim().toLowerCase();

  const exported = fromExport.get(key);
  if (exported) return exported;

  const cached = getShowRuntime(key);
  if (cached !== undefined) return cached;

  try {
    const { apiUrl } = config.sources.myshows;
    const search = await postJson<{ result?: Array<{ id: number }> }>(apiUrl, {
      jsonrpc: '2.0',
      method: 'shows.Search',
      params: { query: show },
      id: 1,
    });
    const showId = search.result?.[0]?.id;
    if (!showId) {
      cacheShowRuntime(key, null);
      return null;
    }

    const details = await postJson<{ result?: { runtime?: number | null } }>(apiUrl, {
      jsonrpc: '2.0',
      method: 'shows.GetById',
      params: { showId, withEpisodes: false },
      id: 1,
    });
    const runtime = details.result?.runtime ?? null;
    cacheShowRuntime(key, runtime);
    return runtime;
  } catch {
    return null;
  }
}

export const myshows: Source = {
  id: 'myshows',
  enabled: config.sources.myshows.enabled,

  async sync(year: number): Promise<SyncResult> {
    const { importDir, fallbackEpisodeMinutes } = config.sources.myshows;

    const exportPath = findLatestExport(importDir);
    const exported = exportPath
      ? readExport(exportPath, year)
      : { episodes: [] as Episode[], runtimes: new Map<string, number>() };

    // The feed must not break the history import: without network we stay on the export.
    let feed: Episode[] = [];
    let feedFailed = false;
    try {
      feed = await readFeed(year);
    } catch {
      feedFailed = true;
    }

    // The export goes last and overrides the feed: it has the real watch date,
    // whereas the feed has the moment the check-in was made.
    const merged = new Map<string, Episode>();
    for (const episode of feed) merged.set(episode.key, episode);
    for (const episode of exported.episodes) merged.set(episode.key, episode);

    const rows: EntryRow[] = [];
    const byShow = new Map<string, number>();
    let estimated = 0;

    for (const episode of merged.values()) {
      const runtime = await resolveRuntime(episode.show, exported.runtimes);
      const minutes = runtime ?? fallbackEpisodeMinutes;
      if (runtime === null) estimated += 1;

      const seconds = minutes * 60;
      rows.push({
        externalId: episode.key,
        day: episode.day,
        seconds,
        title: episode.title,
        subtitle: episode.show,
        estimated: runtime === null,
        meta: { season: episode.season, episode: episode.episode },
      });
      byShow.set(episode.show, (byShow.get(episode.show) ?? 0) + seconds);
    }

    upsertEntries('myshows', rows);
    rebuildDailyFromEntries('myshows', year);

    replaceHighlights(
      'myshows',
      year,
      [...byShow.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 100)
        .map(([show, seconds]) => ({ title: show, subtitle: null, seconds })),
    );

    // There can be a gap between the export date and the feed window: if more
    // than 25 episodes were checked in, some never make it into the summary.
    const lastExported = exported.episodes.reduce((max, e) => (e.day > max ? e.day : max), '');
    const oldestInFeed = feed.reduce((min, e) => (min === '' || e.day < min ? e.day : min), '');
    const gap =
      lastExported && oldestInFeed && oldestInFeed > lastExported
        ? `check-ins between ${lastExported} and ${oldestInFeed} may be missing from the summary, refresh the profile export`
        : null;

    const warning = !exportPath
      ? 'profile export not found in data/imports, only the last 25 check-ins from the feed are counted'
      : (gap ?? (feedFailed ? 'myshows feed unavailable, showing the export only' : null));

    const seconds = rows.reduce((sum, row) => sum + row.seconds, 0);
    const estimateNote = estimated ? `, runtime estimated for ${estimated}` : '';

    return {
      coversFrom: exportPath ? null : (oldestInFeed || null),
      granularity: 'day',
      summary: `${rows.length} episodes, ${Math.round(seconds / 3600)} h, shows: ${byShow.size}${estimateNote}`,
      warning,
    };
  },
};
