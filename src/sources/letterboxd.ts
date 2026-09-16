import { config } from '../config.ts';
import { fetchJson, fetchText } from '../http.ts';
import {
  cacheFilm,
  countEntries,
  db,
  getCachedFilm,
  rebuildDailyFromEntries,
  replaceHighlights,
  upsertEntries,
  type EntryRow,
} from '../db.ts';
import type { Source, SyncResult } from './types.ts';

/**
 * Letterboxd sits behind Cloudflare, has no public API, and the RSS only keeps
 * the ~50 latest entries. So each sync does not overwrite the year but adds to
 * the accumulated database: what has already dropped out of the feed stays with us.
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

type FilmInfo = {
  runtimeMin: number | null;
  director: string | null;
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
    // The feed also carries lists and reviews without a watched mark; those are not about time.
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

function pickDirector(crew: Array<{ job?: string; name?: string }> | undefined): string | null {
  const names = (crew ?? [])
    .filter((person) => person.job === 'Director' && person.name)
    .map((person) => person.name as string);
  if (names.length === 0) return '';
  return names.join(', ');
}

/** Runtime and director from TMDB with a permanent cache; empty without a key. */
async function resolveFilm(tmdbId: number | null, title: string): Promise<FilmInfo> {
  const { tmdbApiKey } = config.sources.letterboxd;
  if (!tmdbId || !tmdbApiKey) return { runtimeMin: null, director: null };

  const cached = getCachedFilm(tmdbId);
  // director === null means the column has not been filled yet; fetch credits.
  if (cached && cached.director !== null) {
    return { runtimeMin: cached.runtimeMin, director: cached.director || null };
  }

  try {
    const movie = await fetchJson<{
      runtime?: number | null;
      title?: string;
      credits?: { crew?: Array<{ job?: string; name?: string }> };
    }>(
      `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${tmdbApiKey}&append_to_response=credits`,
      { retries: 1 },
    );
    const runtimeMin = typeof movie.runtime === 'number' && movie.runtime > 0 ? movie.runtime : null;
    const director = pickDirector(movie.credits?.crew);
    cacheFilm(tmdbId, runtimeMin, movie.title ?? title, director);
    return { runtimeMin, director: director || null };
  } catch {
    // Network or TMDB rate limits do not fail the sync; the movie gets an estimated time.
    return { runtimeMin: cached?.runtimeMin ?? null, director: null };
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
      const film = await resolveFilm(viewing.tmdbId, viewing.title);
      const minutes = film.runtimeMin ?? fallbackRuntimeMinutes;
      if (film.runtimeMin === null) estimatedCount += 1;

      rows.push({
        externalId: viewing.guid,
        day: viewing.watchedDate,
        seconds: minutes * 60,
        title: viewing.title,
        subtitle: film.director ?? viewing.filmYear,
        estimated: film.runtimeMin === null,
        meta: { tmdbId: viewing.tmdbId, rewatch: viewing.rewatch, rating: viewing.rating },
      });
    }

    upsertEntries('letterboxd', rows);

    // Old entries outside the RSS get a director too, otherwise the journal keeps showing the year.
    const stale = db
      .prepare(
        `SELECT external_id, day, seconds, title, subtitle, estimated, meta
           FROM entries
          WHERE source = 'letterboxd' AND day LIKE ?
            AND (subtitle GLOB '[0-9][0-9][0-9][0-9]' OR subtitle IS NULL)`,
      )
      .all(`${year}-%`) as Array<{
      external_id: string;
      day: string;
      seconds: number;
      title: string;
      subtitle: string | null;
      estimated: number;
      meta: string | null;
    }>;

    const backfill: EntryRow[] = [];
    for (const row of stale) {
      let tmdbId: number | null = null;
      try {
        tmdbId = row.meta ? ((JSON.parse(row.meta) as { tmdbId?: number | null }).tmdbId ?? null) : null;
      } catch {
        tmdbId = null;
      }
      if (!tmdbId) continue;
      const film = await resolveFilm(tmdbId, row.title);
      if (!film.director) continue;
      backfill.push({
        externalId: row.external_id,
        day: row.day,
        seconds: row.seconds,
        title: row.title,
        subtitle: film.director,
        estimated: Boolean(row.estimated),
        meta: row.meta ? (JSON.parse(row.meta) as Record<string, unknown>) : null,
      });
    }
    if (backfill.length > 0) upsertEntries('letterboxd', backfill);

    rebuildDailyFromEntries('letterboxd', year);

    // The top is computed over the whole accumulated year, not just the fresh feed.
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

    const noKey = !tmdbApiKey ? ', no TMDB key' : '';
    const estimateNote = estimatedCount ? `, estimated for ${estimatedCount}` : '';

    return {
      coversFrom: null,
      granularity: 'day',
      summary: `${viewings.length} in feed, ${total} accumulated in total${estimateNote}${noKey}`,
    };
  },
};
