/**
 * World Congress (Gathering Storm). The resolutions sit in the tail as records
 * `WC_RES_x, targetHash, 0, option (1 = A, 2 = B), -1, [64 per-player entries: 1/2/-1], …`
 * about 1.2 KB apart, newest session first (late-a-1: Espionage Pact B, Sovereignty A,
 * Diplomatic Victory A — the oracle's three in effect — then earlier sessions' records; after
 * the turn-241 session on pre-vote-4: Patronage A, World Ideology A, Diplomatic Victory A
 * first, the rest behind). The 64-entry array looks like each player's vote but the oracle
 * exposes no per-resolution votes to check it against. The session countdown is derived: the
 * last session's turn is stored with the emergencies (`parseEmergencies`), sessions are 30
 * turns apart on standard speed (TurnsLeft 29 / 3 % on turn 242). Each player object also carries the AI's per-resolution
 * vote weights (`WC_RES_x, 2, playerIndex, WC_RES_x, 0, 0, 0, -1`), which are not this.
 */

import { resolveTypeHash } from './hash-tables';

export interface Civ6Emergency {
    emergency: string;
    /** The session turn the emergency was proposed at. */
    turn: number;
    /** Votes per player slot (64 entries). */
    votes: number[];
    payloadOffset: number;
}

export interface Civ6Resolution {
    resolution: string;
    /** The chosen target (a type hash, resolved when known; a player id for player-targeted resolutions). */
    target: number;
    targetName: string | null;
    /** 1 = option A, 2 = option B. */
    option: number;
    payloadOffset: number;
}

/**
 * Emergencies proposed at a session: `votes[64], -1, WC_EMERGENCY_x, 1, WC_EMERGENCY_x, 1, turn`
 * (pre-vote-4, turn 242: the World's Fair with votes 1/0/1/6 exactly as the oracle's
 * `GetProposals().PlayerVotes`, turn 241 the session that just ended).
 */
export function parseEmergencies(payload: Buffer, from = 0): Civ6Emergency[] {
    const out: Civ6Emergency[] = [];
    for (let o = from; o + 20 <= payload.length; o++) {
        const t = resolveTypeHash(payload.readUInt32LE(o));
        if (!t || !t.name.startsWith('WC_EMERGENCY_') || payload.readInt32LE(o + 4) !== 1 || payload.readUInt32LE(o + 8) !== payload.readUInt32LE(o) || payload.readInt32LE(o + 12) !== 1) continue;
        const turn = payload.readInt32LE(o + 16);
        if (turn < 0 || turn > 5000 || payload.readInt32LE(o - 4) !== -1 || o - 4 - 256 < 0) continue;
        const votes: number[] = [];
        for (let k = 0; k < 64; k++) votes.push(payload.readInt32LE(o - 4 - 256 + 4 * k));
        out.push({ emergency: t.name, turn, votes, payloadOffset: o });
        o += 16;
    }
    return out;
}

export function parseResolutions(payload: Buffer, from = 0): Civ6Resolution[] {
    const out: Civ6Resolution[] = [];
    for (let o = from; o + 28 <= payload.length; o++) {
        const t = resolveTypeHash(payload.readUInt32LE(o));
        if (t?.kind !== 'KIND_RESOLUTION') continue;
        if (payload.readInt32LE(o + 8) !== 0 || payload.readInt32LE(o + 16) !== -1) continue;
        const option = payload.readInt32LE(o + 12);
        if (option !== 1 && option !== 2) continue;
        const target = payload.readInt32LE(o + 4);
        if (out.some(r => r.resolution === t.name && r.target === target && r.option === option)) continue;
        out.push({ resolution: t.name, target, targetName: resolveTypeHash(target >>> 0)?.name ?? null, option, payloadOffset: o });
    }
    return out;
}
