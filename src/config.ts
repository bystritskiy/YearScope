import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Everything is configured via environment variables. The defaults are enough
 * for the service to start without .env, but sources are then either off or
 * talk to nowhere: your own nicknames and addresses must be set explicitly.
 */

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(env(name, String(fallback)), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** The product version comes from one place: package.json. Shown in the footer. */
function appVersion(): string {
  try {
    const root = dirname(dirname(fileURLToPath(import.meta.url)));
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Demo mode: the database is filled with a fictional year, the network is never touched.
 * Exists for screenshots and so the project can be started and looked at
 * without creating accounts on five services.
 */
const demo = process.argv.includes('--demo') || env('YEARSCOPE_DEMO', 'false') === 'true';

/** Demo data lives separately so it never overwrites the real database. */
const dataDir = env('DATA_DIR', join(process.cwd(), demo ? 'data/demo' : 'data'));

/**
 * A source is on only if the switch is not off AND we know where to get the
 * data from. Otherwise an empty nickname would silently become a request to
 * nowhere and a red error on screen. Better to honestly show "not configured".
 */
const on = (flag: string, ...required: string[]): boolean =>
  env(flag, 'true') !== 'false' && required.every((value) => value !== '');

const gowithmePlayer = env('GOWITHME_PLAYER', '');
const koshelfBaseUrl = env('KOSHELF_BASE_URL', '');
const myshowsLogin = env('MYSHOWS_LOGIN', '');
const letterboxdUser = env('LETTERBOXD_USER', '');

export const config = {
  version: appVersion(),
  demo,
  port: envInt('PORT', 3010),
  dataDir,

  /** The year the summary is computed for. */
  year: envInt('YEARSCOPE_YEAR', new Date().getUTCFullYear()),

  /**
   * How often background sync polls the sources. Once a day: the year's data
   * does not change from extra polling, and the sources are better left alone.
   * Counted from service start, not from midnight.
   */
  syncIntervalMinutes: envInt('SYNC_INTERVAL_MINUTES', 1440),

  /** Sync right away on service start. */
  syncOnBoot: env('SYNC_ON_BOOT', 'true') !== 'false',

  sources: {
    gowithme: {
      enabled: on('GOWITHME_ENABLED', gowithmePlayer),
      baseUrl: env('GOWITHME_BASE_URL', 'https://gowithme.club'),
      player: gowithmePlayer,
    },
    koshelf: {
      enabled: on('KOSHELF_ENABLED', koshelfBaseUrl),
      baseUrl: koshelfBaseUrl,
    },
    myshows: {
      enabled: on('MYSHOWS_ENABLED', myshowsLogin),
      apiUrl: env('MYSHOWS_API_URL', 'https://api.myshows.me/v2/rpc/'),
      login: myshowsLogin,
      /**
       * History comes from a profile export (lives in data/imports),
       * because the public API only returns the last 25 check-ins.
       */
      importDir: env('MYSHOWS_IMPORT_DIR', join(dataDir, 'imports')),
      fallbackEpisodeMinutes: envInt('MYSHOWS_FALLBACK_EPISODE_MINUTES', 45),
    },
    intervals: {
      /**
       * The key comes from intervals.icu → Settings → Developer Settings.
       * Without it the source is simply off: workouts land in intervals.icu
       * from Garmin on their own, so a separate Garmin connector is not needed.
       */
      apiKey: env('INTERVALS_API_KEY', ''),
      baseUrl: env('INTERVALS_BASE_URL', 'https://intervals.icu'),
      /** 0 means "the current athlete", i.e. the key's owner. */
      athleteId: env('INTERVALS_ATHLETE_ID', '0'),
    },
    letterboxd: {
      enabled: on('LETTERBOXD_ENABLED', letterboxdUser),
      baseUrl: env('LETTERBOXD_BASE_URL', 'https://letterboxd.com'),
      user: letterboxdUser,
      /**
       * The TMDB key is optional. Without it movie runtime is taken as an
       * average and marked in the interface as an estimate.
       */
      tmdbApiKey: env('TMDB_API_KEY', ''),
      fallbackRuntimeMinutes: envInt('LETTERBOXD_FALLBACK_RUNTIME_MINUTES', 115),
    },
  },
} as const;

export type SourceId = 'gowithme' | 'myshows' | 'letterboxd' | 'koshelf' | 'intervals';

/** Order and labels of activities on the summary screen. */
export const SOURCE_META: Record<SourceId, { label: string; icon: string; accent: string }> = {
  gowithme: { label: 'Games', icon: '🎮', accent: '#7c5cff' },
  myshows: { label: 'TV shows', icon: '📺', accent: '#31b0d5' },
  letterboxd: { label: 'Movies', icon: '🎬', accent: '#40bf6a' },
  koshelf: { label: 'Books', icon: '📚', accent: '#e0913a' },
  intervals: { label: 'Workouts', icon: '🏃', accent: '#e05a8a' },
};

export const SOURCE_ORDER: SourceId[] = ['gowithme', 'myshows', 'letterboxd', 'koshelf', 'intervals'];
