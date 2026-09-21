/**
 * Alliances and deals (Rise & Fall / Gathering Storm; friend-1…13 captures, turns 243–246).
 *
 * Alliances: a matrix of the 2016 unordered player pairs in the tail, `2016, (ALLIANCE_x | -1,
 * startTurn | -1)×2016`, in the same reverse j-major order as the grievance matrix
 * (`2015 − (j(j−1)/2 + (j−1−i))` for i<j). friend-13: Mapuche–Zulu `ALLIANCE_CULTURAL` from
 * turn 246 (the deal accepted that turn), Mapuche–Aztec `ALLIANCE_RESEARCH` from 222 (a scripted
 * alliance, which the game files as research — the oracle's type 0 with 6 turns left on 246,
 * i.e. 30-turn alliances). Level and points are not here (the oracle: level 1, 6 points a turn).
 *
 * Deals: agreement items `DEAL_ITEM_AGREEMENTS, 5, n, 0, 0, DIPLOACTION_x, turn, duration, from,
 * to` — open borders 2↔3 from 244 and 2↔0 from 245 for 30 turns, one item per direction; a
 * pending proposal carries turn -1 (the alliance offer on friend-12).
 */

import { resolveTypeHash } from './hash-tables';

const PAIRS = 2016;

export interface Civ6Alliance { a: number; b: number; type: string; startTurn: number; payloadOffset: number }
export interface Civ6DealItem { action: string; turn: number; duration: number; from: number; to: number; payloadOffset: number }

function pairOf(index: number): [number, number] {
    const f = PAIRS - 1 - index;
    let j = 1;
    while ((j + 1) * j / 2 <= f) j++;
    return [j - 1 - (f - j * (j - 1) / 2), j];
}

export function parseAlliances(payload: Buffer, from = 0): Civ6Alliance[] | null {
    for (let o = from; o + 4 + 8 * PAIRS <= payload.length; o++) {
        // The marker: `2016` right after a byte-shifted `-1, 1` (bytes ff ff ff 01).
        if (payload.readInt32LE(o) !== PAIRS || payload.readUInt32LE(o - 4) !== 0x01ffffff) continue;
        const out: Civ6Alliance[] = [];
        let ok = true;
        for (let k = 0; k < PAIRS; k++) {
            const at = o + 4 + 8 * k;
            const type = payload.readInt32LE(at), turn = payload.readInt32LE(at + 4);
            if (type === -1 && turn === -1) continue;
            const t = resolveTypeHash(type >>> 0);
            if (t?.kind !== 'KIND_DIPLOMACY_ALLIANCE' || turn < 0 || turn > 5000) { ok = false; break; }
            const [a, b] = pairOf(k);
            out.push({ a, b, type: t.name, startTurn: turn, payloadOffset: at });
        }
        if (ok) return out;
    }
    return null;
}

export function parseDealItems(payload: Buffer, from = 0): Civ6DealItem[] {
    const out: Civ6DealItem[] = [];
    for (let o = from; o + 40 <= payload.length; o++) {
        const item = resolveTypeHash(payload.readUInt32LE(o));
        if (item?.name !== 'DEAL_ITEM_AGREEMENTS' || payload.readInt32LE(o + 4) !== 5) continue;
        const action = resolveTypeHash(payload.readUInt32LE(o + 20));
        if (action?.kind !== 'KIND_DIPLOMATIC_ACTION') continue;
        const turn = payload.readInt32LE(o + 24), duration = payload.readInt32LE(o + 28), fromId = payload.readInt32LE(o + 32), to = payload.readInt32LE(o + 36);
        if (turn < -1 || turn > 5000 || fromId < 0 || fromId > 63 || to < 0 || to > 63) continue;
        out.push({ action: action.name, turn, duration, from: fromId, to, payloadOffset: o });
    }
    return out;
}
