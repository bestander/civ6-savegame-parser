import { existsSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { join } from 'path';
import { decompressCiv6Payload, parseCiv6Save } from '../src/internal/index';
import { readOracleDump } from '../src/internal/oracle';

/**
 * The fixture saves are captures made with the oracle mod (each carries its own ground truth)
 * plus a few plain saves. They live in test/fixtures (gitignored — see the README on how to get
 * them); a test whose fixture is missing is skipped.
 */
const FIXTURES = process.env.CIV6_FIXTURES ?? join(__dirname, 'fixtures');
const fixture = (name: string) => join(FIXTURES, `${name}.Civ6Save`);
const ALEXANDER_SAVE = fixture('alexander-turn-1');
const PYDT_SAVE = fixture('pydt-turn-54');
/** Hotseat turn 15 saved with the oracle mod: the save carries its own ground truth. */
const ORACLE_SAVE = fixture('oracle-8');

function loadSave(path: string): Buffer | null {
    if (!existsSync(path)) return null;
    return readFileSync(path);
}

describe('civ6save parser', () => {
    it('parses Alexander turn-2 spike save (map, cities, unit positions)', () => {
        const buf = loadSave(ALEXANDER_SAVE);
        if (!buf) return;

        const parsed = parseCiv6Save(buf);

        expect(parsed.metadata.turn).toBe(2);
        expect(parsed.metadata.mapSize).toMatch(/SMALL|TINY/i);
        expect(parsed.players.fullCivs).toHaveLength(2);
        expect(parsed.players.fullCivs.map(p => p.leader).sort()).toEqual(
            ['LEADER_ALEXANDER', 'LEADER_SALADIN'].sort(),
        );

        expect(parsed.map.tileCount).toBe(2280);
        expect(parsed.map.width).toBe(60);
        expect(parsed.map.height).toBe(38);
        expect(parsed.map.resyncCount).toBe(0);
        expect(parsed.map.tileSectionEnd).toBeGreaterThan(parsed.map.tileSectionStart);

        const owned = parsed.map.tiles.filter(t => t.ownership);
        expect(owned).toHaveLength(56);

        const unitTiles = parsed.unitStacks;
        expect(unitTiles).toHaveLength(16);
        expect(unitTiles.reduce((n, s) => n + s.count, 0)).toBe(16);

        expect(parsed.cities).toHaveLength(8);
        expect(parsed.cities.every(c => c.center)).toBe(true);

        const huts = parsed.map.tiles.filter(t => t.improvement === 'Tribal Village');
        expect(huts).toHaveLength(18);

        expect(parsed.unmapped.notDecoded.length).toBeGreaterThan(0);
        expect(parsed.unmapped.hashes.terrain).toHaveLength(0);

        expect(parsed.units.length).toBeGreaterThan(0);
        expect(parsed.units.some(u => u.typeName === 'UNIT_WARRIOR')).toBe(true);
    });

    it('parses PYDT mid-game save (turn 54, districts, city yields)', () => {
        const buf = loadSave(PYDT_SAVE);
        if (!buf) return;

        const parsed = parseCiv6Save(buf);

        expect(parsed.metadata.turn).toBe(54);
        expect(parsed.metadata.gameSpeed).toBe('GAMESPEED_STANDARD');
        expect(parsed.players.fullCivs).toHaveLength(6);
        expect(parsed.players.fullCivs.some(p => p.isCurrentTurn && p.leader === 'LEADER_JADWIGA')).toBe(true);

        expect(parsed.map.tileCount).toBe(3404);
        expect(parsed.map.width).toBe(74);
        expect(parsed.map.resyncCount).toBe(0);

        expect(parsed.cities.length).toBeGreaterThanOrEqual(20);
        const withHistory = parsed.cities.filter(c => c.history.some(h => h.category === 'building'));
        expect(withHistory.length).toBeGreaterThan(0);

        const holySites = parsed.cities.flatMap(c => c.history.filter(h => h.typeName === 'DISTRICT_HOLY_SITE'));
        expect(holySites.length).toBeGreaterThan(0);

        expect(parsed.cityYieldTimelines.length).toBeGreaterThan(0);
        const withPop = parsed.cityYieldTimelines.filter(y => (y.population ?? 0) > 0);
        expect(withPop.length).toBeGreaterThan(0);

        expect(parsed.unitStacks.length).toBeGreaterThan(50);
        expect(parsed.locCityNames.length).toBeGreaterThan(0);
        expect(parsed.units.length).toBeGreaterThan(20);
        expect(parsed.units.some(u => u.typeName === 'UNIT_WARRIOR')).toBe(true);
        expect(parsed.asciiHints.modifiers.length).toBeGreaterThan(0);
    });

    it('rejects non-Civ6 buffers', () => {
        expect(() => parseCiv6Save(Buffer.from('NOTCIV6'))).toThrow(/Not a Civilization 6 save/i);
    });
});

describe('civ6 type hashes', () => {
    it('is CRC-32 of the type name without the final complement', async () => {
        const { civ6Hash, resolveTypeHash, resolveInstanceType, hashHex } = await import('../src/internal/hash-tables');
        // From the pairwise RE (instance records, stored straight).
        expect(hashHex(civ6Hash('UNIT_WARRIOR'))).toBe('e9b57b30');
        expect(hashHex(civ6Hash('UNIT_SCOUT'))).toBe('6f961899');
        expect(hashHex(civ6Hash('UNIT_BUILDER'))).toBe('11d57532');
        expect(hashHex(civ6Hash('BUILDING_MONUMENT'))).toBe('874bf3a0');
        // From the Data Sheet (tile fields, stored byte-swapped).
        expect(resolveTypeHash(0x30c6e783)).toEqual({ name: 'TERRAIN_GRASS', kind: 'KIND_TERRAIN' });
        expect(resolveTypeHash(0x0a0929b1)).toEqual({ name: 'IMPROVEMENT_FARM', kind: 'KIND_IMPROVEMENT' });
        // The unit hashes the PYDT save left unmapped before the formula was known.
        expect(['2b175344', '2e57ead3', '3a8b634d', '5ceac7c9', '8ac232c5'].map(h => resolveInstanceType(parseInt(h, 16))))
            .toEqual(['UNIT_GALLEY', 'UNIT_SPEARMAN', 'UNIT_HEAVY_CHARIOT', 'UNIT_SLINGER', 'UNIT_QUADRIREME']);
        expect(resolveTypeHash(0xffffffff)).toBeNull();
        expect(resolveTypeHash(civ6Hash('NOT_A_TYPE'))).toBeNull();
    });

    it('leaves no unit type unmapped in the PYDT save', () => {
        const buf = loadSave(PYDT_SAVE);
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        expect(parsed.unmapped.hashes.instanceTypes).toEqual([]);
        expect(parsed.units.every(u => u.typeName)).toBe(true);
        expect(new Set(parsed.units.map(u => u.typeName))).toContain('UNIT_SLINGER');
    });
});

describe('typed tables', () => {
    it('finds runs of same-kind hashes at one stride and reads their values', async () => {
        const { civ6Hash } = await import('../src/internal/hash-tables');
        const { detectTypedTables, activeEntries } = await import('../src/internal/typed-tables');
        const buf = Buffer.alloc(200, 0xaa);
        // A promotions table: {hash, u8} × 4, with RANGER set.
        const promos = ['PROMOTION_RANGER', 'PROMOTION_ALPINE', 'PROMOTION_SENTRY', 'PROMOTION_GUERRILLA'];
        promos.forEach((p, i) => { buf.writeUInt32LE(civ6Hash(p), 10 + i * 5); buf.writeUInt8(p === 'PROMOTION_RANGER' ? 1 : 0, 14 + i * 5); });
        // A tech progress table: {hash, u32} × 3.
        const techs = ['TECH_POTTERY', 'TECH_MINING', 'TECH_SAILING'];
        techs.forEach((t, i) => { buf.writeUInt32LE(civ6Hash(t), 60 + i * 8); buf.writeUInt32LE(t === 'TECH_SAILING' ? 6810 : 0, 64 + i * 8); });
        const tables = detectTypedTables(buf);
        expect(tables.map(t => [t.kind, t.start, t.stride, t.entries.length])).toEqual([
            ['KIND_PROMOTION', 10, 5, 4],
            ['KIND_TECH', 60, 8, 3],
        ]);
        expect(activeEntries(tables[0]!)).toEqual([{ name: 'PROMOTION_RANGER', int: 1 }]);
        expect(activeEntries(tables[1]!)).toEqual([{ name: 'TECH_SAILING', int: 6810 }]);
        expect(detectTypedTables(buf, { kinds: new Set(['KIND_TECH']) })).toHaveLength(1);
    });

    it('sees the unit objects and per-player tech tables of the PYDT save', async () => {
        const buf = loadSave(PYDT_SAVE);
        if (!buf) return;
        const { decompressCiv6Payload } = await import('../src/internal/index');
        const { detectTypedTables, activeEntries } = await import('../src/internal/typed-tables');
        const tables = detectTypedTables(decompressCiv6Payload(buf), { minEntries: 4 });
        const promotionTables = tables.filter(t => t.kind === 'KIND_PROMOTION' && t.stride === 5);
        expect(promotionTables.length).toBeGreaterThanOrEqual(100);
        const techFlags = tables.filter(t => t.kind === 'KIND_TECH' && t.stride === 5 && activeEntries(t).length > 0);
        expect(techFlags.length).toBeGreaterThan(0);
        expect(activeEntries(techFlags[0]!).map(e => e.name)).toContain('TECH_POTTERY');
        const techProgress = tables.find(t => t.kind === 'KIND_TECH' && t.stride === 8 && activeEntries(t).length > 0)!;
        expect(techProgress).toBeDefined();
        // Progress is stored in 256ths; every non-zero value is a plausible science total.
        for (const e of activeEntries(techProgress)) expect(e.int / 256).toBeLessThan(2000);
    });
});

describe('player states', () => {
    it('reads techs, civics, government, policies and yields per player in the PYDT save', () => {
        const buf = loadSave(PYDT_SAVE);
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        // 6 civs + 9 active city-states + free cities + barbarians.
        expect(parsed.playerStates).toHaveLength(17);
        const greece = parsed.playerStates[0]!;
        expect(greece.techsResearched).toEqual(['TECH_POTTERY', 'TECH_ANIMAL_HUSBANDRY', 'TECH_MINING', 'TECH_ASTROLOGY', 'TECH_BRONZE_WORKING']);
        expect(greece.currentResearch).toBe('TECH_SAILING');
        expect(greece.techProgress['TECH_SAILING']).toBeCloseTo(6810 / 256, 3);
        expect(greece.techsBoosted).toContain('TECH_SAILING');
        expect(greece.civicsCompleted).toEqual(['CIVIC_CODE_OF_LAWS', 'CIVIC_MILITARY_TRADITION', 'CIVIC_STATE_WORKFORCE', 'CIVIC_EARLY_EMPIRE', 'CIVIC_MYSTICISM']);
        expect(greece.currentCivic).toBe('CIVIC_FOREIGN_TRADE');
        expect(greece.civicProgress['CIVIC_FOREIGN_TRADE']).toBeGreaterThan(30);
        expect(greece.government).toBe('GOVERNMENT_CHIEFDOM');
        // Greece has Chiefdom's two slots plus its own wildcard.
        expect(greece.policiesSlotted).toEqual([
            { policy: 'POLICY_DISCIPLINE', slot: 1 }, { policy: 'POLICY_URBAN_PLANNING', slot: 0 }, { policy: 'POLICY_COLONIZATION', slot: 4 },
        ]);
        expect(greece.policiesEverSlotted).toContain('POLICY_GOD_KING');
        expect(greece.unitsTrained).toMatchObject({ UNIT_SETTLER: 2, UNIT_SCOUT: 3 });
        // Ottoman (seat 5) per-turn yields as Player_Stats.csv logged them for this turn.
        const ottoman = parsed.playerStates[5]!;
        expect(Math.round(ottoman.yields['YIELD_FOOD']!)).toBe(23);
        expect(Math.round(ottoman.yields['YIELD_PRODUCTION']!)).toBe(15);
        expect(Math.round(ottoman.yields['YIELD_GOLD']!)).toBe(7);
        expect(Math.round(ottoman.yields['YIELD_FAITH']!)).toBe(1);
        expect(ottoman.policiesSlotted.map(p => p.policy)).toEqual(['POLICY_DISCIPLINE', 'POLICY_GOD_KING']);
        // Every civ is under a government with a research and a civic in progress; city-states slot nothing.
        for (const p of parsed.playerStates.slice(0, 6)) {
            expect(p.government).toBe('GOVERNMENT_CHIEFDOM');
            expect(p.currentResearch).toMatch(/^TECH_/);
            expect(p.currentCivic).toMatch(/^CIVIC_/);
            expect(p.policiesSlotted.length).toBeGreaterThanOrEqual(2);
        }
        for (const p of parsed.playerStates.slice(6, 15)) expect(p.policiesSlotted).toEqual([]);
    });
});

describe('city objects', () => {
    it('names every city, puts its centre on its first district, and reads production and buildings', () => {
        const buf = loadSave(PYDT_SAVE);
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        expect(parsed.cities).toHaveLength(25);
        expect(parsed.cities.every(c => c.name)).toBe(true);
        const byName = new Map(parsed.cities.map(c => [c.name, c]));
        const sparta = byName.get('SPARTA')!;
        expect(sparta).toMatchObject({ ownerId: 0, cityIndex: 0, center: { x: 54, y: 24 }, currentProduction: 'UNIT_SETTLER', buildings: ['BUILDING_PALACE'] });
        expect(sparta.productionProgress).toEqual({ UNIT_SETTLER: 75, UNIT_BUILDER: 9 });
        expect(sparta.productionQueue).toEqual(['BUILDING_SHRINE', 'BUILDING_AMPHITHEATER']);
        // Ephesus is not the first tile of its group: the centre is the first district instance.
        const ephesus = byName.get('EPHESUS')!;
        expect(ephesus).toMatchObject({ ownerId: 0, cityIndex: 1, center: { x: 60, y: 22 }, currentProduction: 'DISTRICT_HOLY_SITE', productionPlot: { x: 59, y: 22 } });
        expect(ephesus.productionProgress['DISTRICT_HOLY_SITE']).toBeCloseTo(62.1, 0);
        const krakow = byName.get('KRAKOW')!;
        expect(krakow).toMatchObject({ ownerId: 2, currentProduction: 'UNIT_BUILDER', buildings: ['BUILDING_MONUMENT', 'BUILDING_PALACE', 'BUILDING_GRANARY'] });
        // Stonehenge stands on its own wonder tile inside Canberra's territory.
        expect(byName.get('CANBERRA')!.buildings).toEqual(['BUILDING_PALACE', 'BUILDING_STONEHENGE']);
        // Every capital has a Palace, and only capitals do.
        for (const c of parsed.cities) expect(c.buildings.includes('BUILDING_PALACE')).toBe(c.cityIndex === 0);
        // A city-state builds too.
        expect(byName.get('BRUSSELS')!.productionProgress).toEqual({ BUILDING_GRANARY: 44 });
    });
});

describe('treasury, faith, pantheon, population and food', () => {
    it('matches the oracle dump inside a save made with the mod', () => {
        const buf = loadSave(ORACLE_SAVE);
        if (!buf) return;
        const oracle = readOracleDump(decompressCiv6Payload(buf));
        expect(oracle).not.toBeNull();
        expect(oracle!.turn).toBe(15);
        const parsed = parseCiv6Save(buf);
        expect(parsed.metadata.turn).toBe(15);
        let compared = 0;
        for (const op of oracle!.players) {
            const ps = parsed.playerStates[op.id]!;
            expect(ps.gold).toBe(op.gold);
            expect(ps.goldPerTurn).toBe(op.goldPerTurn);
            expect(ps.faith).toBe(op.faith);
            for (const oc of op.cities) {
                const city = parsed.cities.find(c => c.ownerId === op.id && oc.name === `LOC_CITY_NAME_${c.name}`)!;
                expect(city.population).toBe(oc.population);
                expect(city.food).toBe(oc.food);
                expect(city.center).toEqual({ x: oc.x, y: oc.y });
                compared++;
            }
        }
        expect(compared).toBe(8);
        for (const op of oracle!.players) if (op.eraScore != null) expect(parsed.playerStates[op.id]!.eraScore).toBe(op.eraScore);
        // The hall-of-fame graphs: score per turn ends on the oracle's score, in game units.
        const last = (name: string, player: number) => { const pts = parsed.graphs[name]![player]!; return pts[pts.length - 1]!; };
        expect(last('SCOREPERTURN', 0)).toEqual({ turn: 15, value: oracle!.players[0]!.score });
        expect(last('SCOREPERTURN', 1).value).toBe(oracle!.players[1]!.score);
        expect(Object.keys(parsed.graphs).sort()).toContain('TOTALCOMBATS');
        expect(parsed.graphs['TOTALUNITSDESTROYED']![1]).toEqual([{ turn: expect.any(Number), value: 1 }]);
        // Macedon at turn 15: no pantheon yet, 5.7 faith banked.
        expect(parsed.playerStates[0]).toMatchObject({ gold: 97.70703125, faith: 5.70703125, pantheon: null });
    });

    it('reads each unit\'s own id, as the game reports it', () => {
        const buf = loadSave(ORACLE_SAVE);
        if (!buf) return;
        const payload = decompressCiv6Payload(buf);
        const oracle = readOracleDump(payload)!;
        const parsed = parseCiv6Save(buf);

        // Every unit the mod listed is in the save under the same id, on the same plot.
        let compared = 0;
        for (const op of oracle.players) {
            for (const ou of op.units) {
                const unit = parsed.units.find(u => u.ownerId === op.id && u.id === ou.id);
                expect(unit, `unit ${ou.id} of player ${op.id}`).toBeDefined();
                expect({ x: unit!.x, y: unit!.y }).toEqual({ x: ou.x, y: ou.y });
                compared++;
            }
        }
        expect(compared).toBeGreaterThan(20);

        // Packed `(generation << 16) | index`: unique per owner, never zero.
        const keys = parsed.units.filter(u => u.id !== undefined).map(u => `${u.ownerId}:${u.id}`);
        expect(new Set(keys).size).toBe(keys.length);
        expect(parsed.units.every(u => u.id === undefined || u.id > 0)).toBe(true);
    });

    it('keeps a unit\'s id across turns, through moves', () => {
        const before = loadSave(fixture('duel-turn-125'));
        const after = loadSave(fixture('duel-turn-126'));
        if (!before || !after) return;
        const a = parseCiv6Save(before).units, b = parseCiv6Save(after).units;
        const byId = new Map(a.filter(u => u.id !== undefined).map(u => [`${u.ownerId}:${u.id}`, u]));
        let matched = 0, moved = 0;
        for (const u of b) {
            const prev = u.id === undefined ? undefined : byId.get(`${u.ownerId}:${u.id}`);
            if (!prev) continue;
            // An id is only reused once its unit is gone, so a match is the same unit.
            expect(prev.typeName).toBe(u.typeName);
            matched++;
            if (prev.x !== u.x || prev.y !== u.y) moved++;
        }
        expect(matched).toBeGreaterThan(10);
        expect(moved).toBeGreaterThan(0);
    });

    it('reads them for every player and city of the PYDT save', () => {
        const buf = loadSave(PYDT_SAVE);
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        const majors = parsed.playerStates.slice(0, 6);
        expect(majors.map(p => p.gold)).toEqual([65.90234375, 40, 96, 54.6328125, 106, 96.90234375]);
        expect(majors.map(p => p.faith)).toEqual([157, 126.9765625, 45, 0, 119, 2]);
        expect(majors.map(p => p.eraScore)).toEqual([26, 25, 18, 11, 30, 8]);
        // Tribal villages by reward type: Australia found seven.
        expect(majors[4]!.goodyHutsReceived).toEqual({ GOODYHUT_CULTURE: 1, GOODYHUT_GOLD: 2, GOODYHUT_FAITH: 1, GOODYHUT_MILITARY: 1, GOODYHUT_SCIENCE: 1, GOODYHUT_SURVIVORS: 1, GOODYHUT_DIPLOMACY: 1 });
        expect(majors[0]!.continents).toEqual(['CONTINENT_ASIA']);
        expect(majors.map(p => p.pantheon)).toEqual([
            'BELIEF_SACRED_PATH', 'BELIEF_DESERT_FOLKLORE', 'BELIEF_GOD_OF_CRAFTSMEN', 'BELIEF_GOD_OF_THE_SEA', 'BELIEF_RELIGIOUS_SETTLEMENTS', null,
        ]);
        // Every player has a religion record, even the ones with nothing in it.
        expect(parsed.playerStates.every(p => p.faith !== null)).toBe(true);
        expect(parsed.cities.every(c => c.population !== null && c.population >= 1)).toBe(true);
        const byName = new Map(parsed.cities.map(c => [c.name, c]));
        expect(byName.get('SPARTA')).toMatchObject({ population: 4, food: 14, originalOwnerId: 0 });
        expect(byName.get('KRAKOW')).toMatchObject({ population: 3, food: 30 });
        expect(parsed.cities.every(c => c.food !== null && c.food >= 0 && c.food < 200)).toBe(true);
        expect(byName.get('RIO_DE_JANEIRO')).toMatchObject({ population: 5, originalOwnerId: 3 });
        expect(byName.get('ADANA')).toMatchObject({ population: 1, originalOwnerId: 5 });
        expect(parsed.warnings).not.toContainEqual(expect.stringContaining('header not found'));
    });
});

describe('lab scenarios: wonders, damage, corps, war', () => {
    /** Turn 16 of the hotseat game after the lab mod applied its scenarios, with the oracle dump inside. */
    const LAB_SAVE = fixture('lab-4');

    it('reads the manufactured state the oracle confirms', () => {
        const buf = loadSave(LAB_SAVE);
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        const oracle = readOracleDump(decompressCiv6Payload(buf))!;
        const byName = new Map(parsed.cities.map(c => [c.name, c]));
        // Stonehenge stands, the Pyramids are 40% along on their own wonder plot.
        const pella = byName.get('PELLA')!;
        expect(pella.buildings).toContain('BUILDING_STONEHENGE');
        expect(pella.buildings).not.toContain('BUILDING_PYRAMIDS');
        expect(pella.productionProgress['BUILDING_PYRAMIDS']).toBeGreaterThan(0);
        expect(pella.districts.filter(d => d.type === 'DISTRICT_WONDER').map(d => `${d.x},${d.y}`).sort()).toEqual(['16,17', '18,17']);
        // Cairo's centre took 30 and healed to 10; the Scout carries 35 damage.
        expect(byName.get('CAIRO')!.districts.find(d => d.type === 'DISTRICT_CITY_CENTER')).toMatchObject({ damage: 10, wallsDamage: 0 });
        const scout = parsed.units.find(u => u.typeName === 'UNIT_SCOUT' && u.ownerId === 0)!;
        expect(scout).toMatchObject({ damageTaken: 35, hp: 65 });
        // The Warrior corps next to Cairo, and the Great Prophet Stonehenge spawned.
        expect(parsed.units.find(u => u.x === 40 && u.y === 22)).toMatchObject({ typeName: 'UNIT_WARRIOR', ownerId: 1, militaryFormation: 1 });
        expect(parsed.units.filter(u => u.militaryFormation > 0)).toHaveLength(1);
        expect(parsed.units.find(u => u.typeName === 'UNIT_GREAT_PROPHET')).toMatchObject({ ownerId: 0, x: 17, y: 17 });
        // Macedon and Arabia are at war, both ways; nobody else is (barbarians have no slot).
        const state = (a: number, b: number) => parsed.diplomacy[a]!.relations.find(r => r.other === b)!.state;
        expect(state(0, 1)).toBe('WAR');
        expect(state(1, 0)).toBe('WAR');
        expect(state(0, 6)).toBe('INFLUENTIAL');
        expect(state(6, 0)).toBe('PATRON');
        // Envoys: Macedon has one in Hong Kong and one in Geneva, seen from both sides.
        expect(parsed.diplomacy[0]!.envoys).toEqual({ 3: 1, 6: 1 });
        expect(parsed.diplomacy[6]!.envoys).toEqual({ 0: 1 });
        for (const op of oracle.players.filter(x => x.major)) expect(parsed.diplomacy[op.id]!.envoys).toEqual(Object.fromEntries(op.envoys.map(e => [e.cityState, e.envoys])));
        for (const op of oracle.players) {
            const wars = parsed.diplomacy[op.id]!.relations.filter(r => r.state === 'WAR').map(r => r.other);
            expect(wars).toEqual(op.diplomacy.filter(d => d.war && d.player < 62).map(d => d.player));
        }
        // Every unit the oracle lists is parsed with the same damage.
        for (const op of oracle.players) for (const ou of op.units) {
            const u = parsed.units.find(x => x.ownerId === op.id && x.x === ou.x && x.y === ou.y && x.typeName === ou.type);
            expect(u, `${ou.type} at ${ou.x},${ou.y}`).toBeDefined();
            expect(u!.damageTaken).toBe(ou.damage);
        }
    });

    it('reads a Trader on its route from the unit operation', () => {
        const buf = loadSave(fixture('route-6'));
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        const traders = parsed.units.filter(u => u.typeName === 'UNIT_TRADER');
        expect(traders).toHaveLength(2);
        // Pella's Trader is one tile out on a route to Bandar Brunei; Cairo's has no orders.
        expect(traders.find(u => u.ownerId === 0)).toMatchObject({ x: 18, y: 17, tradeRoute: { origin: { x: 17, y: 17 }, destination: { x: 23, y: 21 }, startedTurn: 17 } });
        expect(traders.find(u => u.ownerId === 1)!.tradeRoute).toBeUndefined();
        const pydt = loadSave(PYDT_SAVE);
        if (!pydt) return;
        const poland = parseCiv6Save(pydt).units.find(u => u.typeName === 'UNIT_TRADER')!;
        expect(poland).toMatchObject({ ownerId: 2, tradeRoute: { origin: { x: 20, y: 27 }, destination: { x: 16, y: 15 }, startedTurn: 51 } });
    });

    it('reads the war records: kinds and latest turns', () => {
        const a = loadSave(fixture('war-a-1')), b = loadSave(fixture('war-b-1'));
        if (!a || !b) return;
        // war-a-1: the lab declared two formal wars; war-b-1 added a third.
        expect(parseCiv6Save(a).wars.map(w => `${w.type}@${w.turn}`)).toEqual(['FORMAL_WAR@15', 'FORMAL_WAR@15']);
        expect(parseCiv6Save(b).wars.map(w => `${w.type}@${w.turn}`)).toEqual(['FORMAL_WAR@15', 'FORMAL_WAR@15', 'FORMAL_WAR@15']);
        const pydt = loadSave(PYDT_SAVE);
        if (pydt) expect(parseCiv6Save(pydt).wars.map(w => w.type)).toEqual(['SURPRISE_WAR', 'SURPRISE_WAR', 'SURPRISE_WAR', 'SURPRISE_WAR']);
    });

    it('reads the PYDT diplomacy as the 2v2v2 it was', () => {
        const buf = loadSave(PYDT_SAVE);
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        const state = (a: number, b: number) => parsed.diplomacy[a]!.relations.find(r => r.other === b)!.state;
        expect(state(0, 1)).toBe('ALLIED');
        expect(state(1, 0)).toBe('ALLIED');
        expect(state(2, 4)).toBe('ALLIED');
        expect(state(3, 5)).toBe('ALLIED');
        expect(state(0, 2)).toBe('WAR');
        expect(state(4, 1)).toBe('WAR');
        expect(state(0, 0)).toBe('NEUTRAL');
        expect(parsed.diplomacy.slice(0, 15).every(d => d.relations.length === 54)).toBe(true);
        // Every PATRON relation is backed by an envoy count, and the counts agree from both sides.
        for (const d of parsed.diplomacy.slice(6, 15)) {
            for (const r of d.relations.filter(r => r.state === 'PATRON')) expect(d.envoys[r.other]).toBeGreaterThan(0);
            for (const [major, n] of Object.entries(d.envoys)) expect(parsed.diplomacy[Number(major)]!.envoys[d.playerIndex]).toBe(n);
        }
    });
});

describe('great people', () => {
    it('reads points per class and the recruitment ledger', () => {
        const buf = loadSave(PYDT_SAVE);
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        const points = (id: number) => parsed.greatPeople.byPlayer[id]!.points;
        expect(points(1)).toEqual({ GREAT_PERSON_CLASS_PROPHET: { banked: 24, perTurn: 1 } });
        expect(points(4)).toEqual({ GREAT_PERSON_CLASS_PROPHET: { banked: 1, perTurn: 1 } });
        // Greece recruited John the Baptist this turn: points reset, still 1/turn.
        expect(points(0)).toEqual({ GREAT_PERSON_CLASS_PROPHET: { banked: 0, perTurn: 1 } });
        expect(points(2)).toEqual({});
        const recruited = parsed.greatPeople.ledger.filter(l => l.recruitedBy !== null);
        expect(recruited).toEqual([
            { individual: 'GREAT_PERSON_INDIVIDUAL_SIDDHARTHA_GAUTAMA', class: 'GREAT_PERSON_CLASS_PROPHET', era: 'ERA_CLASSICAL', cost: 60, recruitedBy: 4, recruitedTurn: 45 },
            { individual: 'GREAT_PERSON_INDIVIDUAL_JOHN_THE_BAPTIST', class: 'GREAT_PERSON_CLASS_PROPHET', era: 'ERA_CLASSICAL', cost: 60, recruitedBy: 0, recruitedTurn: 54 },
        ]);
        // The GREATPEOPLEEARNED graph agrees on who has one.
        expect(Object.keys(parsed.graphs['GREATPEOPLEEARNED']!).map(Number).sort()).toEqual([0, 4]);
        expect(parsed.greatPeople.ledger.filter(l => l.recruitedBy === null).every(l => l.cost > 0)).toBe(true);
    });

    it('sees Stonehenge hand Macedon its prophet on the lab save', () => {
        const buf = loadSave(fixture('lab-4'));
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        expect(parsed.greatPeople.ledger.find(l => l.recruitedBy === 0)).toMatchObject({ individual: 'GREAT_PERSON_INDIVIDUAL_JOHN_THE_BAPTIST', recruitedTurn: 15 });
    });
});

describe('governors', () => {
    it('reads each appointed governor with its promotions', () => {
        const buf = loadSave(PYDT_SAVE);
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        const cityOf = (g: typeof parsed.governors[number]) => parsed.cities.find(c => c.ownerId === g.cityOwnerId && c.id === g.cityId)?.name;
        expect(parsed.governors.map(g => [g.playerIndex, g.governor, g.promotions.length, cityOf(g)])).toEqual([
            [0, 'GOVERNOR_THE_RESOURCE_MANAGER', 2, 'SPARTA'],
            [1, 'GOVERNOR_THE_CARDINAL', 1, 'NOBAMBA'],
            [4, 'GOVERNOR_THE_EDUCATOR', 2, 'CANBERRA'],
        ]);
        expect(parsed.governors[0]!.promotions).toEqual(['GOVERNOR_PROMOTION_RESOURCE_MANAGER_GROUNDBREAKER', 'GOVERNOR_PROMOTION_RESOURCE_MANAGER_EXPEDITION']);
        // The GOVERNORS graph lists the same players.
        expect(Object.keys(parsed.graphs['GOVERNORS']!).map(Number)).toEqual([0, 1, 4]);
    });
});

describe('lab7: stockpiles and the rest of the bare numbers', () => {
    const LAB7 = fixture('lab7-4');

    it('reads strategic stockpiles as the oracle has them', () => {
        const buf = loadSave(LAB7);
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        const oracle = readOracleDump(decompressCiv6Payload(buf))!;
        for (const op of oracle.players) {
            const want = Object.fromEntries(Object.entries((op as any).resources ?? {}).map(([k, v]) => [k, (v as any).amount]));
            expect(parsed.playerStates[op.id]!.stockpiles).toEqual(want);
        }
        const pydt = loadSave(PYDT_SAVE);
        if (!pydt) return;
        expect(parseCiv6Save(pydt).playerStates[3]!.stockpiles).toMatchObject({ RESOURCE_HORSES: 50, RESOURCE_IRON: 13, RESOURCE_TURTLES: 2 });
    });

    it('sees Macedon found Catholicism in Pella between lab9-5 and lab9-6', () => {
        const before = loadSave(fixture('lab9-5')), after = loadSave(fixture('lab9-6'));
        if (!before || !after) return;
        expect(parseCiv6Save(before).playerStates[0]!.religionFounded).toBeNull();
        const parsed = parseCiv6Save(after);
        expect(parsed.playerStates[0]!.religionFounded).toEqual({ religion: 'RELIGION_CATHOLICISM', name: 'CATHOLICISM', foundedTurn: 19, holyCity: { x: 17, y: 17 }, beliefs: ['BELIEF_CHORAL_MUSIC', 'BELIEF_WAT'] });
        expect(parsed.cities.find(c => c.name === 'PELLA')!.religions).toEqual([{ religion: null, followers: 2, pressure: 550 }, { religion: 'RELIGION_CATHOLICISM', followers: 8, pressure: 2000 }]);
        expect(parsed.graphs['TOTALRELIGIONSFOUNDED']).toEqual({ 0: [{ turn: 19, value: 1 }] });
        // The Builder put to sleep by hand, fortified units on sentry, walkers in an operation.
        const act = (type: string, x: number, y: number) => parsed.units.find(u => u.typeName === type && u.x === x && u.y === y)!.activity;
        expect(act('UNIT_BUILDER', 38, 22)).toBe('ACTIVITY_SLEEP');
        expect(act('UNIT_WARRIOR', 4, 12)).toBe('ACTIVITY_SENTRY');
        expect(act('UNIT_TRADER', 19, 17)).toBe('ACTIVITY_OPERATION');
        expect(parsed.units.every(u => u.activity !== null)).toBe(true);
    });

    it('reads the pillaged plots and a reassigned governor on the lab8 saves', () => {
        const buf = loadSave(fixture('lab8-5'));
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        const oracle = readOracleDump(decompressCiv6Payload(buf))! as any;
        expect(parsed.map.tiles.filter(t => t.pillaged).map(t => t.index).sort()).toEqual([...oracle.pillagedPlots].sort());
        expect(parsed.map.tiles.filter(t => t.pillaged).every(t => t.improvement)).toBe(true);
        // Moksha was taken off Cairo and Titus put there by hand.
        expect(parsed.governors.map(g => [g.governor.slice(13), g.cityId === null ? null : parsed.cities.find(c => c.ownerId === g.cityOwnerId && c.id === g.cityId)?.name])).toEqual([['CARDINAL', null], ['DEFENDER', 'CAIRO']]);
    });

    it('reads fortify turns per unit and routes per tile as the oracle has them', () => {
        const buf = loadSave(LAB7);
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        const oracle = readOracleDump(decompressCiv6Payload(buf))! as any;
        let compared = 0;
        for (const op of oracle.players) for (const ou of op.units) {
            const u = parsed.units.find(x => x.ownerId === op.id && x.x === ou.x && x.y === ou.y && x.typeName === ou.type);
            if (u && typeof ou.fortifyTurns === 'number') { expect(u.fortifyTurns).toBe(ou.fortifyTurns); compared++; }
        }
        expect(compared).toBeGreaterThan(20);
        const routed = parsed.map.tiles.filter(t => t.routeIndex !== null).map(t => `${t.x},${t.y}:${t.routeIndex}`).sort();
        const W = parsed.map.width;
        expect(routed).toEqual(oracle.routes.map((r: any) => `${r.plot % W},${Math.floor(r.plot / W)}:${r.route}`).sort());
    });
});

describe('late game: turn 125 of a Phoenicia vs Byzantium duel', () => {
    const LATE = fixture('duel-turn-125');
    const LATER = fixture('duel-turn-126');

    it('parses without warnings: Monarchy with six cards, captured cities, food that moves by a surplus', () => {
        const a = loadSave(LATE), b = loadSave(LATER);
        if (!a || !b) return;
        const parsed = parseCiv6Save(a), next = parseCiv6Save(b);
        expect(parsed.metadata.turn).toBe(125);
        expect(parsed.warnings).toEqual([]);
        expect(parsed.playerStates[0]).toMatchObject({ government: 'GOVERNMENT_MONARCHY', pantheon: 'BELIEF_DANCE_OF_THE_AURORA' });
        expect(parsed.playerStates[1]!.policiesSlotted).toHaveLength(6);
        expect(parsed.playerStates[1]!.stockpiles).toMatchObject({ RESOURCE_HORSES: 59, RESOURCE_IRON: 59, RESOURCE_NITER: 36 });
        // Byzantium took Buenos Aires from its city-state: id 4/1 in its list, founded by player 2.
        const ba = parsed.cities.find(c => c.name === 'BUENOS_AIRES')!;
        expect(ba).toMatchObject({ ownerId: 1, cityIndex: 1, population: 6, originalOwnerId: 2, center: { x: 32, y: 14 } });
        // The header's centre corrects the district heuristic (Nicomedia's lowest district is not its centre).
        expect(parsed.cities.find(c => c.name === 'NICOMEDIA')!.center).toEqual({ x: 25, y: 22 });
        // Food stock moves by a small surplus (or resets on growth) in every city between the turns.
        for (const c of parsed.cities) {
            const later = next.cities.find(x => x.ownerId === c.ownerId && x.name === c.name)!;
            const delta = later.food! - c.food!;
            expect(delta).toBeLessThan(40);
            if (delta < 0) expect(later.population).toBe(c.population! + 1);
        }
        // Seven governors, the Ambassador in Babylon (a city-state's city), the rest at home.
        const seat = (g: typeof parsed.governors[number]) => parsed.cities.find(c => c.ownerId === g.cityOwnerId && c.id === g.cityId)?.name;
        expect(parsed.governors.map(g => `${g.governor.slice(13)}→${seat(g)}`)).toEqual(['CARDINAL→TYRE', 'AMBASSADOR→BABYLON', 'EDUCATOR→LPQY', 'BUILDER→BYBLOS', 'DEFENDER→AMASEIA', 'RESOURCE_MANAGER→CONSTANTINOPLE', 'EDUCATOR→NICOMEDIA']);
        // Phoenicia founded "crab" on turn 70 in Tyre; Byzantium has only a pantheon.
        expect(parsed.playerStates[0]!.religionFounded).toEqual({ religion: 'RELIGION_CUSTOM_1', name: 'crab', foundedTurn: 70, holyCity: { x: 19, y: 5 }, beliefs: ['BELIEF_JESUIT_EDUCATION', 'BELIEF_SYNAGOGUE'] });
        expect(parsed.playerStates[1]!.religionFounded).toBeNull();
        expect(parsed.cities.filter(c => c.majorityReligion === 'RELIGION_CUSTOM_1').map(c => c.name)).toEqual(['TYRE', 'BYBLOS', 'LPQY', 'BIRUTA', 'BUENOS_AIRES', 'BABYLON']);
        expect(parsed.cities.find(c => c.name === 'BYBLOS')!.religions).toEqual([{ religion: null, followers: 4, pressure: 400 }, { religion: 'RELIGION_CUSTOM_1', followers: 7, pressure: 771.0546875 }]);
        expect(parsed.graphs['TOTALRELIGIONSFOUNDED']).toEqual({ 0: [{ turn: 70, value: 1 }] });
        expect(parsed.units.filter(u => u.tradeRoute)).toHaveLength(9);
        expect(parsed.greatPeople.ledger.filter(l => l.recruitedBy !== null)).toHaveLength(6);
    });
});

describe('header store', () => {
    it('reads the game settings and every player slot of the PYDT save', () => {
        const buf = loadSave(PYDT_SAVE);
        if (!buf) return;
        const { header, metadata } = parseCiv6Save(buf);
        expect(header.game).toMatchObject({ CurrentTurn: metadata.turn, GameSpeed: metadata.gameSpeed, MapSize: metadata.mapSize, VICTORY_SCORE: expect.any(Boolean), RULESET: expect.stringMatching(/^RULESET_/) });
        expect(typeof header.game['GAME_SYNC_RANDOM_SEED']).toBe('number');
        expect(header.players).toHaveLength(128);
        const greece = header.players.find(p => p['CIVILIZATION_TYPE_NAME'] === 'CIVILIZATION_GREECE')!;
        expect(greece).toMatchObject({ PLAYER_ID: 0, LEADER_TYPE_NAME: 'LEADER_GORGO', NICK_NAME: expect.any(String), CIVILIZATION_LEVEL_TYPE_NAME: 'CIVILIZATION_LEVEL_FULL_CIV', IS_ALIVE: true });
        expect(header.unnamedKeys.length).toBeLessThan(400);
    });
});

describe('districts', () => {
    it('reads every district instance with its type, plot, city and completion', async () => {
        const buf = loadSave(PYDT_SAVE);
        if (!buf) return;
        const { decompressCiv6Payload } = await import('../src/internal/index');
        const { parseDistrictInstances } = await import('../src/internal/parse-districts');
        const parsed = parseCiv6Save(buf);
        const instances = parseDistrictInstances(decompressCiv6Payload(buf), parsed.map.width, parsed.map.height);
        // One record per district tile on the map, each matching its tile's instance id.
        const districtTiles = parsed.map.tiles.filter(t => t.ownership && t.ownership.districtInstanceId !== 0xffffffff);
        expect(instances).toHaveLength(districtTiles.length);
        for (const d of instances) {
            const tile = districtTiles.find(t => t.x === d.x && t.y === d.y)!;
            expect(tile.ownership!.districtInstanceId).toBe(d.instanceId);
        }
        const byName = new Map(parsed.cities.map(c => [c.name, c]));
        expect(byName.get('SPARTA')!.districts).toEqual([
            { type: 'DISTRICT_CITY_CENTER', x: 54, y: 24, completed: true, damage: 0, wallsDamage: 0 },
            { type: 'DISTRICT_HOLY_SITE', x: 54, y: 21, completed: true, damage: 0, wallsDamage: 0 },
        ]);
        // The Holy Site Ephesus is building is there, unfinished, on the plot its production item names.
        const ephesus = byName.get('EPHESUS')!;
        expect(ephesus.districts.find(d => d.type === 'DISTRICT_HOLY_SITE')).toEqual({ type: 'DISTRICT_HOLY_SITE', x: 59, y: 22, completed: false, damage: 0, wallsDamage: 0 });
        expect(ephesus.productionPlot).toEqual({ x: 59, y: 22 });
        expect(byName.get('CANBERRA')!.districts.map(d => d.type.slice(9)).sort()).toEqual(['CITY_CENTER', 'GOVERNMENT', 'HOLY_SITE', 'WONDER']);
        expect(parsed.cities.every(c => c.districts.some(d => d.type === 'DISTRICT_CITY_CENTER' && d.x === c.center!.x && d.y === c.center!.y))).toBe(true);
    });
});

describe('citizen assignment', () => {
    it('reads the worked plots of every city from the 37-plot citizen array', () => {
        const buf = loadSave(fixture('cit-a-1'));
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        const dump = readOracleDump(decompressCiv6Payload(buf))!;
        const oracleCities = dump.players.flatMap(p => p.cities) as Array<{ name: string; population: number; plots: Array<{ x: number; y: number; worked: boolean }> }>;
        expect(oracleCities).toHaveLength(10);
        for (const oc of oracleCities) {
            const city = parsed.cities.find(c => `LOC_CITY_NAME_${c.name}` === oc.name)!;
            const worked = oc.plots.filter(p => p.worked).map(p => `${p.x},${p.y}`).sort();
            expect(city.workedPlots.map(w => `${w.x},${w.y}`).sort()).toEqual(worked);
            expect(city.workedPlots.every(w => w.workers === 1)).toBe(true);
            expect(city.workedPlots.some(w => w.x === city.center!.x && w.y === city.center!.y)).toBe(true);
        }
    });

    it('is plausible on the PYDT and duel saves: centre worked, workers ≤ population', () => {
        for (const path of [PYDT_SAVE, fixture('duel-turn-126')]) {
            const buf = loadSave(path);
            if (!buf) continue;
            const parsed = parseCiv6Save(buf);
            for (const city of parsed.cities) {
                expect(city.workedPlots.length).toBeGreaterThan(0);
                expect(city.workedPlots.some(w => w.x === city.center!.x && w.y === city.center!.y)).toBe(true);
                const workers = city.workedPlots.reduce((n, w) => n + w.workers, 0) - 1;
                expect(workers).toBeLessThanOrEqual(city.population!);
            }
        }
    });
});

describe('eras: moments and dedications', () => {
    it('reads the moment ledger and the dedications the oracle lists on the first Classical save', () => {
        const buf = loadSave(fixture('end-d-2'));
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        const dump = readOracleDump(decompressCiv6Payload(buf))! as any;
        expect(parsed.eras.moments).toHaveLength(53);
        expect(parsed.eras.moments[0]).toMatchObject({ type: 'MOMENT_CITY_BUILT_NEAR_FLOODABLE_RIVER', turn: 1, playerId: 1, plot: { x: 39, y: 22 }, index: 0 });
        expect(parsed.eras.moments.filter(m => m.type === 'MOMENT_GAME_ERA_STARTED_WITH_GOLDEN_AGE').map(m => m.playerId)).toEqual([0, 1]);
        for (const p of dump.players.slice(0, 2)) {
            const d = parsed.eras.dedications.find(d => d.playerId === p.id)!;
            expect(d.active).toEqual(p.dedications);
            expect(d.choices).toEqual(p.dedicationChoices);
        }
        expect(parsed.eras.dedications.filter(d => d.active.length)).toHaveLength(2);
    });

    it('reads the duel save: 321 moments, both players dedicated to the military', () => {
        const buf = loadSave(fixture('duel-turn-126'));
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        expect(parsed.eras.moments).toHaveLength(321);
        expect(parsed.eras.moments.every((m, i) => m.index === i && m.turn <= 126)).toBe(true);
        expect(parsed.eras.dedications.filter(d => d.active.length).map(d => [d.playerId, d.active[0]])).toEqual([[0, 'COMMEMORATION_MILITARY'], [1, 'COMMEMORATION_MILITARY']]);
    });
});

describe('loyalty', () => {
    it('reads loyalty, its per-turn change and the level of every city against the oracle', () => {
        const state = loadSave(fixture('loy-c-2a')), withDump = loadSave(fixture('loy-c-2'));
        if (!state || !withDump) return;
        const parsed = parseCiv6Save(state);
        const dump = readOracleDump(decompressCiv6Payload(withDump))! as any;
        // The city-states keep processing between the save and its dump; the majors' cities hold still.
        for (const oc of dump.players.filter((p: any) => p.major).flatMap((p: any) => p.cities)) {
            const city = parsed.cities.find(c => `LOC_CITY_NAME_${c.name}` === oc.name)!;
            expect(city.loyalty).toMatchObject({ loyalty: oc.loyalty, perTurn: oc.loyaltyPerTurn });
        }
        // Sanaa, founded four tiles from Pella two turns earlier: bleeding loyalty.
        const sanaa = parsed.cities.find(c => c.name === 'SANAA')!;
        expect(sanaa.loyalty).toEqual({ loyalty: 54, perTurn: -23, level: 'LOYALTY_LEVEL_2' });
        expect(parsed.cities.filter(c => c.name !== 'SANAA').every(c => c.loyalty!.loyalty === 100 && c.loyalty!.level === 'LOYALTY_LEVEL_3')).toBe(true);
    });

    it('reads every city of the late duel and PYDT saves', () => {
        const duel = loadSave(fixture('duel-turn-126'));
        if (duel) {
            const parsed = parseCiv6Save(duel);
            expect(parsed.cities.every(c => c.loyalty !== null)).toBe(true);
            expect(parsed.cities.find(c => c.name === 'BUENOS_AIRES')!.loyalty).toEqual({ loyalty: 98.359375, perTurn: -1.640625, level: 'LOYALTY_LEVEL_3' });
        }
        const pydt = loadSave(PYDT_SAVE);
        if (pydt) expect(parseCiv6Save(pydt).cities.every(c => c.loyalty?.loyalty === 100)).toBe(true);
    });
});

describe('followers', () => {
    it('reads followers and pressure per religion of every city against the oracle', () => {
        // The dump a save carries describes the state of the save before it (the oracle writes
        // after a save completes), so the -2a state is checked against the -2 dump.
        const state = loadSave(fixture('loy-c-2a')), withDump = loadSave(fixture('loy-c-2'));
        if (!state || !withDump) return;
        const parsed = parseCiv6Save(state);
        const dump = readOracleDump(decompressCiv6Payload(withDump))! as any;
        const RELIGION: Record<number, string | null> = { [-1]: null, 2: 'RELIGION_CATHOLICISM' };
        // The city-states keep processing between the save and its dump; the majors' cities hold still.
        for (const oc of dump.players.filter((p: any) => p.major).flatMap((p: any) => p.cities)) {
            const city = parsed.cities.find(c => `LOC_CITY_NAME_${c.name}` === oc.name)!;
            const expected = oc.religions.map((r: any) => ({ religion: RELIGION[r.religion], followers: r.followers, pressure: r.pressure }));
            // The unconverted entry is only stored once a religion has spread in; elsewhere its pressure is the
            // game's. Jeddah's pressure reads 8 where the dump says 6: a tick of spread between save and dump.
            expect(city.religions.map(r => ({ religion: r.religion, followers: r.followers }))).toEqual(expected.map((r: any) => ({ religion: r.religion, followers: r.followers })));
            for (const [i, r] of city.religions.entries()) if (r.pressure !== null) expect(Math.abs(r.pressure - expected[i].pressure)).toBeLessThanOrEqual(2);
        }
        expect(parsed.cities.find(c => c.name === 'PELLA')!.religions).toEqual([{ religion: null, followers: 2, pressure: 550 }, { religion: 'RELIGION_CATHOLICISM', followers: 8, pressure: 2110.5 }]);
    });
});

describe('fog of war', () => {
    it('reads every player\'s revealed and visible plots as the oracle sees them', () => {
        const buf = loadSave(fixture('vis-a-1'));
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        const dump = readOracleDump(decompressCiv6Payload(buf))! as any;
        expect(parsed.visibility.map(v => v.playerId)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 62, 63]);
        for (const p of dump.players) {
            const v = parsed.visibility.find(v => v.playerId === p.id)!;
            const chars = [...(p.visibility as string)];
            expect(v.revealed).toEqual(chars.map((c, i) => c !== '0' ? i : -1).filter(i => i >= 0));
            expect(v.visible.map(x => x.plot)).toEqual(chars.map((c, i) => c === '2' ? i : -1).filter(i => i >= 0));
        }
        // The lab revealed the whole map to both majors; the barbarians see a good deal too.
        expect(parsed.visibility[0]!.revealed).toHaveLength(2280);
        expect(parsed.visibility.find(v => v.playerId === 63)!.revealed.length).toBeGreaterThan(500);
    });

    it('has every owned plot revealed and visible to its owner on the PYDT save', () => {
        const buf = loadSave(PYDT_SAVE);
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        for (const v of parsed.visibility) {
            const owned = parsed.map.tiles.filter(t => t.ownership?.ownerId === v.playerId).map(t => t.y * parsed.map.width + t.x);
            const revealed = new Set(v.revealed), visible = new Set(v.visible.map(x => x.plot));
            expect(owned.every(i => revealed.has(i) && visible.has(i))).toBe(true);
        }
        // Teams share sight: Greece and its partner reveal the same 992 plots.
        expect(parsed.visibility[0]!.revealed).toEqual(parsed.visibility[1]!.revealed);
    });
});

