/**
 * Builds the public {@link Civ6Save} model from the internal parse result. The internal
 * parsers keep their own shapes (indexed by file position, hashes alongside names, offsets
 * everywhere); this is the one place that turns them into the contract in types.ts.
 */

import { parseCiv6Save as parseInternal } from './internal/index';
import type { Civ6SaveParsed, Civ6Tile } from './internal/types';
import { bswap32, resolveTypeHash } from './internal/hash-tables';
import { readImprovementPlots } from './internal/parse-improvement-plots';
import type {
    Civ6City, Civ6Header, Civ6Map, Civ6Metadata, Civ6Player, Civ6PlayerKind, Civ6Plot, Civ6Save, Civ6Unit, HeaderValue,
} from './types';

const FREE_CITIES = 62;
const BARBARIANS = 63;

function typeName(hash: number, fallback: string | null): string | null {
    if (hash === 0xffffffff || hash === 0) return fallback;
    return resolveTypeHash(hash)?.name ?? resolveTypeHash(bswap32(hash))?.name ?? fallback;
}

function plotOf(tile: Civ6Tile): Civ6Plot {
    return {
        index: tile.index,
        x: tile.x,
        y: tile.y,
        terrain: typeName(tile.terrainHash, tile.terrain?.name ?? null) ?? 'UNKNOWN',
        form: tile.terrain?.form ?? null,
        feature: typeName(tile.featureHash, tile.feature),
        resource: typeName(tile.resourceHash, tile.resource),
        improvement: typeName(tile.improvementHash, tile.improvement),
        continent: typeName(tile.continentHash, tile.continent),
        routeIndex: tile.routeIndex,
        pillaged: tile.pillaged,
        riverMap: tile.riverMap,
        unitCount: tile.unitCount,
        owner: tile.ownership
            ? {
                playerId: tile.ownership.ownerId,
                citySlot: tile.ownership.cityIndex,
                districtInstanceId: tile.ownership.districtInstanceId === 0xffffffff ? null : tile.ownership.districtInstanceId,
                worldWonder: tile.ownership.worldWonderHash === null ? null : typeName(tile.ownership.worldWonderHash, null),
            }
            : null,
        offset: tile.payloadOffset ?? -1,
    };
}

function playerKind(playerId: number, slot: Record<string, HeaderValue> | undefined): Civ6PlayerKind {
    if (playerId === FREE_CITIES) return 'free_cities';
    if (playerId === BARBARIANS) return 'barbarians';
    if (slot?.['CIVILIZATION_LEVEL_TYPE_NAME'] === 'CIVILIZATION_LEVEL_CITY_STATE') return 'city_state';
    if (typeof slot?.['LEADER_TYPE_NAME'] === 'string' && (slot['LEADER_TYPE_NAME'] as string).startsWith('LEADER_MINOR_CIV')) return 'city_state';
    return 'civilization';
}

