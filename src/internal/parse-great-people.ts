/**
 * Great people.
 *
 * Two places. Per player, right after its unit records, the first two `GREAT_PERSON_CLASS s8
 * n10` tables are the points banked per class and the points earned per turn, ×256 (PYDT: Zulu
 * 24 Prophet points at 1/turn, Australia 1 at 1/turn, Greece 0 at 1/turn the turn it recruited
 * John the Baptist). Every unit record carries two more such tables, all zero, and the next
 * player's pre-tech block a few more, which is why the pair is the first past the unit list.
 *
 * Game-wide, near the end of the payload, the recruitment ledger: per class, the individuals
 * that have been on offer, each `individual, class, era, cost, recruitedBy, turn` (-1, -1 while
 * unclaimed). Recruits per player fall out of it.
 */

import { resolveTypeHash } from './hash-tables';
import type { Civ6PlayerState } from './parse-players';
import type { TypedTable } from './typed-tables';

export interface Civ6GreatPersonOffer {
    /** `GREAT_PERSON_INDIVIDUAL_*`. */
    individual: string;
    /** `GREAT_PERSON_CLASS_*`. */
    class: string;
    /** `ERA_*`. */
    era: string;
    /** Points needed. */
    cost: number;
    /** Civ6 player id that recruited them, or null while on offer. */
    recruitedBy: number | null;
    recruitedTurn: number | null;
}

export interface Civ6GreatPeople {
    /** Per Civ6 player id: `GREAT_PERSON_CLASS_*` → points banked and earned per turn. */
    byPlayer: Array<{ playerIndex: number; points: Record<string, { banked: number; perTurn: number }> }>;
    /** The ledger: everyone on offer or recruited so far, in ledger order. */
    ledger: Civ6GreatPersonOffer[];
}

const CLASS_ENTRIES = 10;

/** A unit record is at most this long; the player's own tables start past the last one. */
const UNIT_SPAN = 6400;

export function parseGreatPeople(
    payload: Buffer,
    players: Civ6PlayerState[],
    tables: TypedTable[],
    /** Payload offset of each unit record with its owner, to step past the unit lists. */
    units: ReadonlyArray<{ ownerId: number; payloadOffset: number }>,
): Civ6GreatPeople {
    const byPlayer: Civ6GreatPeople['byPlayer'] = [];
    for (let i = 0; i < players.length; i++) {
        const from = players[i]!.payloadOffset;
        const to = players[i + 1]?.payloadOffset ?? payload.length;
        const lastUnit = Math.max(from, ...units.filter(u => u.ownerId === i && u.payloadOffset > from && u.payloadOffset < to).map(u => u.payloadOffset + UNIT_SPAN));
        const mine = tables.filter(t => t.kind === 'KIND_GREAT_PERSON_CLASS' && t.stride === 8 && t.entries.length === CLASS_ENTRIES && t.start > lastUnit && t.start < to);
        const [banked, perTurn] = mine;
        const points: Record<string, { banked: number; perTurn: number }> = {};
        if (banked && perTurn) {
            for (let k = 0; k < CLASS_ENTRIES; k++) {
                const b = banked.entries[k]!, r = perTurn.entries[k]!;
                if (b.int !== 0 || r.int !== 0) points[b.name] = { banked: b.int / 256, perTurn: r.int / 256 };
            }
        }
        byPlayer.push({ playerIndex: i, points });
    }

    const ledger: Civ6GreatPersonOffer[] = [];
    const lastTech = players[players.length - 1]?.payloadOffset ?? 0;
    for (let o = lastTech; o + 24 <= payload.length; o++) {
        const individual = resolveTypeHash(payload.readUInt32LE(o));
        if (individual?.kind !== 'KIND_GREAT_PERSON_INDIVIDUAL') continue;
        const cls = resolveTypeHash(payload.readUInt32LE(o + 4));
        const era = resolveTypeHash(payload.readUInt32LE(o + 8));
        if (cls?.kind !== 'KIND_GREAT_PERSON_CLASS' || era?.kind !== 'KIND_ERA') continue;
        const by = payload.readInt32LE(o + 16);
        const turn = payload.readInt32LE(o + 20);
        ledger.push({
            individual: individual.name, class: cls.name, era: era.name, cost: payload.readInt32LE(o + 12),
            recruitedBy: by >= 0 ? by : null, recruitedTurn: turn >= 0 ? turn : null,
        });
        o += 23;
    }
    return { byPlayer, ledger };
}
