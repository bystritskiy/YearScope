import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Всё настраивается через переменные окружения. Значений по умолчанию хватает,
 * чтобы сервис поднялся без .env, но источники тогда либо выключены,
 * либо ходят в пустоту: свои ники и адреса нужно указать явно.
 */

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(env(name, String(fallback)), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Версия продукта берётся из одного места: package.json. Показывается в футере. */
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
 * Демо-режим: база заполняется вымышленным годом, сеть не трогается вовсе.
 * Нужен для скриншотов и для того, чтобы проект можно было запустить и
 * посмотреть, не заводя аккаунты в пяти сервисах.
 */
const demo = process.argv.includes('--demo') || env('YEARSCOPE_DEMO', 'false') === 'true';

/** Демо-данные живут отдельно, чтобы не затереть настоящую базу. */
const dataDir = env('DATA_DIR', join(process.cwd(), demo ? 'data/demo' : 'data'));

/**
 * Источник включён, только если выключатель не сняли И известно, откуда брать
 * данные. Иначе пустой ник молча превратился бы в запрос в никуда и красную
 * ошибку на экране. Лучше честно показать «не настроен».
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
       * История берётся из выгрузки профиля (лежит в data/imports),
       * потому что публичный API отдаёт лишь 25 последних отметок.
       */
      importDir: env('MYSHOWS_IMPORT_DIR', join(dataDir, 'imports')),
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
      enabled: on('LETTERBOXD_ENABLED', letterboxdUser),
      baseUrl: env('LETTERBOXD_BASE_URL', 'https://letterboxd.com'),
      user: letterboxdUser,
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
