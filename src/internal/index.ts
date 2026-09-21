import { buildCitySummaries, buildUnitStacks } from './build-cities';
import { decompressCiv6Payload } from './decompress';
import { parseCiv6Header } from './header-parser';
import { parseHeaderStore } from './header-store';
import { collectUnmappedHashes } from './hash-tables';
import { extractLocCityNames, parseCityHistory } from './parse-city-history';
import { parseCityYieldTimelines, parsePlayerTimelines, readAllReplayDatasets } from './parse-timelines';
import { parseMapTiles } from './parse-tiles';
import { parseAsciiHints } from './parse-ascii-hints';
import { parseUnitInstances } from './parse-units';
import { parsePlayerStates } from './parse-players';
import { parseCityObjects } from './parse-city-objects';
import { parseDistrictInstances } from './parse-districts';
import { parseDiplomacy } from './parse-diplomacy';
import { parseGreatPeople } from './parse-great-people';
import { parseGovernors } from './parse-governors';
import { parseWars } from './parse-wars';
import { parseDedications, parseMoments } from './parse-eras';
import { parsePlayerVisibility } from './parse-visibility';
import { parseGrievances } from './parse-grievances';
import { parseCityGreatWorkSlots, parseGreatWorkRegistry } from './parse-great-works';
import { parseEmergencies, parseResolutions } from './parse-congress';
import { parseAlliances, parseDealItems } from './parse-alliances';
import { detectTypedTables } from './typed-tables';
import type { Civ6SaveParsed } from './types';

export type {
    Civ6CityHistoryEvent,
    Civ6CitySummary,
    Civ6CityYieldSnapshot,
    Civ6MapSection,
    Civ6PlayerSeat,
    Civ6PlayerTimelines,
    Civ6SaveMetadata,
    Civ6SaveParsed,
    Civ6Tile,
    Civ6TimelineSeries,
    Civ6SaveAsciiHints,
    Civ6UnitInstance,
    Civ6PlayerState,
    Civ6DiplomacyState,
    Civ6GreatPeople,
    Civ6GreatPersonOffer,
    Civ6Governor,
    Civ6HeaderStore,
    Civ6War,
    HeaderValue,
    Civ6UnmappedSection,
} from './types';

export { decompressCiv6Payload } from './decompress';
export { parseCiv6Header } from './header-parser';

const NOT_DECODED_SECTIONS = [
    'religion_beyond_the_pantheon, governor assignments, great works holders',
    'espionage, world congress, climate, loyalty and amenities',
] as const;

/**
 * Parse a .Civ6Save buffer into structured JSON.
 * Covers header metadata, map tiles, city footprints/history, units (with XP/MP/promotions),
 * per-player techs/civics/government/policies/yields/treasury/faith, and yield timelines.
 * Trade routes stay in `unmapped.notDecoded`.
 */
