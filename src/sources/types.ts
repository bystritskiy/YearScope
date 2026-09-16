import type { Granularity } from '../db.ts';
import type { SourceId } from '../config.ts';

export type SyncResult = {
  /** From which date the source actually has data (for an honest note about the gap). */
  coversFrom?: string | null;
  granularity: Granularity;
  /** A short line for the log: what exactly arrived. */
  summary: string;
  /** A data-completeness caveat, if any; shown on screen. */
  warning?: string | null;
};

export type Source = {
  id: SourceId;
  enabled: boolean;
  sync(year: number): Promise<SyncResult>;
};
