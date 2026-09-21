/**
 * Grievances (Gathering Storm). In the tail: a matrix of the 2016 unordered player
 * pairs, `1, -1, 2016, (total, lastTurn)×2016`, in reverse j-major order — index
 * `2015 − (j(j−1)/2 + (j−1−i))` for the pair i<j — and right after it the grievance log,
 * `count, (16, holder, against, amount, turn, len, LOC_DIPLO_GRIEVANCE_LOG_x, len, arg)×count`.
 * dip-a-1: Macedon's war on Arabia (turn 15, 100) and on Samarkand (three city-state entries,
 * 300) are the two non-zero pairs, exactly the oracle's ±100 and ±300; war-b-1 shows the pair
 * total is both directions summed (1 holds 100 against 0 and 0 holds 50 against 1 → 150).
 * A second, identical matrix framed `0, 2016` sits 32 KB earlier (not read). Saves without
 * the expansion carry neither.
 */

const PAIRS = 2016;
const REASON_PREFIX = 'LOC_DIPLO_GRIEVANCE_LOG_';

export interface Civ6GrievancePair { a: number; b: number; total: number; turn: number }
export interface Civ6GrievanceEntry { holder: number; against: number; amount: number; turn: number; reason: string; arg: string | null; payloadOffset: number }
export interface Civ6Grievances { pairs: Civ6GrievancePair[]; log: Civ6GrievanceEntry[] }

function pairOf(index: number): [number, number] {
    const f = PAIRS - 1 - index;
    let j = 1;
    while ((j + 1) * j / 2 <= f) j++;
    return [j - 1 - (f - j * (j - 1) / 2), j];
}

export function parseGrievances(payload: Buffer, from = 0): Civ6Grievances | null {
    const marker = Buffer.alloc(12);
    marker.writeInt32LE(1, 0); marker.writeInt32LE(-1, 4); marker.writeInt32LE(PAIRS, 8);
    const at = payload.indexOf(marker, from);
    if (at < 0) return null;
    const pairs: Civ6GrievancePair[] = [];
    let o = at + 12;
    for (let k = 0; k < PAIRS; k++, o += 8) {
        const total = payload.readInt32LE(o), turn = payload.readInt32LE(o + 4);
        if (total === 0 && turn === -1) continue;
        const [a, b] = pairOf(k);
        pairs.push({ a, b, total, turn });
    }
    const log: Civ6GrievanceEntry[] = [];
    const count = payload.readInt32LE(o);
    o += 4;
    const readString = () => { const len = payload.readUInt32LE(o); const s = payload.subarray(o + 4, o + 4 + len).toString('latin1'); o += 4 + len; return s; };
    for (let e = 0; e < count && o + 28 <= payload.length; e++) {
        if (payload.readInt32LE(o) !== 16) break;
        const entry = { holder: payload.readInt32LE(o + 4), against: payload.readInt32LE(o + 8), amount: payload.readInt32LE(o + 12), turn: payload.readInt32LE(o + 16), payloadOffset: o };
        o += 20;
        const reason = readString();
        if (!reason.startsWith(REASON_PREFIX)) break;
        const arg = readString();
        log.push({ ...entry, reason: reason.slice(REASON_PREFIX.length), arg: arg || null });
    }
    return { pairs, log };
}
