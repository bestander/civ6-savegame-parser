import { civ6Hash, hashHex, resolveInstanceType, resolveTypeHash } from './hash-tables';
import { activeEntries, detectTypedTables, type TypedTable } from './typed-tables';

/** Sentinel used on every live unit blob we have seen (not on tile records). */
const BLOB_PAD = -9999;

/**
 * Live unit instance, from the typed blob that sits after the map section.
 *
 * Layout (byte offsets from the type hash), pairwise-RE 2026-09-18, typed tables 2026-09-19:
 *   +0  type hash
 *   +4  kind (see Civ6UnitInstance.kind — not a reliable combat class)
 *   +8  -1
 *   +12 / +16  -9999
 *   +20 / +24  plot x, y
 *   +28 -1
 *   +32 owner / player index (63 observed on barbarians; tile owner 62 is a different id space)
 *   +56 byte 1 = damage taken (0–100); byte 0 varies (0x6b, 0x49, 0xd0 — an activity state, not part of HP)
 *   +68 flags (65536 = scout promo available; 131072 = warrior could still act — do not conflate)
 *   +80 builder charges × 256 (kind 1 only, farm/mine/pasture pairs)
 *   then ~5.8 KB of typed tables (`typed-tables.ts`): UNITOPERATION, ABILITY {hash,i32},
 *   TERRAIN, FEATURE, GREAT_PERSON_CLASS ×2, then XP (u16 at PROMOTION-24), level (u16 at
 *   PROMOTION-20), PROMOTION {hash,u8} ×145, YIELD, DISTRICT, IMPROVEMENT, …
 *
 * Neither the unit's id nor its remaining movement is on this blob: each player also keeps a
 * 60-byte unit list (`[…, 1, index, id, x, y, owner, mp×256, domain, …]`) in the same order as
 * the blobs, which `parseUnitInstances` walks for both.
 */
export interface Civ6UnitInstance {
    /**
     * The game's own unit id — what `unit:GetID()` returns in Lua — packed as
     * `(generation << 16) | index`, where `index` is the unit's slot in its owner's list.
     * Unique per owner, kept as the unit moves, and reused by a later unit once this one dies,
     * so `(ownerId, id)` identifies a unit within one game's lifetime.
     *
     * Verified against the oracle mod's `GetID` on oracle-8, lab-4, lab9-6 and war-a-1 (every
     * unit agrees) and across consecutive PYDT turns (ids survive movement).
     *
     * Absent when the unit's list record could not be matched — a stack the plot match could
     * not resolve.
     */
    id?: number;
    typeHash: number;
    typeHashHex: string;
    typeName: string | null;
    kind: number;
    x: number;
    y: number;
    ownerId: number;
    payloadOffset: number;
    /** Damage taken, 0–100 (byte 1 of +56). */
    damageTaken?: number;
    /** 100 - damageTaken. Max HP is not proven for later-era units. */
    hp?: number;
    /** Builder charges remaining. Only filled for kind === 1 when +80 is a 256 multiple in 0..10. */
    builderCharges?: number;
    /** Religious unit: its religion and the spread charges left — `100, RELIGION_x, charges, 0` in the blob. */
    religion?: { religion: string; spreadCharges: number };
    /** Great person: the `GREAT_PERSON_INDIVIDUAL_*` — `1, INDIVIDUAL, …` in the blob (PYDT's Great Prophet is John the Baptist). */
    greatPerson?: string;
    /** Raw +68. Do not treat as a single pending-promotion bit. */
    flags68: number;
    /** 0 single unit, 1 corps/fleet, 2 army/armada (Civ6 MilitaryFormationTypes). */
    militaryFormation: number;
    /** Turns spent fortified (byte 1 of +60; lab7-4: 2 on every idle military unit, 0 on civilians). */
    fortifyTurns: number;
    /**
     * `ACTIVITY_AWAKE | HOLD | SLEEP | HEAL | SENTRY | INTERCEPT | MISSION | OPERATION`: the CRC of the
     * activity name at +53 (lab9-6: the Builder put to sleep reads SLEEP, fortified units SENTRY,
     * units with a queued move OPERATION, an idle Trader AWAKE); null for an unknown hash.
     */
    activity: string | null;
    /** A Trader on a route: where it goes, where it left from, and when. */
    tradeRoute?: { origin: { x: number; y: number }; destination: { x: number; y: number }; startedTurn: number };
    /** Every active operation, raw: `UNITOPERATION_*` and its 13 parameter ints. */
    operations?: Array<{ type: string; params: number[] }>;
    /** Movement points left this turn (from the per-player unit list, ×256 there). */
    movesRemaining?: number;
    /** Experience points (u16 before the promotion table). */
    xp?: number;
    /** 1 + promotions taken. */
    level?: number;
    /** `PROMOTION_*` names with a set flag in the unit's promotion table. */
    promotions?: string[];
    /** `ABILITY_*` names with a non-zero count in the unit's ability table. */
    abilities?: string[];
}

/** How far after the type hash the unit's typed tables can extend. */
const UNIT_RECORD_SPAN = 6400;
/** The per-player unit list record: stride, and the sentinel pair that closes it. */
const UNIT_LIST_STRIDE = 60;


