import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { CIV6_SAVES_ROOT } from './constants';

const MODES = ['Hotseat', 'Single', 'Multi'] as const;

export interface ListedSave {
    path: string;
    mode: string;
    name: string;
    mtimeMs: number;
    bytes: number;
    auto: boolean;
}

function walkSaves(dir: string, mode: string, auto: boolean, out: ListedSave[]): void {
    if (!existsSync(dir)) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, ent.name);
        if (ent.isDirectory()) {
            walkSaves(full, mode, auto || ent.name === 'auto' || ent.name === 'prev', out);
            continue;
        }
        if (!ent.name.endsWith('.Civ6Save')) continue;
        const st = statSync(full);
        out.push({
            path: full,
            mode,
            name: ent.name,
            mtimeMs: st.mtimeMs,
            bytes: st.size,
            auto,
        });
    }
}

export function listCiv6Saves(options?: { includeAuto?: boolean; root?: string }): ListedSave[] {
    const root = options?.root ?? CIV6_SAVES_ROOT;
    const includeAuto = options?.includeAuto ?? false;
    const out: ListedSave[] = [];
    for (const mode of MODES) walkSaves(join(root, mode), mode, false, out);
    return out
        .filter(s => includeAuto || !s.auto)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** Resolve a path or a save filename under the Civ6 Saves tree. */
export function resolveCiv6SavePath(input: string, root = CIV6_SAVES_ROOT): string {
    if (existsSync(input)) return input;
    const underRoot = join(root, input);
    if (existsSync(underRoot)) return underRoot;
    const matches = listCiv6Saves({ includeAuto: true, root }).filter(
        s => s.name === input || s.name === `${input}.Civ6Save` || s.path.endsWith(input),
    );
    if (matches.length === 1) return matches[0].path;
    if (matches.length > 1) {
        const manual = matches.filter(s => !s.auto);
        if (manual.length === 1) return manual[0].path;
        throw new Error(`Ambiguous save name ${input}:\n${matches.map(m => m.path).join('\n')}`);
    }
    throw new Error(`Save not found: ${input} (looked in ${root})`);
}

export function formatSaveList(saves: ListedSave[], limit = 20): string {
    return saves.slice(0, limit).map(s => {
        const t = new Date(s.mtimeMs).toISOString().replace('T', ' ').slice(0, 19);
        const kind = s.auto ? 'auto' : 'manual';
        return `${t}  ${s.mode.padEnd(8)} ${kind.padEnd(6)} ${s.bytes.toString().padStart(8)}  ${s.name}`;
    }).join('\n');
}

export function twoLatestManual(mode: 'Hotseat' | 'Single' | 'Multi' = 'Hotseat'): [ListedSave, ListedSave] {
    const saves = listCiv6Saves().filter(s => s.mode === mode);
    if (saves.length < 2) {
        throw new Error(`Need two manual ${mode} saves in ${CIV6_SAVES_ROOT}/${mode}; found ${saves.length}`);
    }
    return [saves[1], saves[0]];
}
