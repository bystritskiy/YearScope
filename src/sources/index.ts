import { gowithme } from './gowithme.ts';
import { koshelf } from './koshelf.ts';
import { letterboxd } from './letterboxd.ts';
import type { Source } from './types.ts';

/**
 * Порядок здесь не важен — источники синхронизируются параллельно.
 * myshows и Garmin появятся тут же, когда решим, откуда брать их историю.
 */
export const sources: Source[] = [gowithme, koshelf, letterboxd];

export const sourceById = new Map(sources.map((source) => [source.id, source]));
