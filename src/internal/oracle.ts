/**
 * The the oracle mod dump inside a save.
 *
 * The SaveOracle mod (src/civ6save/lua/SaveOracle) runs as a gameplay script and stores a JSON
 * dump of the live state with `Game:SetProperty("ORACLE_JSON", …)` on load and at every
 * turn start, and the UI context's richer dump as `ORACLE_UI_JSON` through the same call.
 * Game properties are serialized with the game core, so each dump sits in the inflated payload
 * as
 *
 *   u16 keyLen, key bytes, u32 5 (string), u24 valueLen (NUL included) + u8 0x21, u32 1, value, NUL
 *
 * That makes any save taken with the mod enabled its own ground truth: population, treasury,
 * faith, score and the rest, per player, for the very state the save holds. (Only the Mac
 * build's lack of Lua.log made this necessary; it works on every platform.)
 */

export interface OracleUnit {
    id: number; type: string | null; x: number; y: number;
    damage: number | null; maxDamage: number | null; moves: number | null; maxMoves: number | null;
    xp: number | null; level: number | null; promotions: string[];
    formation: number | null; militaryFormation: number | null; charges: number | null;
    error?: string;
}

export interface OracleCity {
    id: number; name: string; x: number; y: number; owner: number;
    population: number | null; capital: boolean | null;
    food: number | null; foodSurplus: number | null; growthThreshold: number | null; housing: number | null; turnsToGrow: number | null;
    production: string | null; productionProgress: number | null; productionCost: number | null;
    queue: number[]; buildings: string[];
    districts: Array<{ type: string | null; x: number; y: number; complete: boolean | null; pillaged: boolean | null }>;
    hp: number | null; maxHp: number | null;
    error?: string;
}

export interface OraclePlayer {
    id: number; civilization: string | null; leader: string | null; name: string | null;
    human: boolean | null; major: boolean | null; minor: boolean | null; alive: boolean | null;
    gold: number | null; goldPerTurn: number | null; faith: number | null; faithPerTurn: number | null;
    science: number | null; culture: number | null; eraScore: number | null; score: number | null;
    government: string | null;
    currentTech: string | null; currentTechProgress: number | null;
    currentCivic: string | null; currentCivicProgress: number | null;
    techs: string[]; civics: string[];
    policies: Array<{ slot: number; policy?: string }>;
    units: OracleUnit[]; cities: OracleCity[];
    diplomacy: Array<{ player: number; war: boolean | null; allied: boolean | null }>;
    envoys: Array<{ cityState: number; envoys: number; suzerain: boolean }>;
    error?: string;
}

export interface OracleDump {
    reason: string;
    turn: number;
    currentPlayer: number | null;
    players: OraclePlayer[];
}

const GAMEPLAY_KEY = 'ORACLE_JSON';
const UI_KEY = 'ORACLE_UI_JSON';
/** Captures made before the mod was renamed carry their properties under this prefix. */
const LEGACY_PREFIX = 'CIVA_';

/** The dump's byte range in the payload, or null when the save was made without the mod. */
export function findOracleDump(payload: Buffer, key: string = GAMEPLAY_KEY): { start: number; end: number } | null {
    // The key is framed `u16 len, key`; searching for the legacy spelling too keeps old captures readable.
    let at0 = payload.indexOf(key);
    let found = key;
    if (at0 < 0) { found = LEGACY_PREFIX + key; at0 = payload.indexOf(found); }
    if (at0 < 0) return null;
    const at = at0 + found.length;
    if (payload.readUInt32LE(at) !== 5) return null;
    const len = payload.readUIntLE(at + 4, 3);
    const start = at + 12;
    // The stored length counts the terminating NUL.
    return { start, end: start + len - 1 };
}

function readJson<T>(payload: Buffer, key: string): T | null {
    const range = findOracleDump(payload, key);
    return range ? JSON.parse(payload.subarray(range.start, range.end).toString('utf8')) as T : null;
}

type Row = Record<string, unknown>;

/**
 * Field by field, the UI value when it has one, else the gameplay value. The two contexts see
 * different API subsets (the UI has food, levels and era score; the gameplay context every
 * player's build queue, which the UI hides for players other than the one at the keyboard),
 * so neither dump is complete on its own. Lists of players, cities and units pair up by id.
 */
function merge(ui: unknown, gameplay: unknown): unknown {
    if (ui === null || ui === undefined) return gameplay ?? null;
    if (gameplay === null || gameplay === undefined) return ui;
    if (Array.isArray(ui) && Array.isArray(gameplay)) {
        const byId = (row: unknown) => (row && typeof row === 'object' && 'id' in row ? (row as Row).id : undefined);
        if (ui.length > 0 && byId(ui[0]) !== undefined) {
            const rest = new Map(gameplay.map(r => [byId(r), r]));
            return ui.map(r => merge(r, rest.get(byId(r))));
        }
        return ui.length >= gameplay.length ? ui : gameplay;
    }
    if (typeof ui === 'object' && typeof gameplay === 'object') {
        const out: Row = {};
        for (const key of new Set([...Object.keys(ui as Row), ...Object.keys(gameplay as Row)])) {
            out[key] = merge((ui as Row)[key], (gameplay as Row)[key]);
        }
        return out;
    }
    return ui;
}

/** What the lab mod applied to this game, one line per step; null without the mod. */
export function readLabLog(payload: Buffer): string | null {
    return readProperty(payload, 'LAB_LOG');
}

/** What an automated run (scripts/capture.ts) did, one line per step; null when none. */
export function readPlanLog(payload: Buffer): string | null {
    return readProperty(payload, 'PLAN_LOG');
}

function readProperty(payload: Buffer, key: string): string | null {
    const range = findOracleDump(payload, key);
    return range ? payload.subarray(range.start, range.end).toString('utf8') : null;
}

/** The dump, or null when the save was made without the mod. */
export function readOracleDump(payload: Buffer): OracleDump | null {
    const gameplay = readJson<OracleDump>(payload, GAMEPLAY_KEY);
    const ui = readJson<OracleDump>(payload, UI_KEY);
    if (!gameplay) return ui;
    if (!ui) return gameplay;
    return merge(ui, gameplay) as OracleDump;
}
