import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readEntryOrFile, readZip } from './zip.js';

/** Hand-build a minimal, valid (non-ZIP64) zip from central-directory-first principles, mirroring zip.ts's own field layout. */
function buildZip(entries: { name: string; data: Buffer; store?: boolean }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const method = e.store ? 0 : 8;
    const compData = e.store ? e.data : deflateRawSync(e.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(compData.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const localEntry = Buffer.concat([local, nameBuf, compData]);
    localParts.push(localEntry);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(compData.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(Buffer.concat([central, nameBuf]));

    offset += localEntry.length;
  }
  const localBuf = Buffer.concat(localParts);
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

describe('readZip', () => {
  it('reads back deflated and stored entries', () => {
    const zip = buildZip([
      { name: 'conversations.json', data: Buffer.from(JSON.stringify({ a: 1, text: 'hello world '.repeat(50) })) },
      { name: 'readme.txt', data: Buffer.from('plain stored text'), store: true },
    ]);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['conversations.json', 'readme.txt']);
    expect(JSON.parse(entries[0]!.getData().toString('utf8'))).toMatchObject({ a: 1 });
    expect(entries[1]!.getData().toString('utf8')).toBe('plain stored text');
  });

  it('throws a clear error for a non-zip buffer', () => {
    expect(() => readZip(Buffer.from('not a zip'))).toThrow(/end-of-central-directory/);
  });
});

describe('readEntryOrFile', () => {
  it('reads a matching entry out of a zip file on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clai-zip-'));
    const zipPath = join(dir, 'export.zip');
    writeFileSync(zipPath, buildZip([{ name: 'conversations.json', data: Buffer.from('{"ok":true}') }]));
    const data = readEntryOrFile(zipPath, (n) => n.endsWith('conversations.json'));
    expect(JSON.parse(data.toString('utf8'))).toEqual({ ok: true });
  });

  it('reads a plain (non-zip) file directly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clai-zip-'));
    const jsonPath = join(dir, 'conversations.json');
    writeFileSync(jsonPath, '{"ok":true}');
    const data = readEntryOrFile(jsonPath, (n) => n.endsWith('conversations.json'));
    expect(JSON.parse(data.toString('utf8'))).toEqual({ ok: true });
  });

  it('throws when no entry in the zip matches the predicate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clai-zip-'));
    const zipPath = join(dir, 'export.zip');
    writeFileSync(zipPath, buildZip([{ name: 'other.json', data: Buffer.from('{}') }]));
    expect(() => readEntryOrFile(zipPath, (n) => n.endsWith('conversations.json'))).toThrow(/no matching entry/);
  });
});
