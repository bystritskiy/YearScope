import { config } from '../config.ts';
import { fetchJson, fetchText } from '../http.ts';
import {
  cacheRuntime,
  countEntries,
  getCachedRuntime,
  rebuildDailyFromEntries,
  replaceHighlights,
  upsertEntries,
  type EntryRow,
} from '../db.ts';
import type { Source, SyncResult } from './types.ts';

/**
 * Letterboxd закрыт Cloudflare, публичный API отсутствует, а RSS хранит только
 * ~50 последних записей. Поэтому каждая синхронизация не перезаписывает год,
 * а дополняет накопленную базу: то, что уже выпало из ленты, остаётся у нас.
 */

type Viewing = {
  guid: string;
  watchedDate: string;
  title: string;
  filmYear: string | null;
  tmdbId: number | null;
  rewatch: boolean;
  rating: number | null;
};

const tag = (xml: string, name: string): string | null => {
  const match = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  if (!match) return null;
  return match[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
};

const decode = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

export function parseRss(xml: string): Viewing[] {
  const viewings: Viewing[] = [];

  for (const chunk of xml.split('<item>').slice(1)) {
    const item = chunk.split('</item>')[0];
    const watchedDate = tag(item, 'letterboxd:watchedDate');
    const title = tag(item, 'letterboxd:filmTitle');
    // В ленту попадают ещё и списки, и отзывы без отметки о просмотре — они не про время.
    if (!watchedDate || !title) continue;

    const guid = tag(item, 'guid');
    const tmdbRaw = tag(item, 'tmdb:movieId');
    const ratingRaw = tag(item, 'letterboxd:memberRating');

    viewings.push({
      guid: guid ?? `${title}-${watchedDate}`,
      watchedDate,
      title: decode(title),
      filmYear: tag(item, 'letterboxd:filmYear'),
      tmdbId: tmdbRaw ? Number.parseInt(tmdbRaw, 10) : null,
      rewatch: tag(item, 'letterboxd:rewatch') === 'Yes',
      rating: ratingRaw ? Number.parseFloat(ratingRaw) : null,
    });
  }

  return viewings;
}

/** Хронометраж из TMDB с вечным кэшем; null — если ключа нет или фильм не найден. */
async function resolveRuntime(viewing: Viewing): Promise<number | null> {
  const { tmdbApiKey } = config.sources.letterboxd;
  if (!viewing.tmdbId || !tmdbApiKey) return null;

  const cached = getCachedRuntime(viewing.tmdbId);
  if (cached !== null) return cached;

  try {
    const movie = await fetchJson<{ runtime?: number | null; title?: string }>(
      `https://api.themoviedb.org/3/movie/${viewing.tmdbId}?api_key=${tmdbApiKey}`,
      { retries: 1 },
    );
    const runtime = typeof movie.runtime === 'number' && movie.runtime > 0 ? movie.runtime : null;
    cacheRuntime(viewing.tmdbId, runtime, movie.title ?? viewing.title);
    return runtime;
  } catch {
    // Сеть или лимит TMDB — не роняем синк, фильм получит оценочное время.
    return null;
  }
}

export const letterboxd: Source = {
  id: 'letterboxd',
  enabled: config.sources.letterboxd.enabled,

  async sync(year: number): Promise<SyncResult> {
    const { baseUrl, user, fallbackRuntimeMinutes, tmdbApiKey } = config.sources.letterboxd;

    const xml = await fetchText(`${baseUrl}/${encodeURIComponent(user)}/rss/`);
    const viewings = parseRss(xml).filter((viewing) => viewing.watchedDate.startsWith(`${year}-`));

    const rows: EntryRow[] = [];
    let estimatedCount = 0;

    for (const viewing of viewings) {
      const runtime = await resolveRuntime(viewing);
      const minutes = runtime ?? fallbackRuntimeMinutes;
      if (runtime === null) estimatedCount += 1;

      rows.push({
        externalId: viewing.guid,
        day: viewing.watchedDate,
        seconds: minutes * 60,
        title: viewing.title,
        subtitle: viewing.filmYear,
        estimated: runtime === null,
        meta: { tmdbId: viewing.tmdbId, rewatch: viewing.rewatch, rating: viewing.rating },
      });
    }

    upsertEntries('letterboxd', rows);
    rebuildDailyFromEntries('letterboxd', year);

    // Топ считаем по всей накопленной базе за год, а не только по свежей ленте.
    const total = countEntries('letterboxd', year);
    replaceHighlights(
      'letterboxd',
      year,
      rows
        .slice()
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 100)
        .map((row) => ({ title: row.title, subtitle: row.subtitle, seconds: row.seconds })),
    );

    const noKey = !tmdbApiKey ? ', без ключа TMDB' : '';
    const estimateNote = estimatedCount ? `, оценка у ${estimatedCount}` : '';

    return {
      coversFrom: null,
      granularity: 'day',
      summary: `в ленте ${viewings.length}, всего накоплено ${total}${estimateNote}${noKey}`,
    };
  },
};
