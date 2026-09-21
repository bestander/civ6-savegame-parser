/** Tile-section marker: 0E 00 00 00 0F 00 00 00 06 00 00 00 */
export const TILE_SECTION_MARKER = Buffer.from([0x0e, 0, 0, 0, 0x0f, 0, 0, 0, 0x06, 0, 0, 0]);

/** Next-tile terrain hashes used for forward resync (unsigned LE in the save). */
export const TERRAIN_RESYNC_ALLOWLIST = new Set<number>([
    2213004848, 1855786096, 1602466867, 4226188894, 3872285854, 2746853616, 3852995116,
    3108058291, 1418772217, 1223859883, 3949113590, 3746160061, 1743422479, 3842183808,
    699483892, 1248885265, 1204357597,
]);

export const PLAYER_TIMELINE_NAMES = [
    'Gold', 'Culture', 'Science', 'Faith', 'Score', 'BarbariansKilled', 'BarbarianCampsCleared',
    'CivicsAcquired', 'TechsAcquired', 'Favor', 'ScienceVP', 'DiploVP',
] as const;

export const CITY_YIELD_SERIES_NAMES = [
    'Population', 'Production', 'Food', 'Science', 'Gold', 'Culture', 'Faith',
] as const;

export const CITY_CENTER_DISTRICT_INSTANCE = 0x0001_0000;

export const OWNER_BARBARIAN = 62;
export const OWNER_FREE_CITIES = 255;

import { homedir } from 'os';
import { join } from 'path';

/** The game's user save root (hotseat / single / multi): macOS by default, or `CIV6_SAVES_ROOT` in the environment. */
export const CIV6_SAVES_ROOT =
    process.env.CIV6_SAVES_ROOT ?? join(homedir(), "Library/Application Support/Sid Meier's Civilization VI/Sid Meier's Civilization VI/Saves");
