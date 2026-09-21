# civ6-savegame-parser

A TypeScript reader for Sid Meier's Civilization VI `.Civ6Save` files. Given a save, it returns
the game state — map, cities, units, players, diplomacy, religion, eras, great works, fog of war —
without running the game. It was reverse-engineered against the game itself (a mod dumps the live
state into every save, the parser is checked against that dump), so every field below has a
verified meaning, and every field not listed is either known to be computed by the game at
runtime or still open.

Status: the data model (`src/types.ts`) is the contract; the parser behind it is being migrated
into this package. This README is the map of what it reads and how it was found.

## Usage

```ts
import { parseCiv6Save } from 'civ6-savegame-parser';
import { readFileSync } from 'fs';

const game = parseCiv6Save(readFileSync('my.Civ6Save'));
game.metadata.turn;                    // 222
game.map.plots[i].terrain;             // 'TERRAIN_PLAINS_HILLS'
game.cities[0].workedPlots;            // [{ x, y, workers }, …]
game.players[0].favor;                 // { favor, earned, spent }
game.players[2].revealedPlots;         // plot indices the player has revealed
```

Everything is plain data — see [`src/types.ts`](src/types.ts) for the full `Civ6Save` model.
Players are keyed by their slot id everywhere (62 = free cities, 63 = barbarians), database rows
by their type string, and most records keep an `offset` into the inflated payload so a value can
be traced back to its bytes.

## What it reads

Each row is a fact the parser extracts, where the bytes are, and how it was verified.
"Oracle" means the in-game dump (see *Methodology*) agreed on every instance in the capture.

### Header (uncompressed, before the zlib payload)

