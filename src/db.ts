import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config, type SourceId } from './config.ts';

/**
 * Источники отдают данные с разной детализацией, и подгонять их под общий
 * знаменатель нечестно: gowithme знает точный день, KoShelf — только месяц.
 * Поэтому храним два ряда — daily и monthly — и на чтении берём тот,
 * что доступен, а гранулярность показываем в интерфейсе.
 */

export type DailyRow = { day: string; seconds: number; items?: number };
export type MonthlyRow = { month: string; seconds: number; items?: number };

export type EntryRow = {
  externalId: string;
  day: string;
  seconds: number;
  title: string;
  subtitle?: string | null;
  /** true, если время посчитано оценкой, а не взято из источника. */
  estimated?: boolean;
  meta?: Record<string, unknown> | null;
};

export type Granularity = 'day' | 'month';

export type SyncStatus = {
  source: SourceId;
  status: 'ok' | 'error';
  message?: string | null;
  /** С какой даты у источника вообще есть данные — чтобы не врать про пробелы. */
  coversFrom?: string | null;
  granularity?: Granularity;
  durationMs?: number;
  /** Оговорка о полноте данных — попадает в блок «Что стоит знать о данных». */
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

  -- Топ игр/книг: у таких элементов нет одной даты, только суммарное время,
  -- поэтому они не попадают ни в daily, ни в entries.
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

  -- Хронометраж фильмов меняется редко, а TMDB лимитирует запросы,
  -- поэтому кэшируем навсегда и ходим в сеть только за новыми id.
  CREATE TABLE IF NOT EXISTS film_runtime (
    tmdb_id      INTEGER PRIMARY KEY,
    runtime_min  INTEGER,
    title        TEXT,
    fetched_at   TEXT NOT NULL
  );

  -- Хронометраж серии у сериала: в выгрузке есть не всегда, а дёргать
  -- shows.GetById на каждый синк ради неменяющегося числа бессмысленно.
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

/** Добавляет колонку, если её ещё нет: CREATE TABLE IF NOT EXISTS их не досоздаёт. */
function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('sync_state', 'warning', 'TEXT');

const yearRange = (year: number) => ({ from: `${year}-01-01`, to: `${year}-12-31` });

/**
 * Полная замена ряда за год: источники вроде gowithme пересчитывают прошлое
 * задним числом, поэтому дописывать по одной строке нельзя — разъедется.
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
 * Накопительная запись. Letterboxd отдаёт скользящее окно из ~50 записей,
 * поэтому старое нельзя удалять — только дополнять.
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

/** Пересобирает daily из накопленных entries — для источников, живущих на записях. */
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

export function getCachedRuntime(tmdbId: number): number | null {
  const row = db.prepare('SELECT runtime_min FROM film_runtime WHERE tmdb_id = ?').get(tmdbId) as
    | { runtime_min: number | null }
    | undefined;
  return row?.runtime_min ?? null;
}

export function cacheRuntime(tmdbId: number, runtimeMin: number | null, title: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO film_runtime (tmdb_id, runtime_min, title, fetched_at)
     VALUES (?, ?, ?, ?)`,
  ).run(tmdbId, runtimeMin, title, new Date().toISOString());
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

/** Итог по источнику за год: daily в приоритете, monthly как запасной ряд. */
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

/** Помесячный ряд по каждому источнику — из daily, где есть, иначе из monthly. */
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
  /** item — конкретная запись (фильм, серия), day — дневной итог источника. */
  kind: 'item' | 'day';
};

export type JournalDay = { day: string; total: number; items: JournalItem[] };

/** «1 сессия», «2 сессии», «8 сессий». */
function pluralSessions(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'сессия';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'сессии';
  return 'сессий';
}

/**
 * Лента активностей по дням, сверху свежее.
 *
 * У источников разная детализация: фильмы, серии, книги и тренировки лежат
 * поштучно, а gowithme не отдаёт разбивку по играм за день в разрезе игрока —
 * только суммарное время. Поэтому такие источники попадают в ленту одной
 * дневной строкой, а не выдумываются задним числом.
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

  // Источники, у которых поштучных записей нет вовсе, показываем дневным итогом.
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
      title: 'за день',
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
