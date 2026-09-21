# Civ6Save instance reverse-engineering

Working notes kept while the parser was reverse-engineered, in the order things were learned.
The README summarizes them; this file keeps the detail (offsets, captures, dead ends).

Saves live under the game's user folder (`CIV6_SAVES_ROOT`, on macOS
`~/Library/Application Support/Sid Meier's Civilization VI/Sid Meier's Civilization VI/Saves`);
hotseat manuals are under `Hotseat/`, autosaves under `Hotseat/auto/`. The scripts resolve save
names against that tree; reports go to the gitignored `.debug/`.

## Your loop

1. In Civ6, **Save Game** (not autosave) as a named file, e.g. `re-before`.
2. Do **one** action (wound a unit, move 1 hex, queue a building).
3. Save again as `re-after` (or overwrite a second name).
4. Tell the agent what changed. We run:

```bash
cd server
npm run delta -- --list
npm run delta -- --latest-hotseat --change "warrior at capital took one hit, HP 100 -> ~87"
# or by filename (resolved under the Saves tree):
npm run delta -- --before re-before.Civ6Save --after re-after.Civ6Save --change "..."
```

## Best first pairs (one change each)

Use the Alexander tiny hotseat, not the 6-player PYDT game.

| Pair | In-game action | What we hope to see |
|---|---|---|
| unit-damage | Attack so one warrior is wounded; **do not move** others | HP / damage int |
| unit-move | Move one unit 1 hex, no combat | Plot x,y in the instance record |
| unit-xp | Kill a barb; same unit otherwise | XP / level |
| queue-building | Queue Granary, 0 hammers vs partway | Type hash + production progress |

Decoded so far: current queue item is a type hash on the city object; **hammers are `uint32` 256ths** in a per-type table (`5` hammers = `1280`). Switching items keeps the old type's progress.
| research-tick | Same turn vs after 1 turn of Pottery | Current tech + remaining science |

`--change` is the ground truth we cannot see from the file yet.

## FireTuner (faster than playing the action)

Lua cannot write a `.Civ6Save`. It *can* apply one mutation so you only hit Save.

1. `EnableTuner 1` in `AppOptions.txt` (same folder as `Saves/`), restart Civ6.
2. FireTuner → attach → Lua console, **GameCore** context.
3. `dofile("<repo>/mods/SaveRE.lua")`
4. Save `before-FOO` → `SaveRE.pair("slinger")` (or `SaveRE.damage(22)` on a selected unit) → Save `after-FOO`.

`SaveRE.help()` lists recipes aligned with the pair list above.

## 2026-09-19 — the hash formula, and what it makes unnecessary

