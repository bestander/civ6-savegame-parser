import { TILE_SECTION_MARKER, TERRAIN_RESYNC_ALLOWLIST } from './constants';
import {
    resolveContinent,
    resolveFeature,
    resolveImprovement,
    resolveResource,
    resolveTerrain,
} from './hash-tables';
import type { Civ6MapSection, Civ6Tile, Civ6TileOwnership } from './types';

function readU32(buf: Buffer, offset: number): number {
    return buf.readUInt32LE(offset);
}

export function parseMapTiles(payload: Buffer): Civ6MapSection {
    const markerStart = payload.indexOf(TILE_SECTION_MARKER);
    if (markerStart < 0) {
        throw new Error('Civ6Save: tile section marker not found in payload');
    }

    const tileCount = payload.readUInt32LE(markerStart + 12);
    const widthSearch = Buffer.concat([
        Buffer.from([0, 0, 0, 0]),
        payload.subarray(markerStart + 12, markerStart + 16),
    ]);

    let width = 0;
    let searchPos = -1;
    while (width <= 0) {
        searchPos = payload.indexOf(widthSearch, searchPos + 1);
        if (searchPos < 0) throw new Error('Civ6Save: map width pattern not found');
        width = payload.readInt16LE(searchPos + 8);
    }
    if (tileCount % width !== 0) {
        throw new Error(`Civ6Save: tile count ${tileCount} not divisible by width ${width}`);
    }
    const height = tileCount / width;

    let cursor = markerStart + 16;
    const tiles: Civ6Tile[] = [];
    let resyncCount = 0;

    for (let i = 0; i < tileCount; i++) {
        const base = cursor;
        const recordStart = base;
        const terrainHash = readU32(payload, base + 12);
        const featureHash = readU32(payload, base + 16);
        const resourceHash = readU32(payload, base + 27);
        const improvementHash = readU32(payload, base + 33);
        const continentHash = readU32(payload, base + 22);
        const overlayNum = readU32(payload, base + 51);
        cursor += 55;

        const overlayLen = overlayNum === 1 ? 24 : overlayNum === 2 ? 44 : overlayNum === 3 ? 64 : 0;
        cursor += overlayLen;

        let ownership: Civ6TileOwnership | undefined;
        if (payload[base + 49] & 0x40) {
            ownership = {
                ownerId: payload[cursor + 12],
                cityIndex: payload.readUInt16LE(cursor),
                districtInstanceId: readU32(payload, cursor + 8),
                worldWonderHash: readU32(payload, cursor + 13) === 0xffffffff
                    ? null
                    : readU32(payload, cursor + 13),
            };
            cursor += 17;
        }

        if (i < tileCount - 1) {
            let offset = 0;
            while (
                offset < 1000
                && !TERRAIN_RESYNC_ALLOWLIST.has(readU32(payload, cursor + 12 + offset))
            ) {
                offset++;
            }
            if (offset >= 1000) {
                throw new Error(`Civ6Save: tile resync failed at tile ${i} (offset ${cursor})`);
            }
            if (offset > 0) resyncCount++;
            cursor = cursor - 12 + offset + 12;
        }

        tiles.push({
            payloadOffset: recordStart,
            recordLength: cursor - recordStart,
            index: i,
            x: i % width,
            y: Math.floor(i / width),
            terrainHash,
            terrain: resolveTerrain(terrainHash),
            featureHash,
            feature: resolveFeature(featureHash),
            resourceHash,
            resource: resolveResource(resourceHash),
            improvementHash,
            improvement: resolveImprovement(improvementHash),
            continentHash,
            continent: resolveContinent(continentHash),
            road: payload.readInt16LE(base + 38),
            routeIndex: payload.readInt16LE(base + 38) < 0 ? null : payload.readInt16LE(base + 38) & 0xff,
            pillaged: (payload.readUInt8(base + 48) & 1) === 1,
            riverMap: payload[base + 46],
            unitCount: payload[base + 26],
            ownership,
            overlayBytes: overlayLen,
        });
    }

    return {
        width,
        height,
        tileCount,
        tiles,
        resyncCount,
        tileSectionStart: markerStart,
        tileSectionEnd: cursor,
    };
}