describe('grievances', () => {
    it('reads the pair totals and the log (turn 38 of the hotseat game: the oracle said ±100 and ±300 with war turns 15 and 18)', () => {
        // dip-a-1, the capture with the diplomacy dump, was overwritten by a later game; vis-a-1 is the same state.
        const buf = loadSave(fixture('vis-a-1'));
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        expect(parsed.grievances!.pairs).toEqual([{ a: 0, b: 2, total: 300, turn: 18 }, { a: 0, b: 1, total: 100, turn: 15 }]);
        expect(parsed.grievances!.log.map(e => [e.holder, e.against, e.amount, e.turn, e.reason, e.arg])).toEqual([
            [1, 0, 100, 15, 'WAR_DECLARED', null],
            [2, 0, 100, 17, 'CITY_STATE_WAR_DECLARED', 'LOC_CIVILIZATION_SAMARKAND_NAME'],
            [2, 0, 100, 17, 'CITY_STATE_WAR_DECLARED', 'LOC_CIVILIZATION_SAMARKAND_NAME'],
            [2, 0, 100, 18, 'CITY_STATE_WAR_DECLARED', 'LOC_CIVILIZATION_SAMARKAND_NAME'],
        ]);
    });

    it('sums both directions into the pair total (war-b: 100 against Macedon plus 50 against Arabia)', () => {
        const buf = loadSave(fixture('war-b-1'));
        if (!buf) return;
        const g = parseCiv6Save(buf).grievances!;
        expect(g.pairs.find(p => p.a === 0 && p.b === 1)!.total).toBe(150);
        expect(g.pairs.find(p => p.a === 1 && p.b === 3)!.total).toBe(100);
        expect(g.log.filter(e => e.against === 1).map(e => [e.holder, e.amount])).toEqual([[0, 50], [3, 100]]);
    });
});

