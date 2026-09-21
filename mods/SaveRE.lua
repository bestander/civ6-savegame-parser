-- SaveRE.lua
-- FireTuner helpers for one-field .Civ6Save pairs (save-xb42).
--
-- Civ6 cannot write a .Civ6Save from Lua. You still Save Game twice; this
-- script applies the *single* mutation so you do not have to play it out.
--
-- Setup (once):
--   1. In AppOptions.txt set EnableTuner 1, restart Civ6.
--      macOS: ~/Library/Application Support/Sid Meier's Civilization VI/Sid Meier's Civilization VI/AppOptions.txt
--   2. Open FireTuner, attach to Civilization VI.
--   3. Lua console context: **GameCore** (hybrid). GetSelectedUnit() works here.
--   4. Paste this file, or:  dofile("<repo>/mods/SaveRE.lua")
--   5. SaveRE.help()
--
-- Loop:
--   Save as before-FOO  →  SaveRE.<one call>  →  Save as after-FOO  →  tell the agent both names + UI numbers.
--   Do not move/end-turn unless the recipe says so.

SaveRE = SaveRE or {}

local function say(...)
    print("[SaveRE]", ...)
end

local function localPlayer()
    return Players[Game.GetLocalPlayer()]
end

local function selectedUnit()
    local u = GetSelectedUnit and GetSelectedUnit()
    if u == nil and UI and UI.GetHeadSelectedUnit then
        u = UI.GetHeadSelectedUnit()
    end
    if u == nil then
        say("select a unit on the map first")
        return nil
    end
    return u
end

local function selectedCity()
    local c = GetSelectedCity and GetSelectedCity()
    if c == nil and UI and UI.GetHeadSelectedCity then
        c = UI.GetHeadSelectedCity()
    end
    if c == nil then
        local cap = localPlayer():GetCities():GetCapitalCity()
        if cap == nil then
            say("select a city (or found a capital)")
            return nil
        end
        say("no city selected; using capital", cap:GetName())
        return cap
    end
    return c
end

local function unitTypeName(pUnit)
    local idx = pUnit:GetType()
    local row = GameInfo.Units[idx]
    return row and row.UnitType or ("index:" .. tostring(idx))
end

function SaveRE.dump()
    local u = selectedUnit()
    if u == nil then return end
    local exp = u:GetExperience()
    local moves = "?"
    if u.GetMovesRemaining then
        moves = tostring(u:GetMovesRemaining())
    end
    local xp, nextXp, ready = "?", "?", "?"
    if exp then
        if exp.GetExperiencePoints then xp = tostring(exp:GetExperiencePoints()) end
        if exp.GetExperienceForNextLevel then nextXp = tostring(exp:GetExperienceForNextLevel()) end
        if exp.GetExperienceToNextLevel then nextXp = tostring(exp:GetExperienceToNextLevel()) end
        if exp.IsPromotionReady then ready = tostring(exp:IsPromotionReady()) end
    end
    say(string.format(
        "%s id=%s owner=%s xy=(%d,%d) damage=%s moves=%s xp=%s next=%s promoReady=%s",
        unitTypeName(u),
        tostring(u:GetID()),
        tostring(u:GetOwner()),
        u:GetX(), u:GetY(),
        tostring(u:GetDamage()),
        moves, xp, nextXp, ready
    ))
end

--- HP: SetDamage is 0..100 damage-taken (0 = full). Does not move the unit.
function SaveRE.damage(amount)
    local u = selectedUnit()
    if u == nil then return end
    amount = amount or 22
    u:SetDamage(amount)
    say(unitTypeName(u), "SetDamage", amount, "now", u:GetDamage())
end

function SaveRE.heal()
    SaveRE.damage(0)
end

--- XP on the selected unit. bFromCombat=true may fire promo-available the way a fight does.
function SaveRE.xp(amount, fromCombat)
    local u = selectedUnit()
    if u == nil then return end
    amount = amount or 4
    u:GetExperience():ChangeExperience(amount, -1, fromCombat == true, false, false)
    say(unitTypeName(u), "ChangeExperience", amount, "fromCombat", fromCombat == true)
    SaveRE.dump()
end

function SaveRE.promoReady()
    local u = selectedUnit()
    if u == nil then return end
    u:GetExperience():SetPromotionReady(true)
    say(unitTypeName(u), "SetPromotionReady true")
end

function SaveRE.setMoves(n)
    local u = selectedUnit()
    if u == nil then return end
    if u.SetMovesRemaining then
        u:SetMovesRemaining(n)
    elseif u.SetMoves then
        u:SetMoves(n)
    else
        say("no SetMovesRemaining on this context")
        return
    end
    say(unitTypeName(u), "moves ->", n)
end

--- Spawn on the selected unit's tile (or capital). One type per save pair.
function SaveRE.spawn(unitType)
    unitType = unitType or "UNIT_SETTLER"
    local row = GameInfo.Units[unitType]
    if row == nil then
        say("unknown unit", unitType)
        return
    end
    local x, y
    local u = selectedUnit()
    if u then
        x, y = u:GetX(), u:GetY()
    else
        local cap = localPlayer():GetCities():GetCapitalCity()
        x, y = cap:GetX(), cap:GetY()
    end
    UnitManager.InitUnit(Game.GetLocalPlayer(), row.Index, x, y)
    say("InitUnit", unitType, "at", x, y)
end

function SaveRE.killSelected()
    local u = selectedUnit()
    if u == nil then return end
    say("killing", unitTypeName(u))
    UnitManager.Kill(u)
end

