import { inflateRawSync } from 'node:zlib';

/**
 * Minimal zip reading: xlsx is a zip, and pulling in a dependency for one
 * format is not worth it. The two storage methods that Excel and myshows
 * exports actually use are supported: 0 (stored) and 8 (deflate).
 * Zip64 is not supported: exports of hundreds of megabytes are not expected here.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

type Entry = { name: string; offset: number; method: number; compressedSize: number };

function findEndOfCentralDirectory(buffer: Buffer): number {
  // The archive comment at the end takes up to 64 KB, so search for the signature from the tail.
  const start = Math.max(0, buffer.length - 66_000);
  for (let index = buffer.length - 22; index >= start; index -= 1) {
    if (buffer.readUInt32LE(index) === EOCD_SIGNATURE) return index;
  }
  throw new Error('does not look like a zip: end of central directory not found');
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

/** Unpacks the archive into a map of "path inside the archive → contents". */
export function readZip(buffer: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();

  for (const entry of listEntries(buffer)) {
    // Name and extra lengths in the local header may differ from the central one.
    const nameLength = buffer.readUInt16LE(entry.offset + 26);
    const extraLength = buffer.readUInt16LE(entry.offset + 28);
    const dataStart = entry.offset + 30 + nameLength + extraLength;
    const data = buffer.subarray(dataStart, dataStart + entry.compressedSize);

    if (entry.method === 0) {
      files.set(entry.name, Buffer.from(data));
    } else if (entry.method === 8) {
      files.set(entry.name, inflateRawSync(data));
    } else {
      throw new Error(`unsupported compression method ${entry.method} for ${entry.name}`);
    }
  }

  return files;
}
