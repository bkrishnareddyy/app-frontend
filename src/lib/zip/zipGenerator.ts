/**
 * Pure TypeScript / Node.js zero-dependency ZIP archive generator.
 * Produces standard binary PKZIP (.zip) files containing multiple entries (PDFs, JSON, CSV, text).
 */

// Pre-computed CRC32 lookup table for fast CRC32 calculation
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function computeCrc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntryInput {
  filename: string;
  content: Buffer | string;
  modDate?: Date;
}

/**
 * Encodes a JavaScript Date into MS-DOS date and time 16-bit integers.
 */
function toDosTimeDate(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, Math.min(2099, date.getFullYear()));
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();

  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  const dosTime = (hours << 11) | (minutes << 5) | Math.floor(seconds / 2);
  return { dosTime, dosDate };
}

/**
 * Builds a standard PKZIP (.zip) buffer from an array of entry inputs.
 */
export function generateZipBuffer(entries: ZipEntryInput[]): Buffer {
  const localHeaderBuffers: Buffer[] = [];
  const centralDirBuffers: Buffer[] = [];

  let currentOffset = 0;
  const now = new Date();

  for (const entry of entries) {
    const filenameBuf = Buffer.from(entry.filename.replace(/\\/g, "/"), "utf-8");
    const dataBuf = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content, "utf-8");

    const crc32 = computeCrc32(dataBuf);
    const uncompressedSize = dataBuf.length;
    const compressedSize = dataBuf.length; // Store method (no compression)
    const { dosTime, dosDate } = toDosTimeDate(entry.modDate || now);

    // ── Local File Header (30 bytes + filename + data) ─────────────────────
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // Signature: PK\x03\x04
    localHeader.writeUInt16LE(20, 4);         // Version needed: 2.0
    localHeader.writeUInt16LE(0x0800, 6);     // General purpose flag (UTF-8 bit set)
    localHeader.writeUInt16LE(0, 8);          // Compression method: 0 (Store)
    localHeader.writeUInt16LE(dosTime, 10);   // Last mod time
    localHeader.writeUInt16LE(dosDate, 12);   // Last mod date
    localHeader.writeUInt32LE(crc32, 14);     // CRC32
    localHeader.writeUInt32LE(compressedSize, 18);   // Compressed size
    localHeader.writeUInt32LE(uncompressedSize, 22); // Uncompressed size
    localHeader.writeUInt16LE(filenameBuf.length, 26); // Filename length
    localHeader.writeUInt16LE(0, 28);         // Extra field length

    localHeaderBuffers.push(localHeader, filenameBuf, dataBuf);

    // ── Central Directory File Header (46 bytes + filename) ───────────────
    const centralDirHeader = Buffer.alloc(46);
    centralDirHeader.writeUInt32LE(0x02014b50, 0); // Signature: PK\x01\x02
    centralDirHeader.writeUInt16LE(20, 4);         // Version made by: 2.0
    centralDirHeader.writeUInt16LE(20, 6);         // Version needed: 2.0
    centralDirHeader.writeUInt16LE(0x0800, 8);     // General purpose flag (UTF-8)
    centralDirHeader.writeUInt16LE(0, 10);         // Compression method: 0
    centralDirHeader.writeUInt16LE(dosTime, 12);   // Last mod time
    centralDirHeader.writeUInt16LE(dosDate, 14);   // Last mod date
    centralDirHeader.writeUInt32LE(crc32, 16);     // CRC32
    centralDirHeader.writeUInt32LE(compressedSize, 20);   // Compressed size
    centralDirHeader.writeUInt32LE(uncompressedSize, 24); // Uncompressed size
    centralDirHeader.writeUInt16LE(filenameBuf.length, 28); // Filename length
    centralDirHeader.writeUInt16LE(0, 30);         // Extra field length
    centralDirHeader.writeUInt16LE(0, 32);         // File comment length
    centralDirHeader.writeUInt16LE(0, 34);         // Disk number start
    centralDirHeader.writeUInt16LE(0, 36);         // Internal file attributes
    centralDirHeader.writeUInt32LE(0, 38);         // External file attributes
    centralDirHeader.writeUInt32LE(currentOffset, 42); // Relative offset of local header

    centralDirBuffers.push(centralDirHeader, filenameBuf);

    currentOffset += localHeader.length + filenameBuf.length + dataBuf.length;
  }

  const centralDirStartOffset = currentOffset;
  let centralDirSize = 0;
  for (const buf of centralDirBuffers) {
    centralDirSize += buf.length;
  }

  // ── End of Central Directory Record (22 bytes) ─────────────────────────
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // Signature: PK\x05\x06
  eocd.writeUInt16LE(0, 4);          // Disk number: 0
  eocd.writeUInt16LE(0, 6);          // Start disk: 0
  eocd.writeUInt16LE(entries.length, 8);  // Number of CD records on this disk
  eocd.writeUInt16LE(entries.length, 10); // Total CD records
  eocd.writeUInt32LE(centralDirSize, 12); // Size of central directory
  eocd.writeUInt32LE(centralDirStartOffset, 16); // Offset of start of CD
  eocd.writeUInt16LE(0, 20);         // Zipfile comment length

  return Buffer.concat([...localHeaderBuffers, ...centralDirBuffers, eocd]);
}
