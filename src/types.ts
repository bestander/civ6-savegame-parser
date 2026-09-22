/**
 * The public data model of a parsed `.Civ6Save`.
 *
 * Conventions:
 * - Every player is identified by its slot id (`playerId`): 0… for the civilizations and
 *   city-states as the game numbers them, 62 the free cities, 63 the barbarians. Nothing here
 *   is keyed by file position.
 * - Database rows are named by their type string (`UNIT_WARRIOR`, `TECH_MINING`,
 *   `RELIGION_CATHOLICISM`, `BELIEF_CHORAL_MUSIC`, …), never by hash.
 * - Plots are Civ6 offset coordinates (`x`, `y`; odd rows shifted right) or the plot index
 *   `y * width + x` where a list of plots is long.
 * - Fixed-point ×256 values are converted to numbers; turns are game turns.
 * - `null` means "not present in this save" (a city without a religion, a player without a
 *   pantheon); an optional field means "the parser did not find it" (rare, logged in `warnings`).
 * - `offset` fields point into the inflated payload so a value can be traced to its bytes.
 */

// ---------------------------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------------------------

export type HeaderValue = boolean | number | string | null;

/** The uncompressed key/value store ahead of the payload: game setup and the 128 player slots. */
export interface Civ6Header {
    /** Turn, speed, map size, ruleset, victories, modes, seed, … keyed by the game's own property names. */
    game: Record<string, HeaderValue>;
    /** One record per slot (128), keyed by the game's property names (`CIVILIZATION_TYPE_NAME`, `LEADER_TYPE_NAME`, `TEAM`, `SLOT_STATUS`, …). */
    slots: Array<Record<string, HeaderValue>>;
    /** Header keys whose property name is unknown, as hex of the hash. */
    unnamedKeys: string[];
}

export interface Civ6Metadata {
    turn: number;
    gameSpeed: string;
    mapSize: string;
    mapScript?: string;
    /** Slot ids whose turn it is (several in hotseat). */
    currentPlayers: number[];
}

// ---------------------------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------------------------

export type Civ6PlayerKind = 'civilization' | 'city_state' | 'free_cities' | 'barbarians';

export interface Civ6Player {
    playerId: number;
    kind: Civ6PlayerKind;
    civilization: string;
    leader: string;
    /** Team id from the header. */
    team: number;
    human: boolean;
    alive: boolean;
    name?: string;

    // Science and culture
    techsResearched: string[];
    techsBoosted: string[];
    /** Science banked per tech in progress. */
    techProgress: Record<string, number>;
    currentResearch: string | null;
    civicsCompleted: string[];
    civicsInspired: string[];
    civicProgress: Record<string, number>;
    currentCivic: string | null;

    // Government
    government: string | null;
    governmentsUnlocked: string[];
    policiesSlotted: Array<{ policy: string; slot: number }>;
    /** Every policy that has ever been slotted (the legacy set). */
    policiesEverSlotted: string[];

    // Economy
    gold: number;
    goldPerTurn: number;
    /** Per-turn yields as last computed by the game (`YIELD_FOOD`, `YIELD_SCIENCE`, …). */
    yields: Record<string, number>;
    /** Strategic stockpiles and copies of bonus/luxury resources (`RESOURCE_*` → amount). */
    stockpiles: Record<string, number>;
    /** Diplomatic favor (Gathering Storm); null without the expansion. */
    favor: { favor: number; earned: number; spent: number } | null;

    // Religion
    faith: number | null;
    pantheon: string | null;
    religionFounded: {
        religion: string;
        /** Custom name, or the standard religion's name. */
        name: string;
        foundedTurn: number;
        holyCity: { x: number; y: number };
        beliefs: string[];
    } | null;

    // Eras and great people
    eraScore: number | null;
    /** Dedications (Rise & Fall): what was offered at the era start and what was taken. */
    dedications: { choices: string[]; active: string[] } | null;
    /** Great-person points by class (`GREAT_PERSON_CLASS_*`). */
    greatPersonPoints: Record<string, { banked: number; perTurn: number }>;

    // Knowledge of the world
    /** Plot indices the player has revealed. */
    revealedPlots: number[];
    /** Plot indices the player sees now, with the visibility count. */
    visiblePlots: Array<{ plot: number; count: number }>;
    continents: string[];
    naturalWondersFound: string[];
    /** Unit types of other players this player has seen. */
    unitTypesSeen: string[];
    goodyHutsReceived: Record<string, number>;
    /** Plot indices of this player's improvements (the barbarians' outposts for 63). */
    improvementPlots: number[];
    unitsTrained: Record<string, number>;

