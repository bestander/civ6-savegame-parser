/**
 * The save header as the key/value store it is.
 *
 * After the `CIV6` magic the header is a flat list of entries `u32 key, u32 type, 8 bytes, value`
 * — the game configuration (`GAME_SYNC_RANDOM_SEED`, the `VICTORY_*` toggles, `GAMEMODE_*`,
 * `GAME_START_ERA`, …) followed by one block per player slot (`PLAYER_ID`, `CIVILIZATION_TYPE_NAME`,
 * `LEADER_TYPE_NAME`, `NICK_NAME`, `IS_ALIVE`, `SLOT_STATUS`, `TEAM`, …) and the enabled mods. A
 * key is `civ6Hash` of the property's name: the configuration names the game logs in
 * `net_message_debug.log`, or CamelCase for the summary fields (`CurrentTurn`, `GameSpeed`,
 * `MapSize`). Unknown keys are kept under their hex; 307 distinct keys on a hotseat save, about
 * two thirds named.
 *
 * Types: 1 bool (u8 at +16), 2 int (i32 at +16), 3 a type hash (u32 at +16, resolved when known),
 * 4/5 string (`u24 len | 0x21 << 24, u32 1, bytes, NUL` at +16), 0x0A/0x0B arrays (skipped: the
 * mod list is read by the vendored pydt parser), 0x18 the compressed payload.
 */

import { civ6Hash, resolveTypeHash } from './hash-tables';

export type HeaderValue = boolean | number | string | null;

export interface Civ6HeaderStore {
    /** Game-level settings by name (or hex key). */
    game: Record<string, HeaderValue>;
    /** One record per player slot, in header order, by name (or hex key). */
    players: Array<Record<string, HeaderValue>>;
    /** Keys seen that the dictionary could not name. */
    unnamedKeys: string[];
}

const NAMES = [
    'CurrentTurn', 'GameSpeed', 'MapSize', 'NICK_NAME',
    'AGENDA_TYPE_ID', 'AGENDA_TYPE_NAME', 'CALENDAR_TYPE', 'CITY_STATE_COUNT', 'CIVILIZATION_ADJECTIVE', 'CIVILIZATION_DESCRIPTION',
    'CIVILIZATION_LEVEL_TYPE_ID', 'CIVILIZATION_LEVEL_TYPE_NAME', 'CIVILIZATION_SHORT_DESCRIPTION', 'CIVILIZATION_TYPE_ID',
    'CIVILIZATION_TYPE_NAME', 'CONFIGURATION_TYPE', 'ENABLED_MODS', 'GAMEMODE_APOCALYPSE', 'GAMEMODE_BARBARIAN_CLANS',
    'GAMEMODE_DRAMATICAGES', 'GAMEMODE_HEROES', 'GAMEMODE_MONOPOLIES', 'GAMEMODE_TOWERDEFENSE', 'GAMEMODE_TREE_RANDOMIZER',
    'GAME_ALLIES_SHARE_VISIBILITY', 'GAME_GUID_HI', 'GAME_GUID_LO', 'GAME_HANDICAP', 'GAME_MODE', 'GAME_NAME', 'GAME_NO_BARBARIANS',
    'GAME_PAUSED', 'GAME_REALISM', 'GAME_ROOT', 'GAME_SPEED_NAME', 'GAME_START_ERA', 'GAME_START_ERA_NAME', 'GAME_START_TURN',
    'GAME_START_YEAR', 'GAME_STATE', 'GAME_SYNC_RANDOM_SEED', 'GAME_TURN_LIMIT', 'HANDICAP_TYPE_ID', 'HOTSEAT_PASSWORD', 'IS_ALIVE',
    'IS_LOCKED', 'LEADER_DOMAIN', 'LEADER_NAME', 'LEADER_TYPE_ID', 'LEADER_TYPE_NAME', 'LEADER_VALUES', 'LEADER_VALUE_DOMAIN',
    'MAP_PINS', 'MOD_ID', 'MOD_READY_STATUS', 'MOD_SUBSCRIPTION_ID', 'MOD_TITLE_KEY', 'MOD_VERSION', 'NETWORK_NAME',
    'NO_DUPLICATE_CIVILIZATIONS', 'NO_DUPLICATE_LEADERS', 'NO_TEAMS', 'PLAYER_COLOR_ALTERNATE', 'PLAYER_COLOR_TYPE', 'PLAYER_ID',
    'READY_STATUS', 'RULESET', 'RULESET_NAME', 'SAVED_GAME', 'SLOT_STATUS', 'TEAM', 'TURN_TIMER_TIME', 'TURN_TIMER',
    'VICTORY_TECHNOLOGY', 'VICTORY_CONQUEST', 'VICTORY_RELIGIOUS', 'VICTORY_CULTURE', 'VICTORY_SCORE', 'VICTORY_DIPLOMATIC',
    // hashed candidates from every quoted string in the game's Lua/SQL/XML (33 hits on dip-a-1)
    'AutoEndTurn', 'AutoProdQueue', 'AutoUnitCycle', 'ChatTextValue', 'CityRangeAttackTurnBlocking', 'ClockFormat', 'EdgePan',
    'GAMEMODE_SECRETSOCIETIES', 'GAME_NO_GOODY_HUTS', 'GAME_SPEED_TYPE', 'MAP_DOMAIN', 'MAP_MAX_MINOR_PLAYERS', 'MAP_MIN_MINOR_PLAYERS',
    'MAP_NAME', 'MAP_SCRIPT', 'MAP_SIZE', 'MapName', 'PRIVATE_GAME', 'PlotToolTipFollowsMouse', 'QuickCombat', 'QuickMovement', 'RANDOM_SEED',
    'ReplaceDragWithClick', 'RibbonStats', 'Ruleset', 'TURN_TIMER_TYPE', 'TutorialLevel', 'rainfall', 'resources', 'sea_level', 'start',
    'temperature', 'world_age',
];
const DICT = new Map(NAMES.map(n => [civ6Hash(n) >>> 0, n] as const));
/** Keys that belong to a player slot; everything else is game-level wherever it appears. */
const PLAYER_KEYS = new Set(['PLAYER_ID', 'NICK_NAME', 'AGENDA_TYPE_ID', 'AGENDA_TYPE_NAME', 'CIVILIZATION_ADJECTIVE', 'CIVILIZATION_DESCRIPTION',
    'CIVILIZATION_LEVEL_TYPE_ID', 'CIVILIZATION_LEVEL_TYPE_NAME', 'CIVILIZATION_SHORT_DESCRIPTION', 'CIVILIZATION_TYPE_ID', 'CIVILIZATION_TYPE_NAME',
    'CONFIGURATION_TYPE', 'HANDICAP_TYPE_ID', 'HOTSEAT_PASSWORD', 'IS_ALIVE', 'IS_LOCKED', 'LEADER_DOMAIN', 'LEADER_NAME', 'LEADER_TYPE_ID',
    'LEADER_TYPE_NAME', 'LEADER_VALUES', 'LEADER_VALUE_DOMAIN', 'PLAYER_COLOR_ALTERNATE', 'PLAYER_COLOR_TYPE', 'READY_STATUS', 'SLOT_STATUS', 'TEAM',
    'MOD_READY_STATUS', 'NETWORK_NAME']);

