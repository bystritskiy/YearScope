import { config, type SourceId } from './config.ts';
import { recordSync } from './db.ts';
import { sources } from './sources/index.ts';

export type SyncReport = {
  source: SourceId;
  status: 'ok' | 'error' | 'skipped';
  message: string;
  durationMs: number;
};

let running: Promise<SyncReport[]> | null = null;

async function syncOne(source: (typeof sources)[number], year: number): Promise<SyncReport> {
  const startedAt = Date.now();

  if (!source.enabled) {
    return { source: source.id, status: 'skipped', message: 'выключен в конфиге', durationMs: 0 };
  }

  try {
    const result = await source.sync(year);
    const durationMs = Date.now() - startedAt;
    recordSync({
      source: source.id,
      status: 'ok',
      message: result.summary,
      coversFrom: result.coversFrom,
      granularity: result.granularity,
      durationMs,
    });
    return { source: source.id, status: 'ok', message: result.summary, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    recordSync({ source: source.id, status: 'error', message, durationMs });
    return { source: source.id, status: 'error', message, durationMs };
  }
}

/**
 * Один источник не должен ронять остальные: каждый ловит свою ошибку сам,
 * а параллельный запуск нужен, чтобы медленный TMDB не задерживал локальный KoShelf.
 */
export function runSync(year = config.year): Promise<SyncReport[]> {
  if (running) return running;

  running = Promise.all(sources.map((source) => syncOne(source, year))).finally(() => {
    running = null;
  });

  return running;
}

export function isSyncRunning(): boolean {
  return running !== null;
}

export function startScheduler(): void {
  const intervalMs = config.syncIntervalMinutes * 60_000;
  if (intervalMs <= 0) return;

  const timer = setInterval(() => {
    runSync().then(
      (reports) => logReports('плановая синхронизация', reports),
      (error) => console.error('[sync] сбой планировщика:', error),
    );
  }, intervalMs);

  // Планировщик не должен удерживать процесс при остановке контейнера.
  timer.unref();
}

export function logReports(label: string, reports: SyncReport[]): void {
  const parts = reports.map((report) => {
    const mark = report.status === 'ok' ? '✓' : report.status === 'skipped' ? '·' : '✗';
    return `${mark} ${report.source}: ${report.message}`;
  });
  console.log(`[sync] ${label}\n      ${parts.join('\n      ')}`);
}
