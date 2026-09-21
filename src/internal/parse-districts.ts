/**
 * District instances.
 *
 * Each player object carries a district list; a record is
 * `[instanceLow, 15, instanceId, x, y, cityId, DISTRICT_* hash, damage, wallsDamage, lastDamagedTurn, 0, cost, built, …]`
 * where `instanceId` is the id tiles carry (`(n+1) << 16 | n`, counted per player, the city
 * centre being a city's first) and `cityId` the owning city's own id in the same form (counted
 * per player over cities). `built` is 1 once the district is complete, 0 while it is the item
 * in production. All 37 records of the PYDT save match their tile's instance id exactly.
 * `damage` is the garrison damage (Cairo took 30 in lab-3 and read 30, healed to 10 a turn
 * later), `wallsDamage` the outer-defense damage, and `lastDamagedTurn` -100 until hit.
 */

import { resolveTypeHash } from './hash-tables';

export interface Civ6DistrictInstance {
    /** `DISTRICT_HOLY_SITE`, `DISTRICT_CITY_CENTER`, `DISTRICT_WONDER`, … */
    type: string;
    x: number;
    y: number;
    /** The id the tile carries (`Civ6TileOwnership.districtInstanceId`). */
    instanceId: number;
    /** Owning city's id: `(cityIndex+1) << 16 | cityIndex` within its player. */
    cityId: number;
    /** `cityId & 0xffff` — the owner's city index. */
    cityIndex: number;
    completed: boolean;
    /** Damage on the district's garrison (a city centre's health is 200 minus this). */
    damage: number;
    /** Damage on the outer defenses (walls). */
    wallsDamage: number;
    /** Turn the district was last damaged, or -100 when never. */
    lastDamagedTurn: number;
    /** Production cost the record carries (0 for a city centre). */
    cost: number;
    payloadOffset: number;
}

/** True for the `(n+1) << 16 | n` shape both district and city ids take. */
function isInstanceId(v: number): boolean {
    return (v >>> 16) === (v & 0xffff) + 1;
}

export function parseDistrictInstances(payload: Buffer, mapWidth: number, mapHeight: number): Civ6DistrictInstance[] {
    const out: Civ6DistrictInstance[] = [];
    for (let o = 0; o + 48 <= payload.length; o++) {
        if (payload.readInt32LE(o) !== 15) continue;
        const instanceId = payload.readUInt32LE(o + 4);
        if (!isInstanceId(instanceId)) continue;
        const x = payload.readInt32LE(o + 8);
        const y = payload.readInt32LE(o + 12);
        if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) continue;
        const cityId = payload.readUInt32LE(o + 16);
        if (!isInstanceId(cityId)) continue;
        const type = resolveTypeHash(payload.readUInt32LE(o + 20));
        if (!type || type.kind !== 'KIND_DISTRICT') continue;
        out.push({
            type: type.name,
            x, y,
            instanceId,
            cityId,
            cityIndex: cityId & 0xffff,
            completed: payload.readInt32LE(o + 44) === 1,
            damage: payload.readInt32LE(o + 24),
            wallsDamage: payload.readInt32LE(o + 28),
            lastDamagedTurn: payload.readInt32LE(o + 32),
            cost: payload.readInt32LE(o + 40),
            payloadOffset: o,
        });
    }
    return out;
}
