-- the lab mod: manufacture the parser's test scenarios in one load.
--
-- Runs in the gameplay-script context, where the state is writable. On the first load of a
-- game it applies every scenario below to the human players' cities and units, then stamps the
-- game with LAB_APPLIED so a reload does not apply them twice. Every step is pcall'd and
-- its outcome appended to LAB_LOG — an API name that does not exist in this context shows
-- up there as the error text, next to the oracle dump of the resulting state.

local LOG = {}
local function log(step, ok, detail)
    LOG[#LOG + 1] = string.format("%s %s: %s", ok and "OK" or "FAIL", step, tostring(detail))
end

local function try(step, f)
    local ok, r = pcall(f)
    log(step, ok, r)
    return ok, r
end

local function firstCity(player)
    for _, c in player:GetCities():Members() do return c end
    return nil
end

local function firstUnit(player, predicate)
    for _, u in player:GetUnits():Members() do
        if predicate == nil or predicate(u) then return u end
    end
    return nil
end

local function humans()
    local out = {}
    for id = 0, 63 do
        local p = Players[id]
        if p and p:IsAlive() and p:IsHuman() then out[#out + 1] = id end
    end
    return out
end

local function apply(again)
    local ids = humans()
    local a, b = ids[1], ids[2]
    if a == nil then log("players", false, "no human player"); return end
    local pa, pb = Players[a], b and Players[b] or nil
    local cityA, cityB = firstCity(pa), pb and firstCity(pb) or nil

    -- 1. A wonder in production in player A's capital, 40% done, on a plot next to the centre
    --. Pyramids need Masonry, which is granted first so the item is legal.
    if cityA and not again then
        try("grant TECH_MASONRY to A", function()
            local tech = GameInfo.Technologies["TECH_MASONRY"].Index
            pa:GetTechs():SetTech(tech, true)
            return "ok"
        end)
        try("Pyramids 40% in " .. Locale.Lookup(cityA:GetName()), function()
            local wonder = GameInfo.Buildings["BUILDING_PYRAMIDS"].Index
            local plot = Map.GetAdjacentPlot(cityA:GetX(), cityA:GetY(), DirectionTypes.DIRECTION_EAST)
            cityA:GetBuildQueue():CreateIncompleteBuilding(wonder, plot:GetIndex(), 40)
            return "plot " .. plot:GetX() .. "," .. plot:GetY()
        end)
        -- 2. A finished wonder on the other side, so both states are in one save.
        try("Stonehenge built in " .. Locale.Lookup(cityA:GetName()), function()
            local wonder = GameInfo.Buildings["BUILDING_STONEHENGE"].Index
            local plot = Map.GetAdjacentPlot(cityA:GetX(), cityA:GetY(), DirectionTypes.DIRECTION_WEST)
            cityA:GetBuildQueue():CreateIncompleteBuilding(wonder, plot:GetIndex(), 100)
            return "plot " .. plot:GetX() .. "," .. plot:GetY()
        end)
    end

    -- 3. Damage: player B's capital takes 30 to its garrison, player A's first military unit 35
    --.
    if cityB and not again then
        try("damage city B", function()
            local centre = cityB:GetDistricts():GetDistrict(GameInfo.Districts["DISTRICT_CITY_CENTER"].Index)
            centre:ChangeDamage(DefenseTypes.DISTRICT_GARRISON, 30)
            return "garrison damage " .. tostring(centre:GetDamage(DefenseTypes.DISTRICT_GARRISON))
        end)
    end
    local soldier = firstUnit(pa, function(u) return u:GetCombat() > 0 end)
    if soldier and not again then
        try("damage unit A", function()
            soldier:ChangeDamage(35)
            return GameInfo.Units[soldier:GetType()].UnitType .. " damage " .. tostring(soldier:GetDamage())
        end)
    end

    -- 4. Diplomacy: A and B have met, A declared war on B.
    if pb and not again then
        try("A meets B", function() pa:GetDiplomacy():SetHasMet(b, true); return "ok" end)
        try("A declares war on B", function()
            pa:GetDiplomacy():DeclareWarOn(b, WarTypes.FORMAL_WAR, true)
            return "at war: " .. tostring(pa:GetDiplomacy():IsAtWarWith(b))
        end)
    end

    -- 5. A corps for player B: Nationalism, then a second Warrior spawned next to the capital and
    --    promoted to a corps formation.
    if pb and cityB and not again then
        try("grant CIVIC_NATIONALISM to B", function()
            local civic = GameInfo.Civics["CIVIC_NATIONALISM"].Index
            pb:GetCulture():SetCivic(civic, true)
            return "ok"
        end)
        try("spawn a Warrior corps for B", function()
            local plot = Map.GetAdjacentPlot(cityB:GetX(), cityB:GetY(), DirectionTypes.DIRECTION_EAST)
            local u = UnitManager.InitUnit(b, "UNIT_WARRIOR", plot:GetX(), plot:GetY())
            u:SetMilitaryFormation(MilitaryFormationTypes.CORPS_FORMATION)
            return "formation " .. tostring(u:GetMilitaryFormation()) .. " at " .. plot:GetX() .. "," .. plot:GetY()
        end)
    end

    -- 6. A trade route: a Trader for A next to its capital, sent to the nearest
    --    city-state within range. Both the request API and its parameter names are UI-side
    --    conventions, so two spellings are tried and the log says which one took.
    if cityA and not Game:GetProperty("LAB_APPLIED_V3") then
        try("trade route from " .. Locale.Lookup(cityA:GetName()), function()
            local best, bestDist = nil, 99
            for id = 0, 63 do
                local cs = Players[id]
                if cs and cs:IsAlive() and not cs:IsMajor() and not cs:IsBarbarian() then
                    local c = firstCity(cs)
                    if c then
                        local d = Map.GetPlotDistance(cityA:GetX(), cityA:GetY(), c:GetX(), c:GetY())
                        if d < bestDist then best, bestDist = c, d end
                    end
                end
            end
            if not best then return "no city-state city" end
            local trader = UnitManager.InitUnit(a, "UNIT_TRADER", cityA:GetX(), cityA:GetY())
            local params = {}
            params[UnitOperationTypes.PARAM_X0] = best:GetX()
            params[UnitOperationTypes.PARAM_Y0] = best:GetY()
            params[UnitOperationTypes.PARAM_X1] = best:GetX()
            params[UnitOperationTypes.PARAM_Y1] = best:GetY()
            local ok1 = pcall(function() UnitManager.RequestOperation(trader, UnitOperationTypes.MAKE_TRADE_ROUTE, params) end)
            local ok2 = pcall(function() trader:GetTrade():StartRoute(best:GetOwner(), best:GetID()) end)
            return string.format("trader to %s at %d,%d (dist %d) request=%s startRoute=%s", Locale.Lookup(best:GetName()), best:GetX(), best:GetY(), bestDist, tostring(ok1), tostring(ok2))
        end)
    end

    -- 6b. Pella has no reachable destination, so a Trader for B in Cairo too (route by hand).
    if cityB and not Game:GetProperty("LAB_APPLIED_V4") then
        try("trader for B in " .. Locale.Lookup(cityB:GetName()), function()
            UnitManager.InitUnit(b, "UNIT_TRADER", cityB:GetX(), cityB:GetY())
            return "ok"
        end)
    end

    -- 6c. A route needs a known destination: both humans meet every city-state and see the
    --     whole map.
    if not Game:GetProperty("LAB_APPLIED_V9") then
        for _, id in ipairs({ a, b }) do
            if id then
                try("player " .. id .. " meets everyone and sees the map", function()
                    local met = 0
                    for other = 0, 63 do
                        local o = Players[other]
                        if o and other ~= id and o:IsAlive() and not o:IsBarbarian() then
                            Players[id]:GetDiplomacy():SetHasMet(other, true); met = met + 1
                        end
                    end
                    local vis = PlayersVisibility[id]
                    local n = Map.GetPlotCount()
                    for plot = 0, n - 1 do vis:ChangeVisibilityCount(plot, 1) end
                    return string.format("met %d, revealed %d plots", met, n)
                end)
            end
        end
    end

    -- 8. The bare-number systems: odd amounts so each value intersects on its own.
    if not Game:GetProperty("LAB_APPLIED_V9") then
        local function res(name) return GameInfo.Resources[name].Index end
        try("stockpiles A iron 13 horses 7, B niter 5", function()
            pa:GetResources():ChangeResourceAmount(res("RESOURCE_IRON"), 13)
            pa:GetResources():ChangeResourceAmount(res("RESOURCE_HORSES"), 7)
            if pb then pb:GetResources():ChangeResourceAmount(res("RESOURCE_NITER"), 5) end
            return string.format("A iron %s horses %s", tostring(pa:GetResources():GetResourceAmount(res("RESOURCE_IRON"))), tostring(pa:GetResources():GetResourceAmount(res("RESOURCE_HORSES"))))
        end)
        local warrior = firstUnit(pa, function(u) return GameInfo.Units[u:GetType()].UnitType == "UNIT_WARRIOR" end)
        local archer = firstUnit(pa, function(u) return GameInfo.Units[u:GetType()].UnitType == "UNIT_ARCHER" end)
        if warrior then
            try("fortify A's warrior", function()
                local ok1 = pcall(function() UnitManager.RequestOperation(warrior, UnitOperationTypes.FORTIFY) end)
                local ok2 = pcall(function() warrior:SetActivityType(ActivityTypes.ACTIVITY_SENTRY) end)
                return string.format("request=%s setActivity=%s activity=%s", tostring(ok1), tostring(ok2), tostring(warrior:GetActivityType()))
            end)
        end
        if archer then
            try("sleep A's archer", function()
                local ok1 = pcall(function() UnitManager.RequestOperation(archer, UnitOperationTypes.SLEEP) end)
                local ok2 = pcall(function() archer:SetActivityType(ActivityTypes.ACTIVITY_SLEEP) end)
                return string.format("request=%s setActivity=%s activity=%s", tostring(ok1), tostring(ok2), tostring(archer:GetActivityType()))
            end)
        end
        if cityB then
            try("loyalty of city B to 61", function()
                cityB:GetCulturalIdentity():SetLoyalty(61)
                return "loyalty " .. tostring(cityB:GetCulturalIdentity():GetLoyalty())
            end)
            try("assign B's governor to city B", function()
                local gs = pb:GetGovernors()
                local list = gs:GetGovernorList()
                local g = list and list[1]
                if not g then
                    gs:AppointGovernor(GameInfo.Governors["GOVERNOR_THE_DEFENDER"].Index)
                    list = gs:GetGovernorList(); g = list and list[1]
                end
                if not g then return "no governor to assign" end
                g:Assign(cityB)
                return "assigned " .. tostring(g:GetType()) .. " established=" .. tostring(g:IsEstablished())
            end)
            try("pillage an improvement of B and lay a road", function()
                local done = "none"
                for _, plotIndex in ipairs(Map.GetCityPlots():GetPurchasedPlots(cityB)) do
                    local plot = Map.GetPlotByIndex(plotIndex)
                    if plot:GetImprovementType() ~= -1 and not plot:IsImprovementPillaged() then
                        plot:SetImprovementPillaged(true); done = "pillaged " .. plot:GetX() .. "," .. plot:GetY(); break
                    end
                end
                local road = Map.GetAdjacentPlot(cityB:GetX(), cityB:GetY(), DirectionTypes.DIRECTION_WEST)
                RouteBuilder.SetRouteType(road, GameInfo.Routes["ROUTE_ANCIENT_ROAD"].Index)
                return done .. "; road at " .. road:GetX() .. "," .. road:GetY() .. " type " .. tostring(road:GetRouteType())
            end)
        end
        try("A founds a religion", function()
            local rel = pa:GetReligion()
            rel:SetPantheon(GameInfo.Beliefs["BELIEF_GOD_OF_THE_SEA"].Index)
            local ok = pcall(function() Game.GetReligion():FoundReligion(a, GameInfo.Religions["RELIGION_CATHOLICISM"].Index, { GameInfo.Beliefs["BELIEF_TITHE"].Index, GameInfo.Beliefs["BELIEF_CHORAL_MUSIC"].Index }, cityA and cityA:GetID()) end)
            return "pantheon " .. tostring(rel:GetPantheon()) .. " found=" .. tostring(ok) .. " created=" .. tostring(rel:GetReligionTypeCreated())
        end)
        for id = 0, 63 do
            local cs = Players[id]
            if cs and cs:IsAlive() and not cs:IsMajor() and not cs:IsBarbarian() and cs:GetCities():GetCount() > 0 then
                try("A declares a formal war on city-state " .. id, function()
                    pa:GetDiplomacy():DeclareWarOn(id, WarTypes.FORMAL_WAR, true)
                    return "turn " .. tostring(Game.GetCurrentGameTurn()) .. " at war " .. tostring(pa:GetDiplomacy():IsAtWarWith(id))
                end)
                break
            end
        end
    end

    -- 9. A mid-game landscape in one load: more cities of different sizes, luxuries improved, a pillaged
    --    improvement, roads, a Holy Site for the Great Prophet to found a religion in, faith and
    --    gold to spend, the civics that unlock governor titles, and a city planted next to the
    --    enemy so loyalty has something to lose. What stays by hand: found the religion, assign a
    --    governor, sleep one unit.
    if not Game:GetProperty("LAB_APPLIED_V9") then
        local function plotAt(x, y) return Map.GetPlot(x, y) end
        local function landNear(cx, cy, minD, maxD, avoid)
            for d = minD, maxD do
                for dx = -d, d do for dy = -d, d do
                    local plot = plotAt(cx + dx, cy + dy)
                    if plot and Map.GetPlotDistance(cx, cy, plot:GetX(), plot:GetY()) == d and not plot:IsWater() and not plot:IsMountain()
                        and plot:GetOwner() == -1 and not plot:IsCity() and not (avoid and Map.GetPlotDistance(avoid:GetX(), avoid:GetY(), plot:GetX(), plot:GetY()) < 3) then
                        return plot
                    end
                end end
            end
            return nil
        end
        for _, who in ipairs({ { id = a, p = pa, city = cityA, other = cityB }, { id = b, p = pb, city = cityB, other = cityA } }) do
            if who.id and who.city then
                local pid, pl, capital = who.id, who.p, who.city
                try("civics and techs for " .. pid, function()
                    for _, c in ipairs({ "CIVIC_EARLY_EMPIRE", "CIVIC_STATE_WORKFORCE", "CIVIC_POLITICAL_PHILOSOPHY", "CIVIC_DRAMA_POETRY", "CIVIC_MYSTICISM" }) do pl:GetCulture():SetCivic(GameInfo.Civics[c].Index, true) end
                    for _, t in ipairs({ "TECH_IRRIGATION", "TECH_MINING", "TECH_ASTROLOGY", "TECH_WRITING", "TECH_CURRENCY", "TECH_MASONRY" }) do pl:GetTechs():SetTech(GameInfo.Technologies[t].Index, true) end
                    return "ok"
                end)
                try("faith and gold for " .. pid, function()
                    pl:GetReligion():ChangeFaithBalance(400 + pid * 37)
                    pl:GetTreasury():ChangeGoldBalance(300 + pid * 53)
                    return "faith " .. tostring(pl:GetReligion():GetFaithBalance()) .. " gold " .. tostring(pl:GetTreasury():GetGoldBalance())
                end)
                try("two more cities for " .. pid, function()
                    local made = {}
                    local p1 = landNear(capital:GetX(), capital:GetY(), 4, 6, nil)
                    if p1 then local c = pl:GetCities():Create(p1:GetX(), p1:GetY()); if c then c:ChangePopulation(3); made[#made + 1] = p1:GetX() .. "," .. p1:GetY() end end
                    -- the loyalty one: as close to the other human's capital as the rules allow
                    if who.other then
                        local p2 = landNear(who.other:GetX(), who.other:GetY(), 3, 5, capital)
                        if p2 then local c = pl:GetCities():Create(p2:GetX(), p2:GetY()); if c then c:ChangePopulation(1); made[#made + 1] = p2:GetX() .. "," .. p2:GetY() .. "(near enemy)" end end
                    end
                    return table.concat(made, " ")
                end)
                try("grow the capital of " .. pid, function() capital:ChangePopulation(3); return "pop " .. tostring(capital:GetPopulation()) end)
                try("improvements, a pillage and a road around " .. Locale.Lookup(capital:GetName()), function()
                    local done, pillaged = 0, nil
                    for dx = -2, 2 do for dy = -2, 2 do
                        local plot = plotAt(capital:GetX() + dx, capital:GetY() + dy)
                        if plot and plot:GetOwner() == pid and not plot:IsCity() and not plot:IsWater() and plot:GetImprovementType() == -1 and plot:GetDistrictType() == -1 and done < 6 then
                            local res = plot:GetResourceType()
                            local imp = "IMPROVEMENT_FARM"
                            if res ~= -1 then
                                local row = GameInfo.Resources[res]
                                if row.ResourceClassType == "RESOURCECLASS_LUXURY" then imp = (row.ResourceType == "RESOURCE_WINE" or row.ResourceType == "RESOURCE_SILK" or row.ResourceType == "RESOURCE_COFFEE") and "IMPROVEMENT_PLANTATION" or "IMPROVEMENT_MINE" end
                            end
                            if not plot:IsHills() or imp ~= "IMPROVEMENT_FARM" then
                                ImprovementBuilder.SetImprovementType(plot, GameInfo.Improvements[imp].Index, pid)
                                done = done + 1
                                if done == 2 then ImprovementBuilder.SetImprovementPillaged(plot, true); pillaged = plot:GetX() .. "," .. plot:GetY() end
                            end
                        end
                    end end
                    local road = Map.GetAdjacentPlot(capital:GetX(), capital:GetY(), DirectionTypes.DIRECTION_EAST)
                    RouteBuilder.SetRouteType(road, GameInfo.Routes["ROUTE_ANCIENT_ROAD"].Index)
                    return string.format("%d improvements, pillaged %s, road %d,%d", done, tostring(pillaged), road:GetX(), road:GetY())
                end)
                try("a Holy Site for " .. Locale.Lookup(capital:GetName()), function()
                    for dx = -2, 2 do for dy = -2, 2 do
                        local plot = plotAt(capital:GetX() + dx, capital:GetY() + dy)
                        if plot and plot:GetOwner() == pid and not plot:IsCity() and not plot:IsWater() and not plot:IsMountain() and plot:GetDistrictType() == -1 and plot:GetImprovementType() == -1 and plot:GetResourceType() == -1 then
                            capital:GetBuildQueue():CreateIncompleteDistrict(GameInfo.Districts["DISTRICT_HOLY_SITE"].Index, plot:GetIndex(), 100)
                            return "at " .. plot:GetX() .. "," .. plot:GetY()
                        end
                    end end
                    return "no plot"
                end)
            end
        end
    end

    -- 10. What lab8 left open:
    --     a city for each human right at the other's border (loyalty pressure), a Holy Site
    --     for Pella on a cleared plot so the Great Prophet can found a religion there, and
    --     three wonders for B so tourism differs between the two players.
    if not Game:GetProperty("LAB_APPLIED_V9") then
        local function plotAt(x, y) return Map.GetPlot(x, y) end
        local function freeLandNear(cx, cy, minD, maxD)
            for d = minD, maxD do
                for dx = -d, d do for dy = -d, d do
                    local plot = plotAt(cx + dx, cy + dy)
                    if plot and Map.GetPlotDistance(cx, cy, plot:GetX(), plot:GetY()) == d and not plot:IsWater() and not plot:IsMountain()
                        and not plot:IsCity() and plot:GetOwner() == -1 and plot:GetDistrictType() == -1 then
                        local ok = true
                        for _, c in ipairs(Map.GetPlotsInRange and {} or {}) do end
                        return plot
                    end
                end end
            end
            return nil
        end
        for _, who in ipairs({ { id = a, p = pa, other = cityB }, { id = b, p = pb, other = cityA } }) do
            if who.id and who.other then
                try("border city for " .. who.id .. " next to " .. Locale.Lookup(who.other:GetName()), function()
                    -- Civ6 needs 3 tiles between cities; the first free land plot at distance 3..7 from the enemy capital.
                    local plot = freeLandNear(who.other:GetX(), who.other:GetY(), 3, 7)
                    if not plot then return "no free plot" end
                    local c = who.p:GetCities():Create(plot:GetX(), plot:GetY())
                    if not c then return "Create returned nil at " .. plot:GetX() .. "," .. plot:GetY() end
                    c:ChangePopulation(2)
                    return string.format("%s at %d,%d (dist %d)", Locale.Lookup(c:GetName()), plot:GetX(), plot:GetY(), Map.GetPlotDistance(who.other:GetX(), who.other:GetY(), plot:GetX(), plot:GetY()))
                end)
            end
        end
        if cityA then
            try("a Holy Site for " .. Locale.Lookup(cityA:GetName()) .. " on a cleared plot", function()
                for dx = -2, 2 do for dy = -2, 2 do
                    local plot = plotAt(cityA:GetX() + dx, cityA:GetY() + dy)
                    if plot and plot:GetOwner() == a and not plot:IsCity() and not plot:IsWater() and not plot:IsMountain() and plot:GetDistrictType() == -1 and plot:GetResourceType() == -1 and plot:GetFeatureType() == -1 then
                        if plot:GetImprovementType() ~= -1 then ImprovementBuilder.SetImprovementType(plot, -1) end
                        cityA:GetBuildQueue():CreateIncompleteDistrict(GameInfo.Districts["DISTRICT_HOLY_SITE"].Index, plot:GetIndex(), 100)
                        return "at " .. plot:GetX() .. "," .. plot:GetY() .. " district " .. tostring(plot:GetDistrictType())
                    end
                end end
                return "no plot"
            end)
        end
        if cityB then
            for i, w in ipairs({ "BUILDING_COLOSSEUM", "BUILDING_GREAT_BATH", "BUILDING_HANGING_GARDENS" }) do
                try(w .. " for " .. Locale.Lookup(cityB:GetName()), function()
                    local dirs = { DirectionTypes.DIRECTION_NORTHEAST, DirectionTypes.DIRECTION_SOUTHEAST, DirectionTypes.DIRECTION_SOUTHWEST, DirectionTypes.DIRECTION_NORTHWEST }
                    for _, dir in ipairs(dirs) do
                        local plot = Map.GetAdjacentPlot(cityB:GetX(), cityB:GetY(), dir)
                        if plot and not plot:IsWater() and not plot:IsMountain() and plot:GetDistrictType() == -1 and plot:GetOwner() == b then
                            if plot:GetImprovementType() ~= -1 then ImprovementBuilder.SetImprovementType(plot, -1) end
                            cityB:GetBuildQueue():CreateIncompleteBuilding(GameInfo.Buildings[w].Index, plot:GetIndex(), 100)
                            return "at " .. plot:GetX() .. "," .. plot:GetY()
                        end
                    end
                    return "no plot"
                end)
            end
        end
    end

    -- 7. Envoys: A sends two envoys to the first city-state.
    for id = 0, 63 do
        local cs = Players[id]
        if cs and cs:IsAlive() and not cs:IsHuman() and not cs:IsMajor() and cs:GetCities():GetCount() > 0 then
            try("A envoys to city-state " .. id, function()
                local inf = pa:GetInfluence()
                inf:ChangeTokensToGive(2)
                inf:GiveTokensToPlayer(id, 2)
                return "received " .. tostring(cs:GetInfluence():GetTokensReceived(a))
            end)
            break
        end
    end
end

-- Per-capture commands from SaveLabCmd.lua (written by hand or by scripts/civ6-run.ts):
--   LAB_CMD = { gate = "war-a", wars = { { 0, 2, "FORMAL" } }, peace = { { 0, 1 } }, skipScenarios = true }
-- `gate` names a property so the same command is not applied twice to a game.
local function runCommands()
    local ok, err = pcall(function() include("SaveLabCmd") end)
    local cmd = ok and LAB_CMD or nil
    if not cmd then log("commands", ok, ok and "none" or err); return false end
    if cmd.gate and Game:GetProperty("LAB_CMD_" .. cmd.gate) then log("commands", true, "gate " .. cmd.gate .. " already applied"); return cmd.skipScenarios == true end
    for _, w in ipairs(cmd.wars or {}) do
        try(string.format("war %d → %d (%s)", w[1], w[2], w[3] or "FORMAL"), function()
            Players[w[1]]:GetDiplomacy():SetHasMet(w[2], true)
            Players[w[1]]:GetDiplomacy():DeclareWarOn(w[2], WarTypes[(w[3] or "FORMAL") .. "_WAR"], true)
            return "turn " .. tostring(Game.GetCurrentGameTurn()) .. " at war " .. tostring(Players[w[1]]:GetDiplomacy():IsAtWarWith(w[2]))
        end)
    end
    for _, pc in ipairs(cmd.peace or {}) do
        try(string.format("peace %d ↔ %d", pc[1], pc[2]), function()
            Players[pc[1]]:GetDiplomacy():MakePeaceWith(pc[2], true)
            return "at war " .. tostring(Players[pc[1]]:GetDiplomacy():IsAtWarWith(pc[2]))
        end)
    end
    for _, a in ipairs(cmd.alliances or {}) do
        try(string.format("alliance %d ↔ %d", a[1], a[2]), function()
            local d1, d2 = Players[a[1]]:GetDiplomacy(), Players[a[2]]:GetDiplomacy()
            d1:SetHasMet(a[2], true); d2:SetHasMet(a[1], true)
            if d1:IsAtWarWith(a[2]) then d1:MakePeaceWith(a[2], true) end
            d1:SetHasAllied(a[2], true); d2:SetHasAllied(a[1], true)
            if a[3] then d1:SetPermanentAlliance(a[2]); d2:SetPermanentAlliance(a[1]) end
            return "allied " .. tostring(d1:HasAllied(a[2])) .. "/" .. tostring(d2:HasAllied(a[1]))
        end)
    end
    -- Strip a game down for hand play: every unit of the majors, every non-capital city.
    if cmd.slim then
        for _, p in ipairs(Game.GetPlayers({ Alive = true, Major = true })) do
            local pid = p:GetID()
            try(string.format("slim units %d", pid), function()
                local n = 0
                for _, u in p:GetUnits():Members() do p:GetUnits():Destroy(u); n = n + 1 end
                return n .. " destroyed"
            end)
            try(string.format("slim cities %d", pid), function()
                local n, keep = 0, cmd.slim.keepCities or 1
                local kept, doomed = 0, {}
                local cities = p:GetCities()
                local capital = cities:GetCapitalCity()
                local isCapital = function(c) return capital ~= nil and c:GetID() == capital:GetID() end
                for _, c in cities:Members() do
                    if isCapital(c) or kept < keep - 1 then
                        if not isCapital(c) then kept = kept + 1 end
                    else
                        doomed[#doomed + 1] = c
                    end
                end
                local how = type(cities.Destroy) == "function" and "Cities:Destroy" or (CityManager and type(CityManager.DestroyCity) == "function" and "CityManager.DestroyCity" or "none")
                for _, c in ipairs(doomed) do
                    if how == "Cities:Destroy" then cities:Destroy(c) elseif how == "CityManager.DestroyCity" then CityManager.DestroyCity(c) else error("no destroy API: " .. tostring(cities.Destroy)) end
                    n = n + 1
                end
                return n .. " destroyed via " .. how
            end)
        end
    end
    for _, u in ipairs(cmd.units or {}) do
        try(string.format("unit %s for %d at %d,%d", u[2], u[1], u[3], u[4]), function()
            local unit = Players[u[1]]:GetUnits():Create(GameInfo.Units[u[2]].Index, u[3], u[4])
            return "id " .. tostring(unit and unit:GetID())
        end)
    end
    if cmd.gate then Game:SetProperty("LAB_CMD_" .. cmd.gate, Game.GetCurrentGameTurn()) end
    return cmd.skipScenarios == true
end

local function run()
    -- Commands first (they may ask to skip the scenarios); then the scenario set, once per game.
    local skipScenarios = runCommands()
    if not skipScenarios and not Game:GetProperty("LAB_APPLIED_V9") then
        if Game:GetProperty("LAB_APPLIED") then LOG[#LOG + 1] = "note: earlier lab already applied; only the newer steps run" end
        local ok, err = pcall(apply, Game:GetProperty("LAB_APPLIED") ~= nil)
        if not ok then log("apply", false, err) end
        for _, v in ipairs({ "", "_V3", "_V4", "_V9" }) do Game:SetProperty("LAB_APPLIED" .. v, Game.GetCurrentGameTurn()) end
    end
    Game:SetProperty("LAB_LOG", table.concat(LOG, "\n"))
end

Events.LoadScreenClose.Add(run)
