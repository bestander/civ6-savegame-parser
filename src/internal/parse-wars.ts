/**
 * The war list.
 *
 * After the last player object, past a run of -1s, the game keeps its wars as 16-byte records
 * `WAR_* type hash, turn, -1, -1`, followed by `2016` and one `(63, 1)` entry per living player
 * (everyone's standing war with the barbarians). Pinned with two clean captures (war-a-1: two
 * formal wars → two records; war-b-1: a third declared → a third record). The turn is the war's
 * latest event, not its declaration (17 → 18 on lab7-4 → lab9-6), and the order is neither
 * declaration order nor by turn (lab7-4: 16, 17, 17, 15). No record names its participants and
 * the relationship blobs carry no index, so the pairs are not recoverable from here: the
 * diplomatic states say who is at war with whom, this list says what kinds of wars exist.
 */

import { resolveTypeHash } from './hash-tables';
import type { Civ6PlayerState } from './parse-players';

export interface Civ6War {
    /** `WAR_FORMAL_WAR`, `WAR_SURPRISE_WAR`, … as the type dictionary names it. */
    type: string;
    /** Turn of the war's latest event. */
    turn: number;
    payloadOffset: number;
}

export function parseWars(payload: Buffer, players: Civ6PlayerState[]): Civ6War[] {
    const tail = players[players.length - 1]?.payloadOffset ?? 0;
    const wars: Civ6War[] = [];
    for (let o = tail; o + 8 <= payload.length; o++) {
        const t = resolveTypeHash(payload.readUInt32LE(o));
        if (t?.kind !== 'KIND_WAR') continue;
        const turn = payload.readInt32LE(o + 4);
        if (turn < 2 || turn > 10_000) continue;
        if (wars.length > 0 && o - wars[wars.length - 1]!.payloadOffset > 4096) break;
        wars.push({ type: t.name, turn, payloadOffset: o });
    }
    return wars;
}
