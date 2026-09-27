import { describe, expect, it } from 'vitest';
import { parseTreeText } from '../src/internal/tree-dump';

describe('Civa Tree mod dump', () => {
    it('parses techs and civics with costs, rows and prerequisites', () => {
        const dump = parseTreeText('v1;era=0;T|TECH_POTTERY|25|-3|;T|TECH_IRRIGATION|80|2|TECH_ASTROLOGY;C|CIVIC_FOREIGN_TRADE|70|1|CIVIC_CODE_OF_LAWS')!;
        expect(dump.era).toBe(0);
        expect(dump.technologies).toEqual([
            { type: 'TECH_POTTERY', cost: 25, row: -3, prerequisites: [] },
            { type: 'TECH_IRRIGATION', cost: 80, row: 2, prerequisites: ['TECH_ASTROLOGY'] },
        ]);
        expect(dump.civics[0]).toEqual({ type: 'CIVIC_FOREIGN_TRADE', cost: 70, row: 1, prerequisites: ['CIVIC_CODE_OF_LAWS'] });
    });

    it('rejects an unknown version', () => {
        expect(parseTreeText('v9;T|TECH_X|1|0|')).toBeNull();
    });
});
