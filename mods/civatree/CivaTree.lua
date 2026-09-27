-- Civa Tree (civa-2hw4): write the game's Tech and Civic Shuffle draw into the save.
--
-- Civ6 re-derives a shuffled tree from the game seed at load and never writes it to the save, so
-- civa cannot rebuild it from a file. The UI can read it: UITree.GetAvailableTechs/Civics give each
-- item's prerequisites and row, and GetResearchCost/GetCultureCost the costs the engine charges
-- (UITree's own Cost field is not the engine's). This writes one line per item into the game
-- configuration, which is saved with the game, in chunks of CHUNK characters:
--   CIVA_TREE_COUNT = n, CIVA_TREE_000 … = "T|TECH_X|cost|row|PRE_A,PRE_B;C|CIVIC_Y|…"
-- Costs are the local player's (the same for every player in a game) at the current world era.
-- UI only, read-only: nothing here changes the game.

local CHUNK = 3000

local function techType(x) local r = GameInfo.Technologies[x]; return r and r.TechnologyType or tostring(x) end
local function civicType(x) local r = GameInfo.Civics[x]; return r and r.CivicType or tostring(x) end

local function dump()
  if not (UITree and Game and GameConfiguration) then return end
  local me = Players[Game.GetLocalPlayer()]
  if not me then return end
  local techs, culture = me:GetTechs(), me:GetCulture()
  local rows = {}
  for _, n in ipairs(UITree.GetAvailableTechs() or {}) do
    local row = GameInfo.Technologies[n.Name]
    local pre = {}
    for _, p in ipairs(n.PrereqTechTypes or {}) do table.insert(pre, techType(p)) end
    local ok, cost = pcall(function() return techs:GetResearchCost(row.Index) end)
    table.insert(rows, "T|" .. row.TechnologyType .. "|" .. tostring(ok and cost or "") .. "|" .. tostring(n.TreeRow) .. "|" .. table.concat(pre, ","))
  end
  for _, n in ipairs(UITree.GetAvailableCivics() or {}) do
    local row = GameInfo.Civics[n.CivicType]
    local pre = {}
    for _, p in ipairs(n.PrereqCivicTypes or {}) do table.insert(pre, civicType(p)) end
    local ok, cost = pcall(function() return culture:GetCultureCost(row.Index) end)
    table.insert(rows, "C|" .. row.CivicType .. "|" .. tostring(ok and cost or "") .. "|" .. tostring(n.TreeRow) .. "|" .. table.concat(pre, ","))
  end
  local text = "v1;era=" .. tostring(Game.GetEras and Game.GetEras():GetCurrentEra() or -1) .. ";" .. table.concat(rows, ";")
  local n = math.ceil(#text / CHUNK)
  GameConfiguration.SetValue("CIVA_TREE_COUNT", n)
  for i = 1, n do
    GameConfiguration.SetValue(string.format("CIVA_TREE_%03d", i - 1), text:sub((i - 1) * CHUNK + 1, i * CHUNK))
  end
end

local function safeDump() pcall(dump) end

-- On load, and at every local turn start: costs move with the world era.
Events.LoadScreenClose.Add(safeDump)
Events.LocalPlayerTurnBegin.Add(safeDump)
