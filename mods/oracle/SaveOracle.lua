-- the oracle mod: dump the live state into the save itself.
--
-- Read-only as far as the game goes: it writes two game properties (see "Channels" below) and
-- nothing else. A dump is written on load, at the start of every turn, and after every save, so
-- the next save always carries the state as of its last load/turn start; `npm run
-- oracle <save>` prints it and `src/civ6save/oracle.ts` reads it for the tests.
-- The [SaveOracle] print lines remain for builds that do write Lua.log.

local PREFIX = "[SaveOracle]"
local CHUNK = 900

local function esc(s)
    return (tostring(s):gsub('[%c"\\]', function(c) return string.format("\\u%04x", c:byte()) end))
end

local function j(v)
    local t = type(v)
    if t == "table" then
        if #v > 0 or next(v) == nil then
            local parts = {}
            for _, x in ipairs(v) do parts[#parts + 1] = j(x) end
            return "[" .. table.concat(parts, ",") .. "]"
        end
        local parts = {}
        for k, x in pairs(v) do parts[#parts + 1] = '"' .. esc(k) .. '":' .. j(x) end
        table.sort(parts)
        return "{" .. table.concat(parts, ",") .. "}"
    elseif t == "string" then
        return '"' .. esc(v) .. '"'
    elseif t == "boolean" or t == "number" then
        return tostring(v)
    end
    return "null"
end

local function safe(f, ...)
    local ok, r = pcall(f, ...)
    if ok then return r end
    return nil
end

-- `m(obj, "Method", args…)`: call a method if the object and the method exist, nil otherwise.
-- The UI and gameplay contexts expose different subsets of the API; every engine call goes
-- through here so a missing method costs one field, not the dump.
local function m(obj, name, ...)
    if obj == nil then return nil end
    local f = safe(function() return obj[name] end)
    if type(f) ~= "function" then return nil end
    local ok, r = pcall(f, obj, ...)
    if ok then return r end
    return nil
end

local function typeName(tbl, index)
    if index == nil or index == -1 then return nil end
    local row = tbl and safe(function() return tbl[index] end)
    if row == nil then return nil end
    return row.UnitType or row.BuildingType or row.DistrictType or row.TechnologyType
        or row.CivicType or row.GovernmentType or row.PolicyType or row.UnitPromotionType
        or row.ProjectType or row.LeaderType or row.CivilizationType
end

-- Any engine call may answer nil or false where a list was expected; iterate only tables.
local function list(x) if type(x) == "table" then return x end return {} end

local function members(coll)
    local out = {}
    pcall(function() for _, x in coll:Members() do out[#out + 1] = x end end)
    return out
end

local function dumpUnit(u)
    local exp = m(u, "GetExperience")
    local promos = {}
    if exp then
        for row in GameInfo.UnitPromotions() do
            if m(exp, "HasPromotion", row.Index) then promos[#promos + 1] = row.UnitPromotionType end
        end
    end
    return {
        id = m(u, "GetID"), type = typeName(GameInfo.Units, m(u, "GetType")), x = m(u, "GetX"), y = m(u, "GetY"),
        damage = m(u, "GetDamage"), maxDamage = m(u, "GetMaxDamage"),
        moves = m(u, "GetMovesRemaining"), maxMoves = m(u, "GetMaxMoves"),
        xp = m(exp, "GetExperiencePoints"), level = m(exp, "GetLevel"),
        promotions = promos, formation = m(u, "GetFormationClass"),
        militaryFormation = m(u, "GetMilitaryFormation"),
        charges = m(u, "GetBuildCharges"),
        activity = m(u, "GetActivityType"), fortifyTurns = m(u, "GetFortifyTurns"),
        spreadCharges = m(m(u, "GetReligion"), "GetSpreadCharges"), name = m(u, "GetName"),
    }
end

local function dumpCity(c)
    local q = m(c, "GetBuildQueue")
    local buildings, districts = {}, {}
    local cb = m(c, "GetBuildings")
    for row in GameInfo.Buildings() do
        if m(cb, "HasBuilding", row.Index) then buildings[#buildings + 1] = row.BuildingType end
    end
    local cd = m(c, "GetDistricts")
    if cd then
        local seen = {}
        local function add(d)
            if d == nil or seen[d] then return end
            seen[d] = true
            districts[#districts + 1] = {
                type = typeName(GameInfo.Districts, m(d, "GetType")), x = m(d, "GetX"), y = m(d, "GetY"),
                complete = m(d, "IsComplete"), pillaged = m(d, "IsPillaged"),
            }
        end
        for _, d in ipairs(members(cd)) do add(d) end
        if #districts == 0 then
            for row in GameInfo.Districts() do
                if m(cd, "HasDistrict", row.Index) then add(m(cd, "GetDistrict", row.Index)) end
            end
        end
    end
    local growth = m(c, "GetGrowth")
    local identity, religion, power = m(c, "GetCulturalIdentity"), m(c, "GetReligion"), m(c, "GetPower")
    local religions = {}
    for _, r in ipairs(list(m(religion, "GetReligionsInCity"))) do
        religions[#religions + 1] = { religion = r.Religion, followers = r.Followers, pressure = r.Pressure }
    end
    -- Citizen assignment: every owned plot with its worked flag and yields (a worked district plot is a specialist).
    local cz = m(c, "GetCitizens")
    local plots, favored, disfavored, yields = {}, {}, {}, {}
    for _, plotId in ipairs(list(safe(function() return Map.GetCityPlots():GetPurchasedPlots(c) end))) do
        local plot = safe(function() return Map.GetPlotByIndex(plotId) end)
        if plot then
            local px, py = m(plot, "GetX"), m(plot, "GetY")
            local py_ = {}
            for row in GameInfo.Yields() do py_[row.YieldType] = m(plot, "GetYield", row.Index) end
            plots[#plots + 1] = { index = plotId, x = px, y = py, worked = m(cz, "IsPlotWorked", px, py),
                locked = m(cz, "IsPlotLocked", px, py) or m(cz, "IsPlotLocked", plotId),
                district = m(plot, "GetDistrictType"), yields = py_ }
        end
    end
    for row in GameInfo.Yields() do
        yields[row.YieldType] = m(c, "GetYield", row.Index)
        if m(cz, "IsFavoredYield", row.Index) then favored[#favored + 1] = row.YieldType end
        if m(cz, "IsDisfavoredYield", row.Index) then disfavored[#disfavored + 1] = row.YieldType end
    end
    -- The citizen-management targets (UI context only): every workable plot with its worker
    -- count (specialist slots count above one), capacity and locked workers.
    local citizens = nil
    if not IS_GAMEPLAY and CityManager and CityManager.GetCommandTargets then
        local ok, r = pcall(function()
            local variants = { {}, { [CityCommandTypes.PARAM_MANAGE_CITIZEN] = 1 }, { [CityCommandTypes.PARAM_MANAGE_CITIZEN] = 0 } }
            local tried = {}
            for vi, params in ipairs(variants) do
                local t = CityManager.GetCommandTargets(c, CityCommandTypes.MANAGE, params)
                local plots = t and t[CityCommandResults.PLOTS]
                local keys = {}
                if t then for k, v in pairs(t) do keys[#keys + 1] = tostring(k) .. "=" .. tostring(v) .. (type(v) == "table" and ("#" .. #v) or "") end end
                tried[#tried + 1] = tostring(t) .. "/" .. tostring(plots and #plots) .. "{" .. table.concat(keys, ",") .. "}"
                if plots and #plots > 0 then
                    return { variant = vi, plots = plots, workers = t[CityCommandResults.CITIZENS],
                             capacity = t[CityCommandResults.MAX_CITIZENS], locked = t[CityCommandResults.LOCKED_CITIZENS] }
                end
            end
            return { tried = table.concat(tried, " "), paramKey = tostring(CityCommandTypes.PARAM_MANAGE_CITIZEN), manage = tostring(CityCommandTypes.MANAGE), resultsKey = tostring(CityCommandResults.PLOTS) }
        end)
        citizens = ok and r or { error = tostring(r) }
    end
    -- Great works in building slots.
    local greatWorks = {}
    pcall(function()
        for row in GameInfo.Buildings() do
            if m(cb, "HasBuilding", row.Index) then
                local slots = m(cb, "GetNumGreatWorkSlots", row.Index) or 0
                for slot = 0, slots - 1 do
                    local index = m(cb, "GetGreatWorkInSlot", row.Index, slot)
                    local slotType = m(cb, "GetGreatWorkSlotType", row.Index, slot)
                    if index and index ~= -1 then
                        local gwType = safe(function() return Game.GetGreatWorkTypeFromIndex(index) end) or safe(function() return Game.GetGreatWorkType(index) end)
                        local row2 = gwType and GameInfo.GreatWorks[gwType]
                        greatWorks[#greatWorks + 1] = { building = row.BuildingType, slot = slot, index = index, type = row2 and row2.GreatWorkType or gwType,
                            creator = safe(function() return Game.GetGreatWorkPlayer(index) end), slotType = slotType }
                    elseif slots > 0 then
                        greatWorks[#greatWorks + 1] = { building = row.BuildingType, slot = slot, index = -1, slotType = slotType }
                    end
                end
            end
        end
    end)
    local queue = {}
    if q then
        for i = 0, 6 do
            local hash = m(q, "GetAt", i)
            if hash and hash ~= -1 then queue[#queue + 1] = hash end
        end
    end
    return {
        id = m(c, "GetID"), name = m(c, "GetName"), x = m(c, "GetX"), y = m(c, "GetY"), owner = m(c, "GetOwner"),
        population = m(c, "GetPopulation"), capital = m(c, "IsCapital"),
        food = m(growth, "GetFood"),
        foodSurplus = m(growth, "GetFoodSurplus"),
        growthThreshold = m(growth, "GetGrowthThreshold"),
        housing = m(growth, "GetHousing"),
        turnsToGrow = m(growth, "GetTurnsUntilGrowth"),
        production = m(q, "CurrentlyBuilding"),
        productionProgress = m(q, "GetProductionProgress"),
        productionCost = m(q, "GetProductionCost"),
        queue = queue, buildings = buildings, districts = districts,
        hp = safe(function() return c:GetDamage(DefenseTypes.DISTRICT_GARRISON) end),
        maxHp = safe(function() return c:GetMaxDamage(DefenseTypes.DISTRICT_GARRISON) end),
        loyalty = m(identity, "GetLoyalty"), loyaltyPerTurn = m(identity, "GetLoyaltyPerTurn"),
        amenities = m(growth, "GetAmenities"), amenitiesNeeded = m(growth, "GetAmenitiesNeeded"),
        amenitiesFromLuxuries = m(growth, "GetAmenitiesFromLuxuries"), amenitiesFromEntertainment = m(growth, "GetAmenitiesFromEntertainment"),
        amenitiesFromReligion = m(growth, "GetAmenitiesFromReligion"), amenitiesFromCivics = m(growth, "GetAmenitiesFromCivics"),
        amenitiesLostFromWarWeariness = m(growth, "GetAmenitiesLostFromWarWeariness"), happiness = m(growth, "GetHappiness"),
        housingFromBuildings = m(growth, "GetHousingFromBuildings"), housingFromWater = m(growth, "GetHousingFromWaterTiles"),
        housingFromDistricts = m(growth, "GetHousingFromDistricts"), housingFromImprovements = m(growth, "GetHousingFromImprovements"),
        housingFromCivics = m(growth, "GetHousingFromCivics"),
        majorityReligion = m(religion, "GetMajorityReligion"), activePantheon = m(religion, "GetActivePantheon"),
        religions = religions,
        powerProduced = m(power, "GetPowerProduced"), powerConsumed = m(power, "GetPowerConsumed"),
        governor = m(m(c, "GetAssignedGovernor"), "GetType"),
        tourism = m(m(c, "GetCulture"), "GetTourism"),
        plots = plots, yields = yields, favoredYields = favored, disfavoredYields = disfavored,
        numWorkedPlots = m(cz, "GetNumCitizensWorkingPlots"), numSpecialists = m(cz, "GetNumSpecialists"),
        focusType = m(cz, "GetFocusType"), citizens = citizens, greatWorks = greatWorks,
    }
end

local function dedicationNames(ids)
    local out = {}
    for _, i in ipairs(list(ids)) do
        local row = GameInfo.CommemorationTypes and GameInfo.CommemorationTypes[i]
        out[#out + 1] = row and row.CommemorationType or tostring(i)
    end
    return out
end

local function dumpPlayer(p, id)
    local cfg = safe(function() return PlayerConfigurations[id] end)
    local techs, civics, policies = {}, {}, {}
    local pt, pc, pculture = m(p, "GetTechs"), m(p, "GetCulture"), m(p, "GetCulture")
    for row in GameInfo.Technologies() do
        if m(pt, "HasTech", row.Index) then techs[#techs + 1] = row.TechnologyType end
    end
    for row in GameInfo.Civics() do
        if m(pc, "HasCivic", row.Index) then civics[#civics + 1] = row.CivicType end
    end
    local slots = m(pculture, "GetNumPolicySlots") or 0
    for i = 0, slots - 1 do
        local pol = m(pculture, "GetSlotPolicy", i)
        policies[#policies + 1] = { slot = i, policy = typeName(GameInfo.Policies, pol) }
    end
    local units, cities = {}, {}
    for _, u in ipairs(members(m(p, "GetUnits"))) do
        local ok, r = pcall(dumpUnit, u)
        units[#units + 1] = ok and r or { error = tostring(r) }
    end
    for _, c in ipairs(members(m(p, "GetCities"))) do
        local ok, r = pcall(dumpCity, c)
        cities[#cities + 1] = ok and r or { error = tostring(r) }
    end
    local diplo = {}
    local pd = m(p, "GetDiplomacy")
    for other = 0, 63 do
        local o = Players[other]
        if o and other ~= id and m(o, "IsAlive") and m(pd, "HasMet", other) then
            diplo[#diplo + 1] = { player = other, war = m(pd, "IsAtWarWith", other), allied = m(pd, "HasAllied", other),
                allianceLevel = m(pd, "GetAllianceLevel", other), grievances = m(pd, "GetGrievancesAgainst", other),
                allianceType = m(pd, "GetAllianceType", other), allianceTurnsLeft = m(pd, "GetAllianceTurnsUntilExpiration", other),
                allianceTurnsThisLevel = m(pd, "GetAllianceTurnsThisLevel", other), alliancePointsPerTurn = m(pd, "GetAlliancePointsPerTurn", other),
                denounceTurn = m(pd, "GetDenounceTurn", other), warChangeTurn = m(pd, "GetAtWarChangeTurn", other),
                openBordersFrom = m(pd, "HasOpenBordersFrom", other), embassy = m(pd, "HasEmbassyAt", other), delegation = m(pd, "HasDelegationAt", other),
                visibility = m(pd, "GetVisibilityOn", other), warmonger = m(pd, "GetWarmongerLevel"),
                state = m(m(o, "GetDiplomaticAI"), "GetDiplomaticStateIndex", id) }
        end
    end
    local envoys = {}
    for other = 0, 63 do
        local o = Players[other]
        if o and m(o, "IsAlive") and not m(o, "IsMajor") then
            local inf = m(o, "GetInfluence")
            local n = m(inf, "GetTokensReceived", id)
            if n and n > 0 then envoys[#envoys + 1] = { cityState = other, envoys = n, suzerain = m(inf, "GetSuzerain") == id } end
        end
    end
    local routes = {}
    for _, r in ipairs(list(m(m(p, "GetTrade"), "GetOutgoingRoutes"))) do
        routes[#routes + 1] = {
            originPlayer = r.OriginCityPlayer, originCity = r.OriginCityID,
            destinationPlayer = r.DestinationCityPlayer, destinationCity = r.DestinationCityID,
            turnsRemaining = r.TurnsRemaining,
        }
    end
    local currentTech = m(pt, "GetResearchingTech")
    local currentCivic = m(pc, "GetProgressingCivic")
    local treasury, religion = m(p, "GetTreasury"), m(p, "GetReligion")
    local resources = {}
    local pr = m(p, "GetResources")
    for row in GameInfo.Resources() do
        local n = m(pr, "GetResourceAmount", row.Index)
        if n and n > 0 then resources[row.ResourceType] = { amount = n, cap = m(pr, "GetResourceStockpileCap", row.Index), perTurn = m(pr, "GetResourceAccumulationPerTurn", row.Index) } end
    end
    local governors = {}
    local pg = m(p, "GetGovernors")
    for _, g in ipairs(list(m(pg, "GetGovernorList"))) do
        local promos = {}
        for row in GameInfo.GovernorPromotions() do
            if m(g, "HasPromotion", row.Index) then promos[#promos + 1] = row.GovernorPromotionType end
        end
        local city = m(g, "GetAssignedCity")
        governors[#governors + 1] = { type = m(g, "GetType"), city = city and m(city, "GetID"), cityName = city and m(city, "GetName"), promotions = promos, established = m(g, "IsEstablished"), turnsToEstablish = m(g, "GetTurnsToEstablish"), neutralized = m(g, "GetNeutralizedTurns") }
    end
    local eras = m(Game, "GetEras")
    local religionCreated = m(religion, "GetReligionTypeCreated")
    local beliefs = {}
    if religionCreated and religionCreated ~= -1 then
        for _, b in ipairs(list(m(m(Game, "GetReligion"), "GetBeliefsInReligion", religionCreated))) do beliefs[#beliefs + 1] = b end
    end
    -- Fog of war: one char per plot, '0' unrevealed, '1' revealed, '2' visible now.
    local visibility = nil
    pcall(function()
        local pv = PlayersVisibility[id]
        if not pv then return end
        local chars = {}
        for i = 0, (Map.GetPlotCount() or 0) - 1 do
            chars[#chars + 1] = pv:IsVisible(i) and "2" or (pv:IsRevealed(i) and "1" or "0")
        end
        visibility = table.concat(chars)
    end)
    local touristsFrom = {}
    for otherId = 0, 63 do
        local n = m(m(p, "GetCulture"), "GetTouristsFrom", otherId)
        if n and n ~= 0 then touristsFrom[tostring(otherId)] = n end
    end
    return {
        id = id, civilization = m(cfg, "GetCivilizationTypeName"), leader = m(cfg, "GetLeaderTypeName"),
        name = m(cfg, "GetPlayerName"), human = m(p, "IsHuman"), major = m(p, "IsMajor"), minor = m(p, "IsMinor"), alive = m(p, "IsAlive"),
        gold = m(treasury, "GetGoldBalance"),
        goldPerTurn = m(treasury, "GetGoldYield"),
        faith = m(religion, "GetFaithBalance"),
        faithPerTurn = m(religion, "GetFaithYield"),
        science = m(pt, "GetScienceYield"),
        culture = m(pculture, "GetCultureYield"),
        eraScore = m(m(Game, "GetEras"), "GetPlayerCurrentScore", id) or m(m(p, "GetEras"), "GetEraScore"),
        eraThreshold = m(m(Game, "GetEras"), "GetPlayerThresholdScore", id),
        score = m(p, "GetScore"),
        government = typeName(GameInfo.Governments, m(pculture, "GetCurrentGovernment")),
        currentTech = typeName(GameInfo.Technologies, currentTech),
        currentTechProgress = currentTech and currentTech ~= -1 and m(pt, "GetResearchProgress", currentTech) or nil,
        currentCivic = typeName(GameInfo.Civics, currentCivic),
        currentCivicProgress = currentCivic and currentCivic ~= -1 and m(pc, "GetCulturalProgress", currentCivic) or nil,
        techs = techs, civics = civics, policies = policies, units = units, cities = cities, diplomacy = diplo, envoys = envoys,
        tradeRoutes = routes, routeCapacity = m(m(p, "GetTrade"), "GetOutgoingRouteCapacity"),
        resources = resources, governors = governors,
        governorTitles = m(pg, "GetGovernorPoints"), governorTitlesSpent = m(pg, "GetGovernorPointsSpent"),
        tourism = m(m(p, "GetStats"), "GetTourism"),
        staycationers = m(m(p, "GetCulture"), "GetStaycationers"), touristsTo = m(m(p, "GetCulture"), "GetTouristsTo"),
        touristsFrom = touristsFrom, visibility = visibility,
        goldenAge = m(eras, "HasGoldenAge", id), darkAge = m(eras, "HasDarkAge", id), heroicAge = m(eras, "HasHeroicGoldenAge", id),
        goldenAgeThreshold = m(eras, "GetPlayerGoldenAgeThreshold", id), darkAgeThreshold = m(eras, "GetPlayerDarkAgeThreshold", id),
        thresholdBaseline = m(eras, "GetPlayerThresholdBaseline", id), previousGoldenAgeThreshold = m(eras, "GetPlayerPreviousGoldenAgeThreshold", id),
        dedications = dedicationNames(m(eras, "GetPlayerActiveCommemorations", id)), dedicationChoices = dedicationNames(m(eras, "GetPlayerCommemorateChoices", id)),
        dedicationsAllowed = m(eras, "GetPlayerNumAllowedCommemorations", id),
        favor = m(p, "GetFavor") or m(m(p, "GetDiplomacy"), "GetFavor"),
        religionCreated = religionCreated, religionBeliefs = beliefs, holyCity = m(religion, "GetHolyCityID"),
        co2 = m(GameClimate, "GetPlayerCO2Footprint", id, false), co2Lifetime = m(GameClimate, "GetPlayerCO2Footprint", id, true),
        resolutions = safe(function() return m(m(Game, "GetWorldCongress"), "GetResolutions", id) end),
        warWeariness = m(m(p, "GetDiplomacy"), "GetWarWearinessTotal"),
    }
end

-- Channels. The Mac build writes no Lua.log, so `print` is not one. Game properties
-- (`Game:SetProperty`) are serialized with the game core and land in the compressed payload;
-- the call exists in the gameplay-script context only, so that context exposes it to the UI
-- context through ExposedMembers. The same file is loaded into both (see the modinfo): the
-- gameplay dump is ORACLE_JSON, the UI dump — the richer one, since the UI API has the
-- food stock, production progress, era score and unit levels — ORACLE_UI_JSON. The game
-- configuration (`GameConfiguration.SetValue`) is tried too, in case a build persists it.
-- `Game` is userdata in both contexts; only the gameplay one answers to SetProperty.
local IS_GAMEPLAY = (pcall(function() return Game.SetProperty end)) and Game.SetProperty ~= nil
if IS_GAMEPLAY then
    ExposedMembers.SaveOracle = ExposedMembers.SaveOracle or {}
    ExposedMembers.SaveOracle.SetProperty = function(key, value) Game:SetProperty(key, value) end
end

local function setProperty(key, value)
    if pcall(function() Game:SetProperty(key, value) end) then return "property" end
    if pcall(function() ExposedMembers.SaveOracle.SetProperty(key, value) end) then return "exposed" end
    return nil
end

local function publish(text)
    local channels = {}
    local via = setProperty(IS_GAMEPLAY and "ORACLE_JSON" or "ORACLE_UI_JSON", text)
    if via then channels[#channels + 1] = via end
    local n = math.ceil(#text / CHUNK)
    local ok = pcall(function()
        GameConfiguration.SetValue("ORACLE_COUNT", n)
        for i = 1, n do
            GameConfiguration.SetValue(string.format("ORACLE_%03d", i), text:sub((i - 1) * CHUNK + 1, i * CHUNK))
        end
    end)
    if ok then channels[#channels + 1] = "config" end
    return table.concat(channels, "+"), n
end

-- Small markers, written whether or not the dump itself succeeds: "did this channel persist at
-- all", and the error text of a failed dump.
local function mark(key, value)
    setProperty((IS_GAMEPLAY and "" or "UI_") .. key, value)
    pcall(function() GameConfiguration.SetValue(key, value) end)
end

PLAN_DEBUG = { log = {} }

local function dumpUnsafe(reason)
    local players = {}
    for id = 0, 63 do
        local p = Players[id]
        if p and m(p, "IsAlive") and (m(p, "IsMajor") or m(p, "IsMinor") or #members(m(p, "GetCities")) > 0) then
            local ok, r = pcall(dumpPlayer, p, id)
            players[#players + 1] = ok and r or { id = id, error = tostring(r) }
        end
    end
    local pillaged, routes, floods = {}, {}, {}
    local plotCount = m(Map, "GetPlotCount") or 0
    for i = 0, plotCount - 1 do
        local plot = Map.GetPlotByIndex(i)
        if plot then
            if m(plot, "IsImprovementPillaged") or m(plot, "IsRoutePillaged") then pillaged[#pillaged + 1] = i end
            local r = m(plot, "GetRouteType")
            if r and r ~= -1 then routes[#routes + 1] = { plot = i, route = r } end
        end
    end
    local eras = m(Game, "GetEras")
    local congress = m(Game, "GetWorldCongress")
    local state = {
        reason = reason, turn = m(Game, "GetCurrentGameTurn"), currentPlayer = m(Game, "GetLocalPlayer"),
        players = players,
        era = m(eras, "GetCurrentEra"), goldenAgeThreshold = m(eras, "GetCurrentEraGoldenAgeThreshold"), darkAgeThreshold = m(eras, "GetCurrentEraDarkAgeThreshold"),
        eraStartTurn = m(eras, "GetCurrentEraStartTurn"), eraCountdown = m(eras, "GetNextEraCountdown"),
        eraMinEndTurn = m(eras, "GetCurrentEraMinimumEndTurn"), eraMaxEndTurn = m(eras, "GetCurrentEraMaximumEndTurn"), finalEra = m(eras, "GetFinalEra"),
        climate = {
            temperature = m(GameClimate, "GetGlobalTemperature"), changeLevel = m(GameClimate, "GetClimateChangeLevel"),
            co2Total = m(GameClimate, "GetTotalCO2Footprint"), seaLevel = m(GameClimate, "GetSeaLevelPhase") or m(GameClimate, "GetSeaLevel"),
            temperatureChange = m(GameClimate, "GetTemperatureChange"), co2Modifier = m(GameClimate, "GetCO2FootprintModifier"),
            nextSeaLevelRiseTurns = m(GameClimate, "GetNextSeaLevelRiseTurns"), nextIceLossTurns = m(GameClimate, "GetNextIceLossTurns"),
            tilesFlooded = m(GameClimate, "GetTilesFlooded"), tilesSubmerged = m(GameClimate, "GetTilesSubmerged"), storms = m(GameClimate, "GetNumStorms"),
            lastSeaLevelEvent = m(GameClimate, "GetClimateChangeForLastSeaLevelEvent"),
        },
        -- CO2 per slot, dead players included (the total counts everyone who ever emitted).
        co2ByPlayer = (function()
            local out = {}
            for pid = 0, 63 do
                local now = safe(function() return GameClimate.GetPlayerCO2Footprint(pid, false) end)
                local life = safe(function() return GameClimate.GetPlayerCO2Footprint(pid, true) end)
                if (now and now ~= 0) or (life and life ~= 0) then
                    local byRes = {}
                    for row in GameInfo.Resources() do
                        local r = safe(function() return GameClimate.GetPlayerResourceCO2Footprint(pid, row.Index, true) end)
                        if r and r ~= 0 then byRes[row.ResourceType] = r end
                    end
                    out[tostring(pid)] = { now = now, lifetime = life, byResource = byRes }
                end
            end
            return out
        end)(),
        congressMeeting = m(congress, "GetMeetingStatus"), congressProposals = safe(function() return congress:GetProposals(Game.GetLocalPlayer()) end),
        congressEmergencies = m(congress, "GetEmergencies"),
        worldCongress = { inSession = m(congress, "IsInSession"), turnsUntilSession = m(congress, "GetTurnsUntilNextSession") or m(congress, "GetTurnsToNextSession") },
        pillagedPlots = pillaged, routes = routes,
        plan = PLAN_DEBUG, oracleVersion = 5, isGameplay = IS_GAMEPLAY,
    }
    local text = j(state)
    local channels, n = publish(text)
    mark("ORACLE_LAST", reason .. ":" .. channels)
    print(string.format("%s BEGIN reason=%s turn=%d chunks=%d channels=%s", PREFIX, reason, state.turn, n, channels))
    for i = 1, n do
        print(string.format("%s %d/%d %s", PREFIX, i, n, text:sub((i - 1) * CHUNK + 1, i * CHUNK)))
    end
    print(PREFIX .. " END")
end

local function dump(reason)
    mark("ORACLE_EVENT", reason)
    local ok, err = pcall(dumpUnsafe, reason)
    if not ok then mark("ORACLE_ERROR", reason .. ": " .. tostring(err)) end
end

local function on(events, name, handler)
    pcall(function() events[name].Add(handler) end)
end

-- Refresh before anything can be saved: on load, at each turn start, and again after every
-- save (so the next save carries the state at the time of saving, not of the last turn start).
-- Not every event exists in both contexts; the missing ones are skipped.
on(Events, "LoadGameViewStateDone", function() dump("load") end)
on(Events, "LoadScreenClose", function() dump("load") end)
on(Events, "LocalPlayerTurnBegin", function() dump("turn_begin") end)
on(Events, "PlayerTurnActivated", function() dump("turn_activated") end)
on(GameEvents, "OnGameTurnStarted", function() dump("game_turn") end)
on(Events, "SaveComplete", function() dump("save") end)
mark("ORACLE_PING", "script loaded")
dump("script_load")
print(PREFIX .. " loaded")

-- Automated runs (UI context only): Plan.lua, written by scripts/civ6-run.ts, says what to
-- do after the game has loaded — dump then save (so the save carries the state it holds),
-- run the AI for a few turns, save again, quit. Every step is pcall'd and its outcome goes
-- into the PLAN_LOG property, so the driver can read it from the last save.
if not IS_GAMEPLAY then
    local planOk, planErr = pcall(function() include("Plan") end)
    local plan = planOk and PLAN or nil
    PLAN_DEBUG.includeOk = planOk
    PLAN_DEBUG.includeErr = tostring(planErr)
    PLAN_DEBUG.planName = plan and plan.name or nil
    PLAN_DEBUG.hasContextPtr = ContextPtr ~= nil
    PLAN_DEBUG.hasSetUpdate = ContextPtr ~= nil and ContextPtr.SetUpdate ~= nil
    PLAN_DEBUG.hasNetworkSaveGame = Network ~= nil and Network.SaveGame ~= nil
    PLAN_DEBUG.hasAutoplay = AutoplayManager ~= nil
    if plan then
        local log = PLAN_DEBUG.log
        local function step(name, f)
            local ok, r = pcall(f)
            log[#log + 1] = string.format("%s %s: %s", ok and "OK" or "FAIL", name, tostring(r))
            setProperty("PLAN_LOG", table.concat(log, "\n"))
        end
        -- The UI-only getters (tourism, loyalty, …) answer nil from inside the tick but fine
        -- from SaveComplete, so a capture is two saves: `<name>-0` triggers the SaveComplete
        -- dump, `<name>-1` a few seconds later carries it (the state has not moved between).
        local function saveAs(name)
            step("save " .. name, function()
                local gameFile = {}
                gameFile.Name = name
                gameFile.Location = SaveLocations.LOCAL_STORAGE
                gameFile.Type = SaveTypes.HOTSEAT
                gameFile.IsAutosave = false
                gameFile.IsQuicksave = false
                Network.SaveGame(gameFile)
                return "requested"
            end)
        end
        -- Ticks come from GameCoreEventPublishComplete (a hidden context's SetUpdate never
        -- fires); time is os.clock when the context has it, else ticks at an assumed 30/s.
        local phase, ticks, t0, hadActions, started = 0, 0, nil, false, 0
        local endTurnStart, lastEndTurn = nil, -100
        -- City commands are refused until the hotseat "Start Turn" screen has been dismissed
        -- (the local player's turn is not active before that), so the actions wait for it.
        -- End the local player's turn by hand: pick a research and a civic when asked, give
        -- every idle city something to build, skip every unit, then request the end of turn.
        local function autoEndTurn()
            local pid = Game.GetLocalPlayer()
            local p = Players[pid]
            local notes = {}
            pcall(function()
                local techs = p:GetTechs()
                if techs:GetResearchingTech() == -1 then
                    for row in GameInfo.Technologies() do
                        if techs:CanResearch(row.Index) then
                            UI.RequestPlayerOperation(pid, PlayerOperations.RESEARCH, { [PlayerOperations.PARAM_TECH_TYPE] = row.Hash, [PlayerOperations.PARAM_INSERT_MODE] = PlayerOperations.VALUE_EXCLUSIVE })
                            notes[#notes + 1] = "tech=" .. row.TechnologyType
                            break
                        end
                    end
                end
            end)
            pcall(function()
                local culture = p:GetCulture()
                if culture:GetProgressingCivic() == -1 then
                    for row in GameInfo.Civics() do
                        if culture:CanProgress(row.Index) then
                            UI.RequestPlayerOperation(pid, PlayerOperations.PROGRESS_CIVIC, { [PlayerOperations.PARAM_CIVIC_TYPE] = row.Hash, [PlayerOperations.PARAM_INSERT_MODE] = PlayerOperations.VALUE_EXCLUSIVE })
                            notes[#notes + 1] = "civic=" .. row.CivicType
                            break
                        end
                    end
                end
            end)
            pcall(function()
                for _, city in p:GetCities():Members() do
                    local q = city:GetBuildQueue()
                    if q:CurrentlyBuilding() == nil or q:CurrentlyBuilding() == "" then
                        for row in GameInfo.Units() do
                            if q:CanProduce(row.Hash, true) then
                                CityManager.RequestOperation(city, CityOperationTypes.BUILD, { [CityOperationTypes.PARAM_UNIT_TYPE] = row.Hash, [CityOperationTypes.PARAM_INSERT_MODE] = CityOperationTypes.VALUE_EXCLUSIVE })
                                notes[#notes + 1] = city:GetName() .. "=" .. row.UnitType
                                break
                            end
                        end
                    end
                end
            end)
            pcall(function()
                for _, u in p:GetUnits():Members() do
                    if u:GetMovesRemaining() > 0 then UnitManager.RequestOperation(u, UnitOperationTypes.SKIP_TURN) end
                end
            end)
            pcall(function()
                local eras = Game.GetEras()
                local allowed = eras:GetPlayerNumAllowedCommemorations(pid) or 0
                local active = eras:GetPlayerActiveCommemorations(pid) or {}
                if allowed > #active then
                    local choices = eras:GetPlayerCommemorateChoices(pid) or {}
                    if choices[1] then
                        UI.RequestPlayerOperation(pid, PlayerOperations.COMMEMORATE, { [PlayerOperations.PARAM_COMMEMORATION_TYPE] = choices[1] })
                        notes[#notes + 1] = "dedication=" .. tostring(choices[1])
                    end
                end
            end)
            local blocking = NotificationManager.GetFirstEndTurnBlocking(pid)
            notes[#notes + 1] = "blocking=" .. tostring(blocking) .. " canEnd=" .. tostring(UI.CanEndTurn())
            UI.RequestAction(ActionTypes.ACTION_ENDTURN)
            return table.concat(notes, " ")
        end
        local actionsDone = false
        local function runActions()
            if actionsDone then return end
            actionsDone = true
            -- UI-side commands the capture wants between the two states (citizen swaps,
            -- focus changes, …): `actions = { { city = {player, index}, command = "MANAGE",
            -- params = { X = .., Y = .. } } }`; the `-2` saves then carry the result.
            step("actions", function() return tostring(plan.actions) .. " n=" .. #list(plan.actions) end)
            for i, a in ipairs(list(plan.actions)) do
                if a.lua then
                    -- Free-form: `{ lua = "return UI.RequestAction(ActionTypes.ACTION_ENDTURN)" }`.
                    step("action " .. i .. " lua", function()
                        local f, err = (loadstring or load)(a.lua)
                        if not f then error(err) end
                        return tostring(f())
                    end)
                    hadActions = true
                else
                step("action " .. i .. " " .. tostring(a.command), function()
                    local city = Players[a.city[1]]:GetCities():FindID(a.city[2])
                    local params = {}
                    for k, v in pairs(a.params or {}) do params[CityCommandTypes["PARAM_" .. k]] = v end
                    if a.command == "MANAGE" and params[CityCommandTypes.PARAM_MANAGE_CITIZEN] == nil then
                        params[CityCommandTypes.PARAM_MANAGE_CITIZEN] = UI.GetInterfaceModeParameter(CityCommandTypes.PARAM_MANAGE_CITIZEN)
                    end
                    local notes = { "city=" .. tostring(city and m(city, "GetName")) .. "@" .. tostring(city and m(city, "GetX")) .. "," .. tostring(city and m(city, "GetY")), "local=" .. tostring(Game.GetLocalPlayer()) }
                    if a.select then
                        notes[#notes + 1] = "select=" .. tostring(pcall(function() UI.SelectCity(city) end))
                        notes[#notes + 1] = "mode=" .. tostring(pcall(function() UI.SetInterfaceMode(InterfaceModeTypes.CITY_MANAGEMENT) end))
                    end
                    local okT, t = pcall(function() return CityManager.GetCommandTargets(city, CityCommandTypes[a.command], params) end)
                    if okT and t then
                        local plots = t[CityCommandResults.PLOTS]
                        notes[#notes + 1] = "targets=" .. tostring(plots and #plots)
                        PLAN_DEBUG.targets = PLAN_DEBUG.targets or {}
                        PLAN_DEBUG.targets[#PLAN_DEBUG.targets + 1] = { plots = plots, workers = t[CityCommandResults.CITIZENS], capacity = t[CityCommandResults.MAX_CITIZENS], locked = t[CityCommandResults.LOCKED_CITIZENS] }
                    else
                        notes[#notes + 1] = "targets=" .. tostring(t)
                    end
                    local okC, can, res = pcall(function() return CityManager.CanStartCommand(city, CityCommandTypes[a.command], params, true) end)
                    notes[#notes + 1] = "can=" .. tostring(okC and can or can)
                    local r = CityManager.RequestCommand(city, CityCommandTypes[a.command], params)
                    return tostring(r) .. " " .. table.concat(notes, " ")
                end)
                hadActions = true
                end
            end
        end
        local function turnActive()
            local ok, r = pcall(function() return Players[Game.GetLocalPlayer()]:IsTurnActive() end)
            return ok and r == true
        end
        local function tick()
            ticks = ticks + 1
            local ok, clock = pcall(function() return os.clock() end)
            local nowAbs = (ok and type(clock) == "number") and clock or ticks / 30
            t0 = t0 or nowAbs
            local now = nowAbs - t0
            PLAN_DEBUG.ticks = ticks
            PLAN_DEBUG.phase = phase
            PLAN_DEBUG.elapsed = now
            if phase == 0 and now - started > (plan.settleSeconds or 6) then
                phase = 0.5
                saveAs(plan.name .. "-0")
            elseif phase == 0.5 and now - started > (plan.settleSeconds or 6) + 8 then
                phase = 1
                saveAs(plan.name .. "-1")
            elseif phase == 1 and now - started > (plan.settleSeconds or 6) + 16 then
                phase = 2
                if (plan.turns or 0) > 0 then
                    step("autoplay " .. plan.turns .. " turns", function()
                        AutoplayManager.SetTurns(plan.turns)
                        AutoplayManager.SetReturnAsPlayer(Game.GetLocalPlayer())
                        AutoplayManager.SetObserveAsPlayer(Game.GetLocalPlayer())
                        AutoplayManager.SetActive(true)
                        return "started"
                    end)
                else
                    phase = 2.5
                end
            elseif phase == 2.5 and (plan.endTurns or 0) > 0 and now - started > (plan.settleSeconds or 6) + 6 then
                -- Play the local player's turns by hand until the target turn (or give up after 15 min).
                local turn = Game.GetCurrentGameTurn()
                if turnActive() then runActions() end
                endTurnStart = endTurnStart or turn
                if turn >= endTurnStart + plan.endTurns or now - started > (plan.settleSeconds or 6) + 900 then
                    phase = 3
                    hadActions = true
                    step("turns played", function() return tostring(turn - endTurnStart) end)
                elseif turnActive() and now - lastEndTurn > 6 then
                    lastEndTurn = now
                    if plan.eachTurn then
                        step("each turn " .. turn, function()
                            local f, err = (loadstring or load)(plan.eachTurn)
                            if not f then error(err) end
                            return tostring(f())
                        end)
                    end
                    step("end turn " .. turn, autoEndTurn)
                end
            elseif (phase == 2 or phase == 2.5) and now - started > (plan.settleSeconds or 6) + 6 + (plan.turns or 0) * (plan.secondsPerTurn or 20)
                and (turnActive() or now - started > (plan.settleSeconds or 6) + 180) then
                phase = 3
                runActions()
            elseif phase == 3 then
                phase = 3.5
                started = now
                if (plan.turns or 0) > 0 or hadActions then saveAs(plan.name .. "-2a") end
            elseif phase == 3.5 and now - started > 8 then
                phase = 4
                if (plan.turns or 0) > 0 or hadActions then saveAs(plan.name .. "-2") end
            elseif phase == 4 and now - started > 12 then
                phase = 5
                -- No quit call exists in this context (UI.ExitGame, Automation.Quit are nil);
                -- the driver ends the process once the saves are on disk.
                step("done", function() return "saves written" end)
            end
        end
        local function arm()
            step("plan armed", function() return plan.name .. " turns=" .. tostring(plan.turns) end)
            on(Events, "GameCoreEventPublishComplete", tick)
            pcall(function() ContextPtr:SetUpdate(tick) end)
        end
        -- Arm now: on a load from the main menu the load events have fired before this script
        -- exists; the settle time absorbs the rest of the loading either way.
        arm()
    end
end
