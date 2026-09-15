import {
  replaceEntries,
  replaceHighlights,
  recordSync,
  rebuildDailyFromEntries,
  type EntryRow,
} from './db.ts';

/**
 * Демо-режим: правдоподобный вымышленный год вместо личной истории.
 *
 * Нужен, чтобы показать интерфейс на скриншотах и дать пощупать проект тому,
 * у кого нет ни ключей, ни аккаунтов в пяти сервисах. Сеть не трогается вовсе.
 *
 * Генератор детерминированный: один и тот же год даёт одну и ту же картинку,
 * иначе каждый пересъём скриншотов менял бы все числа в README.
 */

/** mulberry32 — короткий и воспроизводимый PRNG; Math.random() здесь не годится. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GAMES: Array<[string, string]> = [
  ['The Legend of Zelda: Tears of the Kingdom', 'Nintendo'],
  ["Baldur's Gate 3", 'Steam'],
  ['Elden Ring', 'PS5'],
  ['Hades II', 'Steam'],
  ['Stardew Valley', 'Steam'],
  ['Hollow Knight', 'Nintendo'],
  ['Disco Elysium', 'Steam'],
  ['Super Mario Odyssey', 'Nintendo'],
  ['Factorio', 'Steam'],
  ['Outer Wilds', 'Steam'],
  ['Balatro', 'Nintendo'],
  ['Celeste', 'Nintendo'],
  ['Metroid Dread', 'Nintendo'],
  ['Slay the Spire', 'Steam'],
  ['Return of the Obra Dinn', 'Steam'],
];

const SHOWS: Array<[string, string[]]> = [
  ['Twin Peaks', ['Pilot', 'Traces to Nowhere', 'Zen, or the Skill to Catch a Killer', 'Rest in Pain', 'The One-Armed Man']],
  ['The Wire', ['The Target', 'The Detail', 'The Buys', 'Old Cases', 'The Pager']],
  ['Chernobyl', ['1:23:45', 'Please Remain Calm', 'Open Wide, O Earth', 'The Happiness of All Mankind']],
  ['Severance', ['Good News About Hell', 'Half Loop', 'In Perpetuity', 'The You You Are']],
  ['Better Call Saul', ['Uno', 'Mijo', 'Nacho', 'Hero', 'Alpine Shepherd Boy']],
  ['Arcane', ['Welcome to the Playground', 'Some Mysteries Are Better Left Unsolved', 'The Base Violence Necessary for Change']],
];

const FILMS: Array<[string, string, number]> = [
  ['Blade Runner 2049', 'Denis Villeneuve', 164],
  ['Parasite', 'Bong Joon-ho', 132],
  ['Stalker', 'Andrei Tarkovsky', 162],
  ['Mad Max: Fury Road', 'George Miller', 120],
  ['Spirited Away', 'Hayao Miyazaki', 125],
  ['The Grand Budapest Hotel', 'Wes Anderson', 99],
  ['Arrival', 'Denis Villeneuve', 116],
  ['Whiplash', 'Damien Chazelle', 106],
  ['Everything Everywhere All at Once', 'Daniel Kwan', 139],
  ['Dune', 'Denis Villeneuve', 155],
  ['No Country for Old Men', 'Joel Coen', 122],
  ['In the Mood for Love', 'Wong Kar-wai', 98],
  ['Portrait of a Lady on Fire', 'Céline Sciamma', 122],
  ['Perfect Days', 'Wim Wenders', 124],
];

const BOOKS: Array<[string, string]> = [
  ['Пикник на обочине', 'Аркадий и Борис Стругацкие'],
  ['Мастер и Маргарита', 'Михаил Булгаков'],
  ['Дюна', 'Фрэнк Герберт'],
  ['Задача трёх тел', 'Лю Цысинь'],
  ['Убик', 'Филип Дик'],
  ['Сто лет одиночества', 'Габриэль Гарсиа Маркес'],
  ['Норвежский лес', 'Харуки Мураками'],
];

const WORKOUTS: Array<[string, string]> = [
  ['Morning Ride', 'Велосипед'],
  ['Evening Run', 'Бег'],
  ['City Walk', 'Ходьба'],
  ['Strength', 'Силовая'],
  ['Yoga', 'Йога'],
  ['Pool', 'Плавание'],
];

/** Книги «начались» в июне — чтобы демо показывало и честную отметку о пробеле. */
const BOOKS_START = '-06-10';

