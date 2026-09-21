/**
 * Eras: the historic-moment ledger and the dedications, both in the tail of the
 * payload (end-d-2, the first Classical-era save the automated turns produced).
 *
 * Moments: `count`, then one record per moment starting `8, MOMENT_x, turn, x, y, player,
 * index` (x,y = -9999 when the moment has no plot) followed by a variable blob (the moment's
 * loc-string arguments). 53 records on end-d-2, index 0..52, the count 8 words before the
 * first.
 *
 * Dedications: one record per player slot right after the moments, `A, 30, nChoices,
 * COMMEMORATION_x×n, 0, nActive, COMMEMORATION_x×m` — the choices offered at the era start and
 * the ones taken (Macedon RELIGIOUS, Arabia SCIENTIFIC on end-d-2, as the oracle lists them;
 * both MILITARY on the turn-126 duel); players without an era choice carry `0, 30, 0, 0, 0`.
 * `A` was 64 for player 0 and 0 for the rest, and the 30 is the same on both saves (a size,
 * not a turn). A base-game save (PYDT, no Rise and Fall) has no records.
 */

import { resolveTypeHash } from './hash-tables';

export interface Civ6Moment {
    type: string;
    turn: number;
    playerId: number;
    /** Plot of the moment, when it has one. */
    plot?: { x: number; y: number };
    index: number;
    payloadOffset: number;
}

export interface Civ6Dedications {
    playerId: number;
    choices: string[];
    active: string[];
    payloadOffset: number;
}

const NO_PLOT = -9999;

export function parseMoments(payload: Buffer): Civ6Moment[] {
    const out: Civ6Moment[] = [];
    for (let o = 4; o + 28 <= payload.length; o += 1) {
        if (payload.readInt32LE(o - 4) !== 8) continue;
        const t = resolveTypeHash(payload.readUInt32LE(o));
        if (t?.kind !== 'KIND_MOMENT') continue;
        const turn = payload.readInt32LE(o + 4), x = payload.readInt32LE(o + 8), y = payload.readInt32LE(o + 12);
        const playerId = payload.readInt32LE(o + 16), index = payload.readInt32LE(o + 20);
        if (turn < 0 || turn > 2000 || playerId < 0 || playerId > 63 || index !== out.length) continue;
        out.push({ type: t.name, turn, playerId, ...(x === NO_PLOT ? {} : { plot: { x, y } }), index, payloadOffset: o });
    }
    return out;
}

function readList(payload: Buffer, at: number): { names: string[]; end: number } | null {
    const n = payload.readInt32LE(at);
    if (n < 0 || n > 16 || at + 4 + 4 * n > payload.length) return null;
    const names: string[] = [];
    for (let k = 0; k < n; k++) {
        const t = resolveTypeHash(payload.readUInt32LE(at + 4 + 4 * k));
        if (!t || !t.name.startsWith('COMMEMORATION_')) return null;
        names.push(t.name);
    }
    return { names, end: at + 4 + 4 * n };
}

export function parseDedications(payload: Buffer, from = 0): Civ6Dedications[] {
    // The first record is found by its offered choices; the rest follow it, one per slot.
    for (let o = from; o + 16 <= payload.length; o += 1) {
        const choices = readList(payload, o + 8);
        if (!choices || choices.names.length === 0) continue;
        const out: Civ6Dedications[] = [];
        const marker = payload.readInt32LE(o + 4);
        let at = o;
        for (let playerId = 0; playerId < 64 && at + 20 <= payload.length; playerId++) {
            if (payload.readInt32LE(at + 4) !== marker) break;
            const offered = readList(payload, at + 8);
            if (!offered) break;
            const active = readList(payload, offered.end + 4);
            if (!active) break;
            out.push({ playerId, choices: offered.names, active: active.names, payloadOffset: at });
            at = active.end;
        }
        return out;
    }
    return [];
}
