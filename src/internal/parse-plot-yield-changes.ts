/**
 * Per-plot yield changes — what a flood or an eruption left on a tile (Gathering Storm).
 *
 * Layout, found on a live game (the Civa Oracle's `Plot:GetYield` against the plot records):
 *
 *   u32 plotCount                         the map's tile count
 *   i32 entry[plotCount]                  per plot: an index into the list below, or -1
 *   u32 entryCount
 *   entryCount × { u32 n; n × { u32 yieldHash; i32 amount } }   n is 6: food … faith
 *
 * The amounts are the tile's *extra* yield on top of terrain, feature, resource and improvement.
 * Two Volcanic Soil hexes side by side can differ — the soil itself pays +1 Production and each
 * eruption rolls the rest (one hex +1 Food, its neighbour +1 Culture) — and floodplains carry the
 * silt a flood left the same way. None of it is in the plot record.
 *
 * The table is found by shape, not by a fixed offset: the plot count, then exactly that many
 * entries each -1 or a valid index, then records whose first yield hash is `YIELD_FOOD`.
 */

import { civ6Hash } from './hash-tables';

const YIELD_NAMES = ['YIELD_FOOD', 'YIELD_PRODUCTION', 'YIELD_GOLD', 'YIELD_SCIENCE', 'YIELD_CULTURE', 'YIELD_FAITH'] as const;
const YIELD_BY_HASH = new Map<number, string>(YIELD_NAMES.map(n => [civ6Hash(n), n]));
const FOOD_HASH = civ6Hash('YIELD_FOOD');

export type Civ6YieldChanges = Record<string, number>;

/** Plot index → the yields a disaster added to it. Plots with nothing extra are absent. */
export function parsePlotYieldChanges(payload: Buffer, plotCount: number): Map<number, Civ6YieldChanges> {
    const out = new Map<number, Civ6YieldChanges>();
    const tableBytes = 4 + plotCount * 4;
    for (let at = 0; at + tableBytes + 4 <= payload.length; at++) {
        if (payload.readUInt32LE(at) !== plotCount) continue;
        const entryCountAt = at + tableBytes;
        const entryCount = payload.readUInt32LE(entryCountAt);
        if (entryCount > plotCount) continue;
        // Cheap test first: the first record (if any) must open with `6, YIELD_FOOD`.
        const recordsAt = entryCountAt + 4;
        if (entryCount > 0) {
            if (recordsAt + 8 > payload.length) continue;
            if (payload.readUInt32LE(recordsAt) !== YIELD_NAMES.length) continue;
            if (payload.readUInt32LE(recordsAt + 4) !== FOOD_HASH) continue;
        }
        const index: number[] = [];
        let ok = true;
        for (let i = 0; i < plotCount; i++) {
            const v = payload.readInt32LE(at + 4 + i * 4);
            if (v < -1 || v >= Math.max(entryCount, 1)) { ok = false; break; }
            index.push(v);
        }
        if (!ok) continue;
        if (entryCount === 0) return out;
        const entries: Civ6YieldChanges[] = [];
        let cursor = recordsAt;
        for (let e = 0; e < entryCount; e++) {
            const n = payload.readUInt32LE(cursor);
            if (n === 0 || n > 16) { ok = false; break; }
            const changes: Civ6YieldChanges = {};
            for (let k = 0; k < n; k++) {
                const name = YIELD_BY_HASH.get(payload.readUInt32LE(cursor + 4 + k * 8));
                if (!name) { ok = false; break; }
                const amount = payload.readInt32LE(cursor + 8 + k * 8);
                if (amount !== 0) changes[name] = amount;
            }
            if (!ok) break;
            entries.push(changes);
            cursor += 4 + n * 8;
        }
        if (!ok) continue;
        index.forEach((entry, plot) => {
            if (entry < 0) return;
            const changes = entries[entry];
            if (changes && Object.keys(changes).length > 0) out.set(plot, changes);
        });
        return out;
    }
    return out;
}