/**
 * Per-player unit list entries — the `(id, x, y, mp×256)` rows — in file order.
 */
function walkUnitListRecords(payload: Buffer, mapWidth: number, mapHeight: number): Array<{ id: number; x: number; y: number; owner: number; mp: number; offset: number }> {
    const out: Array<{ id: number; x: number; y: number; owner: number; mp: number; offset: number }> = [];
    const end = payload.length - UNIT_LIST_STRIDE;
    // Anchored on the plot: `[…, 1, index, id, x, y, owner, mp×256, domain, …]` — the leading
    // sentinels vary (the first record of a list has none).
    for (let o = 12; o < end; o++) {
        // +16 is 2 on land units and 0 on ships (a domain, presumably).
        const domain = payload.readInt32LE(o + 16);
        if (payload.readInt32LE(o - 8) !== 1 || domain < 0 || domain > 3) continue;
        const x = payload.readInt32LE(o);
        const y = payload.readInt32LE(o + 4);
        if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) continue;
        const owner = payload.readInt32LE(o + 8);
        if (owner < 0 || owner > 63) continue;
        const mp = payload.readInt32LE(o + 12);
        if (mp < 0 || mp % 256 !== 0 || mp > 32 * 256) continue;
        // The id's low half is the index stored just before it; requiring the pair drops the
        // run of coincidental hits this scan used to return (2254 → ~200 on a PYDT save).
        const id = payload.readInt32LE(o - 4);
        if (id <= 0 || (id & 0xffff) !== payload.readInt32LE(o - 12)) continue;
        out.push({ id, x, y, owner, mp: mp / 256, offset: o });
    }
    return out;
}

const ACTIVITIES = new Map(['ACTIVITY_AWAKE', 'ACTIVITY_HOLD', 'ACTIVITY_SLEEP', 'ACTIVITY_HEAL', 'ACTIVITY_SENTRY', 'ACTIVITY_INTERCEPT', 'ACTIVITY_MISSION', 'ACTIVITY_OPERATION'].map(n => [civ6Hash(n) >>> 0, n] as const));

/** One unit operation record: `hash, 2, -1, 0, turn, id, -1, 1, 0, destX, destY, originX, originY, -1`. */
const OPERATION_RECORD = 56;
const MAKE_TRADE_ROUTE = 'UNITOPERATION_MAKE_TRADE_ROUTE';

/**
 * The unit's active operations sit right before its `UNITOPERATION s5` flag table: a count,
 * then 56-byte records (route-5: the Pella Trader with `MAKE_TRADE_ROUTE` to 23,21, started on
 * turn 17; route-4, before the order, had a count of 0). A Trader on a route is the one
 * operation the parser cares about.
 */
function unitOperations(payload: Buffer, flags: TypedTable | undefined): NonNullable<Civ6UnitInstance['operations']> {
    if (!flags) return [];
    // `flags.start - 4` is the flag table's own count; the operation count is `n` records ahead.
    for (let n = 0; n <= 4; n++) {
        const countAt = flags.start - 8 - n * OPERATION_RECORD;
        if (countAt < 0 || payload.readInt32LE(countAt) !== n) continue;
        const out: NonNullable<Civ6UnitInstance['operations']> = [];
        for (let k = 0; k < n; k++) {
            const at = countAt + 4 + k * OPERATION_RECORD;
            const type = resolveTypeHash(payload.readUInt32LE(at));
            if (type?.kind !== 'KIND_UNITOPERATION') return [];
            out.push({ type: type.name, params: Array.from({ length: 13 }, (_, j) => payload.readInt32LE(at + 4 + j * 4)) });
        }
        return out;
    }
    return [];
}

function tradeRouteOperation(operations: NonNullable<Civ6UnitInstance['operations']>): Civ6UnitInstance['tradeRoute'] | undefined {
    const op = operations.find(o => o.type === MAKE_TRADE_ROUTE);
    if (!op) return undefined;
    // params: 2, -1, 0, turn, id, -1, 1, 0, destX, destY, originX, originY, -1
    return {
        startedTurn: op.params[3]!,
        destination: { x: op.params[8]!, y: op.params[9]! },
        origin: { x: op.params[10]!, y: op.params[11]! },
    };
}

