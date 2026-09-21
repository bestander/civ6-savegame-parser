/**
 * Fog of war per player, in the pre-map region: one block per player slot in
 * slot order, each led by `6, playerId, revealedCount, u8 0, 2280, u8[2280]` — 1 where the
 * player has revealed the plot —
 * and, a little later, `2280, 60, 2280, u16[2280]` — the plot's visibility count, above zero
 * where the player sees it now (units, cities, the lab's ChangeVisibilityCount). Four more
 * u16 plot arrays follow in each block (fog memory, not read). Pinned on vis-a-1 against the
 * oracle's PlayersVisibility for all eight players: the majors have the whole map (lab v5
 * revealed it), the city-states 98–113 plots each.
 */

export interface Civ6PlayerVisibility {
    playerId: number;
    /** Plot indices the player has revealed. */
    revealed: number[];
    /** Plot indices the player sees now, with the visibility count. */
    visible: Array<{ plot: number; count: number }>;
    payloadOffset: number;
}

export function parsePlayerVisibility(payload: Buffer, plotCount: number, before: number): Civ6PlayerVisibility[] {
    const out: Civ6PlayerVisibility[] = [];
    let at = 0;
    while (at + 17 + plotCount <= before) {
        // `6, playerId, revealedCount, u8 0, plotCount` then the revealed bytes.
        if (payload.readUInt32LE(at) !== 6 || payload[at + 12] !== 0 || payload.readUInt32LE(at + 13) !== plotCount) { at++; continue; }
        const playerId = payload.readUInt32LE(at + 4), count = payload.readUInt32LE(at + 8);
        if (playerId > 63 || count > plotCount) { at++; continue; }
        const r = at + 17;
        const revealed: number[] = [];
        for (let i = 0; i < plotCount; i++) if (payload[r + i]) revealed.push(i);
        if (revealed.length !== count) { at++; continue; }
        // The visibility counts: the next `plotCount, _, plotCount` framing after the bytes.
        const visible: Array<{ plot: number; count: number }> = [];
        let v = -1;
        for (let o = r + plotCount; o + 12 + 2 * plotCount <= before && o < r + plotCount + 4096; o++) {
            if (payload.readUInt32LE(o) === plotCount && payload.readUInt32LE(o + 8) === plotCount) { v = o + 12; break; }
        }
        if (v >= 0) for (let i = 0; i < plotCount; i++) { const c = payload.readUInt16LE(v + 2 * i); if (c) visible.push({ plot: i, count: c }); }
        out.push({ playerId, revealed, visible, payloadOffset: at });
        at = v >= 0 ? v + 2 * plotCount : r + plotCount;
    }
    return out;
}