const pydtHeader = require('../vendor/civ6-header-parser.cjs') as { parse: (buffer: Buffer, options?: { simple?: boolean }) => { chunks: Buffer[] } };

function readEntry(buf: Buffer, at: number): { key: number; type: number; value: HeaderValue; next: number } | null {
    if (at + 16 > buf.length) return null;
    const key = buf.readUInt32LE(at);
    const type = buf.readUInt32LE(at + 4);
    const v = at + 16;
    switch (type) {
        case 1: return { key, type, value: buf.readUInt8(v) === 1, next: v + 4 };
        case 2: return { key, type, value: buf.readInt32LE(v), next: v + 4 };
        case 3: { const h = buf.readUInt32LE(v); return { key, type, value: resolveTypeHash(h)?.name ?? h, next: v + 4 }; }
        case 4: case 5: {
            // Strings carry no padding: `u24 len | 0x21 << 24, u32 1, bytes` right after the type.
            const sv = at + 8;
            const len = buf.readUIntLE(sv, 3);
            const flag = buf.readUInt8(sv + 3);
            if (flag !== 0x21 || sv + 8 + len > buf.length) return null;
            return { key, type, value: buf.subarray(sv + 8, sv + 8 + Math.max(0, len - 1)).toString('utf8'), next: sv + 8 + len };
        }
        case 0x0d: case 0x14: return { key, type, value: null, next: v + 8 };
        case 0x15: return { key, type, value: null, next: buf.subarray(v, v + 4).equals(Buffer.from([0, 0, 0, 0x80])) ? v + 12 : v + 4 };
        default: return null;
    }
}

/** The vendored pydt walker splits the header into one buffer per entry; each is decoded here. */
export function parseHeaderStore(buffer: Buffer): Civ6HeaderStore {
    const out: Civ6HeaderStore = { game: {}, players: [], unnamedKeys: [] };
    const unnamed = new Set<string>();
    let current: Record<string, HeaderValue> = out.game;
    for (const chunk of pydtHeader.parse(buffer, { simple: false }).chunks) {
        if (chunk.length < 16) continue;
        const entry = readEntry(chunk, 0);
        if (!entry) continue;
        const name = DICT.get(entry.key);
        const label = name ?? entry.key.toString(16).padStart(8, '0');
        if (!name) unnamed.add(label);
        if (name === 'PLAYER_ID') { current = {}; out.players.push(current); }
        const target = name && !PLAYER_KEYS.has(name) ? out.game : current;
        if (entry.value !== null && !(label in target)) target[label] = entry.value;
    }
    out.unnamedKeys = [...unnamed].sort();
    return out;
}
