import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/**
 * Minimal pure-Node ZIP reader for the small, well-formed export archives claude.ai and ChatGPT
 * produce: reads the central directory (not local headers, which is what makes this robust to
 * archives with data descriptors) and decompresses stored (method 0) or deflated (method 8)
 * entries with `zlib.inflateRawSync`. No ZIP64 support (data-export archives are small); a
 * ZIP64-sized archive throws a clear error rather than silently returning wrong data.
 */

export interface ZipEntry {
  name: string;
  getData(): Buffer;
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_DIR_SIG = 0x02014b50;

function findEOCD(buf: Buffer): number {
  const minPos = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

function extractEntry(buf: Buffer, localOffset: number, method: number, compSize: number): Buffer {
  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLen + extraLen;
  const compData = buf.subarray(dataStart, dataStart + compSize);
  if (method === 0) return Buffer.from(compData);
  if (method === 8) return inflateRawSync(compData);
  throw new Error(`zip: unsupported compression method ${method}`);
}

export function readZip(buf: Buffer): ZipEntry[] {
  const eocd = findEOCD(buf);
  if (eocd < 0) throw new Error('zip: end-of-central-directory record not found (not a valid, non-ZIP64 zip file)');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  const end = cdOffset + cdSize;
  while (p < end) {
    const sig = buf.readUInt32LE(p);
    if (sig !== CENTRAL_DIR_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, getData: () => extractEntry(buf, localOffset, method, compSize) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Read a whole zip's bytes, or a plain (non-zip) file's bytes, and return the first matching entry's data. */
export function readEntryOrFile(path: string, entryNamePred: (name: string) => boolean): Buffer {
  const buf = readFileSync(path);
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) {
    const entries = readZip(buf);
    const entry = entries.find((e) => entryNamePred(e.name));
    if (!entry) throw new Error('zip: no matching entry found');
    return entry.getData();
  }
  return buf;
}