export function parseCiv6Save(buffer: Buffer): Civ6SaveParsed {
    const warnings: string[] = [];

    const header = parseCiv6Header(buffer);
    warnings.push(...header.warnings);
    const headerStore = parseHeaderStore(buffer);

    const payload = decompressCiv6Payload(buffer);
    const map = parseMapTiles(payload);

    const historyBlocks = parseCityHistory(payload);
    const locCityNames = extractLocCityNames(payload);
    const cityYieldTimelines = parseCityYieldTimelines(payload);
    const playerTimelines = parsePlayerTimelines(payload, header.fullCivs.length);

    const cities = buildCitySummaries(map.tiles, historyBlocks, cityYieldTimelines, locCityNames);
    const unitStacks = buildUnitStacks(map.tiles);
    const { units, unmappedTypeHashes } = parseUnitInstances(payload, map.width, map.height);
    const tables = detectTypedTables(payload, { minEntries: 4 });
    const playerStates = parsePlayerStates(payload, tables);
    // The player objects come in slot order with the free cities (62) and barbarians (63)
    // between the initial civs and any added later (late-1: 0–9, 62, 63, 10, 11); the
    // visibility blocks share that order and carry the ids.
    const visibility = parsePlayerVisibility(payload, map.tileCount, map.tileSectionStart);
    const playerIds = visibility.length === playerStates.length ? visibility.map(v => v.playerId) : playerStates.map((_, i) => i);
    for (const [i, state] of playerStates.entries()) state.playerId = playerIds[i]!;
    const diplomacy = parseDiplomacy(payload, playerStates);
    const greatPeople = parseGreatPeople(payload, playerStates, tables, units);
    const governors = parseGovernors(payload, playerStates, tables);
    const graphs = readAllReplayDatasets(payload);
    const wars = parseWars(payload, playerStates);
    const moments = parseMoments(payload);
    const tailStart = playerStates[playerStates.length - 1]?.payloadOffset ?? 0;
    const alliances = parseAlliances(payload, tailStart);
    const dealItems = parseDealItems(payload, tailStart);
    const emergencies = parseEmergencies(payload, playerStates[playerStates.length - 1]?.payloadOffset ?? 0);
    const resolutions = parseResolutions(payload, playerStates[playerStates.length - 1]?.payloadOffset ?? 0);
    const greatWorks = parseGreatWorkRegistry(payload, playerStates[playerStates.length - 1]?.payloadOffset ?? 0);
    const grievances = parseGrievances(payload, playerStates[playerStates.length - 1]?.payloadOffset ?? 0);
    const dedications = parseDedications(payload, moments.length ? moments[moments.length - 1]!.payloadOffset : 0);
    for (const [player, points] of Object.entries(graphs['ERASCORE'] ?? {})) {
        const state = playerStates.find(s => s.playerId === Number(player));
        const last = points[points.length - 1];
        if (state && last) state.eraScore = last.value;
    }
    // The city objects carry what the tile groups cannot: name, production, buildings.
    const owned = new Map(map.tiles.filter(t => t.ownership).map(t => [t.y * map.width + t.x, t.ownership!]));
    const cityObjects = parseCityObjects(payload, {
        playerOffsets: playerStates.map(p => p.payloadOffset),
        playerIds,
        mapWidth: map.width,
        plotOwnedBy: (plot, ownerId, cityIndex) => {
            const o = owned.get(plot);
            return !!o && o.ownerId === ownerId && o.cityIndex === cityIndex;
        },
    });
    for (const obj of cityObjects) {
        // The tile groups are keyed by the city's slot in its owner's list, which is the header
        // id's low half — the file order only while the owner never lost a city (late-1).
        const slot = obj.id !== undefined ? obj.id & 0xffff : obj.cityIndex;
        const city = cities.find(c => c.ownerId === obj.ownerId && c.cityIndex === slot) ?? cities.find(c => c.ownerId === obj.ownerId && c.cityIndex === obj.cityIndex);
        if (!city) { warnings.push(`city object ${obj.name} (owner ${obj.ownerId} #${obj.cityIndex}) has no tile group`); continue; }
        city.name = obj.name;
        city.currentProduction = obj.currentProduction;
        if (obj.productionPlot) city.productionPlot = obj.productionPlot;
        city.productionProgress = obj.productionProgress;
        city.productionQueue = obj.productionQueue;
        city.buildings = obj.buildings.map(b => b.building);
        city.buildingPlots = Object.fromEntries(obj.buildings.map(b => [b.building, { x: b.plot % map.width, y: Math.floor(b.plot / map.width) }]));
        city.population = obj.population;
        city.workedPlots = obj.workedPlots;
        city.loyalty = obj.loyalty;
        city.greatWorkSlots = parseCityGreatWorkSlots(payload, obj.payloadOffset, 23500);
        if (obj.center) city.center = obj.center;
        if (obj.id !== undefined) city.id = obj.id;
        city.food = obj.food;
        city.religions = obj.religions;
        city.majorityReligion = obj.majorityReligion;
        city.originalOwnerId = obj.originalOwnerId;
        city.payloadOffset = obj.payloadOffset;
        if (obj.population === null) warnings.push(`city ${obj.name}: header not found, population unknown`);
    }
    // Districts by type: the per-player district lists, matched to tiles by instance id.
    const districtByTile = new Map(map.tiles.filter(t => t.ownership).map(t => [`${t.x},${t.y}`, t.ownership!]));
    for (const d of parseDistrictInstances(payload, map.width, map.height)) {
        const tile = districtByTile.get(`${d.x},${d.y}`);
        if (!tile || tile.districtInstanceId !== d.instanceId) continue;
        const city = cities.find(c => c.ownerId === tile.ownerId && c.cityIndex === d.cityIndex);
        if (city && !city.districts.some(x => x.x === d.x && x.y === d.y)) {
            city.districts.push({ type: d.type, x: d.x, y: d.y, completed: d.completed, damage: d.damage, wallsDamage: d.wallsDamage });
        }
    }
    const asciiHints = parseAsciiHints(payload);

    const unmappedHashes = collectUnmappedHashes(map.tiles);
    unmappedHashes.instanceTypes = unmappedTypeHashes;
    if (unmappedHashes.terrain.length > 0) {
        warnings.push(`unmapped terrain hashes: ${unmappedHashes.terrain.join(', ')}`);
    }
    if (unmappedHashes.resources.length > 0) {
        warnings.push(`unmapped resource hashes: ${unmappedHashes.resources.join(', ')}`);
    }
    if (unmappedTypeHashes.length > 0) {
        warnings.push(`unmapped unit type hashes: ${unmappedTypeHashes.join(', ')}`);
    }

    if (historyBlocks.length > 0 && historyBlocks.length !== cities.length) {
        warnings.push(
            `city history blocks (${historyBlocks.length}) != owned-city groups (${cities.length}); history alignment is best-effort`,
        );
    }
    if (cityYieldTimelines.length > 0 && cityYieldTimelines.length !== cities.length) {
        warnings.push(
            `city yield snapshots (${cityYieldTimelines.length}) != owned-city groups (${cities.length}); yield alignment is best-effort`,
        );
    }

    return {
        metadata: header.metadata,
        header: headerStore,
        players: {
            fullCivs: header.fullCivs,
            cityStates: header.cityStates,
            other: header.other,
        },
        map,
        cities,
        unitStacks,
        units,
        playerStates,
        diplomacy,
        wars,
        eras: { moments, dedications },
        visibility,
        grievances,
        greatWorks,
        resolutions,
        emergencies,
        alliances,
        dealItems,
        greatPeople,
        governors,
        asciiHints,
        playerTimelines,
        graphs,
        cityYieldTimelines,
        locCityNames,
        unmapped: {
            notDecoded: [...NOT_DECODED_SECTIONS],
            hashes: unmappedHashes,
        },
        warnings,
        payload,
    };
}
