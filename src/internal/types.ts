/** Structured JSON emitted by {@link parseCiv6Save}. */

import type { Civ6SaveAsciiHints } from './parse-ascii-hints';
import type { Civ6UnitInstance } from './parse-units';
import type { Civ6PlayerState } from './parse-players';
import type { Civ6DiplomacyState } from './parse-diplomacy';
import type { Civ6GreatPeople } from './parse-great-people';
import type { Civ6Governor } from './parse-governors';
import type { Civ6HeaderStore } from './header-store';
import type { Civ6War } from './parse-wars';

export interface Civ6SaveMetadata {
    turn: number;
    gameSpeed: string;
    mapSize: string;
    mapFile?: string;
}

export type Civ6SeatKind = 'full_civ' | 'city_state' | 'barbarian' | 'free_cities' | 'inactive_city_state';

export interface Civ6PlayerSeat {
    slotIndex?: number;
    civilization: string;
    leader: string;
    seatKind: Civ6SeatKind;
    /** pydt ACTOR_AI_HUMAN: 3 = human, 1 = AI, 5 = inactive slot */
    aiHuman: number;
    playerName?: string;
    isCurrentTurn: boolean;
    isAlive: boolean;
}

export interface Civ6TileOwnership {
    ownerId: number;
    cityIndex: number;
    /** Packed district instance id from the save (not a district type hash). */
    districtInstanceId: number;
    worldWonderHash: number | null;
}

export interface Civ6ResolvedTerrain {
    name: string;
    form: string | null;
}

export interface Civ6Tile {
    index: number;
    x: number;
    y: number;
    terrainHash: number;
    terrain: Civ6ResolvedTerrain | null;
    featureHash: number;
    feature: string | null;
    resourceHash: number;
    resource: string | null;
    improvementHash: number;
    improvement: string | null;
    continentHash: number;
    continent: string | null;
    /** Raw int16 at +38: -1 none, else the route index in the low byte (bit 10 set on some). */
    road: number;
    /** Civ6 route index on the tile (0 = ancient road, …), null without one. */
    routeIndex: number | null;
    /** Bit 0 of +48: the improvement (or route) is pillaged. */
    pillaged: boolean;
    riverMap: number;
    unitCount: number;
    ownership?: Civ6TileOwnership;
    overlayBytes: number;
    /** Where the record starts in the inflated payload, and how long it is (RE aid). */
    payloadOffset?: number;
    recordLength?: number;
}

export interface Civ6MapSection {
    width: number;
    height: number;
    tileCount: number;
    tiles: Civ6Tile[];
    resyncCount: number;
    /** Byte offset of the tile-section marker in the inflated payload. */
    tileSectionStart: number;
    /** Byte offset immediately after the last tile record. */
    tileSectionEnd: number;
}

export interface Civ6TimelinePoint {
    turn: number;
    value: number;
}

export interface Civ6TimelineSeries {
    name: string;
    tag: string;
    points: Civ6TimelinePoint[];
    last: Civ6TimelinePoint | null;
}

export interface Civ6PlayerTimelines {
    playerIndex: number;
    series: Civ6TimelineSeries[];
}

export interface Civ6CityHistoryEvent {
    category:
        | 'founded'
        | 'building'
        | 'district'
        | 'wonder'
        | 'unit_trained'
        | 'unit_killed'
        | 'unit_lost'
        | 'government';
    typeName: string;
    turn?: number;
}

export interface Civ6CityYieldSnapshot {
    population: number | null;
    food: number | null;
    production: number | null;
    science: number | null;
    gold: number | null;
    culture: number | null;
    faith: number | null;
}

export interface Civ6CitySummary {
    ownerId: number;
    cityIndex: number;
    center: { x: number; y: number } | null;
    ownedTileCount: number;
    districtTiles: Array<{ x: number; y: number; districtInstanceId: number }>;
    history: Civ6CityHistoryEvent[];
    yields: Civ6CityYieldSnapshot | null;
    /** @deprecated best-effort alignment of the localized-name string table; use `name`. */
    locName: string | null;
    /** `SPARTA` — from the city object (parse-city-objects.ts). */
    name: string | null;
    /** `UNIT_SETTLER`, `BUILDING_MONUMENT`, `DISTRICT_HOLY_SITE`, … in production. */
    currentProduction: string | null;
    /** Where a district in production goes. */
    productionPlot?: { x: number; y: number };
    /** Hammers banked per item type. */
    productionProgress: Record<string, number>;
    /** Items queued behind the current one. */
    productionQueue: string[];
    /** `BUILDING_*` standing in the city. */
    buildings: string[];
    /** Plot of each standing building, Civ6 offset coordinates (wonders stand on their own plot). */
    buildingPlots: Record<string, { x: number; y: number }>;
    /** Citizens, from the city header (parse-city-objects.ts); null when not found. */
    population: number | null;
    /** Food banked towards the next citizen; null when not found. */
    food: number | null;
    /**
     * Plots worked by citizens, the centre included, with the worker count (a district plot
     * with workers = specialists); empty when the citizen arrays were not found.
     */
    workedPlots: Array<{ x: number; y: number; workers: number }>;
    /** Loyalty, its per-turn change and the level (`LOYALTY_LEVEL_3` = full); null when not found. */
    loyalty: { loyalty: number; perTurn: number; level: string | null } | null;
    /** Great-work slots of the city's buildings with the work index held (null = empty). */
    greatWorkSlots: import('./parse-great-works').Civ6GreatWorkSlot[];
    /** Religions present with followers and pressure (`religion: null` = the unconverted), and the majority religion (parse-city-objects.ts). */
    religions: Array<{ religion: string | null; followers: number; pressure: number | null }>;
    majorityReligion: string | null;
    /** Civ6 player id the city was founded by; null when the header was not found. */
    originalOwnerId: number | null;
    /** The city's id in its owner's list (`count<<16 | index`), when the header was found. */
    id?: number;
    /** Districts by type and plot, the city centre included (parse-districts.ts). */
    districts: Array<{ type: string; x: number; y: number; completed: boolean; damage: number; wallsDamage: number }>;
    /** Payload offset of the city object's name string, when the object was found. */
    payloadOffset?: number;
}

