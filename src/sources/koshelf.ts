import { config } from '../config.ts';
import { fetchJson } from '../http.ts';
import { replaceDaily, replaceHighlights, upsertEntries, type EntryRow } from '../db.ts';
import type { Source, SyncResult } from './types.ts';

type Period = { key: string; start_date: string; reading_time_sec: number };
type PeriodsResponse = { data?: { periods?: Period[] } };

type CalendarEvent = { item_ref: string; start: string; reading_time_sec: number; pages_read: number };
type CalendarItem = { title?: string; authors?: string[] };
type CalendarResponse = {
  data?: { events?: CalendarEvent[]; items?: Record<string, CalendarItem> };
};

export const koshelf: Source = {
  id: 'koshelf',
  enabled: config.sources.koshelf.enabled,

  async sync(year: number): Promise<SyncResult> {
    const { baseUrl } = config.sources.koshelf;

    // Спрашиваем, в каких месяцах вообще есть чтение, чтобы не дёргать пустые.
    const periods = await fetchJson<PeriodsResponse>(
      `${baseUrl}/api/reading/available-periods?source=reading_data&group_by=month`,
    );
    const months = (periods.data?.periods ?? [])
      .map((period) => period.key)
      .filter((key) => key.startsWith(`${year}-`));

    const secondsByDay = new Map<string, number>();
    const sessionsByDay = new Map<string, number>();
    const secondsByBook = new Map<string, { title: string; author: string | null; seconds: number }>();
    // Чтение конкретной книги в конкретный день это строка журнала.
    const byBookAndDay = new Map<string, EntryRow>();

    for (const month of months) {
      const calendar = await fetchJson<CalendarResponse>(
        `${baseUrl}/api/reading/calendar?month=${month}`,
      );
      const events = calendar.data?.events ?? [];
      const items = calendar.data?.items ?? {};

      for (const event of events) {
        if (!event.start?.startsWith(`${year}-`)) continue;
        secondsByDay.set(event.start, (secondsByDay.get(event.start) ?? 0) + event.reading_time_sec);
        sessionsByDay.set(event.start, (sessionsByDay.get(event.start) ?? 0) + 1);

        const item = items[event.item_ref];
        const title = item?.title ?? 'Без названия';
        const author = item?.authors?.[0]?.replace(/\s+/g, ' ').trim() ?? null;

        // Одну книгу можно читать несколькими заходами за день, поэтому суммируем.
        const entryKey = `${event.item_ref}|${event.start}`;
        const entry = byBookAndDay.get(entryKey);
        if (entry) {
          entry.seconds += event.reading_time_sec;
        } else {
          byBookAndDay.set(entryKey, {
            externalId: entryKey,
            day: event.start,
            seconds: event.reading_time_sec,
            title,
            subtitle: author,
            meta: { pages: event.pages_read },
          });
        }

        const existing = secondsByBook.get(event.item_ref);
        if (existing) {
          existing.seconds += event.reading_time_sec;
        } else {
          secondsByBook.set(event.item_ref, { title, author, seconds: event.reading_time_sec });
        }
      }
    }

    const days = [...secondsByDay.entries()]
      .map(([day, seconds]) => ({ day, seconds, items: sessionsByDay.get(day) ?? 0 }))
      .sort((a, b) => a.day.localeCompare(b.day));

    replaceDaily('koshelf', year, days);
    upsertEntries('koshelf', [...byBookAndDay.values()]);

    replaceHighlights(
      'koshelf',
      year,
      [...secondsByBook.values()]
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 100)
        .map((book) => ({ title: book.title, subtitle: book.author, seconds: book.seconds })),
    );

    const seconds = days.reduce((sum, row) => sum + row.seconds, 0);

    return {
      coversFrom: days[0]?.day ?? null,
      granularity: 'day',
      summary: `${days.length} дней, ${Math.round(seconds / 3600)} ч, книг: ${secondsByBook.size}`,
    };
  },
};
