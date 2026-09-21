/**
 * Diplomatic states.
 *
 * Each player object carries one diplomatic state machine per player slot, in player-id order,
 * right after its tech tables. A block is `u32 otherId, u32 len, "DIPLO_STATE_<current>"`
 * followed by a data blob, then the reachable states (`u32 len, name, u32 stateIndex, …`).
 * The current state is the one the block opens with; the reachable ones are constant per kind
 * of pair (`NEUTRAL FRIENDLY UNFRIENDLY WAR DENOUNCED DECLARED_FRIEND ALLIED` between majors,
 * `NO_INFLUENCE INFLUENTIAL MAX_INFLUENCE WAR_WITH_MINOR` from a major to a minor,
 * `AWARE PATRON PROTECTOR WAR_WITH_MAJOR` from a minor to a major, `MINOR_MINOR …` and
 * `FREE_CITIES_NEUTRAL` for the rest).
 *
 * Pinned with the lab mod's save: after `DeclareWarOn`, both belligerents' blocks for each other
 * open with `WAR` where they opened with `NEUTRAL`, and nothing else in the list moved.
 *
 * The same object holds an envoy count per player slot 1583 bytes ahead of its first state
 * name: for a city-state the envoys received from each player, for a major the envoys it has
 * placed in each city-state. The array is framed by `0x40000000, 0` before and `0x05000000,
 * 0x40000000` after the 63 slots (lab-4: Macedon's one envoy in Hong Kong and Geneva; PYDT:
 * every `PATRON` relation has a non-zero count and nobody reaches the three a suzerain needs,
 * which is why no `PROTECTOR` state occurs).
 */

import type { Civ6PlayerState } from './parse-players';

export interface Civ6DiplomacyState {
    /** Civ6 player id whose object the list sits in. */
    playerIndex: number;
    /** Current state towards every other slot, `DIPLO_STATE_` stripped: `WAR`, `ALLIED`, `PATRON`, … */
    relations: Array<{ other: number; state: string }>;
    /** Envoys per slot (non-zero only): received from that player for a city-state, placed in that city-state for a major. */
    envoys: Record<number, number>;
}

const PREFIX = Buffer.from('DIPLO_STATE_');
const MAX_PLAYERS = 64;
const ENVOYS_BEFORE_STATES = 1583;
const ENVOY_SLOTS = 63;

function envoyCounts(payload: Buffer, firstBlock: number): Record<number, number> {
    const start = firstBlock - ENVOYS_BEFORE_STATES;
    if (start < 8) return {};
    if (payload.readUInt32LE(start - 8) !== 0x40000000 || payload.readInt32LE(start - 4) !== 0) return {};
    if (payload.readUInt32LE(start + ENVOY_SLOTS * 4) !== 0x05000000) return {};
    const out: Record<number, number> = {};
    for (let i = 0; i < ENVOY_SLOTS; i++) {
        const n = payload.readInt32LE(start + i * 4);
        if (n < 0 || n > 200) return {};
        if (n > 0) out[i] = n;
    }
    return out;
}

export function parseDiplomacy(payload: Buffer, players: Civ6PlayerState[]): Civ6DiplomacyState[] {
    const out: Civ6DiplomacyState[] = [];
    for (let i = 0; i < players.length; i++) {
        const from = players[i]!.payloadOffset;
        const to = players[i + 1]?.payloadOffset ?? payload.length;
        const relations: Civ6DiplomacyState['relations'] = [];
        let expected = 0;
        let at = payload.indexOf(PREFIX, from);
        let firstBlock = -1;
        while (at >= 0 && at < to && expected < MAX_PLAYERS) {
            const len = payload.readUInt32LE(at - 4);
            const name = payload.subarray(at, at + len).toString('latin1');
            const blobHead = payload.readUInt32LE(at + len);
            // The block for `expected`: its id ahead of the name, and the state's data blob behind
            // it (`00 xx yy zz` with flags set — `00 00 01 00` neutral, `00 01 00 00` war,
            // `00 01 00 80` allied) rather than a reachable state's `index 00 00 00`.
            const isCurrent = (blobHead & 0xff) === 0 && (blobHead & 0xffffff00) !== 0;
            if (/^DIPLO_STATE_[A-Z_]+$/.test(name) && payload.readInt32LE(at - 8) === expected && isCurrent) {
                relations.push({ other: expected, state: name.slice(PREFIX.length) });
                if (firstBlock < 0) firstBlock = at;
                expected++;
            }
            at = payload.indexOf(PREFIX, at + 1);
        }
        out.push({ playerIndex: i, relations, envoys: firstBlock >= 0 ? envoyCounts(payload, firstBlock) : {} });
    }
    return out;
}
