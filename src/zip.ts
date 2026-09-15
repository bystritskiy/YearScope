import { inflateRawSync } from 'node:zlib';

/**
 * Минимальное чтение zip: xlsx это zip, а тянуть зависимость ради одного
 * формата не хочется. Поддерживаются два метода хранения, которые Excel и
 * выгрузки myshows реально используют: 0 (без сжатия) и 8 (deflate).
 * Zip64 не поддерживается: экспорты на сотни мегабайт тут не ожидаются.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

type Entry = { name: string; offset: number; method: number; compressedSize: number };

function findEndOfCentralDirectory(buffer: Buffer): number {
  // Комментарий в конце архива занимает до 64 КБ, поэтому ищем сигнатуру с хвоста.
  const start = Math.max(0, buffer.length - 66_000);
  for (let index = buffer.length - 22; index >= start; index -= 1) {
    if (buffer.readUInt32LE(index) === EOCD_SIGNATURE) return index;
  }
  throw new Error('не похоже на zip: не найден конец центрального каталога');
}

function listEntries(buffer: Buffer): Entry[] {
  const eocd = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  let position = buffer.readUInt32LE(eocd + 16);

  const entries: Entry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(position) !== CENTRAL_SIGNATURE) break;

    const method = buffer.readUInt16LE(position + 10);
    const compressedSize = buffer.readUInt32LE(position + 20);
    const nameLength = buffer.readUInt16LE(position + 28);
    const extraLength = buffer.readUInt16LE(position + 30);
    const commentLength = buffer.readUInt16LE(position + 32);
    const offset = buffer.readUInt32LE(position + 42);
    const name = buffer.toString('utf8', position + 46, position + 46 + nameLength);

    entries.push({ name, offset, method, compressedSize });
    position += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Разворачивает архив в карту «путь внутри архива → содержимое». */
export function readZip(buffer: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();

  for (const entry of listEntries(buffer)) {
    // Длины имени и extra в локальном заголовке могут отличаться от центрального.
    const nameLength = buffer.readUInt16LE(entry.offset + 26);
    const extraLength = buffer.readUInt16LE(entry.offset + 28);
    const dataStart = entry.offset + 30 + nameLength + extraLength;
    const data = buffer.subarray(dataStart, dataStart + entry.compressedSize);

    if (entry.method === 0) {
      files.set(entry.name, Buffer.from(data));
    } else if (entry.method === 8) {
      files.set(entry.name, inflateRawSync(data));
    } else {
      throw new Error(`не поддерживаемый метод сжатия ${entry.method} у ${entry.name}`);
    }
  }

  return files;
}
