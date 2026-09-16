import { readZip } from './zip.ts';

/**
 * Reads an xlsx into rows. Enough for exports like myshows: values are taken
 * as text, formatting and formulas are ignored.
 *
 * An important subtlety: Excel does not write empty cells, so a column's
 * position cannot be derived from order, only from the r attribute ("C5").
 * Otherwise a row with an empty rating would shift one column to the left.
 */

const decodeEntities = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, '&');

/** "AB" → 27 (one-based). */
function columnToIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/)?.[0] ?? 'A';
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index;
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => {
    // A <si> can hold several <t> if the string is split by formatting.
    const parts = [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]);
    return decodeEntities(parts.join(''));
  });
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];

  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];

    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1];
      const body = cellMatch[2];
      const reference = attributes.match(/r="([A-Z]+)\d+"/)?.[1];
      const type = attributes.match(/t="([^"]+)"/)?.[1];

      let value = '';
      if (type === 'inlineStr') {
        value = decodeEntities(
          [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join(''),
        );
      } else {
        const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (raw !== undefined) {
          value = type === 's' ? (shared[Number.parseInt(raw, 10)] ?? '') : decodeEntities(raw);
        }
      }

      const position = reference ? columnToIndex(reference) - 1 : cells.length;
      while (cells.length < position) cells.push('');
      cells[position] = value;
    }

    rows.push(cells);
  }

  return rows;
}

/** Parses the workbook into a map of "sheet name → rows". */
export function readXlsx(buffer: Buffer): Map<string, string[][]> {
  const files = readZip(buffer);
  const text = (path: string) => files.get(path)?.toString('utf8');

  const workbook = text('xl/workbook.xml');
  if (!workbook) throw new Error('not an xlsx: no xl/workbook.xml inside');

  const shared = parseSharedStrings(text('xl/sharedStrings.xml'));

  // The "sheet → file" link goes through r:id, not the sheet order in the workbook.
  // Both self-closing and paired tags are matched: myshows exports via Go XLSX,
  // which writes <sheet ...></sheet>, whereas Excel writes <sheet .../>.
  const relationships = new Map<string, string>();
  for (const match of (text('xl/_rels/workbook.xml.rels') ?? '').matchAll(
    /<Relationship([^>]*?)\/?>/g,
  )) {
    const id = match[1].match(/Id="([^"]+)"/)?.[1];
    const target = match[1].match(/Target="([^"]+)"/)?.[1];
    if (id && target) relationships.set(id, target.replace(/^\/?xl\//, '').replace(/^\.\//, ''));
  }

  const sheets = new Map<string, string[][]>();
  for (const match of workbook.matchAll(/<sheet ([^>]*?)\/?>/g)) {
    const name = match[1].match(/name="([^"]+)"/)?.[1];
    const relationId = match[1].match(/r:id="([^"]+)"/)?.[1];
    if (!name || !relationId) continue;

    const target = relationships.get(relationId);
    const xml = target ? text(`xl/${target}`) : undefined;
    if (xml) sheets.set(decodeEntities(name), parseSheet(xml, shared));
  }

  return sheets;
}
