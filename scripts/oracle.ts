/**
 * Print or export the oracle dump carried by a save.
 *
 *   npm run oracle -- <save.Civ6Save>            # summary per player
 *   npm run oracle -- <save.Civ6Save> out.json   # the dump as JSON
 *
 * The mod (src/civ6save/lua/SaveOracle, `install-oracle.sh`) writes the dump into the game
 * properties on load and at every turn start; see src/civ6save/oracle.ts for the framing.
 */
import { readFileSync, writeFileSync } from 'fs';
import { decompressCiv6Payload } from '../src/internal/decompress';
import { readLabLog, readOracleDump, readPlanLog } from '../src/internal/oracle';

function main() {
    const [save, out] = process.argv.slice(2);
    if (!save) { console.error('usage: civ6save-oracle <save.Civ6Save> [out.json]'); process.exit(1); }
    const payload = decompressCiv6Payload(readFileSync(save));
    const lab = readLabLog(payload);
    if (lab) console.log(`Lab applied:\n${lab.split('\n').map(l => `  ${l}`).join('\n')}`);
    const plan = readPlanLog(payload);
    if (plan) console.log(`Capture run:\n${plan.split('\n').map(l => `  ${l}`).join('\n')}`);
    const dump = readOracleDump(payload);
    if (!dump) { console.error('no oracle dump in this save — was it made with the oracle mod enabled?'); process.exit(1); }
    if (out) {
        writeFileSync(out, JSON.stringify(dump, null, 1));
        console.log(`wrote ${out} (${dump.reason} turn ${dump.turn})`);
        return;
    }
    console.log(`${dump.reason} turn ${dump.turn}, current player ${dump.currentPlayer}`);
    for (const p of dump.players) {
        console.log(`#${p.id} ${p.civilization} ${p.human ? 'human' : 'ai'} gold ${p.gold} (+${p.goldPerTurn}) faith ${p.faith} score ${p.score} era ${p.eraScore} | war with ${p.diplomacy.filter(d => d.war).map(d => d.player).join(',') || '-'} envoys ${p.envoys.map(e => `${e.cityState}:${e.envoys}`).join(' ') || '-'}`);
        for (const c of p.cities) console.log(`   ${c.name} (${c.x},${c.y}) pop ${c.population} food ${c.food}/${c.growthThreshold} hp ${c.hp}/${c.maxHp} -> ${c.production} ${c.productionProgress ?? '?'}/${c.productionCost ?? '?'} | ${c.buildings.join(',')} | ${c.districts.map(d => `${d.type}@${d.x},${d.y}${d.complete ? '' : '(wip)'}`).join(' ')}`);
        for (const u of p.units) console.log(`   ${u.type} (${u.x},${u.y}) dmg ${u.damage}/${u.maxDamage} mp ${u.moves}/${u.maxMoves} xp ${u.xp} lvl ${u.level} formation ${u.militaryFormation} promos ${u.promotions.join(',')}`);
    }
}

main();
