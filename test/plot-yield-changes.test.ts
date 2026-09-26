import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { parsePlotYieldChanges } from '../src/internal/parse-plot-yield-changes';
import { civ6Hash } from '../src/internal/hash-tables';
import { parseCiv6Save } from '../src/index';

const YIELDS = ['YIELD_FOOD', 'YIELD_PRODUCTION', 'YIELD_GOLD', 'YIELD_SCIENCE', 'YIELD_CULTURE', 'YIELD_FAITH'];

/** plotCount, per-plot index (-1 = none), entryCount, entries of six (hash, amount) pairs. */
function table(plotCount: number, index: number[], entries: number[][]): Buffer {
    const words: number[] = [0xdeadbeef, plotCount, ...index, entries.length];
    for (const e of entries) {
        words.push(6);
        YIELDS.forEach((name, k) => { words.push(civ6Hash(name), e[k] ?? 0); });
    }
    const b = Buffer.alloc(words.length * 4);
    words.forEach((w, i) => b.writeUInt32LE(w >>> 0, i * 4));
    return b;
}

describe('per-plot yield changes', () => {
    it('reads the table by its shape and maps each plot to its entry', () => {
        const buf = table(6, [-1, 1, -1, 0, -1, 1], [[1, 1], [0, 0, 0, 0, 1]]);
        const changes = parsePlotYieldChanges(buf, 6);
        expect([...changes.keys()]).toEqual([1, 3, 5]);
        expect(changes.get(3)).toEqual({ YIELD_FOOD: 1, YIELD_PRODUCTION: 1 });
        expect(changes.get(1)).toEqual({ YIELD_CULTURE: 1 });
    });

    it('rejects a run that only looks like it — an index past the entry list', () => {
        const buf = table(4, [-1, 7, -1, 0], [[1]]);
        expect(parsePlotYieldChanges(buf, 4).size).toBe(0);
    });

    const pydt = join(process.env.CIV6_FIXTURES ?? join(__dirname, 'fixtures'), 'pydt-turn-54.Civ6Save');
    it.skipIf(!existsSync(pydt))('carries a flood\'s silt on a floodplain plot of a real save', () => {
        const save = parseCiv6Save(readFileSync(pydt));
        const floodplains = save.map.plots.filter(p => p.feature?.startsWith('FEATURE_FLOODPLAINS') && p.yieldChanges);
        expect(floodplains.length).toBeGreaterThan(0);
        for (const p of floodplains) expect(Object.values(p.yieldChanges!).every(v => v > 0)).toBe(true);
    });
});
