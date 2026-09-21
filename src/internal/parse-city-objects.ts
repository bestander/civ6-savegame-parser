/**
 * City objects.
 *
 * Each city is a ~23 KB object that starts with its name as a length-prefixed
 * `LOC_CITY_NAME_*` string. The objects sit in their owner's block — after the player's unit
 * list, before the player's tech tables — in `cityIndex` order, which is also the order the
 * tile-ownership groups produce. Inside, anchored by content rather than offset (the name's
 * length shifts everything after it):
 *
 *  - current production: `16 1 TAG 2 TAG <kind> 0 HASH` — kind 0 unit, 1 building, 2 district
 *    (then the plot it goes on) — pairs 2 and 8 saw the hash and the kind;
 *  - production progress: `UNIT/BUILDING/DISTRICT/PROJECT s8` tables whose values are hammers
 *    ×256 (pairs 3–5; kept per item, so a switched-away item keeps its hammers);
 *  - the queue behind the current item: a `BUILDING/UNIT/DISTRICT s12` table;
 *  - buildings standing: `BUILDING s6` tables map building → plot index (65535 = none). The
 *    first such table is the *target plot of the item in production*; the ones after it are
 *    the buildings built. A plot must lie in the city's own territory to count.
 *
 * Ahead of the name, at a per-player distance (1119 bytes on the hotseat game, up to 1661 on
 * the PYDT one), the city header `id, x, y, owner, originalOwner, owner, -1, id, population`
 *. Its x,y is the centre, which beats the district heuristic on a
 * city whose lowest district instance is not the centre (Nicomedia on the turn-125 save).
 *
 * The growth block: after the name come two `YIELD s5` tables, a variable-length stretch, then
 * `UNIT s8 n144` and, at fixed distances from it, the rest of the object — the food stock ×256
 * sits 4969 bytes past that table. Housing, the growth
 * threshold and the surplus are not stored: the game computes them.
 */

import { cityRingPlots, CITY_RING_PLOTS } from './city-plot-ring';
import { resolveTypeHash } from './hash-tables';
import { detectTypedTables, type TypedTable } from './typed-tables';

export interface Civ6CityObject {
    /** `LOC_CITY_NAME_SPARTA` → `SPARTA`. */
    name: string;
    /** Civ6 player id of the owner, from the block the object sits in. */
    ownerId: number;
    /** Position among the owner's cities, in file order. */
    cityIndex: number;
    /** `UNIT_SETTLER`, `BUILDING_MONUMENT`, `DISTRICT_HOLY_SITE`, … or null when idle. */
    currentProduction: string | null;
    /** Where a district or wonder in production goes (Civ6 offset coordinates). */
    productionPlot?: { x: number; y: number };
    /** Hammers banked per item type (`UNIT_SETTLER` → 75). */
    productionProgress: Record<string, number>;
    /** Items queued behind the current one, in order. */
    productionQueue: string[];
    /** `BUILDING_*` standing in the city, with the plot index each stands on. */
    buildings: Array<{ building: string; plot: number }>;
    /** Citizens, from the city header; null when the header was not found. */
    population: number | null;
    /** The centre plot from the header (Civ6 offset coordinates), when found. */
    center?: { x: number; y: number };
    /** The city's id in its owner's list (`count<<16 | index`), from the header; governors refer to it. */
    id?: number;
    /** Food banked towards the next citizen; null when the growth block was not found. */
    food: number | null;
    /**
     * Religions in the city with followers and accumulated pressure. Two record shapes, each led by `5`: the "no religion"
     * entry `5, R, 2, 5, -1, followers, pressure×256` (R is the first religion present; it is
     * what the earlier reading took for that religion's pressure — Pella's 550 on lab9-6 was
     * the unconverted citizens' pressure), and per religion `5, R, followers, pressure×256,
     * -255|-256, -1, 255`. The majority religion has a third record, `0, hash, 10, …`.
     */
    religions: Array<{ religion: string | null; followers: number; pressure: number | null }>;
    majorityReligion: string | null;
    /** Civ6 player id the city was founded by, when the header was found. */
    originalOwnerId: number | null;
    /**
     * Citizens per workable plot: two `37, u32×37` arrays follow the name (after a
     * short variable stretch); the first counts the workers on each plot in `cityRingPlots`
     * order (the centre always 1, a district plot above 0 = specialists), the second was all
     * zero on every city seen (locked plots, presumably). Null when the arrays were not found.
     */
    workers: number[] | null;
    /** The worked plots (Civ6 offset coordinates) from `workers`; empty when not found. */
    workedPlots: Array<{ x: number; y: number; workers: number }>;
    /**
     * Loyalty: `14, loyalty×256, perTurn×256, 0, 1, 3, -1, …, LOYALTY_LEVEL_n` late
     * in the object, found by the level hash (Sanaa, founded four tiles from Pella on loy-c:
     * 54 and −23 as the oracle says; the turn-126 duel's captured Buenos Aires 98.36/−1.64).
     * The record is `14, loyalty, perTurn, 0, …, INT_MIN, …, level` (the level is -1 on a
     * city without one — LPQY on the duel, 100 and +0).
     */
    loyalty: { loyalty: number; perTurn: number; level: string | null } | null;
    /** Payload offset of the name string. */
    payloadOffset: number;
    /** Payload offset of the city header (the id field), when found. */
    headerOffset?: number;
}

