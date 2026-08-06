import { join } from 'node:path';

/**
 * Всё настраивается через переменные окружения, но значения по умолчанию
 * рассчитаны на домашний сетап Богдана — сервис должен подниматься без .env.
 */

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(env(name, String(fallback)), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: envInt('PORT', 3010),
  dataDir: env('DATA_DIR', join(process.cwd(), 'data')),

  /** Год, за который считаем сводку. */
  year: envInt('YEARSCOPE_YEAR', new Date().getUTCFullYear()),

  /**
   * Как часто фоновая синхронизация опрашивает источники. Раз в сутки:
   * данные за год от лишних опросов не меняются, а источники лучше не дёргать.
   * Отсчёт идёт от старта сервиса, а не от полуночи.
   */
  syncIntervalMinutes: envInt('SYNC_INTERVAL_MINUTES', 1440),

  /** Синхронизировать сразу при старте сервиса. */
  syncOnBoot: env('SYNC_ON_BOOT', 'true') !== 'false',

  sources: {
    gowithme: {
      enabled: env('GOWITHME_ENABLED', 'true') !== 'false',
      baseUrl: env('GOWITHME_BASE_URL', 'https://gowithme.club'),
      player: env('GOWITHME_PLAYER', 'your-nick'),
    },
    koshelf: {
      enabled: env('KOSHELF_ENABLED', 'true') !== 'false',
      baseUrl: env('KOSHELF_BASE_URL', 'http://NAS_HOST:3003'),
    },
    myshows: {
      enabled: env('MYSHOWS_ENABLED', 'true') !== 'false',
      apiUrl: env('MYSHOWS_API_URL', 'https://api.myshows.me/v2/rpc/'),
      login: env('MYSHOWS_LOGIN', 'your-nick'),
      /**
       * История берётся из выгрузки профиля (лежит в data/imports),
       * потому что публичный API отдаёт лишь 25 последних отметок.
       */
      importDir: env('MYSHOWS_IMPORT_DIR', join(env('DATA_DIR', join(process.cwd(), 'data')), 'imports')),
      fallbackEpisodeMinutes: envInt('MYSHOWS_FALLBACK_EPISODE_MINUTES', 45),
    },
    intervals: {
      /**
       * Ключ берётся на intervals.icu → Settings → Developer Settings.
       * Без него источник просто выключен: тренировки прилетают в intervals.icu
       * из Garmin сами, поэтому отдельный коннектор к Garmin не нужен.
       */
      apiKey: env('INTERVALS_API_KEY', ''),
      baseUrl: env('INTERVALS_BASE_URL', 'https://intervals.icu'),
      /** 0 означает «текущий атлет», то есть владелец ключа. */
      athleteId: env('INTERVALS_ATHLETE_ID', '0'),
    },
    letterboxd: {
      enabled: env('LETTERBOXD_ENABLED', 'true') !== 'false',
      baseUrl: env('LETTERBOXD_BASE_URL', 'https://letterboxd.com'),
      user: env('LETTERBOXD_USER', 'your-nick'),
      /**
       * Ключ TMDB опционален. Без него хронометраж фильмов берётся как средняя
       * величина и помечается в интерфейсе как оценка.
       */
      tmdbApiKey: env('TMDB_API_KEY', ''),
      fallbackRuntimeMinutes: envInt('LETTERBOXD_FALLBACK_RUNTIME_MINUTES', 115),
    },
  },
} as const;

export type SourceId = 'gowithme' | 'myshows' | 'letterboxd' | 'koshelf' | 'intervals';

/** Порядок и подписи активностей на экране сводки. */
export const SOURCE_META: Record<SourceId, { label: string; icon: string; accent: string }> = {
  gowithme: { label: 'Игры', icon: '🎮', accent: '#7c5cff' },
  myshows: { label: 'Сериалы', icon: '📺', accent: '#31b0d5' },
  letterboxd: { label: 'Кино', icon: '🎬', accent: '#40bf6a' },
  koshelf: { label: 'Книги', icon: '📚', accent: '#e0913a' },
  intervals: { label: 'Тренировки', icon: '🏃', accent: '#e05a8a' },
};

export const SOURCE_ORDER: SourceId[] = ['gowithme', 'myshows', 'letterboxd', 'koshelf', 'intervals'];