export interface Civ6UnitStack {
    x: number;
    y: number;
    count: number;
    ownerId: number | null;
}

export type { Civ6UnitInstance } from './parse-units';
export type { Civ6SaveAsciiHints } from './parse-ascii-hints';
export type { Civ6PlayerState } from './parse-players';
export type { Civ6DiplomacyState } from './parse-diplomacy';
export type { Civ6GreatPeople, Civ6GreatPersonOffer } from './parse-great-people';
export type { Civ6Governor } from './parse-governors';
export type { Civ6HeaderStore, HeaderValue } from './header-store';
export type { Civ6War } from './parse-wars';

export interface Civ6UnmappedHashes {
    terrain: string[];
    features: string[];
    resources: string[];
    improvements: string[];
    continents: string[];
    /** Unit type hashes that matched the live blob layout but are not in instanceTypes. */
    instanceTypes: string[];
}

export interface Civ6UnmappedSection {
    /** Save regions not decoded yet (unit instances, tech trees, queues, …). */
    notDecoded: string[];
    hashes: Civ6UnmappedHashes;
}

export interface Civ6SaveParsed {
    metadata: Civ6SaveMetadata;
    /** Every header key/value: game settings and all 128 player slots (header-store.ts). */
    header: Civ6HeaderStore;
    players: {
        fullCivs: Civ6PlayerSeat[];
        cityStates: Civ6PlayerSeat[];
        other: Civ6PlayerSeat[];
    };
    map: Civ6MapSection;
    cities: Civ6CitySummary[];
    unitStacks: Civ6UnitStack[];
    /** Live unit blobs: type, plot, owner, HP, MP, XP, level, promotions, abilities. */
    units: Civ6UnitInstance[];
    /** Per-player techs, civics, government, policies, yields — in player-id order (parse-players.ts). */
    playerStates: Civ6PlayerState[];
    /** Current diplomatic state from every player towards every slot (parse-diplomacy.ts). */
    diplomacy: Civ6DiplomacyState[];
    /** The game's war records — kind and latest turn per war, participants not stored (parse-wars.ts). */
    wars: Civ6War[];
    /** Historic moments and era dedications (parse-eras.ts). */
    eras: { moments: import('./parse-eras').Civ6Moment[]; dedications: import('./parse-eras').Civ6Dedications[] };
    /** Fog of war per player: revealed plots and the plots seen now (parse-visibility.ts). */
    visibility: import('./parse-visibility').Civ6PlayerVisibility[];
    /** Grievance pair totals and the log (parse-grievances.ts); null without Gathering Storm. */
    grievances: import('./parse-grievances').Civ6Grievances | null;
    /** Every great work in the game with creator and turn (parse-great-works.ts); cities hold them by index in `greatWorkSlots`. */
    greatWorks: import('./parse-great-works').Civ6GreatWork[];
    /** World Congress resolutions in effect (parse-congress.ts); empty without Gathering Storm. */
    resolutions: import('./parse-congress').Civ6Resolution[];
    /** World Congress emergencies with votes per player and the session turn (parse-congress.ts). */
    emergencies: import('./parse-congress').Civ6Emergency[];
    /** Alliances per pair with type and start turn (parse-alliances.ts); null without the matrix. */
    alliances: import('./parse-alliances').Civ6Alliance[] | null;
    /** Agreement items of deals in effect or pending (open borders, alliances; turn -1 = proposal). */
    dealItems: import('./parse-alliances').Civ6DealItem[];
    /** Great-person points per player and the recruitment ledger (parse-great-people.ts). */
    greatPeople: Civ6GreatPeople;
    /** Appointed governors with their promotions (parse-governors.ts). */
    governors: Civ6Governor[];
    asciiHints: Civ6SaveAsciiHints;
    playerTimelines: Civ6PlayerTimelines[];
    /**
     * The hall-of-fame graphs (parse-timelines.ts `readAllReplayDatasets`): dataset name
     * (`SCOREPERTURN`, `TOTALGOLD`, `ERASCORE`, `TOTALCOMBATS`, …) → Civ6 player id → per-turn
     * points, in game units. Dense per-turn series for the yields and score; sparse event logs
     * (only the turns with an event) for the `TOTAL*` counters.
     */
    graphs: Record<string, Record<number, Civ6TimelinePoint[]>>;
    cityYieldTimelines: Civ6CityYieldSnapshot[];
    locCityNames: string[];
    unmapped: Civ6UnmappedSection;
    warnings: string[];
    /** The inflated payload the offsets refer to. */
    payload: Buffer;
}
