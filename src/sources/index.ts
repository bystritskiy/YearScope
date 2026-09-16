import { gowithme } from './gowithme.ts';
import { intervals } from './intervals.ts';
import { koshelf } from './koshelf.ts';
import { letterboxd } from './letterboxd.ts';
import { myshows } from './myshows.ts';
import type { Source } from './types.ts';

/** Order does not matter here: sources sync in parallel. */
export const sources: Source[] = [gowithme, koshelf, letterboxd, myshows, intervals];

export const sourceById = new Map(sources.map((source) => [source.id, source]));