--- Production: incomplete progress is gameplay 256ths in the save; Lua AddProgress is hammer points.
function SaveRE.queue(itemType)
    local city = selectedCity()
    if city == nil then return end
    local q = city:GetBuildQueue()
    if GameInfo.Units[itemType] then
        q:CreateUnit(GameInfo.Units[itemType].Index, 0)
    elseif GameInfo.Buildings[itemType] then
        q:CreateBuilding(GameInfo.Buildings[itemType].Index)
    elseif GameInfo.Districts[itemType] then
        say("districts need a plot; use the UI to place, or SaveRE.queueBuilding")
        return
    else
        say("unknown production item", itemType)
        return
    end
    say("queued", itemType, "in", city:GetName())
end

function SaveRE.addHammers(n)
    local city = selectedCity()
    if city == nil then return end
    n = n or 5
    city:GetBuildQueue():AddProgress(n)
    say("AddProgress", n, city:GetName(), "now building", city:GetBuildQueue():CurrentlyBuilding())
end

function SaveRE.finishProduction()
    local city = selectedCity()
    if city == nil then return end
    city:GetBuildQueue():FinishProgress()
    say("FinishProgress", city:GetName())
end

function SaveRE.research(techType)
    local row = GameInfo.Technologies[techType]
    if row == nil then
        say("unknown tech", techType)
        return
    end
    local techs = localPlayer():GetTechs()
    techs:SetResearching(row.Index)
    say("researching", techType)
end

function SaveRE.grantTech(techType)
    local row = GameInfo.Technologies[techType]
    if row == nil then
        say("unknown tech", techType)
        return
    end
    localPlayer():GetTechs():SetTech(row.Index, true)
    say("granted", techType)
end

function SaveRE.techBoost(techType)
    local row = GameInfo.Technologies[techType]
    if row == nil then
        say("unknown tech", techType)
        return
    end
    localPlayer():GetTechs():TriggerBoost(row.Index, true)
    say("tech boost", techType)
end

function SaveRE.researchCivic(civicType)
    local row = GameInfo.Civics[civicType]
    if row == nil then
        say("unknown civic", civicType)
        return
    end
    local culture = localPlayer():GetCulture()
    if culture.SetCurrentCivic then
        culture:SetCurrentCivic(row.Index)
        say("SetCurrentCivic", civicType)
        return
    end
    say("no SetCurrentCivic in this context — pick", civicType, "in the civic tree, one click, then save")
end

function SaveRE.grantCivic(civicType)
    local row = GameInfo.Civics[civicType]
    if row == nil then return end
    localPlayer():GetCulture():SetCivic(row.Index, true)
    say("granted civic", civicType)
end

function SaveRE.envoy(csPlayerId, n)
    n = n or 1
    local cs = Players[csPlayerId]
    if cs == nil or not cs:IsMinor() then
        say("not a city-state player id", csPlayerId)
        return
    end
    for _ = 1, n do
        cs:GetInfluence():GiveFreeTokenToPlayer(Game.GetLocalPlayer())
    end
    say("gave", n, "envoys to CS player", csPlayerId)
end

--- Named recipes matching save-xb42. Save BEFORE calling, AFTER the print.
SaveRE.pairs = {
    settler = function() SaveRE.spawn("UNIT_SETTLER") end,
    slinger = function() SaveRE.spawn("UNIT_SLINGER") end,
    spearman = function() SaveRE.spawn("UNIT_SPEARMAN") end,
    heavy_chariot = function() SaveRE.spawn("UNIT_HEAVY_CHARIOT") end,
    horseman = function() SaveRE.spawn("UNIT_HORSEMAN") end,
    galley = function() SaveRE.spawn("UNIT_GALLEY") end,
    trader = function() SaveRE.spawn("UNIT_TRADER") end,
    swordsman = function() SaveRE.spawn("UNIT_SWORDSMAN") end,
    missionary = function() SaveRE.spawn("UNIT_MISSIONARY") end,
    ram = function() SaveRE.spawn("UNIT_BATTERING_RAM") end,
    wound22 = function() SaveRE.damage(22) end,
    wound96 = function() SaveRE.damage(96) end,
    xp4 = function() SaveRE.xp(4, true) end,
    xp15 = function() SaveRE.xp(15, true) end,
    pottery = function() SaveRE.research("TECH_POTTERY") end,
    masonry_boost = function() SaveRE.techBoost("TECH_MASONRY") end,
    hammers5 = function() SaveRE.addHammers(5) end,
    finish_build = function() SaveRE.finishProduction() end,
}

function SaveRE.pair(name)
    local fn = SaveRE.pairs[name]
    if fn == nil then
        say("unknown pair; SaveRE.help()")
        return
    end
    say("SAVE before-" .. name .. " if you have not already")
    fn()
    say("NOW Save Game as after-" .. name .. " (no other actions)")
end

function SaveRE.help()
    say("dump()  damage(n)  heal()  xp(n, fromCombat)  promoReady()  setMoves(n)")
    say("spawn('UNIT_SETTLER')  killSelected()")
    say("queue('UNIT_SCOUT'| 'BUILDING_GRANARY')  addHammers(5)  finishProduction()")
    say("research('TECH_POTTERY')  grantTech(...)  techBoost(...)")
    say("grantCivic('CIVIC_CRAFTSMANSHIP')  envoy(csPlayerId, n)")
    say("pair('settler'|'slinger'|'wound22'|'xp4'|'pottery'|...)")
    local names = {}
    for k in pairs(SaveRE.pairs) do names[#names + 1] = k end
    table.sort(names)
    say("pairs:", table.concat(names, ", "))
end

SaveRE.help()
say("loaded")