const PRODUCTION_KINDS = new Set(['KIND_UNIT', 'KIND_BUILDING', 'KIND_DISTRICT', 'KIND_PROJECT']);
const NAME_PREFIX = Buffer.from('LOC_CITY_NAME_');
/** How far a city object can extend after its name. */
const CITY_OBJECT_SPAN = 23500;
const NO_PLOT = 65535;
/** The food stock sits this far past the city's `UNIT s8 n144` table (4969 on every save seen). */
const FOOD_AFTER_UNITS = 4969;
/** How far ahead of the name the city header is looked for. */
const HEADER_SCAN = 8192;
const INT_MIN = -2147483648;

/**
 * `id, x, y, owner, originalOwner, owner, -1, id, population` for the given owner and index. The
 * id's low half is the city's index among the owner's cities; the high half counts the cities the
 * owner has ever held, so it is index+1 until a city is lost or taken (the turn-125 save:
 * Byzantium's captured Buenos Aires is 4/1, Trebizond 6/3).
 */
function findCityHeader(payload: Buffer, nameOffset: number, ownerId: number, cityIndex: number): number | null {
    for (let b = nameOffset - 36; b >= Math.max(0, nameOffset - HEADER_SCAN); b--) {
        const id = payload.readInt32LE(b);
        // The low half is the city's slot in the owner's list — its position in file order only
        // while no city was ever lost (late-1: Nag Mapu is the third city in the file with slot 4).
        const slot = id & 0xffff;
        if (slot < cityIndex || slot > 0xff || (id >>> 16) <= slot || (id >>> 16) > 0xff) continue;
        if (payload.readInt32LE(b + 28) !== id) continue;
        if (payload.readInt32LE(b + 24) !== -1 || payload.readInt32LE(b + 12) !== ownerId) continue;
        return b;
    }
    return null;
}

/** The `37, u32×37, 37, u32×37` citizen arrays within a short stretch after the name. */
function findWorkers(payload: Buffer, nameOffset: number, nameLength: number): number[] | null {
    const span = 4 + 4 * CITY_RING_PLOTS;
    for (let o = nameOffset + nameLength; o + 2 * span <= payload.length && o < nameOffset + nameLength + 256; o++) {
        if (payload.readUInt32LE(o) !== CITY_RING_PLOTS || payload.readUInt32LE(o + span) !== CITY_RING_PLOTS) continue;
        const counts: number[] = [];
        for (let k = 0; k < CITY_RING_PLOTS; k++) counts.push(payload.readUInt32LE(o + 4 + 4 * k));
        if (counts.some(c => c > 8)) continue;
        return counts;
    }
    return null;
}

function readName(payload: Buffer, at: number): string | null {
    const len = payload.readUInt32LE(at - 4);
    if (len < NAME_PREFIX.length + 1 || len > 64) return null;
    const s = payload.subarray(at, at + len).toString('ascii');
    return /^LOC_CITY_NAME_[A-Z0-9_]+$/.test(s) ? s.slice(NAME_PREFIX.length) : null;
}

