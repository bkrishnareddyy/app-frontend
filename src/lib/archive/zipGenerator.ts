/**
 * Shared server-side ZIP archive generator (Store mode).
 * Packs files into a valid PKZip archive Buffer without native dependencies.
 */
export function generateZipArchive(files: Array<{ filename: string; content: string | Buffer }>): Buffer {
  const parts: Buffer[] = [];
  const cdHeaders: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const filenameBuf = Buffer.from(file.filename, "utf-8");
    const contentBuf = typeof file.content === "string" ? Buffer.from(file.content, "utf-8") : file.content;
    const crc = crc32(contentBuf);
    const size = contentBuf.length;

    // Local file header (30 + filename.length)
    const localHeader = Buffer.alloc(30 + filenameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local header signature
    localHeader.writeUInt16LE(20, 4); // Version needed
    localHeader.writeUInt16LE(0, 6); // General purpose bit flag
    localHeader.writeUInt16LE(0, 8); // Compression method (0 = store)
    localHeader.writeUInt16LE(0, 10); // Modification time
    localHeader.writeUInt16LE(0, 12); // Modification date
    localHeader.writeUInt32LE(crc, 14); // CRC-32
    localHeader.writeUInt32LE(size, 18); // Compressed size
    localHeader.writeUInt32LE(size, 22); // Uncompressed size
    localHeader.writeUInt16LE(filenameBuf.length, 26); // Filename length
    localHeader.writeUInt16LE(0, 28); // Extra field length
    filenameBuf.copy(localHeader, 30);

    parts.push(localHeader, contentBuf);

    // Central directory header
    const cdHeader = Buffer.alloc(46 + filenameBuf.length);
    cdHeader.writeUInt32LE(0x02014b50, 0); // Central directory signature
    cdHeader.writeUInt16LE(20, 4); // Version made by
    cdHeader.writeUInt16LE(20, 6); // Version needed
    cdHeader.writeUInt16LE(0, 8); // General purpose flag
    cdHeader.writeUInt16LE(0, 10); // Compression method
    cdHeader.writeUInt16LE(0, 12); // Time
    cdHeader.writeUInt16LE(0, 14); // Date
    cdHeader.writeUInt32LE(crc, 16); // CRC-32
    cdHeader.writeUInt32LE(size, 20); // Compressed size
    cdHeader.writeUInt32LE(size, 24); // Uncompressed size
    cdHeader.writeUInt16LE(filenameBuf.length, 28); // Filename length
    cdHeader.writeUInt16LE(0, 30); // Extra field length
    cdHeader.writeUInt16LE(0, 32); // File comment length
    cdHeader.writeUInt16LE(0, 34); // Disk number start
    cdHeader.writeUInt16LE(0, 36); // Internal file attributes
    cdHeader.writeUInt32LE(0, 38); // External file attributes
    cdHeader.writeUInt32LE(offset, 42); // Local header offset
    filenameBuf.copy(cdHeader, 46);

    cdHeaders.push(cdHeader);
    offset += localHeader.length + contentBuf.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const cd of cdHeaders) {
    parts.push(cd);
    cdSize += cd.length;
  }

  // End of central directory record
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // Disk number
  eocd.writeUInt16LE(0, 6); // Start disk
  eocd.writeUInt16LE(files.length, 8); // Disk entries
  eocd.writeUInt16LE(files.length, 10); // Total entries
  eocd.writeUInt32LE(cdSize, 12); // Central directory size
  eocd.writeUInt32LE(cdOffset, 16); // Central directory offset
  eocd.writeUInt16LE(0, 20); // Comment length

  parts.push(eocd);
  return Buffer.concat(parts);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
