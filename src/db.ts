import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config, type SourceId } from './config.ts';

/**
 * Sources deliver data at different granularity, and forcing them under a
 * common denominator is dishonest: gowithme knows the exact day, KoShelf only
 * the month. So we keep two series, daily and monthly, use whichever is
 * available on read, and show the granularity in the interface.
 */

export type DailyRow = { day: string; seconds: number; items?: number };
export type MonthlyRow = { month: string; seconds: number; items?: number };

export type EntryRow = {
  externalId: string;
  day: string;
  seconds: number;
  title: string;
  subtitle?: string | null;
  /** true if the time is an estimate rather than taken from the source. */
  estimated?: boolean;
  meta?: Record<string, unknown> | null;
};

export type Granularity = 'day' | 'month';

export type SyncStatus = {
  source: SourceId;
  status: 'ok' | 'error';
  message?: string | null;
  /** From which date the source has data at all, so we do not lie about gaps. */
  coversFrom?: string | null;
  granularity?: Granularity;
  durationMs?: number;
  /** A data-completeness caveat: shown on the source card. */
  warning?: string | null;
};

mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(join(config.dataDir, 'yearscope.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS daily (
    source   TEXT NOT NULL,
    day      TEXT NOT NULL,
    seconds  INTEGER NOT NULL,
    items    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (source, day)
  );

  CREATE TABLE IF NOT EXISTS monthly (
    source   TEXT NOT NULL,
    month    TEXT NOT NULL,
    seconds  INTEGER NOT NULL,
    items    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (source, month)
  );

  CREATE TABLE IF NOT EXISTS entries (
    source       TEXT NOT NULL,
    external_id  TEXT NOT NULL,
    day          TEXT NOT NULL,
    seconds      INTEGER NOT NULL,
    title        TEXT NOT NULL,
    subtitle     TEXT,
    estimated    INTEGER NOT NULL DEFAULT 0,
    meta         TEXT,
    PRIMARY KEY (source, external_id)
  );

  CREATE INDEX IF NOT EXISTS entries_by_day ON entries (source, day);

  -- Top games/books: such items have no single date, only total time,
  -- so they go into neither daily nor entries.
  CREATE TABLE IF NOT EXISTS highlights (
    source    TEXT NOT NULL,
    year      INTEGER NOT NULL,
    rank      INTEGER NOT NULL,
    title     TEXT NOT NULL,
    subtitle  TEXT,
    seconds   INTEGER NOT NULL,
    icon_url  TEXT,
    PRIMARY KEY (source, year, rank)
  );

  -- Movie runtimes rarely change and TMDB rate-limits requests,
  -- so cache forever and only go to the network for new ids.
  CREATE TABLE IF NOT EXISTS film_runtime (
    tmdb_id      INTEGER PRIMARY KEY,
    runtime_min  INTEGER,
    title        TEXT,
    fetched_at   TEXT NOT NULL
  );

  -- Episode runtime per show: not always in the export, and calling
  -- shows.GetById on every sync for a number that never changes is pointless.
  CREATE TABLE IF NOT EXISTS show_runtime (
    show         TEXT PRIMARY KEY,
    runtime_min  INTEGER,
    fetched_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_state (
    source       TEXT PRIMARY KEY,
    last_run     TEXT NOT NULL,
    status       TEXT NOT NULL,
    message      TEXT,
    covers_from  TEXT,
    granularity  TEXT,
    duration_ms  INTEGER
  );
`);

/** Adds a column if it does not exist yet: CREATE TABLE IF NOT EXISTS does not add them. */
function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('sync_state', 'warning', 'TEXT');
ensureColumn('film_runtime', 'director', 'TEXT');

const yearRange = (year: number) => ({ from: `${year}-01-01`, to: `${year}-12-31` });

/**
 * Full replacement of the year's series: sources like gowithme recompute the
 * past retroactively, so appending row by row is not an option, it would drift.
 */
export function replaceDaily(source: SourceId, year: number, rows: DailyRow[]): void {
  const { from, to } = yearRange(year);
  const del = db.prepare('DELETE FROM daily WHERE source = ? AND day BETWEEN ? AND ?');
  const ins = db.prepare(
    'INSERT OR REPLACE INTO daily (source, day, seconds, items) VALUES (?, ?, ?, ?)',
  );
  db.exec('BEGIN');
  try {
    del.run(source, from, to);
    for (const row of rows) {
      ins.run(source, row.day, Math.round(row.seconds), row.items ?? 0);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function replaceMonthly(source: SourceId, year: number, rows: MonthlyRow[]): void {
  const del = db.prepare('DELETE FROM monthly WHERE source = ? AND month LIKE ?');
  const ins = db.prepare(
    'INSERT OR REPLACE INTO monthly (source, month, seconds, items) VALUES (?, ?, ?, ?)',
  );
  db.exec('BEGIN');
  try {
    del.run(source, `${year}-%`);
    for (const row of rows) {
      ins.run(source, row.month, Math.round(row.seconds), row.items ?? 0);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Accumulating write. Letterboxd returns a sliding window of ~50 entries,
 * so old ones must never be deleted, only added to.
 */
export function upsertEntries(source: SourceId, rows: EntryRow[]): number {
  const ins = db.prepare(`
    INSERT INTO entries (source, external_id, day, seconds, title, subtitle, estimated, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (source, external_id) DO UPDATE SET
      day = excluded.day,
      seconds = excluded.seconds,
      title = excluded.title,
      subtitle = excluded.subtitle,
      estimated = excluded.estimated,
      meta = excluded.meta
  `);
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      ins.run(
        source,
        row.externalId,
        row.day,
        Math.round(row.seconds),
        row.title,
        row.subtitle ?? null,
        row.estimated ? 1 : 0,
        row.meta ? JSON.stringify(row.meta) : null,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return rows.length;
}

/**
 * Full replacement of the year's entries: for sources like gowithme that
 * recompute the past, otherwise stale day×title rows would linger in the journal.
 */
export function replaceEntries(source: SourceId, year: number, rows: EntryRow[]): void {
  const { from, to } = yearRange(year);
  const del = db.prepare('DELETE FROM entries WHERE source = ? AND day BETWEEN ? AND ?');
  const ins = db.prepare(`
    INSERT INTO entries (source, external_id, day, seconds, title, subtitle, estimated, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec('BEGIN');
  try {
    del.run(source, from, to);
    for (const row of rows) {
      ins.run(
        source,
        row.externalId,
        row.day,
        Math.round(row.seconds),
        row.title,
        row.subtitle ?? null,
        row.estimated ? 1 : 0,
        row.meta ? JSON.stringify(row.meta) : null,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Rebuilds daily from accumulated entries, for sources that live on entries. */
export function rebuildDailyFromEntries(source: SourceId, year: number): void {
  const { from, to } = yearRange(year);
  const rows = db
    .prepare(
      `SELECT day, SUM(seconds) AS seconds, COUNT(*) AS items
         FROM entries
        WHERE source = ? AND day BETWEEN ? AND ?
        GROUP BY day ORDER BY day`,
    )
    .all(source, from, to) as Array<{ day: string; seconds: number; items: number }>;
  replaceDaily(source, year, rows);
}

export type HighlightRow = {
  title: string;
  subtitle?: string | null;
  seconds: number;
  iconUrl?: string | null;
};

export function replaceHighlights(source: SourceId, year: number, rows: HighlightRow[]): void {
  const del = db.prepare('DELETE FROM highlights WHERE source = ? AND year = ?');
  const ins = db.prepare(
    `INSERT INTO highlights (source, year, rank, title, subtitle, seconds, icon_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec('BEGIN');
  try {
    del.run(source, year);
    rows.forEach((row, index) => {
      ins.run(
        source,
        year,
        index + 1,
        row.title,
        row.subtitle ?? null,
        Math.round(row.seconds),
        row.iconUrl ?? null,
      );
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getHighlights(source: SourceId, year: number, limit = 5): HighlightRow[] {
  const rows = db
    .prepare(
      `SELECT title, subtitle, seconds, icon_url FROM highlights
        WHERE source = ? AND year = ? ORDER BY rank LIMIT ?`,
    )
    .all(source, year, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    title: row.title as string,
    subtitle: (row.subtitle as string) ?? null,
    seconds: row.seconds as number,
    iconUrl: (row.icon_url as string) ?? null,
  }));
}

export type FilmCache = {
  runtimeMin: number | null;
  /** null means not requested yet, '' means TMDB has no director. */
  director: string | null;
};

export function getCachedFilm(tmdbId: number): FilmCache | null {
  const row = db
    .prepare('SELECT runtime_min, director FROM film_runtime WHERE tmdb_id = ?')
    .get(tmdbId) as { runtime_min: number | null; director: string | null } | undefined;
  if (!row) return null;
  return { runtimeMin: row.runtime_min, director: row.director };
}

export function getCachedRuntime(tmdbId: number): number | null {
  return getCachedFilm(tmdbId)?.runtimeMin ?? null;
}

export function cacheFilm(
  tmdbId: number,
  runtimeMin: number | null,
  title: string,
  director: string | null,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO film_runtime (tmdb_id, runtime_min, title, director, fetched_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(tmdbId, runtimeMin, title, director, new Date().toISOString());
}

export function cacheRuntime(tmdbId: number, runtimeMin: number | null, title: string): void {
  const prev = getCachedFilm(tmdbId);
  cacheFilm(tmdbId, runtimeMin, title, prev?.director ?? null);
}

export function getShowRuntime(show: string): number | null | undefined {
  const row = db.prepare('SELECT runtime_min FROM show_runtime WHERE show = ?').get(show) as
    | { runtime_min: number | null }
    | undefined;
  return row === undefined ? undefined : row.runtime_min;
}

export function cacheShowRuntime(show: string, runtimeMin: number | null): void {
  db.prepare(
    'INSERT OR REPLACE INTO show_runtime (show, runtime_min, fetched_at) VALUES (?, ?, ?)',
  ).run(show, runtimeMin, new Date().toISOString());
}

export function recordSync(state: SyncStatus): void {
  db.prepare(
    `INSERT OR REPLACE INTO sync_state
       (source, last_run, status, message, covers_from, granularity, duration_ms, warning)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    state.source,
    new Date().toISOString(),
    state.status,
    state.message ?? null,
    state.coversFrom ?? null,
    state.granularity ?? null,
    state.durationMs ?? null,
    state.warning ?? null,
  );
}

export function getSyncState(): Record<string, unknown>[] {
  return db.prepare('SELECT * FROM sync_state').all() as Record<string, unknown>[];
}

/** Per-source total for the year: daily takes priority, monthly is the fallback series. */
export function getSourceTotals(year: number): Array<{ source: string; seconds: number; items: number }> {
  const { from, to } = yearRange(year);
  const daily = db
    .prepare(
      `SELECT source, SUM(seconds) AS seconds, SUM(items) AS items
         FROM daily WHERE day BETWEEN ? AND ? GROUP BY source`,
    )
    .all(from, to) as Array<{ source: string; seconds: number; items: number }>;
  const monthly = db
    .prepare(
      `SELECT source, SUM(seconds) AS seconds, SUM(items) AS items
         FROM monthly WHERE month LIKE ? GROUP BY source`,
    )
    .all(`${year}-%`) as Array<{ source: string; seconds: number; items: number }>;

  const totals = new Map<string, { source: string; seconds: number; items: number }>();
  for (const row of daily) totals.set(row.source, row);
  for (const row of monthly) if (!totals.has(row.source)) totals.set(row.source, row);
  return [...totals.values()];
}

/** Monthly series per source: from daily where available, otherwise from monthly. */
export function getMonthlyBreakdown(year: number): Array<{ source: string; month: string; seconds: number }> {
  const { from, to } = yearRange(year);
  const fromDaily = db
    .prepare(
      `SELECT source, substr(day, 1, 7) AS month, SUM(seconds) AS seconds
         FROM daily WHERE day BETWEEN ? AND ? GROUP BY source, month`,
    )
    .all(from, to) as Array<{ source: string; month: string; seconds: number }>;
  const sourcesWithDaily = new Set(fromDaily.map((row) => row.source));
  const fromMonthly = (
    db
      .prepare(
        `SELECT source, month, SUM(seconds) AS seconds
           FROM monthly WHERE month LIKE ? GROUP BY source, month`,
      )
      .all(`${year}-%`) as Array<{ source: string; month: string; seconds: number }>
  ).filter((row) => !sourcesWithDaily.has(row.source));

  return [...fromDaily, ...fromMonthly];
}

export function getTopEntries(source: SourceId, year: number, limit = 10): EntryRow[] {
  const { from, to } = yearRange(year);
  const rows = db
    .prepare(
      `SELECT external_id, day, seconds, title, subtitle, estimated, meta
         FROM entries WHERE source = ? AND day BETWEEN ? AND ?
        ORDER BY seconds DESC LIMIT ?`,
    )
    .all(source, from, to, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    externalId: row.external_id as string,
    day: row.day as string,
    seconds: row.seconds as number,
    title: row.title as string,
    subtitle: (row.subtitle as string) ?? null,
    estimated: Boolean(row.estimated),
    meta: row.meta ? (JSON.parse(row.meta as string) as Record<string, unknown>) : null,
  }));
}

export type JournalItem = {
  source: string;
  title: string;
  subtitle: string | null;
  seconds: number;
  estimated: boolean;
  /** item is a specific record (movie, episode), day is the source's daily total. */
  kind: 'item' | 'day';
};

export type JournalDay = { day: string; total: number; items: JournalItem[] };

/** "1 session", "2 sessions". */
function pluralSessions(count: number): string {
  return count === 1 ? 'session' : 'sessions';
}

/**
 * Day-by-day activity feed, newest first.
 *
 * Sources differ in granularity: movies, episodes, books, games and workouts
 * sit item by item in entries. Sources without entries enter the feed as a
 * single daily row from daily, so no breakdown is invented after the fact.
 */
export function getJournal(year: number, source?: SourceId): JournalDay[] {
  const { from, to } = yearRange(year);

  const entryFilter = source ? 'AND source = ?' : '';
  const entries = db
    .prepare(
      `SELECT source, day, title, subtitle, seconds, estimated FROM entries
        WHERE day BETWEEN ? AND ? ${entryFilter}
        ORDER BY seconds DESC`,
    )
    .all(...(source ? [from, to, source] : [from, to])) as Array<Record<string, unknown>>;

  // Sources with no per-item entries at all are shown as a daily total.
  const detailed = new Set(
    (db.prepare('SELECT DISTINCT source FROM entries').all() as Array<{ source: string }>).map(
      (row) => row.source,
    ),
  );
  const aggregateFilter = source ? 'AND source = ?' : '';
  const aggregates = (
    db
      .prepare(
        `SELECT source, day, seconds, items FROM daily
          WHERE day BETWEEN ? AND ? ${aggregateFilter}`,
      )
      .all(...(source ? [from, to, source] : [from, to])) as Array<Record<string, unknown>>
  ).filter((row) => !detailed.has(row.source as string));

  const byDay = new Map<string, JournalDay>();
  const dayOf = (day: string): JournalDay => {
    let entry = byDay.get(day);
    if (!entry) {
      entry = { day, total: 0, items: [] };
      byDay.set(day, entry);
    }
    return entry;
  };

  for (const row of entries) {
    const day = dayOf(row.day as string);
    day.items.push({
      source: row.source as string,
      title: row.title as string,
      subtitle: (row.subtitle as string) ?? null,
      seconds: row.seconds as number,
      estimated: Boolean(row.estimated),
      kind: 'item',
    });
    day.total += row.seconds as number;
  }

  for (const row of aggregates) {
    const day = dayOf(row.day as string);
    const sessions = row.items as number;
    day.items.push({
      source: row.source as string,
      title: 'daily total',
      subtitle: sessions > 0 ? `${sessions} ${pluralSessions(sessions)}` : null,
      seconds: row.seconds as number,
      estimated: false,
      kind: 'day',
    });
    day.total += row.seconds as number;
  }

  return [...byDay.values()]
    .map((day) => ({ ...day, items: day.items.sort((a, b) => b.seconds - a.seconds) }))
    .sort((a, b) => b.day.localeCompare(a.day));
}

export function countEntries(source: SourceId, year: number): number {
  const { from, to } = yearRange(year);
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM entries WHERE source = ? AND day BETWEEN ? AND ?')
    .get(source, from, to) as { n: number };
  return row.n;
}