function daysOfYear(year: number): string[] {
  const days: string[] = [];
  const last = new Date(Date.UTC(year, 11, 31));
  const today = new Date();
  // Текущий год обрывается сегодняшним днём: так демо выглядит как живая картина.
  const end = today.getUTCFullYear() === year && today < last ? today : last;
  for (let d = new Date(Date.UTC(year, 0, 1)); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

const isWeekend = (day: string): boolean => {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
};

/** Суммирует секунды по ключу и отдаёт готовый рейтинг для highlights. */
function ranking(
  rows: Array<{ key: string; title: string; subtitle: string | null; seconds: number }>,
): Array<{ title: string; subtitle: string | null; seconds: number }> {
  const totals = new Map<string, { title: string; subtitle: string | null; seconds: number }>();
  for (const row of rows) {
    const prev = totals.get(row.key);
    if (prev) prev.seconds += row.seconds;
    else totals.set(row.key, { title: row.title, subtitle: row.subtitle, seconds: row.seconds });
  }
  return [...totals.values()].sort((a, b) => b.seconds - a.seconds);
}

export function seedDemo(year: number): void {
  const days = daysOfYear(year);
  const random = rng(year * 7919);
  const pick = <T,>(list: T[]): T => list[Math.floor(random() * list.length)]!;
  const between = (min: number, max: number): number => Math.round(min + random() * (max - min));

  const games: EntryRow[] = [];
  const episodes: EntryRow[] = [];
  const films: EntryRow[] = [];
  const books: EntryRow[] = [];
  const workouts: EntryRow[] = [];

  for (const day of days) {
    const weekend = isWeekend(day);

    // Игры: почти каждый день понемногу, на выходных — по нескольку тайтлов.
    if (random() < (weekend ? 0.85 : 0.55)) {
      const count = weekend ? between(1, 3) : 1;
      const chosen = new Set<number>();
      for (let i = 0; i < count; i += 1) {
        const index = Math.floor(random() * GAMES.length);
        if (chosen.has(index)) continue;
        chosen.add(index);
        const [title, platform] = GAMES[index]!;
        games.push({
          externalId: `${day}|game-${index}`,
          day,
          seconds: between(weekend ? 40 : 15, weekend ? 190 : 95) * 60,
          title,
          subtitle: platform,
        });
      }
    }

    // Сериалы: смотрятся сериями подряд, поэтому пачкой и не каждый день.
    if (random() < 0.4) {
      const [show, list] = pick(SHOWS);
      const count = Math.min(between(1, weekend ? 4 : 2), list.length);
      // Серии идут подряд от случайной точки — как при обычном запое сериалом.
      const start = Math.floor(random() * list.length);
      for (let i = 0; i < count; i += 1) {
        const episode = list[(start + i) % list.length]!;
        episodes.push({
          externalId: `${day}|${show}|${i}`,
          day,
          seconds: between(38, 58) * 60,
          title: episode,
          subtitle: show,
        });
      }
    }

    // Кино: пара фильмов в неделю, чаще на выходных.
    if (random() < (weekend ? 0.3 : 0.1)) {
      const [title, director, runtime] = pick(FILMS);
      films.push({
        externalId: `${day}|${title}`,
        day,
        seconds: runtime * 60,
        title,
        subtitle: director,
      });
    }

    // Книги: только со старта учёта — демо показывает и честную отметку о пробеле.
    if (day.slice(4) >= BOOKS_START && random() < 0.45) {
      const [title, author] = pick(BOOKS);
      books.push({
        externalId: `${day}|${title}`,
        day,
        seconds: between(12, 75) * 60,
        title,
        subtitle: author,
      });
    }

    // Тренировки: примерно четыре раза в неделю, на выходных длиннее.
    if (random() < (weekend ? 0.75 : 0.45)) {
      const [title, type] = pick(WORKOUTS);
      workouts.push({
        externalId: `${day}|workout`,
        day,
        seconds: between(25, weekend ? 170 : 85) * 60,
        title,
        subtitle: type,
      });
    }
  }

  const write = (
    source: 'gowithme' | 'myshows' | 'letterboxd' | 'koshelf' | 'intervals',
    rows: EntryRow[],
    rank: Array<{ title: string; subtitle: string | null; seconds: number }>,
  ): void => {
    replaceEntries(source, year, rows);
    rebuildDailyFromEntries(source, year);
    replaceHighlights(source, year, rank.slice(0, 100));
  };

  write(
    'gowithme',
    games,
    ranking(games.map((row) => ({ key: row.title, title: row.title, subtitle: row.subtitle ?? null, seconds: row.seconds }))),
  );
  write(
    'myshows',
    episodes,
    ranking(
      episodes.map((row) => ({
        key: row.subtitle ?? row.title,
        title: row.subtitle ?? row.title,
        subtitle: null,
        seconds: row.seconds,
      })),
    ),
  );
  write(
    'letterboxd',
    films,
    ranking(films.map((row) => ({ key: row.title, title: row.title, subtitle: row.subtitle ?? null, seconds: row.seconds }))),
  );
  write(
    'koshelf',
    books,
    ranking(books.map((row) => ({ key: row.title, title: row.title, subtitle: row.subtitle ?? null, seconds: row.seconds }))),
  );
  write(
    'intervals',
    workouts,
    // У тренировок рейтинг по виду активности, а не по названию: так честнее.
    ranking(
      workouts.map((row) => ({
        key: row.subtitle ?? row.title,
        title: row.subtitle ?? row.title,
        subtitle: null,
        seconds: row.seconds,
      })),
    ),
  );

  const hours = (rows: EntryRow[]): number =>
    Math.round(rows.reduce((sum, row) => sum + row.seconds, 0) / 3600);

  /**
   * coversFrom — не «первая запись», а с какой даты источник вообще ведёт учёт.
   * У четырёх он ведётся с начала года, у книг — с июня: демо должно показывать
   * и эту оговорку, она в продукте на видном месте.
   */
  const state = (
    source: 'gowithme' | 'myshows' | 'letterboxd' | 'koshelf' | 'intervals',
    coversFrom: string,
    summary: string,
  ): void => {
    recordSync({ source, status: 'ok', message: summary, coversFrom, granularity: 'day', durationMs: 0 });
  };

  const yearStart = `${year}-01-01`;
  state('gowithme', yearStart, `демо: ${hours(games)} ч, игр в журнале: ${games.length}`);
  state('myshows', yearStart, `демо: ${hours(episodes)} ч, серий: ${episodes.length}`);
  state('letterboxd', yearStart, `демо: ${hours(films)} ч, фильмов: ${films.length}`);
  state('koshelf', `${year}${BOOKS_START}`, `демо: ${hours(books)} ч, книг: ${books.length}`);
  state('intervals', yearStart, `демо: ${hours(workouts)} ч, тренировок: ${workouts.length}`);
}
