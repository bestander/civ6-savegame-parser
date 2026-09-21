import zlib from 'zlib';

const ZLIB_HEADER = Buffer.from([0x78, 0x9c]);
const COMPRESSED_DATA_END = Buffer.from([0x00, 0x00, 0xff, 0xff]);
const CHUNK_SIZE = 64 * 1024;

/**
 * Inflate the primary zlib payload from an uncompressed .Civ6Save buffer.
 * Recipe verified against pydt/civ6-save-parser and civ6_pipeline.
 */
export function decompressCiv6Payload(savefile: Buffer): Buffer {
    const modTitle = Buffer.from([0x72, 0xe1, 0x34, 0x30]); // MOD_TITLE marker
    const modIndex = savefile.lastIndexOf(modTitle);
    const searchFrom = modIndex >= 0 ? modIndex : 0;
    const bufStart = savefile.indexOf(ZLIB_HEADER, searchFrom);
    if (bufStart < 0) {
        throw new Error('Civ6Save: zlib header not found in file');
    }
    const bufEnd = savefile.lastIndexOf(COMPRESSED_DATA_END);
    if (bufEnd < bufStart) {
        throw new Error('Civ6Save: compressed region end marker not found');
    }
    const data = savefile.subarray(bufStart, bufEnd + COMPRESSED_DATA_END.length);
    const chunks: Buffer[] = [];
    let pos = 0;
    while (pos < data.length) {
        chunks.push(data.subarray(pos, pos + CHUNK_SIZE));
        pos += CHUNK_SIZE + 4;
    }
    return zlib.inflateSync(Buffer.concat(chunks), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
}
