import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { parseCiv6Save, readOracleDump, decompressCiv6Payload } from '../src/index';

const FIXTURES = process.env.CIV6_FIXTURES ?? join(__dirname, 'fixtures');
const fixture = (name: string) => join(FIXTURES, `${name}.Civ6Save`);

describe('public model', () => {
    it('builds the Civ6Save model of a late Gathering Storm save', () => {
        const path = fixture('late-a-1');
        if (!existsSync(path)) return;
        const file = readFileSync(path);
        const game = parseCiv6Save(file);
        const dump = readOracleDump(decompressCiv6Payload(file))! as any;

        expect(game.metadata.turn).toBe(222);
        expect(game.map.width * game.map.height).toBe(game.map.plots.length);
        expect(game.map.plots.every(p => p.terrain.startsWith('TERRAIN_'))).toBe(true);

        const ids = game.players.map(p => p.playerId);
        expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 62, 63, 10, 11]);
        const mapuche = game.players.find(p => p.playerId === 0)!;
        expect(mapuche.kind).toBe('civilization');
        expect(mapuche.civilization).toBe('CIVILIZATION_MAPUCHE');
        expect(mapuche.human).toBe(true);
        expect(mapuche.favor).toEqual({ favor: 223, earned: 1253, spent: 424 });
        expect(mapuche.revealedPlots.length).toBeGreaterThan(0);
        expect(game.players.find(p => p.playerId === 63)!.kind).toBe('barbarians');
        expect(game.players.find(p => p.playerId === 4)!.kind).toBe('city_state');

        // Every city the oracle lists, with population, worked plots, loyalty and religion.
        for (const p of dump.players) for (const oc of p.cities) {
            const city = game.cities.find(c => `LOC_CITY_NAME_${c.name}` === oc.name)!;
            expect(city.playerId).toBe(p.id);
            expect(city.population).toBe(oc.population);
            expect(city.loyalty!.loyalty).toBe(oc.loyalty);
            expect(city.workedPlots.length).toBeGreaterThan(0);
        }
        expect(game.cities.filter(c => c.capital).map(c => c.playerId).sort((a, b) => a - b)).toEqual([0, 2, 3, 4, 6, 7, 10]);

        expect(game.greatWorks).toHaveLength(12);
        expect(game.resolutions[0]).toMatchObject({ resolution: 'WC_RES_ESPIONAGE_PACT', option: 2 });
        expect(game.units.every(u => u.type.startsWith('UNIT_'))).toBe(true);
        expect(game.moments.length).toBeGreaterThan(1000);
    });
});
