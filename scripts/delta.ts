/**
 * Pairwise .Civ6Save delta for instance-block RE.
 *
 *   npm run delta -- --list
 *   npm run delta -- --latest-hotseat --change "warrior took one hit"
 *   npm run delta -- --before "ALEXANDER 1 4000 BC.Civ6Save" --after "ALEXANDER 3 3840 BC.Civ6Save"
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { basename, join, resolve } from 'path';
import { parseCiv6Save, decompressCiv6Payload } from '../src/internal/index';
import type { Civ6SaveParsed } from '../src/internal/index';
import { CIV6_SAVES_ROOT } from '../src/internal/constants';
import {
    formatSaveList,
    listCiv6Saves,
    resolveCiv6SavePath,
    twoLatestManual,
} from '../src/internal/save-paths';
import {
    findChangedWindows,
    hexDump,
    nearbyInt32s,
    windowWithContext,
} from '../src/internal/payload-delta';

function arg(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    if (i < 0 || i + 1 >= process.argv.length) return undefined;
    return process.argv[i + 1];
}

function summarize(parsed: Civ6SaveParsed): string {
    const civs = parsed.players.fullCivs
        .map(p => `${p.civilization}/${p.leader}${p.isCurrentTurn ? ' (current)' : ''}`)
        .join(', ');
    const unitCount = parsed.unitStacks.reduce((n, s) => n + s.count, 0);
    return [
        `- turn ${parsed.metadata.turn} ${parsed.metadata.gameSpeed} ${parsed.metadata.mapSize}`,
        `- full civs: ${civs || '(none)'}`,
        `- map ${parsed.map.width}x${parsed.map.height} tiles=${parsed.map.tileCount} owned=${parsed.map.tiles.filter(t => t.ownership).length}`,
        `- cities=${parsed.cities.length} unitStacks=${parsed.unitStacks.length} units≈${unitCount}`,
        `- tile section payload [${parsed.map.tileSectionStart}..${parsed.map.tileSectionEnd})`,
    ].join('\n');
}

function unitStackDiff(a: Civ6SaveParsed, b: Civ6SaveParsed): string[] {
    const key = (s: { x: number; y: number }) => `${s.x},${s.y}`;
    const before = new Map(a.unitStacks.map(s => [key(s), s]));
    const after = new Map(b.unitStacks.map(s => [key(s), s]));
    const lines: string[] = [];
    for (const [k, s] of after) {
        const prev = before.get(k);
        if (!prev) lines.push(`+ stack (${k}) count=${s.count} owner=${s.ownerId}`);
        else if (prev.count !== s.count) {
            lines.push(`~ stack (${k}) count ${prev.count} -> ${s.count}`);
        }
    }
    for (const [k, s] of before) {
        if (!after.has(k)) lines.push(`- stack (${k}) count=${s.count} owner=${s.ownerId}`);
    }
    return lines;
}

function cityDiff(a: Civ6SaveParsed, b: Civ6SaveParsed): string[] {
    const key = (c: { ownerId: number; cityIndex: number }) => `${c.ownerId}:${c.cityIndex}`;
    const before = new Map(a.cities.map(c => [key(c), c]));
    const after = new Map(b.cities.map(c => [key(c), c]));
    const lines: string[] = [];
    for (const [k, c] of after) {
        const prev = before.get(k);
        if (!prev) {
            lines.push(`+ city ${k} center=${c.center ? `${c.center.x},${c.center.y}` : '?'}`);
            continue;
        }
        if (prev.ownedTileCount !== c.ownedTileCount) {
            lines.push(`~ city ${k} owned tiles ${prev.ownedTileCount} -> ${c.ownedTileCount}`);
        }
        if ((prev.yields?.population ?? null) !== (c.yields?.population ?? null)) {
            lines.push(`~ city ${k} pop ${prev.yields?.population} -> ${c.yields?.population}`);
        }
    }
    return lines;
}

function hasFlag(flag: string): boolean {
    return process.argv.includes(flag);
}

function main(): void {
    if (hasFlag('--list')) {
        const includeAuto = hasFlag('--auto');
        console.log(`Civ6 saves in:\n  ${CIV6_SAVES_ROOT}\n`);
        console.log(formatSaveList(listCiv6Saves({ includeAuto }), 40));
        return;
    }

    const pairDir = arg('--pair');
    let beforePath = pairDir ? join(pairDir, 'before.Civ6Save') : arg('--before');
    let afterPath = pairDir ? join(pairDir, 'after.Civ6Save') : arg('--after');
    const notesPath = arg('--notes')
        ?? (pairDir && existsSync(join(pairDir, 'notes.md')) ? join(pairDir, 'notes.md') : undefined);
    const changeNote = arg('--change') ?? '';

    if (hasFlag('--latest-hotseat')) {
        const [older, newer] = twoLatestManual('Hotseat');
        beforePath = older.path;
        afterPath = newer.path;
        console.error(`latest Hotseat pair:\n  before ${older.name}\n  after  ${newer.name}`);
    }

    if (!beforePath || !afterPath) {
        console.error(`Civ6 save root: ${CIV6_SAVES_ROOT}

Usage:
  npm run delta -- --list
  npm run delta -- --latest-hotseat --change "warrior took one hit"
  npm run delta -- --before <name-or-path> --after <name-or-path> [--change "..."]`);
        process.exit(1);
    }

    beforePath = resolveCiv6SavePath(beforePath);
    afterPath = resolveCiv6SavePath(afterPath);

    const beforeBuf = readFileSync(beforePath);
    const afterBuf = readFileSync(afterPath);
    const fileNotes = notesPath && existsSync(notesPath) ? readFileSync(notesPath, 'utf8').trim() : '';
    const notes = [changeNote, fileNotes].filter(Boolean).join('\n\n');

    const parsedBefore = parseCiv6Save(beforeBuf);
    const parsedAfter = parseCiv6Save(afterBuf);
    const payloadBefore = decompressCiv6Payload(beforeBuf);
    const payloadAfter = decompressCiv6Payload(afterBuf);

    const tileStart = parsedAfter.map.tileSectionStart;
    const tileEnd = parsedAfter.map.tileSectionEnd;
    const stacks = unitStackDiff(parsedBefore, parsedAfter);
    const cities = cityDiff(parsedBefore, parsedAfter);

    const regions: Array<{ name: string; ba: Buffer; bb: Buffer; base: number }> = [
        { name: 'pre-map (fog / observers)', ba: payloadBefore.subarray(0, tileStart), bb: payloadAfter.subarray(0, tileStart), base: 0 },
        { name: 'tile-section', ba: payloadBefore.subarray(tileStart, tileEnd), bb: payloadAfter.subarray(tileStart, tileEnd), base: tileStart },
        { name: 'post-map (instances)', ba: payloadBefore.subarray(tileEnd), bb: payloadAfter.subarray(tileEnd), base: tileEnd },
    ];

    const regionReports = regions.map(r => {
        const delta = findChangedWindows(r.ba, r.bb, { mergeGap: 8, maxWindows: 20 });
        const windowLines = delta.windows.map((w, i) => {
            const abs = r.base + w.offset;
            const ctxBefore = windowWithContext(r.ba, w.offset, w.before.length);
            const ctxAfter = windowWithContext(r.bb, w.offset, w.after.length);
            const showHex = w.before.length <= 256 && w.after.length <= 256;
            return [
                `### ${r.name} window ${i + 1} @ payload +${abs}`,
                `- length before=${w.before.length} after=${w.after.length}`,
                `- nearby int32 LE (after): ${nearbyInt32s(w.after).join(', ') || '(empty)'}`,
                showHex ? ['', 'before:', '```', hexDump(ctxBefore), '```', 'after:', '```', hexDump(ctxAfter), '```'].join('\n')
                    : '- (window too large to hex-dump; likely a length-changing list — use a smaller in-game action or inspect this offset in ImHex)',
            ].join('\n');
        });
        return [
            `## ${r.name}`,
            `- bytes ${r.ba.length} -> ${r.bb.length} (delta ${r.bb.length - r.ba.length})`,
            `- sameLength=${delta.sameLength} changedBytes≈${delta.changedBytes} windows=${delta.windows.length}`,
            '',
            windowLines.join('\n\n') || '_(identical)_',
        ].join('\n');
    });

    const report = [
        '# Civ6Save delta report',
        '',
        `before: \`${basename(beforePath)}\` (${beforeBuf.length} file bytes, ${payloadBefore.length} payload)`,
        `after: \`${basename(afterPath)}\` (${afterBuf.length} file bytes, ${payloadAfter.length} payload)`,
        '',
        notes ? `## Notes\n\n${notes}\n` : '',
        '## Parsed summary',
        '',
        '### Before',
        summarize(parsedBefore),
        '',
        '### After',
        summarize(parsedAfter),
        '',
        '## Parsed diffs we already understand',
        '',
        stacks.length ? stacks.map(l => `- ${l}`).join('\n') : '- unit stacks: no change',
        cities.length ? cities.map(l => `- ${l}`).join('\n') : '- cities: no change',
        '',
        regionReports.join('\n\n'),
        '',
    ].join('\n');

    const outDir = resolve(arg('--out') ?? join(__dirname, '../.debug'));
    mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outPath = join(outDir, `${stamp}-delta-report.md`);
    writeFileSync(outPath, report);
    console.log(report);
    console.log(`\nwrote ${outPath}`);
}

main();
