/**
 * The Civa Tree mod's dump (civa-2hw4): a Tech and Civic Shuffle game's drawn tree and costs.
 *
 * Civ6 does not save a shuffled tree (it re-derives it from the seed at load). The mod
 * (`mods/civatree`, UI only) writes it into the game configuration, which the header keeps as
 * hashed keys: `CIVA_TREE_COUNT` = n, `CIVA_TREE_000` … `CIVA_TREE_{n-1}` = text chunks. The text is
 * `v1;era=<n>;` then one `;`-separated record per item: `T|TECH_X|cost|row|PRE_A,PRE_B` (a
 * technology) or `C|CIVIC_Y|cost|row|PRE…` (a civic). Costs are what the engine charges at the
 * current world era (`GetResearchCost` / `GetCultureCost`).
 */

import { civ6Hash } from './hash-tables';
import { parseHeaderStore } from './header-store';
import type { Civ6HeaderStore } from './header-store';

export interface Civ6TreeItem {
    type: string;
    /** The engine's cost at `era`; null when the mod could not read it. */
    cost: number | null;
    /** Layout row in the tree UI. */
    row: number | null;
    prerequisites: string[];
}

export interface Civ6TreeDump {
    /** World era index when the dump was written (costs include its ±20% adjustment). */
    era: number | null;
    technologies: Civ6TreeItem[];
    civics: Civ6TreeItem[];
}

/** Parse the mod's text. Exposed for tests; `readTreeDump` finds the text in a save. */
export function parseTreeText(text: string): Civ6TreeDump | null {
    const parts = text.split(';');
    if (parts[0] !== 'v1') return null;
    const out: Civ6TreeDump = { era: null, technologies: [], civics: [] };
    for (const part of parts.slice(1)) {
        if (part.startsWith('era=')) { const n = Number(part.slice(4)); out.era = Number.isFinite(n) && n >= 0 ? n : null; continue; }
        const [kind, type, cost, row, pre] = part.split('|');
        if (!type || (kind !== 'T' && kind !== 'C')) continue;
        const item: Civ6TreeItem = {
            type,
            cost: cost !== undefined && cost !== '' && Number.isFinite(Number(cost)) ? Number(cost) : null,
            row: row !== undefined && row !== '' && Number.isFinite(Number(row)) ? Number(row) : null,
            prerequisites: pre ? pre.split(',').filter(Boolean) : [],
        };
        (kind === 'T' ? out.technologies : out.civics).push(item);
    }
    return out;
}

const hex = (key: string) => (civ6Hash(key) >>> 0).toString(16).padStart(8, '0');

/** Read the mod's dump from an already-parsed header store, or null for a save made without the mod. */
export function readTreeDumpFromHeaderStore(store: Civ6HeaderStore): Civ6TreeDump | null {
    const maps = [store.game, ...store.players];
    const get = (key: string) => {
        const label = hex(key);
        for (const m of maps) if (label in m) return m[label];
        return undefined;
    };
    const count = get('CIVA_TREE_COUNT');
    if (typeof count !== 'number' || count <= 0) return null;
    let text = '';
    for (let i = 0; i < count; i++) {
        const chunk = get(`CIVA_TREE_${String(i).padStart(3, '0')}`);
        if (typeof chunk !== 'string') return null;
        text += chunk;
    }
    return parseTreeText(text);
}

/** The mod's dump in a save's header, or null for a save made without the mod. */
export function readTreeDump(buffer: Buffer): Civ6TreeDump | null {
    const store = parseHeaderStore(buffer);
    return readTreeDumpFromHeaderStore(store);
}
