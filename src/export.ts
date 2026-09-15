import { SOURCE_ORDER, config, type SourceId } from './config.ts';
import { getJournal, type JournalDay } from './db.ts';
import { buildSourceDetail, buildSummary, type Summary } from './summary.ts';

export type YearExport = {
  exportedAt: string;
  year: number;
  summary: Summary;
  journal: JournalDay[];
  sources: Array<{
    id: SourceId;
    highlights: Array<{ title: string; subtitle: string | null; seconds: number; iconUrl: string | null }>;
    journal: JournalDay[];
  }>;
};

/** Полный снимок года: сводка, общий журнал и разрезы по источникам. */
export function buildExport(year = config.year): YearExport {
  const summary = buildSummary(year);
  const journal = getJournal(year);

  const sources = SOURCE_ORDER.flatMap((id) => {
    const detail = buildSourceDetail(id, year);
    if (!detail) return [];
    return [
      {
        id,
        highlights: detail.ranking,
        journal: detail.journal,
      },
    ];
  });

  return {
    exportedAt: new Date().toISOString(),
    year,
    summary,
    journal,
    sources,
  };
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Плоский журнал для Excel/Numbers: одна строка это одно событие. */
export function buildJournalCsv(year = config.year): string {
  const days = getJournal(year);
  const lines = ['day,source,title,subtitle,seconds,hours,estimated'];

  for (const day of days) {
    for (const item of day.items) {
      const hours = Math.round((item.seconds / 3600) * 100) / 100;
      lines.push(
        [
          day.day,
          item.source,
          csvEscape(item.title),
          csvEscape(item.subtitle ?? ''),
          String(item.seconds),
          String(hours),
          item.estimated ? '1' : '0',
        ].join(','),
      );
    }
  }

  // BOM нужен, чтобы Excel на Windows не ломал кириллицу.
  return `\uFEFF${lines.join('\n')}\n`;
}
