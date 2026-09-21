/**
 * A player's improvement plots: `1, playerId, 1, 2, 0xBC9BE34F, 0, 0x578A381D, 0, 1, n, plot×n`
 * in the player object, just before the governor block (a civilization's farms, mines and
 * pastures; the barbarians' outposts under slot 63; goody huts belong to nobody).
 */

import type { Civ6PlayerState } from './parse-players';

const MARK_A = 0xbc9be34f, MARK_B = 0x578a381d;

export function readImprovementPlots(payload: Buffer, playerId: number, players: Civ6PlayerState[], index: number): number[] {
    const from = players[index]!.payloadOffset;
    const to = players[index + 1]?.payloadOffset ?? payload.length;
    for (let o = from; o + 44 <= to; o++) {
        if (payload.readUInt32LE(o) !== MARK_A || payload.readUInt32LE(o + 8) !== MARK_B) continue;
        if (payload.readInt32LE(o - 12) !== playerId || payload.readInt32LE(o + 16) !== 1) continue;
        const n = payload.readInt32LE(o + 20);
        if (n < 0 || n > 5000 || o + 24 + 4 * n > to) continue;
        const plots: number[] = [];
        for (let k = 0; k < n; k++) plots.push(payload.readInt32LE(o + 24 + 4 * k));
        return plots;
    }
    return [];
}