export function toModel(internal: Civ6SaveParsed, payload: Buffer): Civ6Save {
    // The header lists every slot twice (a configuration block and a mostly empty one); keep the fuller record.
    const slotsById = new Map<number, Record<string, HeaderValue>>();
    for (const slot of internal.header.players) {
        if (typeof slot['PLAYER_ID'] !== 'number') continue;
        const id = slot['PLAYER_ID'] as number;
        if (!slotsById.has(id) || Object.keys(slot).length > Object.keys(slotsById.get(id)!).length) slotsById.set(id, slot);
    }
    // The summary seats carry human/current-turn flags but no slot id; they pair with the slots by civilization.
    const seats = [...internal.players.fullCivs, ...internal.players.cityStates, ...internal.players.other];
    const seatByCiv = new Map(seats.map(s => [s.civilization, s]));

    const header: Civ6Header = {
        game: internal.header.game,
        slots: internal.header.players,
        unnamedKeys: internal.header.unnamedKeys,
    };
    const metadata: Civ6Metadata = {
        turn: internal.metadata.turn,
        gameSpeed: internal.metadata.gameSpeed,
        mapSize: internal.metadata.mapSize,
        ...(internal.metadata.mapFile ? { mapScript: internal.metadata.mapFile } : {}),
        currentPlayers: [...slotsById.entries()].filter(([, slot]) => seatByCiv.get(slot['CIVILIZATION_TYPE_NAME'] as string)?.isCurrentTurn).map(([id]) => id),
    };

    const map: Civ6Map = { width: internal.map.width, height: internal.map.height, plots: internal.map.tiles.map(plotOf) };

    const players: Civ6Player[] = internal.playerStates.map((state, index) => {
        const id = state.playerId;
        const slot = slotsById.get(id);
        const seat = seatByCiv.get(slot?.['CIVILIZATION_TYPE_NAME'] as string);
        const diplomacy = internal.diplomacy[index];
        const visibility = internal.visibility.find(v => v.playerId === id);
        const points = internal.greatPeople.byPlayer.find(p => p.playerIndex === index)?.points ?? {};
        const dedications = internal.eras.dedications.find(d => d.playerId === id);
        return {
            playerId: id,
            kind: playerKind(id, slot),
            civilization: (slot?.['CIVILIZATION_TYPE_NAME'] as string | undefined) ?? seat?.civilization ?? 'UNKNOWN',
            leader: (slot?.['LEADER_TYPE_NAME'] as string | undefined) ?? seat?.leader ?? 'UNKNOWN',
            team: typeof slot?.['TEAM'] === 'number' ? (slot['TEAM'] as number) : id,
            human: seat ? seat.aiHuman === 3 : false,
            alive: typeof slot?.['IS_ALIVE'] === 'boolean' ? (slot['IS_ALIVE'] as boolean) : seat?.isAlive ?? true,
            ...(seat?.playerName ? { name: seat.playerName } : {}),
            techsResearched: state.techsResearched,
            techsBoosted: state.techsBoosted,
            techProgress: state.techProgress,
            currentResearch: state.currentResearch,
            civicsCompleted: state.civicsCompleted,
            civicsInspired: state.civicsInspired,
            civicProgress: state.civicProgress,
            currentCivic: state.currentCivic,
            government: state.government,
            governmentsUnlocked: state.governmentsUnlocked,
            policiesSlotted: state.policiesSlotted,
            policiesEverSlotted: state.policiesEverSlotted,
            gold: state.gold,
            goldPerTurn: state.goldPerTurn,
            yields: state.yields,
            stockpiles: state.stockpiles,
            favor: state.favor,
            faith: state.faith,
            pantheon: state.pantheon,
            religionFounded: state.religionFounded,
            eraScore: state.eraScore,
            dedications: dedications ? { choices: dedications.choices, active: dedications.active } : null,
            greatPersonPoints: points,
            revealedPlots: visibility?.revealed ?? [],
            visiblePlots: visibility?.visible ?? [],
            continents: state.continents,
            naturalWondersFound: state.naturalWondersFound,
            unitTypesSeen: state.unitTypesSeen,
            goodyHutsReceived: state.goodyHutsReceived,
            improvementPlots: readImprovementPlots(payload, id, internal.playerStates, index),
            unitsTrained: state.unitsTrained,
            relations: (diplomacy?.relations ?? []).map(r => ({ playerId: r.other, state: r.state })),
            envoys: diplomacy?.envoys ?? {},
            governors: internal.governors.filter(g => g.playerIndex === index).map(g => ({ type: g.governor, promotions: g.promotions, cityId: g.cityId })),
            offset: state.payloadOffset,
        };
    });

    const cities: Civ6City[] = internal.cities.map(c => {
        const center = c.center ?? c.districtTiles.find(d => d.districtInstanceId === 0x0001_0000) ?? { x: -1, y: -1 };
        return {
            id: c.id ?? (c.cityIndex + 1) * 0x10000 + c.cityIndex,
            slot: c.id !== undefined ? c.id & 0xffff : c.cityIndex,
            name: c.name ?? '',
            playerId: c.ownerId,
            originalPlayerId: c.originalOwnerId ?? c.ownerId,
            center: { x: center.x, y: center.y },
            capital: c.buildings.includes('BUILDING_PALACE'),
            population: c.population ?? 0,
            food: c.food ?? 0,
            workedPlots: c.workedPlots,
            loyalty: c.loyalty,
            production: {
                current: c.currentProduction,
                plot: c.productionPlot ?? null,
                progress: c.productionProgress,
                queue: c.productionQueue,
            },
            buildings: c.buildings.map(b => ({ type: b, x: c.buildingPlots[b]?.x ?? center.x, y: c.buildingPlots[b]?.y ?? center.y })),
            districts: c.districts.map(d => ({ type: d.type, x: d.x, y: d.y, complete: d.completed, damage: d.damage, wallsDamage: d.wallsDamage, lastDamagedTurn: null })),
            greatWorkSlots: c.greatWorkSlots,
            religions: c.religions,
            majorityReligion: c.majorityReligion,
            offset: c.payloadOffset ?? -1,
        };
    });

    const units: Civ6Unit[] = internal.units.map(u => ({
        id: u.id ?? null,
        type: u.typeName ?? `UNKNOWN_${u.typeHashHex}`,
        playerId: u.ownerId,
        x: u.x,
        y: u.y,
        hp: u.hp ?? 100,
        movesRemaining: u.movesRemaining ?? 0,
        xp: u.xp ?? 0,
        level: u.level ?? 1,
        promotions: u.promotions ?? [],
        abilities: u.abilities ?? [],
        formation: u.militaryFormation,
        fortifyTurns: u.fortifyTurns,
        activity: u.activity,
        ...(u.builderCharges !== undefined ? { builderCharges: u.builderCharges } : {}),
        ...(u.religion ? { religion: u.religion } : {}),
        ...(u.greatPerson ? { greatPerson: u.greatPerson } : {}),
        ...(u.tradeRoute ? { tradeRoute: u.tradeRoute } : {}),
        operations: u.operations ?? [],
        offset: u.payloadOffset,
    }));

    return {
        metadata,
        header,
        map,
        players,
        cities,
        units,
        wars: internal.wars.map(w => ({ type: w.type, turn: w.turn })),
        grievances: internal.grievances
            ? {
                pairs: internal.grievances.pairs,
                log: internal.grievances.log.map(({ payloadOffset: _o, ...e }) => e),
            }
            : null,
        moments: internal.eras.moments.map(m => ({ type: m.type, turn: m.turn, playerId: m.playerId, plot: m.plot ?? null, index: m.index })),
        greatWorks: internal.greatWorks.map(({ payloadOffset: _o, ...w }) => w),
        greatPeople: internal.greatPeople.ledger,
        resolutions: internal.resolutions.map(r => ({
            resolution: r.resolution,
            target: r.targetName ?? r.target,
            option: r.option === 2 ? 2 : 1,
        })),
        emergencies: internal.emergencies.map(({ payloadOffset: _o, ...e }) => e),
        alliances: internal.alliances ? internal.alliances.map(({ payloadOffset: _o, ...a }) => a) : null,
        deals: internal.dealItems.map(({ payloadOffset: _o, ...d }) => d),
        graphs: internal.graphs,
        warnings: internal.warnings,
    };
}

/** Parse a `.Civ6Save` file (the whole file, header included) into a {@link Civ6Save}. */
export function parseCiv6Save(file: Uint8Array): Civ6Save {
    const buffer = Buffer.isBuffer(file) ? file : Buffer.from(file.buffer, file.byteOffset, file.byteLength);
    const internal = parseInternal(buffer);
    return toModel(internal, internal.payload);
}