describe('player tables: governments, natural wonders, buildable units', () => {
    it('names the flag tables of the player object', () => {
        const buf = loadSave(fixture('vis-a-1'));
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        const macedon = parsed.playerStates[0]!, arabia = parsed.playerStates[1]!;
        expect(macedon.governmentsUnlocked).toEqual(['GOVERNMENT_CHIEFDOM', 'GOVERNMENT_AUTOCRACY', 'GOVERNMENT_OLIGARCHY', 'GOVERNMENT_CLASSICAL_REPUBLIC']);
        expect(arabia.governmentsUnlocked).toEqual(['GOVERNMENT_CHIEFDOM']);
        // The lab revealed the map to both majors: the same three natural wonders; the city-states found none.
        expect(macedon.naturalWondersFound).toEqual(['FEATURE_HA_LONG_BAY', 'FEATURE_GIANTS_CAUSEWAY', 'FEATURE_UBSUNUR_HOLLOW']);
        expect(arabia.naturalWondersFound).toEqual(macedon.naturalWondersFound);
        expect(parsed.playerStates[2]!.naturalWondersFound).toEqual([]);
        // Unit types seen on other players: Arabia has met Macedon's Hetairoi, Macedon lists neither its own nor its Missionaries.
        expect(arabia.unitTypesSeen).toContain('UNIT_MACEDONIAN_HETAIROI');
        expect(macedon.unitTypesSeen).not.toContain('UNIT_MACEDONIAN_HETAIROI');
        expect(macedon.unitTypesSeen).not.toContain('UNIT_MISSIONARY');
        // Per-turn yields: gold is the treasury's own per-turn figure.
        expect(arabia.yields['YIELD_GOLD']).toBe(arabia.goldPerTurn);
    });
});