**Every type hash in the save is `~crc32(typeName)`** — CRC-32 of the database type name with
the final complement left out (`civ6Hash` in `hash-tables.ts`). Tile fields store it
byte-swapped, instance records straight. Verified against all 216 entries of the Data Sheet
tables and every hash the pairs decoded. `data/civ6-types.json` (7131 types in 89 kinds, from
the game's own XML via `npm run types`) is therefore the complete dictionary; the
"one save pair per unit type" list is closed.

**State is stored as typed tables.** An object's per-type state is a run of `{hash, value}`
entries of one kind at one stride; `typed-tables.ts` finds them all (25 k in the PYDT save,
270 ms). What the census shows:

| object | tables (stride, entries) | meaning |
|---|---|---|
| unit (133 in PYDT) | `ABILITY s8 n205`, `PROMOTION s5 n145`, `UNITOPERATION s5 n63`, … | abilities with counts; promotions as u8 flags |
| player | `TECH s5 n77` ×2 then `TECH s8 n77` | researched flags, boost flags, progress ×256 |
| player | `CIVIC s5 n61` ×2 then `CIVIC s8 n61` | same shape |
| player | `POLICY s5 n140`, `GOVERNMENT s8 n13` | unlocked/slotted flags; government flags + legacy totals |
| city | `UNIT/BUILDING/DISTRICT s8` | production progress ×256 per type (pairs 3–5) |

So "in-progress tech is hash-only" is over: the progress table names it. Tools:

```bash
npm run tables -- "<save>"                    # census of table signatures
npm run tables -- "<save>" --kind KIND_TECH   # every tech table with its non-zero entries
npm run tables -- "<save>" --near <offset>    # what a unit/city/player record carries
npm run annotate -- "<save>" --near <offset>  # every type reference around an offset
```

Pairs are still the tool for *semantics* (which of the two flag tables is "slotted", whether
the government value is current or unlocked) — but one pair now answers a question for every
kind at once, not one type at a time. Ground truth without FireTuner: the game's own
`Logs/*.csv` (`Player_Stats.csv` techs/civics/gold per player, `City_BuildQueue.csv`
production progress, `CombatLog.csv`) are rewritten every session and line up with a save
taken in that session.

## The oracle is the save itself (2026-09-20)

The Mac build writes no `Lua.log`, and `GameConfiguration.SetValue` from a mod does not reach
the save header. What does: **game properties**. `Game:SetProperty(key, string)` exists in the
gameplay-script context (not the UI one — a mod component `AddGameplayScripts` runs there) and
is serialized with the game core, so the value sits in the inflated payload as

```
u16 keyLen, key, u32 5 (= string), u24 len (NUL included) + u8 0x21, u32 1, value, NUL
```

`SaveOracle` therefore stores a JSON dump of the live state (`ORACLE_JSON`; the UI
context's richer dump goes through `ExposedMembers` as `ORACLE_UI_JSON`) on load and at
every turn start. **Every save made with the mod enabled carries its own ground truth**, one
JSON per save, no log folders, no per-player screenshots. `src/civ6save/oracle.ts` reads it;
`npm run oracle -- <save>` prints it.

Round trips it took to get there: 6 (no channel → property channel probe → `cd:Members()` is
UI-only → `IsMinor()` is UI-only → every engine call behind a safe accessor → full dump). Lesson:
the two Lua contexts expose different API subsets and a missing method is a hard error with no
log, so the dump routes every call through `m(obj, "Method", …)` and captures the error text of
a failed dump into a property (`ORACLE_ERROR`) — the only way to see a traceback on Mac.

What one dump pinned, with 8 players and 8 cities intersected in one pass:

| value | where | check |
|---|---|---|
| treasury | player: researched-techs table + 1410, int32 ×256 | 8/8 oracle; monotone over 31 catalog saves |
| gold per turn | + 1418, ×256 | 8/8 |
| faith, pantheon | player: `20, faith×256, 0, BELIEF_* \| -1, n, x, y` a variable distance before the `PROMOTION_CLASS s8` table | 8/8; PYDT majors 157 / 127 / 45 / 0 / 119 with their pantheons |
| population, original owner | city header `id, x, y, owner, originalOwner, owner, -1, id, pop` 1119–1661 bytes before the `LOC_CITY_NAME_` string, `id = (i+1)<<16 \| i` | 8/8; all 25 PYDT cities resolve to their centre tile |

Score is not stored (computed live). Era score, food stock and production progress are in the
UI dump only — next capture.

**UI context (2026-09-20, `oracle-8`).** `AddUserInterfaces` needs an XML context file
(`SaveOracle.xml`, an empty hidden `<Context>`); the `.lua` of the same name loads with it. The
UI dump reaches the save through `ExposedMembers.SaveOracle.SetProperty` (the gameplay context
exposes `Game:SetProperty`). It adds food stock, growth threshold, housing, unit levels — but
hides other players' build queues, so the reader merges the two dumps field by field. Pinned:
**food stock ×256, 208 bytes before the first `YIELD s8 n6` table after the city's `UNIT s8
n144` table** (the name and a variable block sit between the name and that table, so nothing
past the name is at a fixed distance from it). Threshold, housing, surplus and turns-to-grow
are not stored.

## the lab mod: the scenarios come from a mod, not from play (2026-09-20, `lab-3`/`lab-4`)

`src/civ6save/lua/SaveLab` is a gameplay script that manufactures the states the parser needed
(a wonder 40% built and one complete, a damaged city and unit, a declared war, a corps, a civic
grant) on load, once per game, and records each step's outcome in the `LAB_LOG` property
(`npm run oracle` prints it). One capture (`lab-3` right after, `lab-4` a turn later)
replaced the whole "play until X happens" list. Gotchas: a mod marked `AffectsSavedGames=1`
is not applied to a save that was made without it (the flag is 0 now); enabling a mod in the
menu can silently untick another (check both after every version bump); the oracle's load dump
runs *before* the lab's, so the state is in the next turn's dump.

| value | where | check |
|---|---|---|
| city damage | district record: `hash, garrisonDamage, wallsDamage, lastDamagedTurn (-100 never)` | Cairo 30 after the hit, 10 a turn later; on the game's 0–200 city HP scale |
| corps / army | unit record +45 (byte 1 of +44): 0 / 1 / 2, -1 on great people | the lab's Warrior corps, oracle `militaryFormation` |
| great people | unit records with -1 at +4 (the `kind` filter was 1..4) | the Prophet Stonehenge spawned; PYDT's too |
| wonder standing | `BUILDING_*` in the built-buildings tables with its plot | Stonehenge on 16,17; PYDT Canberra |
| wonder in production | current production `BUILDING_*` with hammers; plot in the first `BUILDING s6` table | Pyramids 44 hammers, plot 18,17 |
| diplomacy | per player, after its tech tables: one state machine per slot in id order, `u32 other, u32 len, "DIPLO_STATE_<current>", 00 xx yy zz blob, reachable states…` | Macedon↔Arabia `WAR` both ways; PYDT reads as the 2v2v2 it was (`ALLIED`/`WAR`), 54 slots per player |

Max HP: units are always 100, city centres 200 (+ walls as `wallsDamage`), the
the same ×256 scale. Not stored: score, housing, growth threshold, surplus.

**Era score (2026-09-20).** Not on the player object at all: it is a hall-of-fame graph,
`REPLAYDATASET_ERASCORE`, in the replay-dataset region near the end of the payload —
`[len]name [len]LOC_HOF_… label, 5 bytes, u32 1, u32 count, (player, turn, value×256)…`
(`readReplayDataset`). The other graphs there (`SCOREPERTURN`, `TOTALGOLD`, `CULTURE`, …) read the
same way and are per-turn history for anything the parser wants later.

**Trade routes and envoys (2026-09-20, `route-6`).** A route in progress is not a player-level
record: it is the Trader's active *unit operation*. Right before the unit's `UNITOPERATION s5`
flag table: `u32 count`, then 56-byte records `hash, 2, -1, 0, turnStarted, id, -1, 1, 0, destX,
destY, originX, originY, -1` — `UNITOPERATION_MAKE_TRADE_ROUTE` from Pella to Bandar Brunei on
turn 17, and Poland's Trader on the PYDT save mid-way to Nazca. Requesting the route from a
gameplay script fails (UI-side operation), so the lab spawns the Trader and the route is made
by hand — after `Players[id]:GetDiplomacy():SetHasMet` and `PlayersVisibility[id]:
ChangeVisibilityCount` over every plot, or nothing is a reachable destination. Envoy counts
are an int per player slot 1583 bytes ahead of the first diplomatic state block, in both the
city-state's object (received) and the major's (placed).

**Capture rule: save twice.** The oracle writes its dump *after* a save completes, so a save
carries the state as of the previous dump. Saving again immediately puts the current state
into the second save.

**Bug found on the way:** the header lists the city-states in an order that is not their
player-id order (hotseat: Mexico City, Jerusalem, Samarkand… vs ids Samarkand 2, Hong Kong 3,
Jerusalem 4…), and the mirror had been handing every city-state city to the wrong city-state.
The id order comes from the save body: a city-state's first city carries its name.

## Two consecutive late-game saves (turn 125/126, Phoenicia vs Byzantium duel, 2026-09-20)

No oracle, but consecutive turns are one: whatever must move by a small known amount between
them (food by a surplus, accumulated pressure by a rate) can be found by intersecting the
delta constraint over all cities. Fixed on the way: six slotted cards register as a `POLICY
s8` table and broke the policy walk (and with it the government); the food stock is 4969 past
the city's `UNIT s8` table (the `YIELD` table used before drifts 17 bytes late-game); a
captured city's id keeps the founder's running count in its high half (Buenos Aires 4/1); the
header's x,y is the centre. New: the founded religion record at the head of the player object
(`RELIGION, 0, turn, holyX, holyY, [len] name, n, BELIEF…` — "crab", turn 70, Tyre); unique
districts alias to what they replace. Loyalty could not be found: every city is at 100 in a
duel, so nothing to intersect.

## Citizen assignment captures (cit-a/cit-b, 2026-09-20)

The oracle now dumps every city plot (`Map.GetCityPlots():GetPurchasedPlots`) with its worked
flag and yields, the city's yields per type, favoured/disfavoured yields, and the
citizen-management targets (`CityManager.GetCommandTargets(city, MANAGE)`: plots, workers,
capacity, locked). The plan can run UI city commands between the `-1` and `-2` saves
(`--actions`) — but `CityManager.RequestCommand`/`CanStartCommand` answer false from the
hidden context even with the city selected and the turn active, so no diff came of it.

**Found without it:** worked plots are not in the tile record (no byte separates worked from
unworked owned tiles) and not an absolute plot index anywhere; they are a **37-entry u32
array** in the city object shortly after the name — `37, count×37, 37, zero×37` — one count
per workable plot in spiral order: the centre, then rings 1–3 each starting at the plot
straight below the centre (odd-r offset, cube direction (0,+1)) and walking around
(`city-plot-ring.ts`; the only start/sense of twelve that fits, and it fits all ten cities of
cit-a). The centre is always 1; the turn-126 duel save has every city at population+1 workers
and Nicomedia's district plot at 2 (specialists). The second array was all zero everywhere
seen (locked plots, presumably). Yield focus (favoured/disfavoured yields) is not pinned:
the oracle's `IsFavoredYield` was false for every yield in every city, nothing to diff.

Found on the way: **per-player improvement plot list** in the player object, right before the
governor block — `1, playerId, 1, 2, 0xBC9BE34F, 0, 0x578A381D, 0, 1, n, plotIndex×n`. Pella's
seven farms/mine/pasture, barbarians (63) list their outposts; goody huts are nobody's.

## Hand-played turns (end-a..d, 2026-09-21)

AutoplayManager never passes a hotseat turn, but the UI context can play one: pick a research
and a civic (`UI.RequestPlayerOperation` RESEARCH / PROGRESS_CIVIC), give idle cities a unit
(`CityManager.RequestOperation` BUILD), skip every unit, take the first dedication when one is
offered (`COMMEMORATE`), then `UI.RequestAction(ActionTypes.ACTION_ENDTURN)` — `plan.endTurns`
in Plan.lua. Only the hotseat "Start Turn" screen between turns still needs a click
(800,458) and a research/civic popup may need its X (822,172). Three turns take about two
minutes. `CityManager.RequestCommand` (citizen management, focus) stays refused from the
hidden context; operations are not.

**Eras:** the moment ledger in the tail — `count`, then records
`8, MOMENT_x, turn, x, y, player, index` with a variable blob after each (53 on end-d-2, 321
on the turn-126 duel, 163 on the PYDT save) — and, right after it, the dedications per player
slot: `A, 30, nChoices, COMMEMORATION×n, 0, nActive, COMMEMORATION×m` (Macedon RELIGIOUS,
Arabia SCIENTIFIC, as the oracle lists them; both MILITARY on the duel; none on the base-game
PYDT save). The oracle dumps the era start turn, countdown, min/max end turns, per-player
golden/dark thresholds, baseline and the choices.

**Tourism:** `GetStats():GetTourism()` is the per-turn rate (11 for both majors on
turns 19 → 31, Stonehenge and the Pyramids), not a stock; staycationers grow (1 → 4 for
Macedon over 12 turns), foreign tourists stay 0 this early. No stored stock is pinned yet.

**Loyalty:** the lab spawns a Settler for Arabia four tiles from Pella
(`units = {{1, "UNIT_SETTLER", 16, 13}}`; a script-made unit has no moves that turn, so the
plan's `eachTurn` hook asks `UnitOperationTypes.FOUND_CITY` until it takes). Sanaa sits at 54
loyalty, −23 a turn two turns later. The record is late in the city object: `14, loyalty×256,
perTurn×256, 0, …, INT_MIN at +44, …, LOYALTY_LEVEL_n at +60` (−1 on LPQY of the duel save,
which also has +0 a turn). Every city of loy-c, the duel and the PYDT saves reads.

**Followers:** the city religion records were misread before. Two shapes, each
led by `5`: the "no religion" entry `5, R, 2, 5, -1, followers, pressure×256` (R = the first
religion present — its 550 on lab9-6 was the unconverted citizens' pressure, not
Catholicism's), then per religion `5, R, followers, pressure×256, -255|-256, -1, 255`. Pella
on loy-c: 2 unconverted at 550, 8 Catholics at 2110.5, exactly the oracle. A city no religion
has reached stores nothing; the unconverted count is population and the pressure the game's
own (not 50 a head: Cairo 9 → 500). City-states move between a save and its dump, so the
tests check the majors' cities only, with a 2-point pressure tolerance.

**Fog of war:** the pre-map region is per-player visibility, one block per
player slot (0–7, then 62 free cities and 63 barbarians): `6, playerId, revealedCount, u8 0,
2280, u8[2280]` (revealed) then `2280, 60, 2280, u16[2280]` (visibility count; >0 = seen
now) and four more u16 plot arrays (fog memory of terrain/feature/improvement/owner,
presumably — not read). The oracle's PlayersVisibility matches for all eight players; PYDT
teams share sight (players 0/1, 2/4, 3/5 reveal identical sets). parse-visibility.ts.

**Grievances:** a matrix of the 2016 unordered player pairs in the tail,
`1, -1, 2016, (total, lastTurn)×2016`, reverse j-major (pair i<j at index
2015 − (j(j−1)/2 + (j−1−i))), then the log `count, (16, holder, against, amount, turn,
reason, arg)×count`. dip-a: 100 for Macedon's war on Arabia (turn 15), 300 for its war on
Samarkand (three city-state entries) — the oracle's ±100/±300 and its war-change turns;
war-b: both directions sum into the pair (100 + 50 = 150). The oracle now also dumps alliance
level, denounce turn, open borders, embassy/delegation, visibility level and the diplomatic
state index per pair; alliance levels are all 1 and no deals exist in these games, so those
stay unpinned (parse-grievances.ts).

## Tail map

16 KB buckets past the last player object, by what their hashes and strings say:

| offset (MB) | contents |
|---|---|
| 4.85–5.07 | AI weight tables: ABILITY/PROMOTION/IMPROVEMENT/DISTRICT/TECH hash lists, repeated per player |
| 5.07–5.10 | UNIT/YIELD tables (unit-class weights), the great-people ledger (`GREAT_PERSON_CLASS`, parse-great-people.ts) |
| 5.10–5.18 | DIPLOMATIC_ACTION hash lists ×~2000: the AI's diplomatic action state per pair; POLICY/SLOT/RESOLUTION lists |
| 5.18–5.25 | RESOURCE/FEATURE/TERRAIN/YIELD tables (map-level resource censuses), GOVERNOR_PROMOTION |
| 5.25–5.30 | BUILDING/TECH/UNIT tables, `UNITTYPE_*` and `DIFFICULTY_*` strings (game setup) |
| 5.30–5.33 | BELIEF tables (religion pools), YIELD tables |
| 5.34–5.36 | the historic-moment ledger (`MOMENT_*`, parse-eras.ts) and the dedications |
| 5.44–5.46 | the war records (`WAR_*`, parse-wars.ts) |
| 5.55–5.60 | two 2016-pair matrices (`0, 2016` and `1, -1, 2016`): grievances, then the grievance log; GOSSIP hashes (the gossip feed) |
| 5.61 | RESOLUTION (world congress; empty this early) |
| 5.64 | the game property store (`ORACLE_*` keys, the oracle dumps) |
| 5.66–5.80 | the property store's JSON payloads |
| 5.80–5.83 | `REQUIRES_*` requirement-set state (diplomatic action requirements) |
| 5.85–5.93 | GameEffects: `*_VICTORY_REQUIREMENT`, `TECHNOLOGY_VICTORY_*`, `DEFAULT_DEFEAT_REQUIREMENT` per player, then modifier instances (`ARGTYPE_IDENTITY`, `Amount`, …) — victory progress is only these requirement sets, no per-player counters |
| 5.95–5.97 | pending notifications: `…, NOTIFICATION_x, 5, id, 69/149/150, hash, 1, -1, …, NOTIFICATION_x, …, LOC_NOTIFICATION_*` strings (player, turn and the message keys) |
| 5.97–6.00 | REPLAYDATASET_* names (the graphs, parse-timelines.ts) |
| 6.02 | `GAME_SUMMARY`, `CONTEXT_ACHIEVEMENTS` |

Not found: an RNG state (no obvious 4×u32 seed block; the game may reseed), tourism stocks, space-race/religious victory counters (derived at runtime from the requirement
sets and the moments).

## Player object tables

Before the tech tables (offsets from the tech table, Macedon):
- `−18063 DISTRICT s8 n36` (27 for the centre, 73 elsewhere) and three zero `DISTRICT s8` after it, `FEATURE s8 n50`, `GREAT_PERSON_CLASS s8` ×8 with `YIELD s8` ×5 each: AI weight scratch, all zero or constant.
- `−16285 GOVERNMENT s8 n13`: **governments unlocked** (Chiefdom, Autocracy, Oligarchy, Classical Republic) — `governmentsUnlocked`. The `GOVERNMENT s5` before it is zero.
- `POLICY s5` ×5: [2] ever slotted, [3] slotted now (known); the others zero. `POLICY s8 n4`: the slot list (known).
- `−8451 RESOURCE s8 n54`: strategic per-turn accumulation (known, stockpiles); `−8011 RESOURCE s8 n66`: several packed entries per luxury (`0x20001, 0x70002, 0x80003, 256`) — a per-city/per-source luxury ledger, not decoded.
- `−3428 UNIT s8 n144`: units trained by type (known).
- `−1960 YIELD s8 n6`: per-turn yields ×256 (known; gold equals the treasury's per-turn figure exactly, the others are the last turn's computation).

After the tech tables, before the diplomacy blocks: `ABILITY/TERRAIN/PROMOTION` flag tables per unit (the unit objects), then `UNIT s5 n144` = **unit types of other players seen** (Arabia lists Macedon's Hetairoi, Great General and Prophet; Macedon lists neither its own Hetairoi nor its Missionaries) — `unitTypesSeen`; `FEATURE s5 n50` = **natural wonders found** — `naturalWondersFound` (both majors: Ha Long Bay, Giant's Causeway, Ubsunur Hollow, the lab's reveal; PYDT teams share them); `CONTINENT s5` = continents (known). `GREAT_PERSON_CLASS s8` ×3 = banked / per turn / (a third, ×256, small) great-person points (known). `PSEUDOYIELD s8 n47` (`GPP_PROPHET`): the AI's pseudo-yield weights. The big `BUILDING/DISTRICT/IMPROVEMENT s8` tables past +180000 with values near 2^24 are the AI's build weights inside the next player's city objects.

**City yield tables:** the city's per-turn yields are not stored — the oracle's
`GetYield` figures (×256 or plain) appear nowhere in the object (dip-a, all seven major
cities), only the food stock. The `YIELD s8 n6` tables come in fixed runs of 52-byte
`6, YIELD×6` records — 2, then 14, then 1 in every city, plus 13 and 1 more in the older
cities — all zero apart from an occasional 1/256 flag: per-source yield-change maps the game
keeps for modifiers, not per plot (the counts do not follow the owned plots). Per-plot
yields are computed from terrain/feature/resource/improvement, all of which the tiles carry.

**Unit extras:** the `+8` header field is not always −1/0 — seventeen of
the oracle's fifty units carried a packed reference there (0x3D0119 on a Builder) and the
parser had been dropping them; the filter is gone (the rest of the header keeps the noise
out; the extras are all barbarians). In the blob: `100, RELIGION_x, spreadCharges, 0` for
religious units (six Missionaries, exact) and `1, GREAT_PERSON_INDIVIDUAL_x` for great people
(Hannibal Barca; PYDT's John the Baptist). Custom names, cargo and air bases: none in these
games.

## Late game (late-1 / late-a, turn 222, Mapuche–Zulu–Aztec hotseat with Gathering Storm, 2026-09-21)

Fixed on the way: city headers are found by the id's slot, not the file position (a lost city
leaves a hole: Nag Mapu is the third city in the file with slot 4); tile groups are matched
by that slot; player objects come in slot order with 62 and 63 between the first ten and the
rest (0–9, 62, 63, 10, 11) — the visibility blocks give the ids, `Civ6PlayerState.playerId`.

**Great works:** registry in the tail — `count`, then
`6, GREATWORK_x, creator, turn, len, LOC name` (index = position; 0 a relic from a tribal
village at turn 71, 1–11 Zulu and Mapuche writers and painters); slots per city object —
`count, (BUILDING_x, n, (10, slotType, index|-1)×n)×count`. All twelve works and every slot
match the oracle.

**Favor:** at the head of the player object, after the goody-hut ledger and an
11-entry table of unknown kind: `12, favor, earned, spent, 0, 0, 0` then `6, MINOR_CIV_BONUS…`
(Mapuche 223/1253/424, Zulu 253/823/216, Aztec 86/336/103, all the oracle's favor; Macedon
93/93/0 on vis-a-1) — `Civ6PlayerState.favor`.

**Resolutions:** records `WC_RES_x, targetHash, 0, option
(1 = A, 2 = B), -1, n, n, -1×64…` ~1.2 KB apart in the tail; the first three on late-a-1 are the
oracle's resolutions in effect (Espionage Pact B, Sovereignty A, Diplomatic Victory A, with
the same target hashes), three more follow (Trade Treaty, World Ideology, Urban Development
— earlier sessions' or upcoming; the oracle does not list them). Votes cast, the meeting
countdown (19 turns, 36 %) and emergencies are not pinned.

**Climate:** not pinned. The oracle reports total CO2 748, change level 1, nine
storms, sea-level rise in 30 turns, ice loss in 11, but every player's own footprint is 0 on
this save (no fossil-fuel power), and 748 appears nowhere as an int, ×256, ×100 or float in a
plausible structure. Needs a save where players actually emit (coal/oil plants) so the
per-player and per-resource footprints have values to intersect.

**Tourism:** foreign tourists are finally non-zero (Zulu 12 from Mapuche, 16 from
Aztec) but no 64×64 or pair matrix holds those counts — they are derived from accumulated
tourism, whose stock is still unlocated.

**late-b (scripted alliance, CO2 by slot):** the lab's `alliances = {{0, 3}}` (`SetHasAllied`
both ways) flips the 0↔3 diplomatic state from UNFRIENDLY to ALLIED in the existing state
machine (parse-diplomacy.ts reads it); the alliance *level/type* stays 1/none for a scripted
alliance, so those fields are still unpinned — they need a real Make-Deal alliance between two
players. With dead players included the oracle's CO2 is Mapuche 226 lifetime (coal), Zulu 474
(coal 16, oil 3 a turn); neither number is stored as int, ×256, ×100, float, double or in a
per-slot array, and there is no CO2 replay dataset — the stock is kept in some other form
(per-turn ledger, or derived from consumption history).

**World Congress session:** the resolution records are newest-session-first (Patronage A, World Ideology A,
Diplomatic Victory A ahead of the earlier sessions'), which is what the oracle lists as in
effect. Emergencies: `votes[64], -1, WC_EMERGENCY_x, 1, WC_EMERGENCY_x, 1, turn` — the World's
Fair with votes 1/0/1/6 exactly as `GetProposals().PlayerVotes`, turn 241. The session
countdown is derived from that turn (30-turn sessions: 29 left on 242 as the oracle says). The
64-entry array after each resolution's option is probably each player's vote (1/2/-1) but the
oracle exposes no per-resolution votes to check. Favor spent on votes shows in the favor
record (Aztec 162 → 16).

**Alliances and deals:** a third 2016-pair matrix in the tail,
`2016, (ALLIANCE_x | -1, startTurn | -1)×2016` (marker bytes `ff ff ff 01` before the count),
same reverse j-major pair order as the grievances: Mapuche–Zulu `ALLIANCE_CULTURAL` from
turn 246 once the deal was accepted (friend-13), Mapuche–Aztec `ALLIANCE_RESEARCH` from 222 —
the scripted alliance, which the game files as research and expires after 30 turns (the
oracle's type 0, 6 turns left on 246). The diplomatic state machine follows
(DECLARED_FRIEND → ALLIED). Deals are agreement items `DEAL_ITEM_AGREEMENTS, 5, n, 0, 0,
DIPLOACTION_x, turn, duration, from, to`, one per direction: open borders 2↔3 from 244 and
2↔0 from 245 for 30 turns; a pending proposal has turn -1 (the alliance offer on friend-12, a
peace offer on friend-1). Not pinned: alliance level/points (all level 1 here) and
denouncements (none made). parse-alliances.ts.

**Barbarian camps:** a camp's tile record is byte-identical 16 turns apart
(end-b-2 → loy-c-2), so no spawn timer lives on the tile; the barbarian player object (63)
holds the camp plots only in its improvement list and AI path scratch. The spawn cadence is
not exposed by the Lua API either, so it stays undecoded; camps themselves are
`IMPROVEMENT_BARBARIAN_CAMP` tiles owned by nobody, listed under player 63's improvements.