| Field | Encoding | Verified |
|---|---|---|
| Turn, game speed, map size, ruleset, victories, game modes, start era, turn limit, timer, city-state count, random seed | Key/value store; keys are `civ6Hash` of the property name, typed values (bool / int / type hash / string) | `header-store.ts`; ~240 of ~300 keys named (the rest hex — nothing in the game's files hashes to them) |
| Player slots (128): civilization, leader, team, slot status, nickname, colours, hotseat password, agenda | Same store, one block per slot | Names from the game's config keys |
| Enabled mods | `MOD_*` array | via the vendored pydt header parser |

### Map (tile section, ~450 KB into the payload on a tiny map)

| Field | Encoding | Verified |
|---|---|---|
| Terrain, feature, resource, improvement, continent | Type hashes per tile (byte-swapped in tile records) | Data-sheet tables, oracle plot dumps |
| River map, route (road index at +38 low byte), pillaged (+48 bit 0) | Tile record fields | Oracle plot lists (lab7-4, lab8-5) |
| Owner, city slot, district instance id, world wonder | Ownership sub-record | All PYDT/duel cities resolve to their centre |
| Unit count per tile | Tile record | Cross-checked with the unit list |

### Cities (one object per city, in owner order; found by the `LOC_CITY_NAME_*` string)

| Field | Encoding | Verified |
|---|---|---|
| Name, owner, original owner, centre, id | Header `id, x, y, owner, originalOwner, owner, -1, id, population` 1.1–1.7 KB before the name; `id = count<<16 \| slot` (slot ≠ file order once a city was lost) | Oracle, all captures + late game |
| Population | Header last field | Oracle |
| **Worked plots and specialists** | `37, u32×37, 37, u32×37` shortly after the name: workers per plot in spiral order from the centre (`city-plot-ring.ts`; second array = locked plots, always 0 so far) | Oracle 10/10 cities; late duel: population+1 workers everywhere, a 2-worker district plot |
| Food stock | int32 ×256, 4969 bytes past the city's `UNIT s8 n144` table | Oracle 8/8; monotone over consecutive saves |
| Production: current item, plot for districts/wonders, hammers banked per item, queue | `16 1 TAG 2 TAG kind 0 HASH [x y]`; sparse `UNIT/BUILDING/DISTRICT s8` progress tables; a stride-12 queue table | Oracle |
| Buildings with their plot | `BUILDING s6` tables (plot index; 65535 = none) | Oracle, wonders on their own plot |
| Districts: type, plot, complete, damage, walls damage, last damaged turn | District instance records (`parse-districts.ts`) | Oracle (lab war captures) |
| Religions: followers and pressure per religion, majority | `5, R, 2, 5, -1, followers, pressure×256` (the unconverted) then `5, R, followers, pressure×256, -255\|-256` per religion; majority `0, R, 10` | Oracle 13/13 cities |
| **Loyalty**, per-turn change, level | `14, loyalty×256, perTurn×256, 0, …, INT_MIN@+44, …, LOYALTY_LEVEL_n@+60` | Oracle (Sanaa 54 / −23), all duel + PYDT cities |
| **Great-work slots** | `count, (BUILDING, n, (10, slotType, workIndex\|-1)×n)×count` | Oracle 12 works, every slot |
| Not stored (game computes): yields per turn, housing, growth threshold, amenities, surplus, turns to grow | The many `YIELD s8 n6` tables are zero modifier maps | Searched, absent |

### Units

| Field | Encoding | Verified |
|---|---|---|
| Type, plot, owner, HP | Record `hash, kind, ref, -9999, -9999, x, y, -1, owner, …, +56 damage byte` | Pairs + oracle |
| Moves remaining | Separate 60-byte per-player unit list (`mp×256`) | Oracle |
| XP, level, promotions, abilities | Typed tables inside the ~6 KB blob (`PROMOTION s5`, `ABILITY s8`, XP/level u16 ahead of the promotion table) | Oracle, all PYDT units |
| Builder charges | +80 ×256 | Oracle |
| Formation (corps/army), fortify turns, activity | +45, +61, +53 (`ACTIVITY_*` hash) | Oracle (lab corps/sleep/fortify) |
| Trade route (origin, destination, turn started) | Operations list before the `UNITOPERATION s5` table, 56-byte records | Oracle (route captures) |
| Religion and spread charges | `100, RELIGION_x, charges, 0` in the blob | Oracle 6/6 Missionaries |
| Great person individual | `1, GREAT_PERSON_INDIVIDUAL_x` in the blob (kind −1 records) | Oracle (Hannibal Barca, John the Baptist) |

### Players (one object per slot, order 0–9, 62 free cities, 63 barbarians, then 10+)

| Field | Encoding | Verified |
|---|---|---|
| Techs researched / boosted / progress, current research | `TECH s5` ×2 then `TECH s8` (×256); the current one 20 bytes ahead | Oracle, game logs |
| Civics completed / inspired / progress, current civic | Same shape | Oracle |
| Government, governments unlocked | Lone hash ahead of the `GOVERNMENT` tables; `GOVERNMENT s8` flags | Oracle |
| Policies slotted (with slot) and ever slotted | `POLICY s5` ×5 (indices 2 and 3) or a `POLICY s8` slot list when ≥4 cards | Oracle; late-game Monarchy with six cards |
| Treasury, gold per turn | Researched-tech table +1410 / +1418, ×256 | Oracle 8/8, monotone over 31 saves |
| Faith, pantheon | `20, faith×256, 0, BELIEF\|-1, n, x, y` before the `PROMOTION_CLASS s8` table (x,y = holy city) | Oracle |
| Founded religion, beliefs, holy city, turn | `RELIGION, 0, turn, holyX, holyY, [len]name, n, BELIEF…` at the object head | Oracle (lab9-6, "crab" on the duel) |
| Strategic stockpiles, per-turn accumulation | `RESOURCE, 3, amount, 0, 0` list; `RESOURCE s8` table | Oracle (lab7) |
| Goody huts received, continents present on, natural wonders found, foreign unit types seen | `GOODY_HUT s8`, `CONTINENT s5`, `FEATURE s5`, `UNIT s5` flag tables | Oracle |
| Units trained per type, per-turn yields | `UNIT s8`, `YIELD s8` before the tech tables | Oracle (gold exact) |
| **Diplomatic favor**, lifetime earned, spent | `12, favor, earned, spent, 0, 0, 0` before the `6, MINOR_CIV_BONUS…` list at the object head | Oracle 3/3 majors + early save |
| Improvement plots | `1, playerId, 1, 2, 0xBC9BE34F, 0, 0x578A381D, 0, 1, n, plot×n` before the governor block | Tiles (barbarian outposts for 63) |
| Governors: type, promotions, assigned city, titles | `GOVERNOR` hash + LOC name; owner ref + city id after the name | Oracle |
| Great-people points banked / per turn, ledger of recruited individuals | `GREAT_PERSON_CLASS s8` ×2 after the unit list; ledger `individual, class, era, cost, by, turn` in the tail | Oracle |
| Era score | `REPLAYDATASET_ERASCORE` graph, last point | Oracle |

### Diplomacy

| Field | Encoding | Verified |
|---|---|---|
| Diplomatic state per pair (`NEUTRAL, FRIENDLY, WAR, ALLIED, …`) | Per player, one block per slot: `u32 other, u32 len, "DIPLO_STATE_<state>"`, data blob, reachable states | Lab wars, scripted alliance |
| Envoys (placed / received) | 63-slot int array 1583 bytes ahead of the first state block | Oracle (lab-4, PYDT) |
| War records (kind, latest turn) | `WAR_* , turn, -1, -1` list in the tail (participants not stored) | Two automated captures |
| **Grievances** | Tail: `1, -1, 2016, (total, lastTurn)×2016` over unordered pairs (index `2015 − (j(j−1)/2 + (j−1−i))`), then the log `count, (16, holder, against, amount, turn, reason, arg)×count` | Oracle ±100/±300; both directions sum into the pair |

### Game-level

| Field | Encoding | Verified |
|---|---|---|
| Replay graphs (score, science, culture, gold, wars, …, per player per turn) | `REPLAYDATASET_*` `(player, turn, value×256)`, dense or sparse | Oracle |
| **Historic moments** | `count`, then `8, MOMENT_x, turn, x, y, player, index` + blob per moment | Oracle (53 → 1087 moments) |
| **Dedications** (Rise & Fall) | `A, 30, nChoices, COMMEMORATION×n, 0, nActive, COMMEMORATION×m` per slot after the moments | Oracle |
| **Fog of war per player** | Pre-map region, per slot: `6, playerId, revealedCount, u8 0, 2280, u8[2280]` revealed; `2280, 60, 2280, u16[2280]` visibility counts; four more u16 plot arrays (fog memory, unread) | Oracle 8/8 players; PYDT teams share sight |
| **Great works registry** | Tail: `count`, then `6, GREATWORK_x, creator, turn, len, LOC name` (index = position) | Oracle |
| **World Congress resolutions in effect** | Tail: `WC_RES_x, target, 0, option (1=A, 2=B), -1, …` ~1.2 KB apart | Oracle (first three records) |
| Notifications, requirement sets, AI weights, gossip, property store | Located (see *Tail map*), read only where useful | — |

### Not read (with the reason)

| Topic | Status |
|---|---|
| Score, yields, housing, amenities, growth threshold | Computed by the game; not in the file |
| CO2 per player / resource, climate level, storms, sea-level countdowns | Readable from the live game (the oracle dumps them); not found in the file as int, ×256, ×100, float, double or slot array — treated as recomputed from consumption |
| Accumulated tourism (domestic and per pair) | Cumulative, so it must be stored; a two-save diff four turns apart found no per-pair accumulator growing by rate×4 — stored in a shape not yet fingerprinted |
| Alliance type and level, deals in effect, denouncements | No real alliance/deal/denouncement existed in any captured game (a scripted alliance only flips the state to `ALLIED`) |
| World Congress votes cast, session countdown, emergencies | Needs a save during or right after a session |
| Barbarian camp spawn timers, locked citizen plots, yield focus | No instance with a non-zero value captured |
| RNG state | Not identified |

## Methodology

The approach that worked, in the order it was learned:

1. **Inflate the payload.** The `.Civ6Save` is a small uncompressed header followed by a zlib
   stream cut into 64 KB chunks with 4-byte separators (`decompress.ts`). Everything below is
   about the inflated payload (5–12 MB).

2. **The hash formula.** Every reference to a database type (`UNIT_WARRIOR`, `TECH_MINING`,
   `RELIGION_CATHOLICISM`, …) is `~crc32(name)` — CRC-32 with the final complement left out
   (`civ6Hash`). Tile records store it byte-swapped, everything else straight. With the game's
   own XML dumped into `data/civ6-types.json` (7 131 types in 89 kinds) the payload becomes a map:
   `annotate` prints every type reference near an offset, and unknown structures are found by
   what they refer to.

3. **Typed tables.** Per-type state is stored as runs of `{hash, value}` of one kind at one
   stride (4 = bare hash list, 5 = u8, 6 = u16, 8 = u32, 12/16 = two/three u32). `typed-tables.ts`
   finds all of them in one pass (25 k in a mid-game save); `tables` prints the census. Values
   that are fractions are stored ×256.

4. **The oracle: the save is its own ground truth.** A small mod (the *oracle*, `mods/oracle`, gameplay + UI
   context) dumps the live state as JSON into a game property on load and at every turn start
   (`Game:SetProperty`); properties are serialized into the payload, so every save made with the
   mod carries the numbers the parser must reproduce. Every field in the tables above was pinned
   by reading it from the payload and comparing with the dump across every city/unit/player at
   once — one save answers a question for all instances, where a before/after pair answers it for
   one. Caveat: the dump is written when a save *completes*, so a save carries the state of the
   previous save; capture by saving twice.

5. **Manufacture the scenario, don't play it.** A second mod (the *lab*, `mods/lab`) mutates the loaded game
   from a gameplay script (declare wars, grant units, found religions, damage walls, form corps,
   spawn a Settler next to an enemy capital for a loyalty test). A command file per capture
   makes each situation a few lines of Lua instead of hours of play.

6. **Automate the captures.** A plan file the oracle's UI context executes: settle, save twice,
   optionally run UI operations (research/civic/production picks, skip units, dedication, end
   turn) to play hotseat turns by itself, save again. A driver launches the game through Steam;
   the launcher and the main-menu load are the only manual clicks (done by coordinates).

7. **Diffs and intersections** for what the oracle cannot reach or when a value must be found
   among millions of ints:
   - a before/after pair with one known change (`delta`: changed windows with type context);
   - value hunts constrained by structure — e.g. worked plots were found by asking for a 37-entry
     array whose non-zero count equals the worked-plot count in every city, then fitting the
     twelve possible spiral orders to the oracle's sets;
   - consecutive turns: anything that must move by a small known amount (food by a surplus,
     pressure by a rate) is found by intersecting the delta constraint over all cities;
   - two saves N turns apart aligned on a fixed anchor (the tech table), looking for values that
     grew by exactly rate×N.

8. **Late-game saves last.** Several readers written on turn-20 captures drifted on turn-125/222
   saves (policy slot list becomes a table, city slots stop matching file order once a city is
   lost, player objects reorder around slots 62/63). Always re-run on the latest save.

### Helpful scripts (moving here under `scripts/`)

| Script | What it does |
|---|---|
| `oracle <save> [out.json]` | Print or export the oracle dump a save carries, plus the lab and plan logs |
| `delta --before A --after B` | Changed byte windows between two saves with nearby type references and hex |
| `tables <save> [--kind K] [--near off]` | Census of typed tables; every table of a kind with non-zero entries; tables around an offset |
| `annotate <save> [--near off]` | Every type reference in the payload grouped by kind and offset |
| `types` | Rebuild `data/civ6-types.json` from the game's XML |
| `capture --load X --name Y [--turns N] [--actions …]` | Drive a capture: write the plan, launch through Steam, wait for the saves, print the oracle |
| Lua: `mods/oracle/` (the dump + plan runner), `mods/lab/` (scenario mutations + command file) | The in-game half; `install.sh` copies them into the game's Mods folder |

## File structure of a `.Civ6Save`

```
┌──────────────────────────────────────────────────────────────┐
│ Header (uncompressed, ~20–60 KB)                             │
│   key/value store: game configuration, 128 player slots,     │
│   summary fields (turn, speed, map size), mod list           │
│   keys = civ6Hash(name); values typed 1 bool, 2 int, 3 type  │
│   hash, 4/5 string (u24 len | 0x21<<24, u32 1, bytes, NUL),  │
│   0x0A/0x0B arrays, 0x18 = the compressed payload            │
├──────────────────────────────────────────────────────────────┤
│ zlib payload, 64 KB chunks with 4-byte separators            │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Pre-map (~0.45 MB on a tiny map)                          │ │
│ │   fog of war per player slot: revealed u8[plots],         │ │
│ │   visibility u16[plots], 4× u16 fog-memory arrays         │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ Tile section (marker 0e 00 00 00 0f 00 00 00 06 00 00 00) │ │
│ │   one record per plot: terrain/feature/resource/          │ │
│ │   improvement/continent hashes (byte-swapped), river,     │ │
│ │   route, pillaged, unit count, optional ownership         │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ Per player, in slot order (0–9, 62, 63, 10, 11 …):        │ │
│ │   object head: goody ledger, favor, minor-civ bonuses,    │ │
│ │     founded religion, stockpiles                          │ │
│ │   city objects (name string; header 1.1–1.7 KB before it; │ │
│ │     citizen arrays after it; typed tables; loyalty and    │ │
│ │     great-work slots late in the ~23 KB object)           │ │
│ │   unit blobs (~6 KB each: header + typed tables)          │ │
│ │   tech/civic tables, government, policies, yields,        │ │
│ │     treasury (+1410 from the researched table)            │ │
│ │   diplomacy state machines, one per slot; envoys          │ │
│ │   governors, improvement plot list, great-people points   │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ Tail (~1.2 MB)                                             │ │
│ │   AI weight tables · diplomatic action state · resource   │ │
│ │   censuses · belief pools · historic moments · dedications│ │
│ │   · war records · grievance matrices + log · gossip ·     │ │
│ │   resolutions · game property store (the oracle's JSON) · │ │
│ │   requirement sets / GameEffects · notifications · replay │ │
│ │   datasets · great-works registry · game summary          │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

Encoding conventions seen everywhere:

- Little-endian throughout. Ints are `i32`; counts precede lists; `-1` is "none"; `-9999` is
  "no plot".
- Fractions are fixed-point ×256 (`25.5 gold` → `6528`).
- Strings are `u32 len` + bytes (no NUL) in the payload, `u24 len | 0x21 << 24, u32 1, bytes,
  NUL` in property stores.
- References to database rows are `civ6Hash(typeName)`; instance ids pack `count << 16 | slot`.
- Lists of one kind at one stride (`typed tables`) are the dominant container; a run's length is
  the number of database rows of that kind, so a table names itself.
- Plot indices are `y * width + x`; the 37-plot city ring is a spiral from the centre, rings 1–3,
  each starting at the plot straight below the centre (odd-r offset layout, odd rows shifted
  right).

## Follow-ups

- Migrate the parser, `data/` (the type dictionary), the tests and the Lua mods into this
  package behind the `Civ6Save` model above.
- Tourism accumulators, CO2 stock, alliance type/level, deals, congress votes — see *Not read*.
- Fog-memory arrays (the four u16 plot arrays per player after the visibility counts).
- The AI-only regions (weights, diplomatic action state) are named but not decoded; a
  consumer wanting AI state would start from the tail map.
- A test fixture set: the capture saves referenced by the tests live in the Civ6 Saves folder
  on the machine they were made on; a public fixture set needs saves without the oracle mod's
  property blobs stripped or with them (they are harmless, 100–300 KB of JSON).