describe('unit extras: religion charges, great-person individuals, every unit found', () => {
    it('finds every unit the oracle lists plus the barbarians, with spread charges and individuals', () => {
        const buf = loadSave(fixture('vis-a-1'));
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        const dump = readOracleDump(decompressCiv6Payload(buf))! as any;
        for (const p of dump.players) for (const ou of p.units) {
            const unit = parsed.units.find(u => u.typeName === ou.type && u.x === ou.x && u.y === ou.y && u.ownerId === p.id);
            expect(unit, `${ou.type}@${ou.x},${ou.y}`).toBeDefined();
            if (ou.spreadCharges) expect(unit!.religion).toEqual({ religion: 'RELIGION_CATHOLICISM', spreadCharges: ou.spreadCharges });
            if (ou.charges) expect(unit!.builderCharges).toBe(ou.charges);
        }
        expect(parsed.units.filter(u => !dump.players.some((p: any) => p.id === u.ownerId)).every(u => u.ownerId === 63)).toBe(true);
        expect(parsed.units.find(u => u.typeName === 'UNIT_GREAT_GENERAL')!.greatPerson).toBe('GREAT_PERSON_INDIVIDUAL_HANNIBAL_BARCA');
    });
});

describe('great works', () => {
    it('reads the registry and every building slot as the oracle lists them on the turn-222 save', () => {
        const buf = loadSave(fixture('late-a-1'));
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        const dump = readOracleDump(decompressCiv6Payload(buf))! as any;
        expect(parsed.greatWorks).toHaveLength(12);
        expect(parsed.greatWorks[1]).toMatchObject({ index: 1, type: 'GREATWORK_OVID_1', creatorPlayerId: 2, turn: 132 });
        for (const p of dump.players) for (const oc of p.cities) {
            const city = parsed.cities.find(c => `LOC_CITY_NAME_${c.name}` === oc.name)!;
            const expected = (oc.greatWorks as any[]).map(w => ({ building: w.building, slot: w.slot, slotType: w.slotType, workIndex: w.index < 0 ? null : w.index }));
            const key = (s: any) => `${s.building}#${s.slot}:${s.slotType}=${s.workIndex}`;
            expect(city.greatWorkSlots.map(key).sort()).toEqual(expected.map(key).sort());
            for (const w of oc.greatWorks as any[]) if (w.index >= 0) expect(parsed.greatWorks[w.index]!.type).toBe(w.type);
        }
    });
});

