/**
 * Governors.
 *
 * A player's appointed governors sit in its region after the units: each `GOVERNOR_*` hash
 * followed by the `LOC_GOVERNOR_*_NAME` string, then a `GOVERNOR_PROMOTION s5 n48` flag table
 * with the promotions earned (PYDT: Greece's Magnus with Groundbreaker and Expedition, Zulu's
 * Moksha with Bishop, Australia's Pingala with Librarian and Connoisseur). The game's own
 * definition cache further on lists every governor and promotion with constant values and is
 * skipped by requiring the name string. Right after the name: `ownerRef, cityId, …` — the low
 * half of `ownerRef` is the assigned city's owner and `cityId` its id in that owner's list
 * (lab8-5: Titus in Cairo `65536`, Moksha unassigned `-1`; PYDT: Moksha in Nobamba `131073`,
 * Pingala in Canberra; the turn-125 Ambassador in Babylon, a city-state's city). The int after
 * those is 1 for some players and 0 for others (not the establishment state) and is left alone.
 */

import { resolveTypeHash } from './hash-tables';
import type { Civ6PlayerState } from './parse-players';
import { activeEntries, type TypedTable } from './typed-tables';

export interface Civ6Governor {
    playerIndex: number;
    /** `GOVERNOR_THE_RESOURCE_MANAGER`, … */
    governor: string;
    /** `GOVERNOR_PROMOTION_*` earned, the governor's base title excluded. */
    promotions: string[];
    /** Civ6 player id owning the assigned city (a city-state for the Ambassador), or null when unassigned. */
    cityOwnerId: number | null;
    /** Id of the assigned city in that owner's list (the city header's id), or null when unassigned. */
    cityId: number | null;
    payloadOffset: number;
}

const NAME_PREFIX = Buffer.from('LOC_GOVERNOR_');

export function parseGovernors(payload: Buffer, players: Civ6PlayerState[], tables: TypedTable[]): Civ6Governor[] {
    const out: Civ6Governor[] = [];
    let at = payload.indexOf(NAME_PREFIX);
    while (at >= 0) {
        const len = payload.readUInt32LE(at - 4);
        const name = payload.subarray(at, at + len).toString('latin1');
        const type = resolveTypeHash(payload.readUInt32LE(at - 8));
        if (len < 64 && /^LOC_GOVERNOR_[A-Z_]+_NAME$/.test(name) && type?.kind === 'KIND_GOVERNOR' && name === `LOC_${type.name}_NAME`) {
            const playerIndex = players.findIndex((pl, i) => pl.payloadOffset < at && (players[i + 1]?.payloadOffset ?? payload.length) > at);
            const flags = tables.find(t => t.kind === 'KIND_GOVERNOR_PROMOTION' && t.stride === 5 && t.start > at && t.start < at + 2048);
            const after = at + len;
            const cityId = payload.readInt32LE(after + 4);
            out.push({
                playerIndex,
                governor: type.name,
                promotions: flags ? activeEntries(flags).map(e => e.name) : [],
                cityOwnerId: cityId === -1 ? null : payload.readInt32LE(after) & 0xffff,
                cityId: cityId === -1 ? null : cityId,
                payloadOffset: at - 8,
            });
        }
        at = payload.indexOf(NAME_PREFIX, at + 1);
    }
    return out;
}
