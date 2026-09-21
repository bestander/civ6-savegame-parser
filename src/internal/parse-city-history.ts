import type { Civ6CityHistoryEvent } from './types';

const LP_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

function readLpStrings(payload: Buffer, start: number, end: number): string[] {
    const out: string[] = [];
    let i = start;
    while (i + 8 < end) {
        const len = payload.readUInt32LE(i);
        if (len < 1 || len > 80) {
            i++;
            continue;
        }
        const s = payload.subarray(i + 4, i + 4 + len).toString('ascii');
        if (!LP_RE.test(s)) {
            i++;
            continue;
        }
        out.push(s);
        i += 4 + len;
    }
    return out;
}

function eventFromToken(token: string, prev?: string): Civ6CityHistoryEvent | null {
    if (token === 'TurnFounded') return { category: 'founded', typeName: 'TurnFounded' };
    if (token.startsWith('BUILDING_')) return { category: 'building', typeName: token };
    if (token.startsWith('DISTRICT_')) return { category: 'district', typeName: token };
    if (token.startsWith('UNIT_')) {
        const cat = prev === 'UnitsKilledByType' ? 'unit_killed'
            : prev === 'UnitsLostByType' ? 'unit_lost'
                : 'unit_trained';
        return { category: cat, typeName: token };
    }
    if (token.startsWith('GOVERNMENT_')) return { category: 'government', typeName: token };
    if (token === 'BUILDING_STONEHENGE' || token.startsWith('WONDER_')) {
        return { category: 'wonder', typeName: token };
    }
    return null;
}

/**
 * Replay/history strings (BuildingsBuiltByType, UnitsTrainedByType, …).
 * Returns one event list per city block (separated by TurnFounded clusters).
 */
export function parseCityHistory(payload: Buffer): Civ6CityHistoryEvent[][] {
    const histStart = payload.indexOf(Buffer.from('BuildingsBuiltByType'));
    const popStart = payload.indexOf(Buffer.from([10, 0, 0, 0, ...Buffer.from('Population')]));
    if (histStart < 0) return [];
    const end = popStart > histStart ? popStart : histStart + 500_000;

    const tokens = readLpStrings(payload, histStart - 2000, end);
    const blocks: Civ6CityHistoryEvent[][] = [];
    let current: Civ6CityHistoryEvent[] = [];
    let prev = '';

    for (const token of tokens) {
        if (token === 'TurnFounded' && current.length > 0) {
            blocks.push(current);
            current = [];
        }
        const ev = eventFromToken(token, prev);
        if (ev) current.push(ev);
        if (
            token.endsWith('ByType')
            || token === 'TurnFounded'
            || token.startsWith('BUILDING_')
            || token.startsWith('DISTRICT_')
            || token.startsWith('UNIT_')
            || token.startsWith('GOVERNMENT_')
        ) {
            prev = token;
        }
    }
    if (current.length > 0) blocks.push(current);
    return blocks;
}

export function extractLocCityNames(payload: Buffer): string[] {
    const names = new Set<string>();
    const re = /LOC_CITY_NAME_[A-Z0-9_]+/g;
    const text = payload.toString('latin1');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        names.add(m[0].replace('LOC_CITY_NAME_', ''));
    }
    return [...names].sort();
}
