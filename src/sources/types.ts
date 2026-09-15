import type { Granularity } from '../db.ts';
import type { SourceId } from '../config.ts';

export type SyncResult = {
  /** С какой даты у источника реально есть данные (для честной отметки о пробеле). */
  coversFrom?: string | null;
  granularity: Granularity;
  /** Короткая строка в лог: что именно приехало. */
  summary: string;
  /** Оговорка о полноте данных, если она есть, показывается на экране. */
  warning?: string | null;
};

export type Source = {
  id: SourceId;
  enabled: boolean;
  sync(year: number): Promise<SyncResult>;
};
