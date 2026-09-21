/**
 * civ6-savegame-parser — reads the game state out of a `.Civ6Save`.
 *
 * `parseCiv6Save(file)` returns a {@link Civ6Save} (see types.ts); the oracle helpers read the
 * ground-truth dump a save carries when it was made with the oracle mod enabled.
 */
export * from './types';
export { parseCiv6Save } from './model';
export { decompressCiv6Payload } from './internal/decompress';
export { readOracleDump, readLabLog, readPlanLog } from './internal/oracle';
export type { OracleDump } from './internal/oracle';
