import { SOURCE_META, SOURCE_ORDER, config, type SourceId } from './config.ts';
import {
  getHighlights,
  getJournal,
  getMonthlyBreakdown,
  getSourceTotals,
  getSyncState,
  type JournalDay,
} from './db.ts';
import { sourceById } from './sources/index.ts';

export type SourceSummary = {
  id: SourceId;
  label: string;
  icon: string;
  accent: string;
  seconds: number;
  hours: number;
  share: number;
  items: number;
  configured: boolean;
  status: 'ok' | 'error' | 'never';
  message: string | null;
  lastRun: string | null;
  /** From which date the source has data. If it is not 1 January, a warning is shown. */
  coversFrom: string | null;
  /** A data-completeness caveat from the source itself. */
  warning: string | null;
  granularity: 'day' | 'month' | null;
  highlights: Array<{ title: string; subtitle: string | null; seconds: number; iconUrl: string | null }>;
};

export type Summary = {
  year: number;
  /** Product version from package.json: the client shows it in the footer. */
  version: string;
  generatedAt: string;
  totalSeconds: number;
  sources: SourceSummary[];
  months: Array<{ month: string; total: number; bySource: Record<string, number> }>;
};

const MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));

export function buildSummary(year = config.year): Summary {
  const totals = new Map(getSourceTotals(year).map((row) => [row.source, row]));
  const syncState = new Map(getSyncState().map((row) => [row.source as string, row]));
  const breakdown = getMonthlyBreakdown(year);

  const totalSeconds = [...totals.values()].reduce((sum, row) => sum + row.seconds, 0);

  const sources: SourceSummary[] = SOURCE_ORDER.map((id) => {
    const meta = SOURCE_META[id];
    const total = totals.get(id);
    const state = syncState.get(id);
    const seconds = total?.seconds ?? 0;

    return {
      id,
      label: meta.label,
      icon: meta.icon,
      accent: meta.accent,
      seconds,
      hours: Math.round((seconds / 3600) * 10) / 10,
      share: totalSeconds > 0 ? seconds / totalSeconds : 0,
      items: total?.items ?? 0,
      configured: sourceById.has(id),
      status: state ? ((state.status as string) === 'ok' ? 'ok' : 'error') : 'never',
      message: (state?.message as string) ?? null,
      lastRun: (state?.last_run as string) ?? null,
      coversFrom: (state?.covers_from as string) ?? null,
      warning: (state?.warning as string) ?? null,
      granularity: (state?.granularity as 'day' | 'month') ?? null,
      highlights: getHighlights(id, year, 5),
    };
  });

  const months = MONTHS.map((month) => {
    const key = `${year}-${month}`;
    const bySource: Record<string, number> = {};
    let total = 0;
    for (const row of breakdown) {
      if (row.month !== key) continue;
      bySource[row.source] = (bySource[row.source] ?? 0) + row.seconds;
      total += row.seconds;
    }
    return { month: key, total, bySource };
  });

  return {
    year,
    version: config.version,
    generatedAt: new Date().toISOString(),
    totalSeconds,
    sources,
    months,
  };
}

export type SourceDetail = {
  source: SourceSummary;
  /** The full ranking, not just what fits on the card. */
  ranking: Array<{ title: string; subtitle: string | null; seconds: number; iconUrl: string | null }>;
  journal: JournalDay[];
  months: Array<{ month: string; seconds: number }>;
};

export function buildSourceDetail(id: SourceId, year = config.year): SourceDetail | null {
  const summary = buildSummary(year);
  const source = summary.sources.find((row) => row.id === id);
  if (!source) return null;

  return {
    source,
    ranking: getHighlights(id, year, 100),
    journal: getJournal(year, id),
    months: summary.months.map((month) => ({
      month: month.month,
      seconds: month.bySource[id] ?? 0,
    })),
  };
}
