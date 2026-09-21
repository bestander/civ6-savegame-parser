/**
 * Per-player state from the typed tables.
 *
 * Each player object carries, in this order: a lone `GOVERNMENT_*` hash (current government),
 * `GOVERNMENT s5/s8 n13`, five `POLICY s5 n140` flag sets (the third is every card ever
 * slotted, the fourth the cards slotted now), the slot list `{POLICY_*, slot}` right before
 * `CIVIC s5 n61` (completed), `CIVIC s5 n61` (inspired), `CIVIC s8 n61` (culture ×256) with the
 * civic in progress as a lone hash just after it, …, `UNIT s8 n144` (units trained by type),
 * `YIELD s8 n6` (per-turn yields ×256), `TECH s5 n77` (researched), `TECH s5 n77` (eureka'd),
 * `TECH s8 n77` (science ×256), with the tech in progress a lone hash 20 bytes before the
 * researched table.
 *
 * Player objects appear in Civ6 player-id order — the full civs first, then the active
 * city-states, then free cities and barbarians — the same order tiles, cities and units use
 * for `ownerId`. Verified on the PYDT save through the units-trained table (three scouts and
 * two settlers trained = seat 0's three scouts and three cities) and Ottoman's yields matching
 * `Player_Stats.csv` to the point.
 *
 * After the tech tables, at a fixed distance (they are fixed-size): the treasury at +1410 and
 * the net gold per turn at +1418, both ×256. Before them, a variable
 * distance ahead of the `PROMOTION_CLASS s8` table, the religion record
 * `20, faith×256, 0, BELIEF_* | -1, n, x, y, …` gives the faith balance and the pantheon.
 *
 * Era score is filled in by index.ts from the hall-of-fame graph (parse-timelines.ts).
 * Not here yet: great-person points.
 */

import { resolveTypeHash } from './hash-tables';
import { activeEntries, detectTypedTables, type TypedTable } from './typed-tables';

export interface Civ6PlayerState {
    /** Civ6 player id — the `ownerId` on tiles, cities and units. */
    playerIndex: number;
    /** The player's id (slot): the object order is 0–9, 62, 63, then 10+ on a game with more than ten slots. */
    playerId: number;
    /** `TECH_*` completed. */
    techsResearched: string[];
    /** `TECH_*` with a eureka earned. */
    techsBoosted: string[];
    /** Science banked per `TECH_*`, in science points (the save stores 256ths). */
    techProgress: Record<string, number>;
    /** `TECH_*` being researched, if any. */
    currentResearch: string | null;
    civicsCompleted: string[];
    civicsInspired: string[];
    civicProgress: Record<string, number>;
    currentCivic: string | null;
    /** `GOVERNMENT_*` in place. */
    government: string | null;
    /** `POLICY_*` slotted now, in slot order, with the slot index the save gives each. */
    policiesSlotted: Array<{ policy: string; slot: number }>;
    /** Every `POLICY_*` the player has had slotted at some point (the legacy set). */
    policiesEverSlotted: string[];
    /** Per-turn yields (`YIELD_FOOD`, …) in points. */
    yields: Record<string, number>;
    /** Units trained so far by `UNIT_*` (at training time — an upgraded Slinger still counts as one). */
    unitsTrained: Record<string, number>;
    /** Treasury, in gold (the save stores 256ths). */
    gold: number;
    /** Net gold per turn as of the last turn processed. */
    goldPerTurn: number;
    /** Faith banked, or null when the religion record was not found. */
    faith: number | null;
    /** `BELIEF_*` chosen as the pantheon, or null. */
    pantheon: string | null;
    /** Era score (Rise & Fall), from the REPLAYDATASET_ERASCORE graph; null without it. */
    eraScore: number | null;
    /**
     * `RESOURCE_*` → amount held: strategic stockpiles (Gathering Storm) and copies of bonus and
     * luxury resources, from the pre-tech list of `hash, 3, amount, 0, 0` entries (lab7-4: iron
     * 13 and horses 13 the lab granted, niter 5, as the oracle's `GetResourceAmount`). The per-turn
     * strategic accumulation is the second `RESOURCE s8` table of the object (×256).
     */
    stockpiles: Record<string, number>;
    /**
     * The religion this player founded (turn-125 save: Phoenicia's "crab", RELIGION_CUSTOM_1,
     * founded turn 70 in Tyre with Jesuit Education and Synagogue; lab9-6: Macedon's Catholicism
     * in Pella with Choral Music and Wat — a standard religion has no custom name), from the record
     * `RELIGION hash, 0, turn, holyX, holyY, [len] name, nBeliefs, BELIEF…` at the head of the
     * player object; null when none.
     */
    religionFounded: { religion: string; name: string; foundedTurn: number; holyCity: { x: number; y: number }; beliefs: string[] } | null;
    /** Tribal-village rewards received, by `GOODY_HUT_*` type (the first such table of the object). */
    goodyHutsReceived: Record<string, number>;
    /** `CONTINENT_*` the player has a presence on (the `CONTINENT s5` flags after its units). */
    continents: string[];
    /**
     * Diplomatic favor (Gathering Storm): `12, favor, earned, spent, 0, 0, 0` right
     * before the `6, MINOR_CIV_BONUS…` list at the head of the player object (late-a-1: Mapuche
     * 223 as the oracle says, 1253 earned, 424 spent; vis-a-1's Macedon 93/93/0). Null without it.
     */
    favor: { favor: number; earned: number; spent: number } | null;
    /** `GOVERNMENT_*` unlocked (the `GOVERNMENT s8` flags before the policy tables). */
    governmentsUnlocked: string[];
    /** Natural wonders the player has found: the `FEATURE s5` flags just before the continent flags. */
    naturalWondersFound: string[];
    /**
     * `UNIT_*` types of other players the player has seen — the `UNIT s5` flags before the
     * natural-wonder flags.
     */
    unitTypesSeen: string[];
    /** Payload offset of the researched-techs table, the object's anchor. */
    payloadOffset: number;
}

