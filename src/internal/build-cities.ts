import { CITY_CENTER_DISTRICT_INSTANCE } from './constants';
import type { Civ6CityHistoryEvent, Civ6CitySummary, Civ6CityYieldSnapshot, Civ6Tile } from './types';

function cityKey(ownerId: number, cityIndex: number): string {
    return `${ownerId}:${cityIndex}`;
}

export function buildCitySummaries(
    tiles: Civ6Tile[],
    historyBlocks: Civ6CityHistoryEvent[][],
    yieldSnapshots: Civ6CityYieldSnapshot[],
    locCityNames: string[],
): Civ6CitySummary[] {
    const groups = new Map<string, {
        ownerId: number;
        cityIndex: number;
        tiles: Civ6Tile[];
        districtTiles: Array<{ x: number; y: number; districtInstanceId: number }>;
    }>();

    for (const tile of tiles) {
        if (!tile.ownership) continue;
        const key = cityKey(tile.ownership.ownerId, tile.ownership.cityIndex);
        let group = groups.get(key);
        if (!group) {
            group = {
                ownerId: tile.ownership.ownerId,
                cityIndex: tile.ownership.cityIndex,
                tiles: [],
                districtTiles: [],
            };
            groups.set(key, group);
        }
        group.tiles.push(tile);
        if (tile.ownership.districtInstanceId !== 0xffffffff) {
            group.districtTiles.push({
                x: tile.x,
                y: tile.y,
                districtInstanceId: tile.ownership.districtInstanceId,
            });
        }
    }

    const cities: Civ6CitySummary[] = [];
    const sortedKeys = [...groups.keys()].sort((a, b) => {
        const [ao, ac] = a.split(':').map(Number);
        const [bo, bc] = b.split(':').map(Number);
        return ao - bo || ac - bc;
    });

    let historyIdx = 0;
    let yieldIdx = 0;

    for (const key of sortedKeys) {
        const group = groups.get(key)!;
        // District instance ids count up per player, and a city's centre is always the first
        // district it ever had — so the tile with the lowest instance in the group is the centre
        // (the capital's is `CITY_CENTER_DISTRICT_INSTANCE`; every other city's is whatever
        // number its player was on). Verified against where Palaces and Monuments stand.
        const districtTiles = group.tiles.filter(t => t.ownership && t.ownership.districtInstanceId !== 0xffffffff);
        const centerTile = districtTiles.length > 0
            ? districtTiles.reduce((a, b) => ((a.ownership!.districtInstanceId & 0xffff) <= (b.ownership!.districtInstanceId & 0xffff) ? a : b))
            : group.tiles.find(t => t.ownership?.districtInstanceId === CITY_CENTER_DISTRICT_INSTANCE) ?? group.tiles[0];

        const history = historyBlocks[historyIdx] ?? [];
        if (history.length > 0) historyIdx++;

        const yields = yieldSnapshots[yieldIdx] ?? null;
        if (yields) yieldIdx++;

        cities.push({
            ownerId: group.ownerId,
            cityIndex: group.cityIndex,
            center: centerTile ? { x: centerTile.x, y: centerTile.y } : null,
            ownedTileCount: group.tiles.length,
            districtTiles: group.districtTiles,
            history,
            yields,
            locName: locCityNames[cities.length] ?? null,
            name: null,
            currentProduction: null,
            productionProgress: {},
            productionQueue: [],
            buildings: [],
            buildingPlots: {},
            population: null,
            food: null,
            workedPlots: [],
            loyalty: null,
            greatWorkSlots: [],
            religions: [],
            majorityReligion: null,
            originalOwnerId: null,
            districts: [],
        });
    }

    return cities;
}

export function buildUnitStacks(tiles: Civ6Tile[]): Array<{
    x: number;
    y: number;
    count: number;
    ownerId: number | null;
}> {
    const stacks: Array<{ x: number; y: number; count: number; ownerId: number | null }> = [];
    for (const tile of tiles) {
        if (tile.unitCount <= 0) continue;
        stacks.push({
            x: tile.x,
            y: tile.y,
            count: tile.unitCount,
            ownerId: tile.ownership?.ownerId ?? null,
        });
    }
    return stacks;
}