describe('world congress: favor and resolutions', () => {
    it('reads diplomatic favor and the resolutions in effect on the turn-222 save', () => {
        const buf = loadSave(fixture('late-a-1'));
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        const dump = readOracleDump(decompressCiv6Payload(buf))! as any;
        for (const p of dump.players) expect(parsed.playerStates.find(s => s.playerId === p.id)!.favor!.favor).toBe(p.favor);
        expect(parsed.playerStates[0]!.favor).toEqual({ favor: 223, earned: 1253, spent: 424 });
        // The oracle's three resolutions in effect come first, with the target hash as ChosenThing and A/B as chosen.
        const active = dump.players[0].resolutions as any[];
        expect(parsed.resolutions.slice(0, active.length).map(r => [r.resolution, r.option])).toEqual([['WC_RES_ESPIONAGE_PACT', 2], ['WC_RES_SOVEREIGNTY', 1], ['WC_RES_DIPLOVICTORY', 1]]);
        expect(active.map((r: any) => r.ChosenLabel)).toEqual(['B', 'A', 'A']);
    });

    it('is empty before the congress exists', () => {
        const buf = loadSave(fixture('vis-a-1'));
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        expect(parsed.resolutions).toEqual([]);
        expect(parsed.playerStates[0]!.favor).toEqual({ favor: 93, earned: 93, spent: 0 });
    });
});

