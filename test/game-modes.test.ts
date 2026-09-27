import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { parseCiv6Save } from '../src/index';
import { parseGameModes } from '../src/internal/header-parser';

const fixture = (name: string) => join(__dirname, 'fixtures', `${name}.Civ6Save`);
const load = (name: string) => (existsSync(fixture(name)) ? readFileSync(fixture(name)) : null);

describe('game modes from the header', () => {
    it('reads the modes block: the 51–60 hotseat game runs three', () => {
        const buf = load('hotseat-58');
        if (!buf) return;
        expect(parseCiv6Save(buf).metadata.gameModes)
            .toEqual(['GAMEMODE_BARBARIAN_CLANS', 'GAMEMODE_MONOPOLIES', 'GAMEMODE_TREE_RANDOMIZER']);
    });

    it('reads a single mode (the duel runs Tech and Civic Shuffle only), and none on a plain save', () => {
        const duel = load('duel-turn-126');
        if (duel) expect(parseCiv6Save(duel).metadata.gameModes).toEqual(['GAMEMODE_TREE_RANDOMIZER']);
        const plain = load('lab9-6');
        if (plain) expect(parseCiv6Save(plain).metadata.gameModes).toEqual([]);
    });

    it('handles the block by shape, escapes and all', () => {
        const name = JSON.stringify({ LOC_GAMEMODE_TREE_RANDOMIZER_NAME: [{ locale: 'en_US', text: 'Tech "and" Civic' }] });
        const header = Buffer.from(`CIV6....GAMESPEED_STANDARD..{\n "modes": [ { "name": ${JSON.stringify(name)} } ]\n}...`);
        expect(parseGameModes(header)).toEqual(['GAMEMODE_TREE_RANDOMIZER']);
        expect(parseGameModes(Buffer.from('CIV6 no modes here'))).toEqual([]);
    });
});