const TECH_COUNT = 77;
/** Treasury and gold per turn: 24 and 32 bytes past the end of the three tech tables. */
const GOLD_OFFSET = 1410;
const GOLD_PER_TURN_OFFSET = 1418;
/** How far ahead of the `PROMOTION_CLASS` table the religion record can sit. */
const RELIGION_SCAN = 65536;

function lastBefore(tables: TypedTable[], index: number, match: (t: TypedTable) => boolean, maxBack = 40): TypedTable | undefined {
    for (let i = index - 1; i >= Math.max(0, index - maxBack); i--) {
        if (match(tables[i]!)) return tables[i];
    }
    return undefined;
}

function typeAt(payload: Buffer, at: number, kind: string): string | null {
    if (at < 0 || at + 4 > payload.length) return null;
    const type = resolveTypeHash(payload.readUInt32LE(at));
    return type && type.kind === kind ? type.name : null;
}

/** The first hash of `kind` scanning byte by byte from `from` (inclusive) towards `to`. */
function scanForType(payload: Buffer, from: number, to: number, kind: string): string | null {
    const step = to >= from ? 1 : -1;
    for (let o = from; step > 0 ? o <= to : o >= to; o += step) {
        const name = typeAt(payload, o, kind);
        if (name) return name;
    }
    return null;
}

/**
 * `{POLICY_*, slot}` pairs that end within 64 bytes before `end`, read backwards while they keep
 * being policies (the list sits 28 bytes ahead of the completed-civics table on the PYDT save).
 */
function slottedPolicies(payload: Buffer, end: number): Array<{ policy: string; slot: number }> {
    let last = -1;
    for (let o = end - 8; o >= end - 64 && o >= 0; o--) {
        if (typeAt(payload, o, 'KIND_POLICY')) { last = o; break; }
    }
    const out: Array<{ policy: string; slot: number }> = [];
    for (let o = last; o >= 0; o -= 8) {
        const policy = typeAt(payload, o, 'KIND_POLICY');
        if (!policy) break;
        const slot = payload.readInt32LE(o + 4);
        if (slot < 0 || slot > 15) break;
        out.unshift({ policy, slot });
    }
    return out;
}

/**
 * `20, faith×256, 0, pantheon, n, x, y` scanning back from `end`: the pantheon is a `BELIEF_*`
 * hash or -1 before one is chosen; the plot is (-9999, -9999) for most players and a real tile
 * for some (Australia's on the PYDT save), so it is not part of the anchor.
 */
function religionRecord(payload: Buffer, end: number): { faith: number; pantheon: string | null } | null {
    for (let o = end - 4; o >= Math.max(12, end - RELIGION_SCAN); o--) {
        const belief = payload.readInt32LE(o);
        if (belief !== -1 && !typeAt(payload, o, 'KIND_BELIEF')) continue;
        if (payload.readInt32LE(o - 4) !== 0 || payload.readInt32LE(o - 12) !== 20) continue;
        const faith = payload.readInt32LE(o - 8);
        if (faith < 0 || faith > 1_000_000 * 256) continue;
        return { faith: faith / 256, pantheon: belief === -1 ? null : typeAt(payload, o, 'KIND_BELIEF') };
    }
    return null;
}

/** A held amount past this is a misread entry (one 65536 on the PYDT save), not a stock. */
const MAX_STOCK = 10_000;

/**
 * The first run of `RESOURCE hash, 3, amount, 0, 0` entries in `[from, to)`, amounts by name:
 * what `GetResourceAmount` reports for every resource — strategic stockpiles, and for bonus and
 * luxury resources the copies held (the oracle says Maize 1 for a city-state with one Maize).
 */