    // Diplomacy
    /** Diplomatic state towards every other slot (`NEUTRAL`, `FRIENDLY`, `WAR`, `ALLIED`, `PATRON`, …). */
    relations: Array<{ playerId: number; state: string }>;
    /** Envoys: placed in each city-state for a civilization, received from each civilization for a city-state. */
    envoys: Record<number, number>;

    governors: Civ6Governor[];
    offset: number;
}

export interface Civ6Governor {
    type: string;
    promotions: string[];
    /** The city the governor is assigned to, by city id, or null when unassigned. */
    cityId: number | null;
    established?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------------------------

export interface Civ6Plot {
    index: number;
    x: number;
    y: number;
    /** `TERRAIN_*` (display name when the type is not in the dictionary). */
    terrain: string;
    /** `null` when flat; `Hill`, `Mountain`. */
    form: string | null;
    /** `FEATURE_*`, `RESOURCE_*`, `IMPROVEMENT_*`, `CONTINENT_*`, or null. */
    feature: string | null;
    resource: string | null;
    improvement: string | null;
    continent: string | null;
    /** The game's route index on the plot (0 = ancient road, …), or null without one. */
    routeIndex: number | null;
    pillaged: boolean;
    /** Bit mask of river edges as the game stores it. */
    riverMap: number;
    unitCount: number;
    owner: {
        playerId: number;
        /** The owning city's slot in its owner's list (`Civ6City.slot`). */
        citySlot: number;
        /** District instance id when a district stands here. */
        districtInstanceId: number | null;
        worldWonder: string | null;
    } | null;
    offset: number;
}

export interface Civ6Map {
    width: number;
    height: number;
    plots: Civ6Plot[];
}

// ---------------------------------------------------------------------------------------------
// Cities
// ---------------------------------------------------------------------------------------------

export interface Civ6District {
    type: string;
    x: number;
    y: number;
    complete: boolean;
    damage: number;
    wallsDamage: number;
    lastDamagedTurn: number | null;
}

export interface Civ6GreatWorkSlot {
    building: string;
    slot: number;
    /** The game's slot type index (writing, art, music, relic, artifact, …). */
    slotType: number;
    /** Index into `Civ6Save.greatWorks`, or null when empty. */
    workIndex: number | null;
}

export interface Civ6City {
    /** `id = (count << 16) | slot`: the owner's running count of cities and this city's slot. */
    id: number;
    slot: number;
    name: string;
    playerId: number;
    originalPlayerId: number;
    center: { x: number; y: number };
    capital: boolean;
    population: number;
    /** Food banked towards the next citizen. */
    food: number;
    /** Plots worked by citizens, the centre included; a district plot with workers holds specialists. */
    workedPlots: Array<{ x: number; y: number; workers: number }>;
    /** Loyalty (Rise & Fall); null without the expansion. */
    loyalty: { loyalty: number; perTurn: number; level: string | null } | null;

    production: {
        current: string | null;
        /** Where a district or wonder in production goes. */
        plot: { x: number; y: number } | null;
        /** Hammers banked per item type. */
        progress: Record<string, number>;
        queue: string[];
    };
    buildings: Array<{ type: string; x: number; y: number }>;
    districts: Civ6District[];
    greatWorkSlots: Civ6GreatWorkSlot[];

