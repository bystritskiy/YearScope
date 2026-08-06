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
 * У myshows нет публичного способа получить историю просмотров: profile.Feed
 * отдаёт 25 последних отметок и игнорирует пагинацию, а profile.Episodes
 * требует авторизации. Поэтому история приезжает выгрузкой профиля, а лента
 * добирает то, что отмечено уже после неё.
 *
 * Обе половины дают сериал в оригинальном названии и номер серии, поэтому
 * ключ `сериал|s01e04` совпадает — один эпизод из двух источников схлопывается
 * в одну запись и не удваивает время.
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

/** Самая свежая выгрузка в папке импорта; null — если папки или файлов нет. */
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

/** Хронометраж серии: выгрузка → кэш → API. null, если узнать не удалось. */
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

    // Лента не должна ронять импорт истории: без сети остаёмся на выгрузке.
    let feed: Episode[] = [];
    let feedFailed = false;
    try {
      feed = await readFeed(year);
    } catch {
      feedFailed = true;
    }

    // Выгрузка идёт последней и перекрывает ленту: в ней настоящая дата
    // просмотра, а в ленте — момент простановки отметки.
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
        .slice(0, 10)
        .map(([show, seconds]) => ({ title: show, subtitle: null, seconds })),
    );

    // Между датой выгрузки и окном ленты может быть провал: если отмечено
    // больше 25 серий, часть в сводку не попадёт вообще.
    const lastExported = exported.episodes.reduce((max, e) => (e.day > max ? e.day : max), '');
    const oldestInFeed = feed.reduce((min, e) => (min === '' || e.day < min ? e.day : min), '');
    const gap =
      lastExported && oldestInFeed && oldestInFeed > lastExported
        ? `отметки между ${lastExported} и ${oldestInFeed} могли не попасть в сводку — обнови выгрузку профиля`
        : null;

    const warning = !exportPath
      ? 'выгрузка профиля не найдена в data/imports — учтены только последние 25 отметок из ленты'
      : (gap ?? (feedFailed ? 'лента myshows недоступна, показана только выгрузка' : null));

    const seconds = rows.reduce((sum, row) => sum + row.seconds, 0);
    const estimateNote = estimated ? `, хронометраж оценкой у ${estimated}` : '';

    return {
      coversFrom: exportPath ? null : (oldestInFeed || null),
      granularity: 'day',
      summary: `${rows.length} серий, ${Math.round(seconds / 3600)} ч, сериалов: ${byShow.size}${estimateNote}`,
      warning,
    };
  },
};
