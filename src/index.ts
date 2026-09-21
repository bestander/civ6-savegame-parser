/**
 * civ6-savegame-parser — reads the game state out of a `.Civ6Save`.
 *
 * The data model is `Civ6Save` (see types.ts). The parser behind `parseCiv6Save` is being
 * moved into this package; until then this module exposes the types only.
 */
export * from './types';

import type { Civ6Save } from './types';

/** Parse a `.Civ6Save` file (the whole file, header included) into a {@link Civ6Save}. */
export function parseCiv6Save(_file: Uint8Array): Civ6Save {
    throw new Error('civ6-savegame-parser: parser not yet migrated into this package');
}
