import { CITY_YIELD_SERIES_NAMES, PLAYER_TIMELINE_NAMES } from './constants';
import type { Civ6CityYieldSnapshot, Civ6PlayerTimelines, Civ6TimelinePoint, Civ6TimelineSeries } from './types';

function readTimelineAt(payload: Buffer, offset: number, name: string): Civ6TimelineSeries | null {
    const nameBuf = Buffer.from(name, 'ascii');
    const pat = Buffer.concat([Buffer.from([nameBuf.length, 0, 0, 0]), nameBuf]);
    const i = payload.indexOf(pat, offset);
    if (i < 0 || i > offset + 500_000) return null;

    let p = i + 4 + nameBuf.length;
    const tagLo = payload.readUInt32LE(p);
    const tagHi = payload.readUInt32LE(p + 4);
    const tag = `${tagHi.toString(16).padStart(8, '0')}${tagLo.toString(16).padStart(8, '0')}`;
    p += 8;
    const count = payload.readUInt32LE(p);
    p += 4;
    const points: Civ6TimelinePoint[] = [];
    for (let k = 0; k < count; k++) {
        const turn = payload.readInt32LE(p);
        const value = payload.readInt32LE(p + 4);
        p += 8;
        if (turn < 0 || turn > 10_000) break;
        points.push({ turn, value });
    }
    return {
        name,
        tag,
        points,
        last: points.length > 0 ? points[points.length - 1] : null,
    };
}

/**
 * A `REPLAYDATASET_*` dataset from the hall-of-fame graphs: the name,
 * its `LOC_HOF_` label, five bytes, u32 kind, u32 count, then `(player, turn, value×256)`
 * records. Kind 1 is a dense per-turn series for every player slot (score, gold, science,
 * culture, faith, era score); kind 2 a sparse event log (units destroyed, combats, cities
 * built, …) with a record only on the turns something happened. Era score was the first one
 * pinned (lab-4: Macedon 17 and Arabia 10 on turn 16, as the oracle says); score, gold, science
 * and culture agree with the oracle at the same scale.
 */
export function readReplayDataset(payload: Buffer, name: string, from = 0): Map<number, Civ6TimelinePoint[]> {
    const out = new Map<number, Civ6TimelinePoint[]>();
    const nameBuf = Buffer.from(name, 'ascii');
    const i = payload.indexOf(Buffer.concat([Buffer.from([nameBuf.length, 0, 0, 0]), nameBuf]), from);
    if (i < 0) return out;
    let p = i + 4 + nameBuf.length;
    const labelLen = payload.readUInt32LE(p);
    p += 4 + labelLen + 5;
    const kind = payload.readUInt32LE(p);
    if (kind !== 1 && kind !== 2) return out;
    const count = payload.readUInt32LE(p + 4);
    p += 8;
    for (let k = 0; k < count && p + 12 <= payload.length; k++, p += 12) {
        const player = payload.readInt32LE(p);
        const turn = payload.readInt32LE(p + 4);
        if (player < 0 || player > 63 || turn < 0 || turn > 10_000) break;
        const points = out.get(player) ?? [];
        points.push({ turn, value: payload.readInt32LE(p + 8) / 256 });
        out.set(player, points);
    }
    return out;
}

/** Every `REPLAYDATASET_*` graph in the save, by dataset name (`SCOREPERTURN`, `TOTALGOLD`, …). */
export function readAllReplayDatasets(payload: Buffer): Record<string, Record<number, Civ6TimelinePoint[]>> {
    const out: Record<string, Record<number, Civ6TimelinePoint[]>> = {};
    const prefix = Buffer.from('REPLAYDATASET_');
    let at = payload.indexOf(prefix);
    while (at >= 0) {
        const len = payload.readUInt32LE(at - 4);
        const name = payload.subarray(at, at + len).toString('latin1');
        if (len < 64 && /^REPLAYDATASET_[A-Z_]+$/.test(name) && !name.endsWith('_NAME')) {
            const series = readReplayDataset(payload, name, at - 4);
            if (series.size > 0) out[name.slice(prefix.length)] = Object.fromEntries(series);
        }
        at = payload.indexOf(prefix, at + 1);
    }
    return out;
}

/** Per-major-player turn series (Gold, Science, …) from the replay dataset region. */
export function parsePlayerTimelines(payload: Buffer, playerCount: number): Civ6PlayerTimelines[] {
    const goldFirst = payload.indexOf(Buffer.from([4, 0, 0, 0, ...Buffer.from('Gold')]));
    if (goldFirst < 0) return [];

    const out: Civ6PlayerTimelines[] = [];
    let searchFrom = goldFirst;
    for (let playerIndex = 0; playerIndex < playerCount; playerIndex++) {
        const series: Civ6TimelineSeries[] = [];
        for (const name of PLAYER_TIMELINE_NAMES) {
            const s = readTimelineAt(payload, searchFrom, name);
            if (s) {
                series.push(s);
                searchFrom = payload.indexOf(
                    Buffer.from([name.length, 0, 0, 0, ...Buffer.from(name)]),
                    searchFrom,
                ) + 1;
            }
        }
        if (series.length > 0) out.push({ playerIndex, series });
    }
    return out;
}

function readCityYieldBlock(payload: Buffer, offset: number, name: string): Civ6TimelineSeries | null {
    const nameBuf = Buffer.from(name, 'ascii');
    const pat = Buffer.concat([Buffer.from([nameBuf.length, 0, 0, 0]), nameBuf]);
    const i = payload.indexOf(pat, offset);
    if (i < 0) return null;
    return readTimelineAt(payload, i, name);
}

/** Per-city yield snapshots (Population, Production, …) near the city-stats region. */
export function parseCityYieldTimelines(payload: Buffer): Civ6CityYieldSnapshot[] {
    const popPat = Buffer.from([10, 0, 0, 0, ...Buffer.from('Population')]);
    const firstPop = payload.indexOf(popPat);
    if (firstPop < 0) return [];

    const results: Civ6CityYieldSnapshot[] = [];
    let offset = firstPop;
    const regionEnd = Math.min(payload.length, firstPop + 400_000);

    while (offset < regionEnd) {
        const nextPop = payload.indexOf(popPat, offset + 1);
        const blockEnd = nextPop > 0 ? nextPop : regionEnd;
        const snap: Civ6CityYieldSnapshot = {
            population: null,
            food: null,
            production: null,
            science: null,
            gold: null,
            culture: null,
            faith: null,
        };
        let found = false;
        for (const name of CITY_YIELD_SERIES_NAMES) {
            const series = readCityYieldBlock(payload, offset, name);
            if (!series?.last) continue;
            found = true;
            const v = series.last.value;
            switch (name) {
                case 'Population': snap.population = v; break;
                case 'Food': snap.food = v; break;
                case 'Production': snap.production = v; break;
                case 'Science': snap.science = v; break;
                case 'Gold': snap.gold = v; break;
                case 'Culture': snap.culture = v; break;
                case 'Faith': snap.faith = v; break;
            }
        }
        if (found) results.push(snap);
        if (nextPop < 0) break;
        offset = nextPop;
    }
    return results;
}
