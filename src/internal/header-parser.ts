/**
 * Civ6 save header — wraps vendored pydt/civ6-save-parser (MIT).
 */

import type { Civ6PlayerSeat, Civ6SeatKind } from './types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pydtHeader = require('../vendor/civ6-header-parser.cjs') as {
    parse: (buffer: Buffer, options?: { simple?: boolean }) => {
        parsed: PydtSimpleParsed;
    };
};

interface PydtActor {
    ACTOR_NAME?: string;
    LEADER_NAME?: string;
    ACTOR_TYPE?: string;
    ACTOR_AI_HUMAN?: number;
    PLAYER_NAME?: string;
    IS_CURRENT_TURN?: boolean;
    PLAYER_ALIVE?: boolean;
    SLOT_HEADER?: number;
}

interface PydtSimpleParsed {
    GAME_TURN?: number;
    GAME_SPEED?: string;
    MAP_SIZE?: string;
    MAP_FILE?: string;
    CIVS?: PydtActor[];
    ACTORS?: PydtActor[];
}

function seatKind(actorType: string, aiHuman: number): Civ6SeatKind {
    if (actorType === 'CIVILIZATION_LEVEL_FULL_CIV') return 'full_civ';
    if (actorType === 'CIVILIZATION_LEVEL_TRIBE') return 'barbarian';
    if (actorType === 'CIVILIZATION_LEVEL_FREE_CITIES') return 'free_cities';
    if (actorType === 'CIVILIZATION_LEVEL_CITY_STATE') {
        return aiHuman === 5 ? 'inactive_city_state' : 'city_state';
    }
    return 'inactive_city_state';
}

function mapActor(actor: PydtActor, slotIndex?: number): Civ6PlayerSeat | null {
    const civ = actor.ACTOR_NAME;
    const leader = actor.LEADER_NAME;
    const actorType = actor.ACTOR_TYPE;
    if (!civ || !leader || !actorType) return null;
    const aiHuman = actor.ACTOR_AI_HUMAN ?? 1;
    return {
        slotIndex,
        civilization: civ,
        leader,
        seatKind: seatKind(actorType, aiHuman),
        aiHuman,
        playerName: actor.PLAYER_NAME,
        isCurrentTurn: actor.IS_CURRENT_TURN === true,
        isAlive: actor.PLAYER_ALIVE !== false,
    };
}

function mapActors(actors: PydtActor[]): Civ6PlayerSeat[] {
    return actors
        .map((a, i) => mapActor(a, typeof a.SLOT_HEADER === 'number' ? a.SLOT_HEADER : i))
        .filter((s): s is Civ6PlayerSeat => s !== null);
}

export function parseCiv6Header(buffer: Buffer): {
    metadata: {
        turn: number;
        gameSpeed: string;
        mapSize: string;
        mapFile?: string;
    };
    fullCivs: Civ6PlayerSeat[];
    cityStates: Civ6PlayerSeat[];
    other: Civ6PlayerSeat[];
    warnings: string[];
} {
    if (buffer.subarray(0, 4).toString() !== 'CIV6') {
        throw new Error('Not a Civilization 6 save file');
    }

    const warnings: string[] = [];
    const { parsed } = pydtHeader.parse(buffer, { simple: true });
    const data = parsed as PydtSimpleParsed;

    const turn = typeof data.GAME_TURN === 'number' ? data.GAME_TURN : 0;
    const gameSpeed = data.GAME_SPEED ?? 'UNKNOWN';
    const mapSize = data.MAP_SIZE ?? 'UNKNOWN';
    const mapFile = data.MAP_FILE;

    if (!turn) warnings.push('header: GAME_TURN missing or zero');

    const fullCivs = mapActors(data.CIVS ?? []);
    const cityStates: Civ6PlayerSeat[] = [];
    const other: Civ6PlayerSeat[] = [];

    for (const actor of data.ACTORS ?? []) {
        const seat = mapActor(actor);
        if (!seat) continue;
        if (seat.seatKind === 'city_state' || seat.seatKind === 'inactive_city_state') {
            cityStates.push(seat);
        } else {
            other.push(seat);
        }
    }

    return {
        metadata: { turn, gameSpeed, mapSize, mapFile },
        fullCivs,
        cityStates,
        other,
        warnings,
    };
}
