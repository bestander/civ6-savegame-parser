/**
 * Extract every `<Row Type="…" Kind="KIND_…">` from the Civ6 install's gameplay data into
 * `src/civ6save/data/civ6-types.json`.
 *
 * Civ6 identifies every database type in a save by `~crc32(typeName)` (see `civ6Hash`), so the
 * full list of type names is the whole hash dictionary: units, buildings, districts, techs,
 * civics, policies, promotions, resources, features, improvements, … No save pairs needed.
 *
 *   npm run types            # default macOS Steam install
 *   npm run types -- /path/to/Civ6.app/Contents/Assets
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const DEFAULT_ASSETS = process.env.CIV6_ASSETS ?? `${process.env.HOME}/Library/Application Support/Steam/steamapps/common/Sid Meier's Civilization VI/Civ6.app/Contents/Assets`;
const OUT = resolve(__dirname, '../src/data/civ6-types.json');
const OUT_REPLACES = resolve(__dirname, '../src/data/civ6-unit-replaces.json');

function* xmlFiles(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) yield* xmlFiles(full);
        else if (/\.(xml|sql)$/i.test(entry)) yield full;
    }
}

const assets = process.argv[2] ?? DEFAULT_ASSETS;
const byKind = new Map<string, Set<string>>();
const rowRe = /<Row\s+Type="([A-Z0-9_]+)"\s+Kind="([A-Z0-9_]+)"/g;
// SQL sources say the same thing as `INSERT INTO Types (Type, Kind) VALUES ('X', 'KIND_Y')`.
const sqlRe = /Types\s*\(\s*Type\s*,\s*Kind\s*\)\s*VALUES\s*\(\s*'([A-Z0-9_]+)'\s*,\s*'([A-Z0-9_]+)'/gi;
// UnitReplaces: which base unit a civ's unique unit stands in for — what the import maps it to.
const replacesRe = /CivUniqueUnitType="([A-Z0-9_]+)"[^>]*ReplacesUnitType="([A-Z0-9_]+)"/g;
const replaces: Record<string, string> = {};
let files = 0;
for (const root of ['Base', 'DLC', 'CTP'].map(d => join(assets, d))) {
    let exists = true;
    try { statSync(root); } catch { exists = false; }
    if (!exists) continue;
    for (const file of xmlFiles(root)) {
        files++;
        const text = readFileSync(file, 'utf8');
        replacesRe.lastIndex = 0;
        for (const m of text.matchAll(replacesRe)) replaces[m[1]!] = m[2]!;
        for (const re of [rowRe, sqlRe]) {
            re.lastIndex = 0;
            for (const m of text.matchAll(re)) {
                const set = byKind.get(m[2]!) ?? new Set<string>();
                set.add(m[1]!);
                byKind.set(m[2]!, set);
            }
        }
    }
}
const out: Record<string, string[]> = {};
for (const kind of [...byKind.keys()].sort()) out[kind] = [...byKind.get(kind)!].sort();
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
const sortedReplaces = Object.fromEntries(Object.entries(replaces).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(OUT_REPLACES, JSON.stringify(sortedReplaces, null, 1) + '\n');
console.log(`${Object.keys(sortedReplaces).length} unique-unit replacements → ${OUT_REPLACES}`);
const total = Object.values(out).reduce((n, l) => n + l.length, 0);
console.log(`${files} data files → ${Object.keys(out).length} kinds, ${total} types → ${OUT}`);