function readStockpiles(payload: Buffer, from: number, to: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (let o = from; o + 20 <= to; o++) {
        if (payload.readInt32LE(o + 4) !== 3 || payload.readInt32LE(o + 12) !== 0 || payload.readInt32LE(o + 16) !== 0) continue;
        if (!typeAt(payload, o, 'KIND_RESOURCE')) continue;
        let n = 0;
        for (let e = o; e + 20 <= to; e += 20) {
            const name = typeAt(payload, e, 'KIND_RESOURCE');
            if (!name || payload.readInt32LE(e + 4) !== 3) break;
            const amount = payload.readInt32LE(e + 8);
            if (amount > 0 && amount < MAX_STOCK) out[name] = amount;
            n++;
        }
        if (n >= 4) return out;
    }
    return out;
}

function readReligionFounded(payload: Buffer, from: number, to: number): Civ6PlayerState['religionFounded'] {
    for (let o = from; o + 28 <= to; o++) {
        const religion = typeAt(payload, o, 'KIND_RELIGION');
        if (!religion || payload.readInt32LE(o + 4) !== 0) continue;
        const turn = payload.readInt32LE(o + 8);
        const len = payload.readUInt32LE(o + 20);
        // A standard religion carries no custom name (len 0); a custom one its name.
        if (turn < 1 || turn > 5000 || len > 64 || o + 24 + len + 4 > to) continue;
        const name = payload.subarray(o + 24, o + 24 + len).toString('utf8');
        let at = o + 24 + len;
        const count = payload.readUInt32LE(at);
        if (count > 8) continue;
        at += 4;
        const beliefs: string[] = [];
        for (let k = 0; k < count; k++, at += 4) {
            const belief = typeAt(payload, at, 'KIND_BELIEF');
            if (!belief) break;
            beliefs.push(belief);
        }
        if (beliefs.length !== count) continue;
        return { religion, name: name || religion.replace(/^RELIGION_/, ''), foundedTurn: turn, holyCity: { x: payload.readInt32LE(o + 12), y: payload.readInt32LE(o + 16) }, beliefs };
    }
    return null;
}

const names = (t: TypedTable | undefined) => (t ? activeEntries(t).map(e => e.name) : []);
const scaled = (t: TypedTable | undefined, scale: number) =>
    Object.fromEntries((t ? activeEntries(t) : []).map(e => [e.name, e.int / scale]));

/**
 * Every player object, in player-id order. `tables` may be passed in when the caller already
 * ran the census (it is the expensive step); otherwise it is computed here.
 */