describe('world congress: a session', () => {
    it('reads the new resolutions first and the emergency with its votes after the turn-241 session', () => {
        const buf = loadSave(fixture('pre-vote-4'));
        if (!buf) return;
        const parsed = parseCiv6Save(buf);
        const dump = readOracleDump(decompressCiv6Payload(buf))! as any;
        expect(dump.turn).toBe(242);
        // The oracle's three resolutions in effect are the first three records.
        expect(parsed.resolutions.slice(0, 3).map(r => r.resolution)).toEqual(['WC_RES_PATRONAGE', 'WC_RES_WORLD_IDEOLOGY', 'WC_RES_DIPLOVICTORY']);
        expect(dump.players[0].resolutions.map((r: any) => r.ChosenLabel)).toEqual(['A', 'A', 'A']);
        const fair = Object.values<any>(dump.congressProposals.Proposals).flatMap(v => v.ProposalsOfType)[0];
        expect(parsed.emergencies).toEqual([{ emergency: 'WC_EMERGENCY_WORLD_FAIR', turn: 241, votes: fair.PlayerVotes, payloadOffset: expect.any(Number) }]);
        // Countdown is derived: 30-turn sessions, the last one at 241 → 29 left on 242 as the oracle says.
        expect(241 + 30 - dump.turn).toBe(dump.congressMeeting.TurnsLeft);
    });
});