export function parseCityObjects(
    payload: Buffer,
    options: {
        /** Tech-table offsets per player, ascending — each player's cities precede its own. */
        playerOffsets: number[];
        /** The player id each of `playerOffsets` belongs to; identity when omitted. */
        playerIds?: number[];
        /** Whether `plot` is inside the given owner's territory (for the buildings filter). */
        plotOwnedBy?: (plot: number, ownerId: number, cityIndex: number) => boolean;
        tables?: TypedTable[];
        /** Needed to turn a plot index into coordinates (the wonder in production). */
        mapWidth?: number;
    },
): Civ6CityObject[] {
    const cities: Civ6CityObject[] = [];
    const perOwner = new Map<number, number>();
    let searchFrom = 0;
    for (;;) {
        const at = payload.indexOf(NAME_PREFIX, searchFrom);
        if (at < 0) break;
        searchFrom = at + 1;
        if (at < 4) continue;
        const name = readName(payload, at);
        if (!name) continue;
        // The owner: the first player whose tech tables come after this object.
        const ownerIndex = options.playerOffsets.findIndex(o => o > at);
        if (ownerIndex < 0) continue;
        const ownerId = options.playerIds?.[ownerIndex] ?? ownerIndex;
        const cityIndex = perOwner.get(ownerId) ?? 0;
        perOwner.set(ownerId, cityIndex + 1);

        const nameOffset = at - 4;
        const end = Math.min(payload.length, at + CITY_OBJECT_SPAN);
        const tables = (options.tables ?? detectTypedTables(payload, { from: at, to: end, minEntries: 2 }))
            .filter(t => t.start >= at && t.start < end);

        // The item in production: `16 1 TAG 2 TAG <0 unit | 1 building | 2 district> 0 HASH`,
        // a district followed by the plot it goes on.
        let currentProduction: string | null = null;
        let productionPlot: { x: number; y: number } | undefined;
        for (let o = at + 32; o + 12 <= end; o++) {
            const type = resolveTypeHash(payload.readUInt32LE(o));
            if (!type || !PRODUCTION_KINDS.has(type.kind)) continue;
            if (payload.readInt32LE(o - 16) !== 2 || payload.readInt32LE(o - 12) !== payload.readInt32LE(o - 20)) continue;
            const itemKind = payload.readInt32LE(o - 8);
            if (itemKind < 0 || itemKind > 3 || payload.readInt32LE(o - 4) !== 0) continue;
            currentProduction = type.name;
            if (itemKind === 2) productionPlot = { x: payload.readInt32LE(o + 8), y: payload.readInt32LE(o + 12) };
            break;
        }

        // Hammers banked per item, ×256. The object also carries AI weight tables of the same
        // shape where nearly every entry is set; the progress table is sparse.
        const productionProgress: Record<string, number> = {};
        for (const t of tables) {
            if (t.stride !== 8 || !PRODUCTION_KINDS.has(t.kind)) continue;
            const set = t.entries.filter(e => e.int !== 0);
            if (set.length === 0 || set.length > t.entries.length / 4) continue;
            for (const e of set) {
                // Below one hammer it is an AI weight (whole rows of 128), not progress.
                if (e.int >= 256 && e.int < 100_000 * 256) productionProgress[e.name] = e.int / 256;
            }
        }

        const queueTable = tables.find(t => t.stride === 12 && PRODUCTION_KINDS.has(t.kind));
        const productionQueue = queueTable ? queueTable.entries.map(e => e.name) : [];

        const buildingPlotTables = tables.filter(t => t.kind === 'KIND_BUILDING' && t.stride === 6);
        // A wonder in production has its plot in the first table (lab-4: the Pyramids, 40% along).
        if (!productionPlot && currentProduction && options.mapWidth) {
            const target = buildingPlotTables[0]?.entries.find(e => e.name === currentProduction);
            if (target && target.int !== NO_PLOT) productionPlot = { x: target.int % options.mapWidth, y: Math.floor(target.int / options.mapWidth) };
        }
        // The tiles are keyed by the city's slot in its owner's list (the header id's low half),
        // which is its file position only while the owner never lost a city.
        const header0 = findCityHeader(payload, nameOffset, ownerId, cityIndex);
        const slot = header0 === null ? cityIndex : payload.readInt32LE(header0) & 0xffff;
        const buildings: Array<{ building: string; plot: number }> = [];
        for (const t of buildingPlotTables.slice(1)) {
            for (const e of t.entries) {
                if (e.int === NO_PLOT || e.int === 0) continue;
                if (options.plotOwnedBy && !options.plotOwnedBy(e.int, ownerId, slot)) continue;
                if (!buildings.some(b => b.building === e.name)) buildings.push({ building: e.name, plot: e.int });
            }
        }

        const header = header0;
        const religions: Civ6CityObject['religions'] = [];
        let majorityReligion: string | null = null;
        for (let o = at; o + 28 <= end; o++) {
            const religion = resolveTypeHash(payload.readUInt32LE(o));
            if (religion?.kind !== 'KIND_RELIGION') continue;
            if (payload.readInt32LE(o - 4) !== 5) {
                if (payload.readInt32LE(o - 4) === 0 && payload.readInt32LE(o + 4) === 10) majorityReligion = religion.name;
                continue;
            }
            if (payload.readInt32LE(o + 4) === 2 && payload.readInt32LE(o + 8) === 5 && payload.readInt32LE(o + 12) === -1) {
                // The "no religion" entry rides in front of the first religion's record.
                if (!religions.some(r => r.religion === null)) religions.push({ religion: null, followers: payload.readInt32LE(o + 16), pressure: payload.readInt32LE(o + 20) / 256 });
            } else if (payload.readInt32LE(o + 12) === -255 || payload.readInt32LE(o + 12) === -256) {
                if (!religions.some(r => r.religion === religion.name)) religions.push({ religion: religion.name, followers: payload.readInt32LE(o + 4), pressure: payload.readInt32LE(o + 8) / 256 });
            }
        }
        const workers = findWorkers(payload, at, payload.readUInt32LE(at - 4));
        const center = header === null ? null : { x: payload.readInt32LE(header + 4), y: payload.readInt32LE(header + 8) };
        const workedPlots = workers && center
            ? cityRingPlots(center.x, center.y).map((plot, k) => ({ ...plot, workers: workers[k]! })).filter(w => w.workers > 0)
            : [];
        let loyalty: Civ6CityObject['loyalty'] = null;
        for (let o = at; o + 64 <= end; o++) {
            if (payload.readInt32LE(o) !== 14 || payload.readInt32LE(o + 12) !== 0 || payload.readInt32LE(o + 44) !== INT_MIN) continue;
            const value = payload.readInt32LE(o + 4);
            if (value < 0 || value > 100 * 256) continue;
            const level = resolveTypeHash(payload.readUInt32LE(o + 60));
            if (level?.kind !== 'KIND_LOYALTY_LEVEL' && payload.readInt32LE(o + 60) !== -1) continue;
            loyalty = { loyalty: value / 256, perTurn: payload.readInt32LE(o + 8) / 256, level: level?.kind === 'KIND_LOYALTY_LEVEL' ? level.name : null };
            break;
        }
        // Without a stored "no religion" entry the game derives it: the rest of the citizens and a
        // pressure that is not simply 50 a head (Chalkidiki 1/50, Jeddah 5/250 but Cairo 9/500 on
        // loy-c-2), so only the followers are filled in.

        if (!religions.some(r => r.religion === null) && header0 !== null) {
            const population = payload.readInt32LE(header0 + 32);
            religions.unshift({ religion: null, followers: population - religions.reduce((n, r) => n + r.followers, 0), pressure: null });
        }
        const unitsTable = tables.find(t => t.kind === 'KIND_UNIT' && t.stride === 8 && t.entries.length > 100);
        const food = unitsTable ? payload.readInt32LE(unitsTable.start + FOOD_AFTER_UNITS) / 256 : null;
        cities.push({
            name, ownerId, cityIndex, currentProduction, ...(productionPlot ? { productionPlot } : {}),
            productionProgress, productionQueue, buildings,
            population: header === null ? null : payload.readInt32LE(header + 32),
            ...(header === null ? {} : { center: { x: payload.readInt32LE(header + 4), y: payload.readInt32LE(header + 8) }, id: payload.readInt32LE(header) }),
            food, workers, workedPlots, loyalty,
            religions, majorityReligion,
            originalOwnerId: header === null ? null : payload.readInt32LE(header + 16),
            payloadOffset: nameOffset,
            ...(header === null ? {} : { headerOffset: header }),
        });
    }
    return cities;
}