export function parsePlayerStates(payload: Buffer, tables?: TypedTable[]): Civ6PlayerState[] {
    const all = tables ?? detectTypedTables(payload, { minEntries: 4 });
    const players: Civ6PlayerState[] = [];
    for (let i = 0; i < all.length; i++) {
        const progress = all[i]!;
        if (progress.kind !== 'KIND_TECH' || progress.stride !== 8 || progress.entries.length !== TECH_COUNT) continue;
        const boosted = all[i - 1];
        const researched = all[i - 2];
        if (!researched || !boosted) continue;
        if (researched.kind !== 'KIND_TECH' || researched.stride !== 5 || boosted.kind !== 'KIND_TECH' || boosted.stride !== 5) continue;

        const yields = lastBefore(all, i - 2, t => t.kind === 'KIND_YIELD' && t.stride === 8, 6);
        const unitsTrained = lastBefore(all, i - 2, t => t.kind === 'KIND_UNIT' && t.stride === 8 && t.entries.length > 100, 8);
        const civicProgress = lastBefore(all, i - 2, t => t.kind === 'KIND_CIVIC' && t.stride === 8);
        const civicIndex = civicProgress ? all.indexOf(civicProgress) : -1;
        const civicsInspired = civicIndex > 1 ? all[civicIndex - 1] : undefined;
        const civicsCompleted = civicIndex > 1 ? all[civicIndex - 2] : undefined;
        const civicsOk = civicsCompleted?.kind === 'KIND_CIVIC' && civicsCompleted.stride === 5
            && civicsInspired?.kind === 'KIND_CIVIC' && civicsInspired.stride === 5;
        // Between the five flag tables and the civics sits the slotted list `{POLICY, slot}`; with
        // six or more slots (Monarchy on the turn-125 save) the census sees it as a `POLICY s8`
        // table, with fewer it is read by hand below.
        const policyTables: TypedTable[] = [];
        let slottedTable: TypedTable | undefined;
        if (civicIndex > 1) {
            for (let j = civicIndex - 3; j >= 0 && policyTables.length < 5; j--) {
                const t = all[j]!;
                if (t.kind === 'KIND_POLICY' && t.stride === 5) policyTables.unshift(t);
                else if (t.kind === 'KIND_POLICY' && t.stride === 8 && policyTables.length === 0 && !slottedTable) slottedTable = t;
                else break;
            }
        }
        const everSlotted = policyTables.length === 5 ? policyTables[2] : undefined;
        // The government tables (s5 then s8) precede the policy tables; the lone current-government
        // hash sits just ahead of the first of them.
        const governmentS8 = policyTables[0] ? lastBefore(all, all.indexOf(policyTables[0]!), t => t.kind === 'KIND_GOVERNMENT' && t.stride === 8, 3) : undefined;
        const governmentS5 = governmentS8 ? lastBefore(all, all.indexOf(governmentS8), t => t.kind === 'KIND_GOVERNMENT' && t.stride === 5, 2) : undefined;
        const firstGovernment = governmentS5 ?? governmentS8;
        const government = firstGovernment ? scanForType(payload, firstGovernment.start - 4, firstGovernment.start - 64, 'KIND_GOVERNMENT') : null;
        const civicEnd = civicProgress ? civicProgress.start + civicProgress.stride * civicProgress.entries.length : 0;
        const promotionClasses = lastBefore(all, i - 2, t => t.kind === 'KIND_PROMOTION_CLASS' && t.stride === 8, 40);
        const religion = promotionClasses ? religionRecord(payload, promotionClasses.start) : null;

        // The object's own goody-hut ledger opens it (before the cities); the continent flags
        // follow the units, so they are the first such table after this tech block.
        const prevTech = players.length > 0 ? players[players.length - 1]!.payloadOffset : 0;
        const goody = all.find(t => t.kind === 'KIND_GOODY_HUT' && t.stride === 8 && t.start > prevTech && t.start < researched.start);
        const stockpiles = readStockpiles(payload, prevTech, researched.start);
        const religionFounded = readReligionFounded(payload, prevTech, researched.start);
        let favor: Civ6PlayerState['favor'] = null;
        if (goody) {
            for (let o = goody.start; o + 36 <= researched.start && o < goody.start + 2048; o++) {
                if (payload.readInt32LE(o) !== 6 || typeAt(payload, o + 4, 'KIND_MINORCIVBONUS') === null || payload.readInt32LE(o - 28) !== 12) continue;
                favor = { favor: payload.readInt32LE(o - 24), earned: payload.readInt32LE(o - 20), spent: payload.readInt32LE(o - 16) };
                break;
            }
        }
        const continents = all.find(t => t.kind === 'KIND_CONTINENT' && t.stride === 5 && t.start > progress.start);
        const continentsIndex = continents ? all.indexOf(continents) : -1;
        const naturalWonders = continents ? lastBefore(all, continentsIndex, t => t.kind === 'KIND_FEATURE' && t.stride === 5, 3) : undefined;
        const unitTypesSeen = naturalWonders ? lastBefore(all, all.indexOf(naturalWonders), t => t.kind === 'KIND_UNIT' && t.stride === 5, 3) : undefined;

        players.push({
            playerIndex: players.length,
            playerId: players.length,
            techsResearched: names(researched),
            techsBoosted: names(boosted),
            techProgress: scaled(progress, 256),
            currentResearch: typeAt(payload, researched.start - 20, 'KIND_TECH'),
            civicsCompleted: civicsOk ? names(civicsCompleted) : [],
            civicsInspired: civicsOk ? names(civicsInspired) : [],
            civicProgress: civicsOk ? scaled(civicProgress, 256) : {},
            currentCivic: civicsOk ? scanForType(payload, civicEnd, civicEnd + 16, 'KIND_CIVIC') : null,
            government,
            // A card never slotted cannot be slotted now: an empty legacy set (city-states) means
            // whatever the backwards scan found ahead of the table is not a slot list.
            policiesSlotted: slottedTable
                ? slottedTable.entries.filter(e => e.int >= 0 && e.int <= 15).map(e => ({ policy: e.name, slot: e.int }))
                : civicsOk && civicsCompleted && names(everSlotted).length > 0 ? slottedPolicies(payload, civicsCompleted.start) : [],
            policiesEverSlotted: names(everSlotted),
            yields: scaled(yields, 256),
            unitsTrained: scaled(unitsTrained, 1),
            gold: payload.readInt32LE(researched.start + GOLD_OFFSET) / 256,
            goldPerTurn: payload.readInt32LE(researched.start + GOLD_PER_TURN_OFFSET) / 256,
            faith: religion?.faith ?? null,
            pantheon: religion?.pantheon ?? null,
            eraScore: null,
            stockpiles,
            religionFounded,
            goodyHutsReceived: scaled(goody, 1),
            favor,
            continents: names(continents),
            governmentsUnlocked: names(governmentS8),
            naturalWondersFound: names(naturalWonders),
            unitTypesSeen: names(unitTypesSeen),
            payloadOffset: researched.start,
        });
    }
    return players;
}
