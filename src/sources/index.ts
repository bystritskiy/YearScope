import { gowithme } from './gowithme.ts';
import { koshelf } from './koshelf.ts';
import { letterboxd } from './letterboxd.ts';
import { myshows } from './myshows.ts';
import type { Source } from './types.ts';

/**
 * Порядок здесь не важен — источники синхронизируются параллельно.
 * Garmin появится тут же, когда решим, откуда брать тренировки.
 */
export const sources: Source[] = [gowithme, koshelf, letterboxd, myshows];

export const sourceById = new Map(sources.map((source) => [source.id, source]));