    /** Religions in the city; `religion: null` is the unconverted population (its pressure is only stored once a religion has spread in). */
    religions: Array<{ religion: string | null; followers: number; pressure: number | null }>;
    majorityReligion: string | null;
    offset: number;
}

// ---------------------------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------------------------

export interface Civ6Unit {
    /**
     * The game's own unit id (`unit:GetID()`), packed `(generation << 16) | index`. Unique per
     * player and kept as the unit moves, so `(playerId, id)` follows a unit from save to save —
     * an id is reused only after its unit dies. Null when the save's unit list could not be
     * matched to this unit.
     */
    id: number | null;
    type: string;
    playerId: number;
    x: number;
    y: number;
    hp: number;
    movesRemaining: number;
    xp: number;
    level: number;
    promotions: string[];
    abilities: string[];
    /** `MILITARY_FORMATION_*`: 0 single, 1 corps/fleet, 2 army/armada. */
    formation: number;
    fortifyTurns: number;
    /** `ACTIVITY_AWAKE`, `ACTIVITY_SLEEP`, `ACTIVITY_SENTRY`, `ACTIVITY_HOLD`, … */
    activity: string | null;
    builderCharges?: number;
    religion?: { religion: string; spreadCharges: number };
    /** `GREAT_PERSON_INDIVIDUAL_*` for great people. */
    greatPerson?: string;
    tradeRoute?: { origin: { x: number; y: number }; destination: { x: number; y: number }; startedTurn: number };
    /** Operations queued on the unit (`UNITOPERATION_*` with their raw parameters). */
    operations: Array<{ type: string; params: number[] }>;
    offset: number;
}

// ---------------------------------------------------------------------------------------------
// Game-level
// ---------------------------------------------------------------------------------------------

export interface Civ6War {
    /** `WAR_FORMAL`, `WAR_SURPRISE`, `WAR_HOLY`, … (participants are not stored). */
    type: string;
    turn: number;
}

export interface Civ6Grievances {
    /** Total grievances between an unordered pair, both directions summed, and the turn they last changed. */
    pairs: Array<{ a: number; b: number; total: number; turn: number }>;
    /** Every grievance event: who holds it against whom, why. */
    log: Array<{ holder: number; against: number; amount: number; turn: number; reason: string; arg: string | null }>;
}

export interface Civ6Moment {
    type: string;
    turn: number;
    playerId: number;
    plot: { x: number; y: number } | null;
    index: number;
}

export interface Civ6GreatWork {
    index: number;
    type: string;
    creatorPlayerId: number;
    turn: number;
    name: string;
}

export interface Civ6GreatPersonRecord {
    individual: string;
    class: string;
    era: string;
    cost: number;
    recruitedBy: number | null;
    recruitedTurn: number | null;
}

export interface Civ6Emergency {
    emergency: string;
    /** The session turn it was proposed at. */
    turn: number;
    /** Votes per player slot (64 entries). */
    votes: number[];
}

export interface Civ6Alliance {
    a: number;
    b: number;
    /** `ALLIANCE_RESEARCH`, `ALLIANCE_MILITARY`, … */
    type: string;
    startTurn: number;
}

export interface Civ6DealItem {
    /** `DIPLOACTION_OPEN_BORDERS`, `DIPLOACTION_ALLIANCE`, `DIPLOACTION_MAKE_PEACE`, … */
    action: string;
    /** Turn the deal began; -1 for a pending proposal. */
    turn: number;
    duration: number;
    from: number;
    to: number;
}

export interface Civ6Resolution {
    resolution: string;
    /** The chosen target: a type name when it is a database row, else the raw value (a player id for player-targeted resolutions). */
    target: string | number;
    /** 1 = option A, 2 = option B. */
    option: 1 | 2;
}

export interface Civ6TimelinePoint {
    turn: number;
    value: number;
}

// ---------------------------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------------------------

export interface Civ6Save {
    metadata: Civ6Metadata;
    header: Civ6Header;
    map: Civ6Map;
    players: Civ6Player[];
    cities: Civ6City[];
    units: Civ6Unit[];
    wars: Civ6War[];
    /** Gathering Storm; null without it. */
    grievances: Civ6Grievances | null;
    /** The historic-moment ledger (Rise & Fall). */
    moments: Civ6Moment[];
    /** Every great work in the game; cities refer to them by index. */
    greatWorks: Civ6GreatWork[];
    /** Great people offered and recruited so far. */
    greatPeople: Civ6GreatPersonRecord[];
    /** World Congress resolutions, the latest session's first (Gathering Storm). */
    resolutions: Civ6Resolution[];
    /** World Congress emergencies with their votes. */
    emergencies: Civ6Emergency[];
    /** Alliances per pair with type and start turn; null without the expansion. */
    alliances: Civ6Alliance[] | null;
    /** Agreement items of deals in effect or pending, one per direction. */
    deals: Civ6DealItem[];
    /**
     * The hall-of-fame graphs: dataset (`SCOREPERTURN`, `TOTALGOLD`, `ERASCORE`, `CULTURE`,
     * `TOTALCOMBATS`, …) → player id → per-turn points. Yields and score are dense; `TOTAL*`
     * counters are sparse (only turns with an event).
     */
    graphs: Record<string, Record<number, Civ6TimelinePoint[]>>;
    /** Anything the parser could not resolve, human-readable. */
    warnings: string[];
}
