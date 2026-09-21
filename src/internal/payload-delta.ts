export interface ChangedWindow {
    offset: number;
    length: number;
    before: Buffer;
    after: Buffer;
}

export interface PayloadDelta {
    beforeLength: number;
    afterLength: number;
    prefixLength: number;
    suffixLength: number;
    sameLength: boolean;
    windows: ChangedWindow[];
    changedBytes: number;
}

const DEFAULT_MERGE_GAP = 48;
const DEFAULT_CONTEXT = 16;
const DEFAULT_MAX_WINDOWS = 40;

function commonPrefix(a: Buffer, b: Buffer): number {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a[i] === b[i]) i++;
    return i;
}

function commonSuffix(a: Buffer, b: Buffer, prefix: number): number {
    const maxA = a.length - prefix;
    const maxB = b.length - prefix;
    const n = Math.min(maxA, maxB);
    let i = 0;
    while (i < n && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
    return i;
}

/** Merge nearby byte diffs so a 4-byte int change is one window, not four. */
export function findChangedWindows(
    before: Buffer,
    after: Buffer,
    options?: { mergeGap?: number; maxWindows?: number },
): PayloadDelta {
    const mergeGap = options?.mergeGap ?? DEFAULT_MERGE_GAP;
    const maxWindows = options?.maxWindows ?? DEFAULT_MAX_WINDOWS;
    const prefixLength = commonPrefix(before, after);
    const suffixLength = commonSuffix(before, after, prefixLength);
    const sameLength = before.length === after.length;

    const aStart = prefixLength;
    const aEnd = before.length - suffixLength;
    const bStart = prefixLength;
    const bEnd = after.length - suffixLength;

    const windows: ChangedWindow[] = [];
    let changedBytes = 0;

    if (aEnd <= aStart && bEnd <= bStart) {
        return {
            beforeLength: before.length,
            afterLength: after.length,
            prefixLength,
            suffixLength,
            sameLength,
            windows: [],
            changedBytes: 0,
        };
    }

    if (!sameLength || aEnd - aStart !== bEnd - bStart) {
        const aSlice = before.subarray(aStart, Math.max(aStart, aEnd));
        const bSlice = after.subarray(bStart, Math.max(bStart, bEnd));
        windows.push({
            offset: prefixLength,
            length: Math.max(aSlice.length, bSlice.length),
            before: aSlice,
            after: bSlice,
        });
        changedBytes = Math.max(aSlice.length, bSlice.length);
        return {
            beforeLength: before.length,
            afterLength: after.length,
            prefixLength,
            suffixLength,
            sameLength,
            windows,
            changedBytes,
        };
    }

    let runStart = -1;
    for (let i = aStart; i < aEnd; i++) {
        const differ = before[i] !== after[i];
        if (differ && runStart < 0) runStart = i;
        if (!differ && runStart >= 0) {
            windows.push({
                offset: runStart,
                length: i - runStart,
                before: before.subarray(runStart, i),
                after: after.subarray(runStart, i),
            });
            changedBytes += i - runStart;
            runStart = -1;
        }
    }
    if (runStart >= 0) {
        windows.push({
            offset: runStart,
            length: aEnd - runStart,
            before: before.subarray(runStart, aEnd),
            after: after.subarray(runStart, aEnd),
        });
        changedBytes += aEnd - runStart;
    }

    const merged: ChangedWindow[] = [];
    for (const w of windows) {
        const last = merged[merged.length - 1];
        if (last && w.offset - (last.offset + last.length) <= mergeGap) {
            const end = w.offset + w.length;
            const start = last.offset;
            last.length = end - start;
            last.before = before.subarray(start, end);
            last.after = after.subarray(start, end);
        } else {
            merged.push({ ...w });
        }
    }

    return {
        beforeLength: before.length,
        afterLength: after.length,
        prefixLength,
        suffixLength,
        sameLength,
        windows: merged.slice(0, maxWindows),
        changedBytes,
    };
}

export function hexDump(buf: Buffer, maxBytes = 96): string {
    const slice = buf.subarray(0, maxBytes);
    const lines: string[] = [];
    for (let i = 0; i < slice.length; i += 16) {
        const chunk = slice.subarray(i, i + 16);
        const hex = [...chunk].map(b => b.toString(16).padStart(2, '0')).join(' ');
        const ascii = [...chunk].map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
        lines.push(`${i.toString(16).padStart(4, '0')}  ${hex.padEnd(47)}  ${ascii}`);
    }
    if (buf.length > maxBytes) lines.push(`... (${buf.length} bytes total)`);
    return lines.join('\n');
}

export function windowWithContext(
    payload: Buffer,
    offset: number,
    length: number,
    context = DEFAULT_CONTEXT,
): Buffer {
    const start = Math.max(0, offset - context);
    const end = Math.min(payload.length, offset + length + context);
    return payload.subarray(start, end);
}

export function classifyRegion(
    offset: number,
    tileStart: number,
    tileEnd: number,
): 'header-or-pre-map' | 'tile-section' | 'post-map' {
    if (offset < tileStart) return 'header-or-pre-map';
    if (offset < tileEnd) return 'tile-section';
    return 'post-map';
}

export function nearbyInt32s(buf: Buffer): number[] {
    const out: number[] = [];
    for (let i = 0; i + 4 <= Math.min(buf.length, 96); i += 4) {
        out.push(buf.readInt32LE(i));
    }
    return out;
}
