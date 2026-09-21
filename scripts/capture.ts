/**
 * Drive Civ6 through one automated capture:
 *
 *   npm run capture -- --load "lab9-6" --name "auto-1" [--turns 2] [--timeout 600]
 *
 * Writes the plan the oracle mod executes once a game is loaded (dump → save `<name>-1`
 * → optional AI turns → save `<name>-2`), launches Civ6 through Steam, waits for the saves to
 * appear, kills the game and prints the oracle of the last save.
 *
 * What still needs a hand (or Claude's desktop tools — see scripts/civ6-click.sh for the
 * coordinates): the Aspyr launcher's Play button, and loading the save from the main menu
 * (Multiplayer → Hot Seat → Load Game → the file → Load → Start → Start Turn). `PlayNowSave`
 * cannot load hotseat saves and mods get no front-end Lua, so there is no way around those
 * clicks. AutoplayManager runs the AI but does not pass hotseat turns.
 */
import { execSync, spawnSync } from 'child_process';
import { existsSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

const HOME = process.env.HOME!;
const APP_SUPPORT = join(HOME, 'Library/Application Support/Sid Meier\'s Civilization VI');
const HOTSEAT = join(APP_SUPPORT, 'Sid Meier\'s Civilization VI/Saves/Hotseat');
const MOD_PLAN = join(APP_SUPPORT, 'Sid Meier\'s Civilization VI/Mods/SaveOracle/Plan.lua');
const STEAM_APP_ID = 289070;

function arg(flag: string, fallback?: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : fallback;
}

function civRunning(): boolean {
    return spawnSync('pgrep', ['-f', 'Civ6.app/Contents/MacOS']).status === 0;
}

function quitCiv() {
    spawnSync('osascript', ['-e', 'tell application "Civ6" to quit']);
    spawnSync('pkill', ['-f', 'Civ6.app/Contents/MacOS']);
    spawnSync('pkill', ['-f', 'LaunchPad']);
}

function sleep(ms: number) { execSync(`sleep ${Math.ceil(ms / 1000)}`); }

async function main() {
    const load = arg('--load'); const name = arg('--name');
    if (!load || !name) { console.error('usage: civ6-run --load <save name> --name <output name> [--turns N] [--timeout S]'); process.exit(1); }
    const turns = Number(arg('--turns', '0'));
    const timeout = Number(arg('--timeout', '600')) * 1000;
    const loadPath = load.endsWith('.Civ6Save') ? (existsSync(load) ? load : join(HOTSEAT, load)) : join(HOTSEAT, `${load}.Civ6Save`);
    if (!existsSync(loadPath)) throw new Error(`no such save: ${loadPath}`);
    if (civRunning()) throw new Error('Civ6 is already running; quit it first');

    // `--actions '{ { city = {1, 65536}, command = "MANAGE", params = { X = 38, Y = 20 } } }'` — UI
    // commands the plan runs between the `-1` and `-2` saves (a Lua table literal).
    const actions = arg('--actions');
    writeFileSync(MOD_PLAN, `-- written by civ6-run\nPLAN = { name = ${JSON.stringify(name)}, turns = ${turns}, settleSeconds = 20, secondsPerTurn = 30, actions = ${actions ?? 'nil'} }\n`);
    const expected = [join(HOTSEAT, `${name}-1.Civ6Save`), ...(turns > 0 || actions ? [join(HOTSEAT, `${name}-2.Civ6Save`)] : [])];
    const before = new Map(expected.map(f => [f, existsSync(f) ? statSync(f).mtimeMs : 0]));
    console.log(`launching Civ6 with ${loadPath} → ${expected.map(f => f.split('/').pop()).join(', ')}`);
    // The Steam entry opens Aspyr's LaunchPad, whose Play button has to be pressed (the driver
    // waits for the saves either way).
    spawnSync('open', [`steam://rungameid/${STEAM_APP_ID}`]);

    const t0 = Date.now();
    let done = false;
    while (Date.now() - t0 < timeout) {
        sleep(5000);
        if (expected.every(f => existsSync(f) && statSync(f).mtimeMs > before.get(f)!)) { done = true; break; }
    }
    sleep(8000);
    quitCiv();
    if (!done) { console.error(`timed out after ${timeout / 1000}s; saves present: ${expected.filter(f => existsSync(f)).length}/${expected.length}`); process.exit(2); }
    console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s`);
    const last = expected[expected.length - 1]!;
    spawnSync('npm', ['run', '-s', 'oracle', '--', last], { stdio: 'inherit' });
}

main().catch(e => { console.error(e.message); process.exit(1); });
