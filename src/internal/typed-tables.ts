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
    /** Number of entries in the table. */
    count: number;
    /** Name id for each entry (Uint16Array index is entry position, value is nameId). */
    nameIds: Uint16Array;
}

/** Strides worth trying: bare hash list, u8, u16, u32, two u32s, three u32s. */
const STRIDES = [4, 5, 6, 8, 12, 16] as const;
/** Strides in reverse order (largest first). */
const STRIDES_REVERSED = [...STRIDES].reverse();
/** A "table" needs this many consecutive entries; fewer is coincidence in 10 MB of ints. */
const MIN_ENTRIES = 3;

let hashIndex: Map<number, Civ6Type> | null = null;
let nameIdMap: Map<string, number> | null = null;
let idToName: string[] | null = null;

function index(): Map<number, Civ6Type> {
    if (hashIndex) return hashIndex;
    hashIndex = new Map();
    nameIdMap = new Map();
    idToName = [];
    for (const [kind, names] of Object.entries(civ6Types as Record<string, string[]>)) {
        for (const name of names) {
            hashIndex.set(civ6Hash(name), { name, kind });
            if (!nameIdMap.has(name)) {
                const id = idToName.length;
                nameIdMap.set(name, id);
                idToName.push(name);
            }
        }
    }
    return hashIndex;
}

function getNameId(name: string): number {
    if (!nameIdMap) index();
    return nameIdMap!.get(name) ?? 0;
}

function getNameFromId(id: number): string {
    if (!idToName) index();
    return idToName![id] ?? '';
}

function readInt(payload: Buffer, start: number, length: number): number {
    if (length === 0) return 0;
    if (start + length > payload.length) length = payload.length - start;
    switch (length) {
        case 1: return payload.readUInt8(start);
        case 2: return payload.readUInt16LE(start);
        case 3: return payload.readUIntLE(start, 3);
        default: return payload.readUInt32LE(start);
    }
}

/** Read the value at entry index i from a table in the payload. */
export function tableInt(payload: Buffer, table: TypedTable, i: number): number {
    if (i < 0 || i >= table.count) return 0;
    const at = table.start + i * table.stride;
    return readInt(payload, at + 4, table.stride - 4);
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
        for (const stride of STRIDES_REVERSED) {
            let count = 1;
            while (off + count * stride + 4 <= to) {
                const t = typeAt(off + count * stride);
                if (!t || t.kind !== first.kind) break;
                count++;
            }
            if (count >= minEntries && (!best || count > best.count)) best = { stride, count };
        }
        if (!best) { off++; continue; }
        const nameIds = new Uint16Array(best.count);
        for (let i = 0; i < best.count; i++) {
            const at = off + i * best.stride;
            const name = typeAt(at)!.name;
            nameIds[i] = getNameId(name);
        }
        tables.push({ kind: first.kind, start: off, stride: best.stride, count: best.count, nameIds });
        off += best.count * best.stride;
    }
    return tables;
}

/** The entries of a table whose value is non-zero — "which promotions does it have". */
export function activeEntries(payload: Buffer, table: TypedTable): Array<{ name: string; int: number }> {
    const result: Array<{ name: string; int: number }> = [];
    for (let i = 0; i < table.count; i++) {
        const int = tableInt(payload, table, i);
        if (int !== 0) {
            const nameId = table.nameIds[i];
            const name = getNameFromId(nameId);
            result.push({ name, int });
        }
    }
    return result;
}

/** All entries in a table, including zeros. */
export function allEntries(payload: Buffer, table: TypedTable): Array<{ name: string; int: number }> {
    const result: Array<{ name: string; int: number }> = [];
    for (let i = 0; i < table.count; i++) {
        const int = tableInt(payload, table, i);
        const nameId = table.nameIds[i];
        const name = getNameFromId(nameId);
        result.push({ name, int });
    }
    return result;
}

/** Get a single entry by index. */
export function getTableEntry(payload: Buffer, table: TypedTable, i: number): { name: string; int: number } | undefined {
    if (i < 0 || i >= table.count) return undefined;
    const int = tableInt(payload, table, i);
    const nameId = table.nameIds[i];
    const name = getNameFromId(nameId);
    return { name, int };
}
