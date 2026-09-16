import {
  replaceEntries,
  replaceHighlights,
  recordSync,
  rebuildDailyFromEntries,
  type EntryRow,
} from './db.ts';

/**
 * Demo mode: a plausible fictional year instead of personal history.
 *
 * Exists to show the interface in screenshots and let someone without keys or
 * accounts on five services try the project. The network is never touched.
 *
 * The generator is deterministic: the same year yields the same picture,
 * otherwise every screenshot retake would change all the numbers in the README.
 */

/** mulberry32: a short, reproducible PRNG; Math.random() will not do here. */
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
  ['Roadside Picnic', 'Arkady and Boris Strugatsky'],
  ['The Master and Margarita', 'Mikhail Bulgakov'],
  ['Dune', 'Frank Herbert'],
  ['The Three-Body Problem', 'Liu Cixin'],
  ['Ubik', 'Philip K. Dick'],
  ['One Hundred Years of Solitude', 'Gabriel García Márquez'],
  ['Norwegian Wood', 'Haruki Murakami'],
];

const WORKOUTS: Array<[string, string]> = [
  ['Morning Ride', 'Cycling'],
  ['Evening Run', 'Running'],
  ['City Walk', 'Walking'],
  ['Strength', 'Strength'],
  ['Yoga', 'Yoga'],
  ['Pool', 'Swimming'],
];

/** Books "started" in June so the demo also shows the honest gap caveat. */
const BOOKS_START = '-06-10';

function daysOfYear(year: number): string[] {
  const days: string[] = [];
  const last = new Date(Date.UTC(year, 11, 31));
  const today = new Date();
  // The current year is cut off at today: that way the demo looks like a live picture.
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

/** Sums seconds by key and returns a ready ranking for highlights. */
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

    // Games: a little almost every day, several titles on weekends.
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

    // TV shows: watched several episodes in a row, so in batches and not every day.
    if (random() < 0.4) {
      const [show, list] = pick(SHOWS);
      const count = Math.min(between(1, weekend ? 4 : 2), list.length);
      // Episodes run consecutively from a random point, like a typical binge.
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

    // Movies: a couple a week, more often on weekends.
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

    // Books: only from the tracking start, so the demo also shows the honest gap caveat.
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

    // Workouts: about four times a week, longer on weekends.
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
    // Workouts are ranked by activity type, not by name: that is more honest.
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
   * coversFrom is not "the first record" but the date the source has tracked from.
   * Four track from the start of the year, books from June: the demo must show
   * this caveat too, it is prominent in the product.
   */
  const state = (
    source: 'gowithme' | 'myshows' | 'letterboxd' | 'koshelf' | 'intervals',
    coversFrom: string,
    summary: string,
  ): void => {
    recordSync({ source, status: 'ok', message: summary, coversFrom, granularity: 'day', durationMs: 0 });
  };

  const yearStart = `${year}-01-01`;
  state('gowithme', yearStart, `demo: ${hours(games)} h, games in journal: ${games.length}`);
  state('myshows', yearStart, `demo: ${hours(episodes)} h, episodes: ${episodes.length}`);
  state('letterboxd', yearStart, `demo: ${hours(films)} h, movies: ${films.length}`);
  state('koshelf', `${year}${BOOKS_START}`, `demo: ${hours(books)} h, books: ${books.length}`);
  state('intervals', yearStart, `demo: ${hours(workouts)} h, workouts: ${workouts.length}`);
}
