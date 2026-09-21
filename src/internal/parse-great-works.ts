/**
 * Great works.
 *
 * Registry, in the tail: `count`, then `6, GREATWORK_x, creatorPlayer, turnCreated, len,
 * LOC_name` per work; a work's index is its position (index 0 was a relic from a tribal
 * village, 1 Ovid's first — exactly the oracle's GetGreatWorkInSlot indices).
 *
 * Slots, per city object: `count, (BUILDING_x, nSlots, (10, slotType, workIndex | -1)×nSlots)
 * ×count` — Umgungundlovu's Amphitheater holds works 1 and 2, its Art Museum 10 and 11 with the
 * first slot empty, the Temple's relic slot (type 5) empty, as the oracle lists them.
 */

import { resolveTypeHash } from './hash-tables';

export interface Civ6GreatWork {
    index: number;
    type: string;
    creatorPlayerId: number;
    turn: number;
    name: string;
    payloadOffset: number;
}

export interface Civ6GreatWorkSlot { building: string; slot: number; slotType: number; workIndex: number | null }

export function parseGreatWorkRegistry(payload: Buffer, from = 0): Civ6GreatWork[] {
    // The first record: `6, GREATWORK hash, player, turn, len, "LOC_"`.
    for (let o = from; o + 24 <= payload.length; o++) {
        if (payload.readInt32LE(o) !== 6) continue;
        const t = resolveTypeHash(payload.readUInt32LE(o + 4));
        if (t?.kind !== 'KIND_GREATWORK') continue;
        const count = payload.readInt32LE(o - 4);
        if (count < 1 || count > 4096) continue;
        const out: Civ6GreatWork[] = [];
        let at = o;
        for (let i = 0; i < count && at + 24 <= payload.length; i++) {
            if (payload.readInt32LE(at) !== 6) break;
            const type = resolveTypeHash(payload.readUInt32LE(at + 4));
            if (type?.kind !== 'KIND_GREATWORK') break;
            const len = payload.readUInt32LE(at + 16);
            if (len > 128) break;
            out.push({ index: i, type: type.name, creatorPlayerId: payload.readInt32LE(at + 8), turn: payload.readInt32LE(at + 12), name: payload.subarray(at + 20, at + 20 + len).toString('latin1'), payloadOffset: at });
            at += 20 + len;
        }
        if (out.length === count) return out;
    }
    return [];
}

/** The great-work slots of the city object starting at `from` (its name), within `span` bytes. */
export function parseCityGreatWorkSlots(payload: Buffer, from: number, span: number): Civ6GreatWorkSlot[] {
    const end = Math.min(payload.length, from + span);
    for (let o = from; o + 16 <= end; o++) {
        const count = payload.readInt32LE(o);
        if (count < 1 || count > 40) continue;
        const first = resolveTypeHash(payload.readUInt32LE(o + 4));
        if (first?.kind !== 'KIND_BUILDING' || payload.readInt32LE(o + 12) !== 10) continue;
        const slots: Civ6GreatWorkSlot[] = [];
        let at = o + 4, ok = true;
        for (let b = 0; b < count && ok; b++) {
            const building = resolveTypeHash(payload.readUInt32LE(at));
            const n = payload.readInt32LE(at + 4);
            if (building?.kind !== 'KIND_BUILDING' || n < 1 || n > 8) { ok = false; break; }
            at += 8;
            for (let s = 0; s < n; s++, at += 12) {
                if (payload.readInt32LE(at) !== 10) { ok = false; break; }
                const workIndex = payload.readInt32LE(at + 8);
                slots.push({ building: building.name, slot: s, slotType: payload.readInt32LE(at + 4), workIndex: workIndex < 0 ? null : workIndex });
            }
        }
        if (ok) return slots;
    }
    return [];
}