describe('alliances and deals', () => {
    it('reads the alliance matrix and the agreement items across the friendship captures', () => {
        const f12 = loadSave(fixture('friend-12')), f13 = loadSave(fixture('friend-13'));
        if (!f12 || !f13) return;
        const before = parseCiv6Save(f12), after = parseCiv6Save(f13);
        // friend-12: the alliance offer is pending (turn -1); friend-13: accepted, a cultural alliance from 246.
        expect(before.dealItems.filter(d => d.action === 'DIPLOACTION_ALLIANCE').map(d => [d.from, d.to, d.turn])).toEqual([[2, 0, -1], [0, 2, -1]]);
        expect(before.alliances).toEqual([{ a: 0, b: 3, type: 'ALLIANCE_RESEARCH', startTurn: 222, payloadOffset: expect.any(Number) }]);
        expect(after.alliances!.map(a => [a.a, a.b, a.type, a.startTurn])).toEqual([[0, 3, 'ALLIANCE_RESEARCH', 222], [0, 2, 'ALLIANCE_CULTURAL', 246]]);
        expect(after.dealItems.map(d => `${d.action.slice(12)} ${d.from}->${d.to} ${d.turn}/${d.duration}`)).toEqual(['OPEN_BORDERS 3->2 244/30', 'OPEN_BORDERS 2->3 244/30', 'OPEN_BORDERS 2->0 245/30', 'OPEN_BORDERS 0->2 245/30']);
        // The state machine follows: 0↔2 went DECLARED_FRIEND → ALLIED.
        const rel = (p: typeof after, a: number, b: number) => p.diplomacy[p.playerStates.findIndex(s => s.playerId === a)]!.relations.find(r => r.other === b)!.state;
        expect(rel(before, 0, 2)).toBe('DECLARED_FRIEND');
        expect(rel(after, 0, 2)).toBe('ALLIED');
        // The oracle on friend-13 (dumped at the turn start, before the acceptance) sees the scripted 0↔3 alliance as type 0 with 6 turns left: 222 + 30 − 246.
        const dump = readOracleDump(decompressCiv6Payload(f13))! as any;
        const d03 = dump.players.find((p: any) => p.id === 0).diplomacy.find((x: any) => x.player === 3);
        expect([d03.allianceType, d03.allianceTurnsLeft]).toEqual([0, 6]);
    });
});
