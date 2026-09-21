/**
 * List the typed tables of a .Civ6Save payload — the structural map of the state.
 *
 *   npm run tables -- "<save>"                       # signature census of the whole file
 *   npm run tables -- "<save>" --kind KIND_TECH      # every table of one kind, with its non-zero entries
 *   npm run tables -- "<save>" --near 1440062        # tables within 8 KB of an offset (a unit record, say)
 *   npm run tables -- "<save>" --context 1414896     # the run of tables around one table (an object's shape)
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { decompressCiv6Payload } from '../src/internal/index';
import { resolveCiv6SavePath } from '../src/internal/save-paths';
import { activeEntries, detectTypedTables, type TypedTable } from '../src/internal/typed-tables';

function arg(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

const sig = (t: TypedTable) => `${t.kind.replace('KIND_', '')} s${t.stride} n${t.entries.length}`;
const short = (name: string) => name.replace(/^[A-Z]+_/, '');

function describe(t: TypedTable): string {
    const active = activeEntries(t);
    const shown = active.slice(0, 12).map(e => `${short(e.name)}=${e.int}`).join(' ');
    return `@${t.start} ${sig(t)}${active.length ? `: ${shown}${active.length > 12 ? ` … (${active.length} non-zero)` : ''}` : ' (all zero)'}`;
}

const saveArg = process.argv[2];
if (!saveArg || saveArg.startsWith('--')) {
    console.error('usage: civ6save-tables <save> [--kind KIND_X | --near offset | --context offset]');
    process.exit(1);
}
const payload = decompressCiv6Payload(readFileSync(resolveCiv6SavePath(saveArg) ?? resolve(saveArg)));
const kind = arg('--kind');
const near = arg('--near') ? Number(arg('--near')) : undefined;
const context = arg('--context') ? Number(arg('--context')) : undefined;

const tables = detectTypedTables(payload, {
    minEntries: 4,
    ...(near !== undefined ? { from: near - 8192, to: near + 8192 } : {}),
});
console.log(`${payload.length} payload bytes, ${tables.length} typed tables`);

if (context !== undefined) {
    const i = tables.findIndex(t => t.start >= context);
    for (const t of tables.slice(Math.max(0, i - 15), i + 15)) console.log((t.start === context ? '>> ' : '   ') + describe(t));
} else if (kind || near !== undefined) {
    for (const t of tables.filter(t => !kind || t.kind === kind)) console.log(describe(t));
} else {
    const census = new Map<string, number>();
    for (const t of tables) census.set(sig(t), (census.get(sig(t)) ?? 0) + 1);
    for (const [s, n] of [...census].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(6)}× ${s}`);
}
