/**
 * Annotate a .Civ6Save payload with every database type hash it contains.
 *
 * With the hash formula known (`civ6Hash`), the inflated payload can be read as a map: each
 * uint32 that is `~crc32(typeName)` — straight or byte-swapped — is a reference to that type.
 * Grouping the hits by kind and offset shows where the tech tables, policy slots, promotions,
 * production queues, … live, without a single before/after pair.
 *
 *   npm run annotate -- "<save path or name under the Saves tree>" [--kind KIND_TECH] [--near <offset>]
 *
 * Writes .debug/<save>-annotate.md and prints a per-kind summary.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, join, resolve } from 'path';
import { decompressCiv6Payload } from '../src/internal/index';
import { bswap32, civ6Hash, hashHex, resolveTypeHash, typeNamesOfKind, type Civ6Type } from '../src/internal/hash-tables';
import { resolveCiv6SavePath } from '../src/internal/save-paths';
import civ6Types from '../src/data/civ6-types.json';

interface Hit { offset: number; type: Civ6Type; swapped: boolean }

function arg(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Every uint32 (any alignment) that names a type. */
export function annotatePayload(payload: Buffer, kinds?: Set<string>, range?: { from: number; to: number }): Hit[] {
    const index = new Map<number, Civ6Type>();
    for (const [kind, names] of Object.entries(civ6Types as Record<string, string[]>)) {
        if (kinds && !kinds.has(kind)) continue;
        for (const name of names) index.set(civ6Hash(name), { name, kind });
    }
    const hits: Hit[] = [];
    const from = Math.max(0, range?.from ?? 0);
    const to = Math.min(payload.length, range?.to ?? payload.length);
    for (let off = from; off + 4 <= to; off++) {
        const v = payload.readUInt32LE(off);
        const straight = index.get(v);
        if (straight) { hits.push({ offset: off, type: straight, swapped: false }); continue; }
        const swapped = index.get(bswap32(v));
        if (swapped) hits.push({ offset: off, type: swapped, swapped: true });
    }
    return hits;
}

function ints(payload: Buffer, offset: number, before: number, after: number): string {
    const out: string[] = [];
    for (let o = offset - before * 4; o <= offset + after * 4; o += 4) {
        if (o < 0 || o + 4 > payload.length) continue;
        const v = payload.readUInt32LE(o);
        const t = resolveTypeHash(v);
        out.push(o === offset ? `[${v}]` : t ? `${t.name}` : String(v));
    }
    return out.join(' ');
}

function main() {
    const saveArg = process.argv[2];
    if (!saveArg || saveArg.startsWith('--')) {
        console.error('usage: civ6save-annotate <save> [--kind KIND_X] [--near offset [--window bytes]]');
        process.exit(1);
    }
    const path = resolveCiv6SavePath(saveArg) ?? resolve(saveArg);
    const payload = decompressCiv6Payload(readFileSync(path));
    const kindFilter = arg('--kind');
    const near = arg('--near') ? Number(arg('--near')) : undefined;
    const window = arg('--window') ? Number(arg('--window')) : 4096;
    const hits = annotatePayload(
        payload,
        kindFilter ? new Set([kindFilter]) : undefined,
        near === undefined ? undefined : { from: near - window, to: near + window },
    );
    // The whole file is a million references (the save carries the game database too); the
    // per-hit listing is for a kind or a neighbourhood, the summary is for orientation.
    const detailed = kindFilter !== undefined || near !== undefined;

    const byKind = new Map<string, Hit[]>();
    for (const h of hits) byKind.set(h.type.kind, [...(byKind.get(h.type.kind) ?? []), h]);
    const lines: string[] = [`# ${basename(path)} — ${payload.length} payload bytes, ${hits.length} type references`, ''];
    console.log(lines[0]);
    for (const [kind, list] of [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)) {
        const names = new Set(list.map(h => h.type.name));
        const summary = `${kind}: ${list.length} refs, ${names.size} distinct (of ${typeNamesOfKind(kind).length}), ${list.filter(h => h.swapped).length} byte-swapped`;
        console.log(summary);
        lines.push(`## ${summary}`, '');
        if (!detailed) continue;
        for (const h of list) {
            lines.push(`- +${h.offset} ${h.swapped ? 'bswap ' : ''}${h.type.name}  ·  ${ints(payload, h.offset, 3, 4)}`);
        }
        lines.push('');
    }
    const outDir = resolve(__dirname, '../.debug');
    mkdirSync(outDir, { recursive: true });
    const out = join(outDir, `${basename(path).replace(/\.Civ6Save$/i, '')}-annotate.md`);
    writeFileSync(out, lines.join('\n'));
    console.log(`→ ${out}`);
    void hashHex;
}

if (require.main === module) main();