export function parseUnitInstances(
    payload: Buffer,
    mapWidth: number,
    mapHeight: number,
): { units: Civ6UnitInstance[]; unmappedTypeHashes: string[] } {
    const units: Civ6UnitInstance[] = [];
    const unmapped = new Set<string>();
    const end = payload.length - 84;

    for (let i = 0; i < end; i++) {
        const kind = payload.readInt32LE(i + 4);
        // Great people carry -1 here (lab-4: a Great Prophet); the rest 1..4.
        if ((kind < 1 || kind > 4) && kind !== -1) continue;
        // +8 was -1 on every early unit and 0 on a script-spawned one (route-6's Trader); on
        // dip-a-1 seventeen of the oracle's units carry a packed reference there (0x3D0119 on a
        // Builder) — a unit that has been through an operation, presumably — so anything goes,
        // the rest of the header keeps the noise out.
        const field8 = payload.readInt32LE(i + 8);
        if (payload.readInt32LE(i + 12) !== BLOB_PAD) continue;
        if (payload.readInt32LE(i + 16) !== BLOB_PAD) continue;
        const x = payload.readInt32LE(i + 20);
        const y = payload.readInt32LE(i + 24);
        if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) continue;
        if (payload.readInt32LE(i + 28) !== -1) continue;
        const ownerId = payload.readInt32LE(i + 32);
        if (ownerId < 0 || ownerId > 63) continue;

        const typeHash = payload.readUInt32LE(i);
        const typeName = resolveInstanceType(typeHash);
        // With the kind wildcarded, only a known unit type keeps a -1 record from being noise.
        if (kind === -1 && !typeName) continue;
        if (!typeName) unmapped.add(hashHex(typeHash));

        const packedHp = payload.readUInt32LE(i + 56);
        const flags68 = payload.readUInt32LE(i + 68);
        const field72 = payload.readUInt32LE(i + 72);
        const field80 = payload.readUInt32LE(i + 80);

        const unit: Civ6UnitInstance = {
            typeHash,
            typeHashHex: hashHex(typeHash),
            typeName,
            kind,
            x,
            y,
            ownerId,
            payloadOffset: i,
            flags68,
            // Byte 1 of +44: 0 single, 1 corps, 2 army (lab-3: a Warrior corps against a Warrior);
            // -1 on great people, which cannot form up.
            militaryFormation: Math.max(0, payload.readInt8(i + 45)),
            fortifyTurns: payload.readUInt8(i + 61),
            activity: ACTIVITIES.get(payload.readUInt32LE(i + 53)) ?? null,
        };

        // Warrior kill pair: 96 damage => 4 HP. Not proven above 100 max HP.
        const damageTaken = (packedHp >>> 8) & 0xff;
        if (damageTaken <= 100) {
            unit.damageTaken = damageTaken;
            unit.hp = 100 - damageTaken;
        }

        if (kind === 1 && field80 % 256 === 0) {
            const charges = field80 / 256;
            if (charges >= 0 && charges <= 10) unit.builderCharges = charges;
        }
        void field72;

        if (kind === -1) {
            for (let o = i + 8; o + 8 <= Math.min(payload.length, i + UNIT_RECORD_SPAN); o++) {
                if (payload.readInt32LE(o - 4) !== 1) continue;
                const individual = resolveTypeHash(payload.readUInt32LE(o));
                if (individual?.kind !== 'KIND_GREAT_PERSON_INDIVIDUAL') continue;
                unit.greatPerson = individual.name;
                break;
            }
        }
        for (let o = i + 8; o + 12 <= Math.min(payload.length, i + UNIT_RECORD_SPAN); o++) {
            if (payload.readInt32LE(o - 4) !== 100) continue;
            const religion = resolveTypeHash(payload.readUInt32LE(o));
            if (religion?.kind !== 'KIND_RELIGION') continue;
            const spreadCharges = payload.readInt32LE(o + 4);
            if (spreadCharges < 0 || spreadCharges > 20 || payload.readInt32LE(o + 8) !== 0) continue;
            unit.religion = { religion: religion.name, spreadCharges };
            break;
        }

        // The typed tables of this unit: promotions/abilities by name, XP and level just ahead
        // of the promotion table. Every one of the PYDT save's 106 units reads consistently
        // (promotions == level - 1, level 2 from XP 15, as Civ6 does it).
        const tables = detectTypedTables(payload, { from: i, to: Math.min(payload.length, i + UNIT_RECORD_SPAN), minEntries: 4 });
        const promotions = tables.find(t => t.kind === 'KIND_PROMOTION');
        const abilities = tables.find(t => t.kind === 'KIND_ABILITY');
        if (promotions && promotions.start - 24 >= 0) {
            unit.xp = payload.readUInt16LE(promotions.start - 24);
            unit.level = payload.readUInt16LE(promotions.start - 20);
            unit.promotions = activeEntries(promotions).map(e => e.name);
        }
        if (abilities) unit.abilities = activeEntries(abilities).map(e => e.name);
        const operations = unitOperations(payload, tables.find(t => t.kind === 'KIND_UNITOPERATION' && t.stride === 5));
        if (operations.length > 0) unit.operations = operations;
        const route = tradeRouteOperation(operations);
        if (route) unit.tradeRoute = route;

        units.push(unit);
    }

    // Id and remaining movement: the per-player unit lists, matched by plot in file order — a
    // stack of two units on one tile lists them in the same order as their blobs.
    const listRecords = walkUnitListRecords(payload, mapWidth, mapHeight);
    const used = new Set<number>();
    for (const unit of units) {
        const record = listRecords.find((r, idx) => !used.has(idx) && r.owner === unit.ownerId && r.x === unit.x && r.y === unit.y);
        if (!record) continue;
        used.add(listRecords.indexOf(record));
        unit.id = record.id;
        unit.movesRemaining = record.mp;
    }

    return { units, unmappedTypeHashes: [...unmapped].sort() };
}
