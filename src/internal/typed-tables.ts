/**
 * Typed tables in a Civ6 save payload.
 *
 * Objects in the payload carry their per-type state as flat tables: a run of entries, each a
 * type hash (`civ6Hash`) followed by a fixed-size value — a unit's promotions are
 * {PROMOTION_x, u8 has} × 145, its abilities {ABILITY_x, i32 count}, a city's production
 * progress {UNIT_x or BUILDING_x, u32 hammers×256}, and so on. Because every hash is known, such
 * a run can be found without knowing the object's layout: consecutive known hashes of one
 * kind at one stride. This module finds them; the decoders then read the values they need.
 */

import { civ6Hash, type Civ6Type } from './hash-tables';
import civ6Types from '../data/civ6-types.json';

export interface TypedTable {
    kind: string;
    /** Offset of the first entry's hash. */
    start: number;
    /** Bytes from one entry's hash to the next: 4 (hashes only) + value width. */
    stride: number;
    /** Entries in table order; `value` is the raw bytes after the hash, `int` those as LE int. */
    entries: Array<{ name: string; offset: number; value: Buffer; int: number }>;
}

/** Strides worth trying: bare hash list, u8, u16, u32, two u32s, three u32s. */
const STRIDES = [4, 5, 6, 8, 12, 16] as const;
/** A "table" needs this many consecutive entries; fewer is coincidence in 10 MB of ints. */
const MIN_ENTRIES = 3;

let hashIndex: Map<number, Civ6Type> | null = null;
function index(): Map<number, Civ6Type> {
    if (hashIndex) return hashIndex;
    hashIndex = new Map();
    for (const [kind, names] of Object.entries(civ6Types as Record<string, string[]>)) {
        for (const name of names) hashIndex.set(civ6Hash(name), { name, kind });
    }
    return hashIndex;
}

function readInt(value: Buffer): number {
    switch (value.length) {
        case 0: return 0;
        case 1: return value.readUInt8(0);
        case 2: return value.readUInt16LE(0);
        case 3: return value.readUIntLE(0, 3);
        default: return value.readUInt32LE(0);
    }
}

/**
 * Every run of ≥ `minEntries` known hashes of one kind at one stride, in `[from, to)`. Runs are
 * reported at the longest stride that explains them (a stride-8 table is not also three
 * stride-4 tables), and never overlap.
 */
export function detectTypedTables(
    payload: Buffer,
    options: { from?: number; to?: number; kinds?: ReadonlySet<string>; minEntries?: number } = {},
): TypedTable[] {
    const idx = index();
    const from = Math.max(0, options.from ?? 0);
    const to = Math.min(payload.length, options.to ?? payload.length);
    const minEntries = options.minEntries ?? MIN_ENTRIES;
    const typeAt = (off: number): Civ6Type | undefined =>
        off + 4 <= to ? idx.get(payload.readUInt32LE(off)) : undefined;

    const tables: TypedTable[] = [];
    let off = from;
    while (off + 4 <= to) {
        const first = typeAt(off);
        if (!first || (options.kinds && !options.kinds.has(first.kind))) { off++; continue; }
        // Longest run over any stride, largest stride first so wider entries win ties.
        let best: { stride: number; count: number } | null = null;
        for (const stride of [...STRIDES].reverse()) {
            let count = 1;
            while (off + count * stride + 4 <= to) {
                const t = typeAt(off + count * stride);
                if (!t || t.kind !== first.kind) break;
                count++;
            }
            if (count >= minEntries && (!best || count > best.count)) best = { stride, count };
        }
        if (!best) { off++; continue; }
        const entries: TypedTable['entries'] = [];
        for (let i = 0; i < best.count; i++) {
            const at = off + i * best.stride;
            const value = payload.subarray(at + 4, Math.min(at + best.stride, to));
            entries.push({ name: typeAt(at)!.name, offset: at, value, int: readInt(value) });
        }
        tables.push({ kind: first.kind, start: off, stride: best.stride, entries });
        off += best.count * best.stride;
    }
    return tables;
}

/** The entries of a table whose value is non-zero — "which promotions does it have". */
export function activeEntries(table: TypedTable): Array<{ name: string; int: number }> {
    return table.entries.filter(e => e.int !== 0).map(e => ({ name: e.name, int: e.int }));
}
