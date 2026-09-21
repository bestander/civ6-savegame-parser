/**
 * The order Civ6 stores a city's 37 workable plots in: the centre, then rings 1–3,
 * each ring starting at the plot straight "below" the centre (offset y+1 on the same column
 * for even rows) and walking around it. Fitted against the oracle's worked-plot sets of all
 * ten cities of the cit-a capture; no other start direction or sense matches even one.
 */

/** Cube-coordinate steps, in the walking order. */
const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const START_DIR = 5;
export const CITY_RING_PLOTS = 37;

function toCube(x: number, y: number): [number, number] {
    // Odd rows are shifted right (odd-r offset layout).
    return [x - (y - (y & 1)) / 2, y];
}

function fromCube(q: number, r: number): { x: number; y: number } {
    return { x: q + (r - (r & 1)) / 2, y: r };
}

/** The 37 plots around a centre in storage order (index 0 = the centre). Off-map plots are not clipped. */
export function cityRingPlots(cx: number, cy: number): Array<{ x: number; y: number }> {
    const [q0, r0] = toCube(cx, cy);
    const out: Array<{ x: number; y: number }> = [{ x: cx, y: cy }];
    for (let k = 1; k <= 3; k++) {
        let q = q0 + DIRS[START_DIR]![0] * k, r = r0 + DIRS[START_DIR]![1] * k;
        for (let side = 0; side < 6; side++) {
            const d = DIRS[(START_DIR + side + 2) % 6]!;
            for (let s = 0; s < k; s++) {
                out.push(fromCube(q, r));
                q += d[0]; r += d[1];
            }
        }
    }
    return out;
}
