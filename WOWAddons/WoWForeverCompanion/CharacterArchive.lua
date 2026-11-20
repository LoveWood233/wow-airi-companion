-- Character archive observations from read-only public client APIs.
local _, ns = ...
local Archive = {}
ns.CharacterArchive = Archive

local Public = ns.Protocol.Public
local owner, database, publish, save, active, professionOpen
local timers, checkpoints = {}, {}
local maxID, maxEntries = 2147483647, 18000
local maxRecipeIDs, maxAchievementRows = 24000, 40000
local finalRecipeRows = 2048
local maxMaps, maxAreaIDs, totalAreaIDs = 720, 512, 4800
local characterEvents = {
    TRADE_SKILL_SHOW = true, TRADE_SKILL_CLOSE = true, TRADE_SKILL_LIST_UPDATE = true,
    TRADE_SKILL_NAME_UPDATE = true, TRADE_SKILL_DATA_SOURCE_CHANGED = true,
    TRADE_SKILL_DATA_SOURCE_CHANGING = true, NEW_RECIPE_LEARNED = true,
    SKILL_LINES_CHANGED = true, ACHIEVEMENT_EARNED = true, RECEIVED_ACHIEVEMENT_LIST = true,
    MAP_EXPLORATION_UPDATED = true, ZONE_CHANGED_NEW_AREA = true, ZONE_CHANGED = true,
    ZONE_CHANGED_INDOORS = true,
}
Archive.Events = characterEvents

local function Call(fn, ...)
    if type(fn) ~= "function" then return end
    local result = {pcall(fn, ...)}
    if not result[1] then return end
    for index = 2, 14 do
        if issecretvalue and issecretvalue(result[index]) then return end
        result[index] = Public(result[index])
    end
    return true, unpack(result, 2, 14)
end

local function Read(fn, ...)
    local _, value = Call(fn, ...)
    return value
end

local function Table(value)
    value = Public(value)
    if type(value) == "table" and (not canaccesstable or canaccesstable(value)) then return value end
end

local function Integer(value, minimum, maximum)
    value = Public(value)
    if type(value) == "number" and value >= minimum and value <= maximum
        and value == math.floor(value) then return value end
end

local function ID(value) return Integer(value, 1, maxID) end

local function Name(value, limit)
    value = Public(value)
    if type(value) ~= "string" then return end
    value = value:gsub("[%z\1-\31\127]", ""):gsub("\194[\128-\159]", "")
    value = ns.Protocol.UTF8Prefix(value, limit or 192)
    if value:find("%S") then return value end
end

local function Current()
    return active and owner.online and owner.session ~= "" and owner.guid ~= ""
        and Read(UnitGUID, "player") == owner.guid
end

local function Cached(section)
    local archive = Table(database.characterArchive)
    local characters = archive and Table(archive.characters)
    local character = characters and characters[owner.guid]
    local record = type(character) == "table" and character[section]
    return type(record) == "table" and Table(record.data) or nil
end

local function Submit(section, data, localOnly)
    local observedAt = Integer(Read(GetServerTime), 1, 4102444800)
    local output = publish
    if localOnly then output = save end
    if output and observedAt and Current() then output(section, data, observedAt) end
end

local function Checkpoint(channel)
    local capture = checkpoints[channel]
    checkpoints[channel] = nil
    if capture and Current() then capture() end
end

local function Cancel(channel)
    local timer = timers[channel]
    if timer then timer:Cancel(); timers[channel] = nil end
end

local function Schedule(channel, delay, callback)
    if not active or timers[channel] then return end
    local timer
    timer = C_Timer.NewTimer(delay, function()
        if timers[channel] ~= timer then return end
        timers[channel] = nil
        if Current() then callback() end
    end)
    timers[channel] = timer
end

local function SortedIDs(values, cap)
    local result = {}
    for id in pairs(values) do result[#result + 1] = id end
    table.sort(result)
    for index = #result, cap + 1, -1 do result[index] = nil end
    return result
end

local function CopyIDs(values, target)
    for _, value in ipairs(Table(values) or {}) do
        local id = ID(value)
        if id then target[id] = true end
    end
end

local function ReadProfessions()
    -- The third result is First Aid on Forever and Archaeology on Retail.
    local ok, first, second, third, fourth, fifth, sixth = Call(GetProfessions)
    if not ok or type(GetProfessionInfo) ~= "function" then return end
    local cached = Cached("professions")
    local previous = {}
    for _, entry in ipairs(cached and Table(cached.entries) or {}) do
        if Table(entry) and ID(entry.id) then previous[entry.id] = entry end
    end
    local entries, byID = {}, {}
    for _, index in pairs({first, second, third, fourth, fifth, sixth}) do
        index = ID(index)
        if not index then return end
        local _, name, _, rank, maxRank, _, _, id = Call(GetProfessionInfo, index)
        name, id = Name(name), ID(id)
        rank, maxRank = Integer(rank, 0, 65535), Integer(maxRank, 0, 65535)
        if not id or not name or not rank or not maxRank or rank > maxRank then return end
        if not byID[id] then
            local entry = {id = id, name = name, rank = rank, maxRank = maxRank}
            local old = previous[id]
            if old and Table(old.recipes) and Integer(old.recipesObservedAt, 1, 4102444800) then
                entry.recipes, entry.recipesObservedAt = old.recipes, old.recipesObservedAt
            end
            entries[#entries + 1], byID[id] = entry, entry
        end
    end
    table.sort(entries, function(firstEntry, secondEntry) return firstEntry.id < secondEntry.id end)
    return entries, byID
end

local function ProfessionID(info)
    return info and (ID(info.parentProfessionID) or ID(info.professionID))
end

local function OwnOpenProfession()
    local api = C_TradeSkillUI
    if not professionOpen or not api or Read(api.IsTradeSkillReady) ~= true
        or Read(api.IsTradeSkillLinked) ~= false or Read(api.IsTradeSkillGuild) ~= false
        or Read(api.IsTradeSkillGuildMember) == true or Read(api.IsNPCCrafting) == true
        or Read(api.IsDataSourceChanging) == true then return end
    local info = Table(Read(api.GetBaseProfessionInfo))
    local id = ProfessionID(info)
    if id then return id end
    return ProfessionID(Table(Read(api.GetChildProfessionInfo)))
end

local function RecipeLimit(entries, selected)
    local remaining = maxEntries
    for _, entry in ipairs(entries) do
        if entry ~= selected and entry.recipes then remaining = remaining - #entry.recipes end
    end
    return remaining
end

local function ReadSpecializations(skillLineID)
    local api = C_ProfSpecs
    local states = Enum and Enum.ProfessionsSpecTabState
    if not api or not states or Read(api.SkillLineHasSpecialization, skillLineID) ~= true then return end
    local configID = ID(Read(api.GetConfigIDForSkillLine, skillLineID))
    local ids = configID and Table(Read(api.GetSpecTabIDsForSkillLine, skillLineID))
    if not ids or #ids == 0 or #ids > 32 then return end
    local tabs = {}
    for index, value in ipairs(ids) do
        local id = ID(value)
        local info = id and Table(Read(api.GetTabInfo, id))
        local name = info and Name(info.name)
        local state = name and Read(api.GetStateForTab, id, configID)
        if not state or (state ~= states.Unlocked and state ~= states.Locked and state ~= states.Unlockable) then return end
        tabs[index] = { id = id, name = name, unlocked = state == states.Unlocked }
    end
    return tabs
end

local function ObserveProfessionDetails(selected, byID)
    local raw = Table(Read(C_TradeSkillUI.GetChildProfessionInfos))
    if not raw or #raw == 0 or #raw > 32 then return end
    local cached = Cached("professionDetails")
    local entries, priorTiers = {}, {}
    for _, entry in ipairs(cached and Table(cached.entries) or {}) do
        if Table(entry) and ID(entry.id) and byID[entry.id] then
            if entry.id == selected.id then
                for _, tier in ipairs(Table(entry.tiers) or {}) do
                    if Table(tier) and ID(tier.id) then priorTiers[tier.id] = tier end
                end
            else
                entries[#entries + 1] = entry
            end
        end
    end
    local tiers = {}
    for _, value in ipairs(raw) do
        local info = Table(value)
        if not info then return end
        local id, rank, maxRank = ID(info.professionID), Integer(info.skillLevel, 0, 65535), Integer(info.maxSkillLevel, 0, 65535)
        if not id or not rank or not maxRank or rank > maxRank then return end
        if rank > 0 and ProfessionID(info) == selected.id then
            local name = Name(info.professionName)
            if not name then return end
            local old = priorTiers[id]
            tiers[#tiers + 1] = { id = id, name = name, expansion = Name(info.expansionName), rank = rank, maxRank = maxRank,
                specializations = ReadSpecializations(id) or (old and old.specializations) }
        end
    end
    local observedAt = Integer(Read(GetServerTime), 1, 4102444800)
    if #tiers == 0 or not observedAt then return end
    entries[#entries + 1] = { id = selected.id, observedAt = observedAt, tiers = tiers }
    Submit("professionDetails", { entries = entries }, true)
end

local function SaveLearnedRecipe(recipeID)
    local id, api = ID(recipeID), C_TradeSkillUI
    if not id or not api then return end
    local ownerID = ProfessionID(Table(Read(api.GetProfessionInfoByRecipeID, id)))
    local entries, byID = ReadProfessions()
    local selected = byID and byID[ownerID]
    local observedAt = Integer(Read(GetServerTime), 1, 4102444800)
    if not selected or not observedAt then return end
    -- NEW_RECIPE_LEARNED is the player's own acquisition event, independently of panel filters.
    local learned = {}
    CopyIDs(selected.recipes, learned)
    if learned[id] then return end
    learned[id] = true
    local ids = SortedIDs(learned, maxEntries + 1)
    if #ids > RecipeLimit(entries, selected) then return end
    selected.recipes, selected.recipesObservedAt = ids, observedAt
    Submit("professions", {entries = entries}, true)
end

local function ObserveProfessions(localOnly, rowLimit)
    local entries, byID = ReadProfessions()
    if not entries then return end
    local professionID = OwnOpenProfession()
    local selected = professionID and byID[professionID]
    if selected then ObserveProfessionDetails(selected, byID) end
    local recipeIDs = selected and Table(Read(C_TradeSkillUI.GetAllRecipeIDs))
    local complete = recipeIDs and #recipeIDs > 0
    if selected and not complete then
        recipeIDs = Table(Read(C_TradeSkillUI.GetFilteredRecipeIDs))
    end
    if not recipeIDs or #recipeIDs == 0 or #recipeIDs > maxRecipeIDs then
        Submit("professions", {entries = entries}, localOnly)
        return
    end
    local identity = owner.guid
    local session = owner.session
    local observedAt = Integer(Read(GetServerTime), 1, 4102444800)
    local offset, learned = 1, {}
    local function Commit(fullyScanned, diskOnly)
        if owner.guid ~= identity or owner.session ~= session then return end
        if not fullyScanned and not next(learned) then
            Submit("professions", {entries = entries}, diskOnly)
            return
        end
        -- Filtered or interrupted reads can confirm recipes without accounting for all rows.
        if not fullyScanned then CopyIDs(selected.recipes, learned) end
        local ids = SortedIDs(learned, maxEntries + 1)
        if observedAt and #ids <= RecipeLimit(entries, selected) then
            local unchanged = selected.recipes and #selected.recipes == #ids
            if unchanged then
                for index, id in ipairs(ids) do
                    if selected.recipes[index] ~= id then unchanged = false; break end
                end
            end
            if not unchanged then selected.recipes, selected.recipesObservedAt = ids, observedAt end
        end
        Submit("professions", {entries = entries}, diskOnly)
    end
    local function Step()
        if owner.guid ~= identity or owner.session ~= session or OwnOpenProfession() ~= professionID then return end
        local last = math.min(offset + (localOnly and (rowLimit or finalRecipeRows) or 100) - 1, #recipeIDs)
        for index = offset, last do
            local id = ID(recipeIDs[index])
            local recipe = id and Table(Read(C_TradeSkillUI.GetRecipeInfo, id))
            local known = recipe and Public(recipe.learned)
            if type(known) ~= "boolean" then complete = false
            elseif known then learned[id] = true end
        end
        offset = last + 1
        if offset <= #recipeIDs and not localOnly then
            checkpoints.professions = function() Commit(false, true) end
            Schedule("professions", 0.03, Step)
            return
        end
        checkpoints.professions = nil
        Commit(complete and offset > #recipeIDs, localOnly)
    end
    Step()
end

local function ObserveAchievements()
    local categoryIDs = Table(Read(GetCategoryList))
    if not categoryIDs or #categoryIDs == 0 or #categoryIDs > 1024
        or type(GetCategoryNumAchievements) ~= "function" or type(GetAchievementInfo) ~= "function" then return end
    local categories, total = {}, 0
    local complete = true
    for _, value in ipairs(categoryIDs) do
        local category = ID(value)
        local count = category and Integer(Read(GetCategoryNumAchievements, category), 0, maxAchievementRows)
        if count and total + count <= maxAchievementRows then
            total = total + count
            if count > 0 then categories[#categories + 1] = {id = category, count = count} end
        else
            complete = false
        end
    end
    -- A zero-sized list can be an unloaded achievement cache.
    if total == 0 then return end
    local identity, session = owner.guid, owner.session
    local offset, row, earned, observed = 1, 1, {}, 0
    local function Commit(fullyScanned, localOnly)
        if owner.guid ~= identity or owner.session ~= session or observed == 0 then return end
        local ids = SortedIDs(earned, maxEntries + 1)
        local isComplete = fullyScanned and complete and #ids <= maxEntries
        local previous = Cached("achievements")
        if #ids == 0 and previous and Table(previous.earnedIds) and #previous.earnedIds > 0 then return end
        if not isComplete then
            if previous and Table(previous.earnedIds) then
                local old = {}
                CopyIDs(previous.earnedIds, old)
                local hasNew
                for _, id in ipairs(ids) do if not old[id] then hasNew = true; break end end
                if not hasNew then return end
                CopyIDs(previous.earnedIds, earned)
            end
            ids = SortedIDs(earned, maxEntries)
        end
        Submit("achievements", {earnedIds = ids, complete = isComplete}, localOnly)
    end
    local function Step()
        if owner.guid ~= identity or owner.session ~= session then return end
        for _ = 1, 250 do
            local category = categories[offset]
            if not category then break end
            local _, id, _, _, completed, _, _, _, _, _, _, _, guild, earnedByPlayer =
                Call(GetAchievementInfo, category.id, row)
            id = ID(id)
            if id and type(completed) == "boolean" then
                observed = observed + 1
                -- Account-wide completion is not provenance for the logged-in character.
                if guild ~= true and earnedByPlayer == true then earned[id] = true
                elseif guild ~= true and completed and type(earnedByPlayer) ~= "boolean" then complete = false end
            else
                complete = false
            end
            row = row + 1
            if row > category.count then offset, row = offset + 1, 1 end
        end
        if offset <= #categories then
            checkpoints.achievements = function() Commit(false, true) end
            Schedule("achievements", 0.03, Step)
            return
        end
        checkpoints.achievements = nil
        Commit(true)
    end
    Step()
end

local function ObserveExploration(localOnly)
    local map, exploration = C_Map, C_MapExplorationInfo
    if not map or not exploration then return end
    local mapID = ID(Read(map.GetBestMapForUnit, "player"))
    local info = mapID and Table(Read(map.GetMapInfo, mapID))
    local name = info and Name(info.name, 96)
    if not name then return end
    local mapType = Public(info.mapType)
    if mapType and Enum and Enum.UIMapType and (mapType == Enum.UIMapType.Dungeon or mapType == Enum.UIMapType.Micro) then return end
    local position = Read(map.GetPlayerMapPosition, mapID, "player")
    local areas = position and Table(Read(exploration.GetExploredAreaIDsAtPosition, mapID, position))
    local overlays = Table(Read(exploration.GetExploredMapTextures, mapID))
    local overlayCount = overlays and Integer(#overlays, 0, 65535)
    if not areas and not overlayCount then return end
    local previous = Cached("exploration")
    local maps, matched, ids, remaining = {}, false, {}, totalAreaIDs
    for _, entry in ipairs(previous and Table(previous.maps) or {}) do
        if Table(entry) and ID(entry.mapId) and Name(entry.name) and Table(entry.areaIds) then
            if entry.mapId == mapID then
                matched = true
                CopyIDs(entry.areaIds, ids)
                if overlayCount == nil then overlayCount = Integer(entry.overlayCount, 0, 65535) end
            else
                maps[#maps + 1] = entry
                remaining = remaining - #entry.areaIds
            end
        end
    end
    if (not matched and #maps >= maxMaps) or remaining < 0 then return end
    CopyIDs(areas, ids)
    maps[#maps + 1] = {mapId = mapID, name = name,
        areaIds = SortedIDs(ids, math.min(remaining, maxAreaIDs)), overlayCount = overlayCount}
    table.sort(maps, function(firstMap, secondMap) return firstMap.mapId < secondMap.mapId end)
    Submit("exploration", {maps = maps}, localOnly)
end

function Archive.Initialize(state, db, submit, saveLocal)
    owner, database, publish, save = state, db, submit, saveLocal
end

function Archive.Enter()
    active, professionOpen = true, false
    Schedule("professions", 0.75, ObserveProfessions)
    Schedule("achievements", 1.5, ObserveAchievements)
    Schedule("exploration", 0.75, ObserveExploration)
end

function Archive.Flush()
    if not Current() then return end
    Checkpoint("professions")
    Checkpoint("achievements")
    ObserveProfessions(true)
    ObserveExploration(true)
end

local function SaveAchievement(id)
    id = ID(id)
    if not id then return end
    local _, observedID, _, _, completed, _, _, _, _, _, _, _, guild, earnedByPlayer = Call(GetAchievementInfo, id)
    if ID(observedID) ~= id or completed ~= true or guild == true or earnedByPlayer ~= true then return end
    local previous = Cached("achievements")
    local earned = {}
    CopyIDs(previous and previous.earnedIds, earned)
    if earned[id] then return end
    earned[id] = true
    local ids = SortedIDs(earned, maxEntries + 1)
    if #ids <= maxEntries then Submit("achievements", {earnedIds = ids, complete = false}, true) end
end

function Archive.OnEvent(event, arg1)
    if event == "PLAYER_LEAVING_WORLD" or event == "PLAYER_LOGOUT" then
        active, professionOpen = false, false
        for channel in pairs(timers) do Cancel(channel) end
        checkpoints = {}
        return
    end
    if not active then return end
    if event == "TRADE_SKILL_SHOW" then
        professionOpen = true
        if OwnOpenProfession() then ObserveProfessions(true, 100) end
    elseif event == "TRADE_SKILL_CLOSE" or event == "TRADE_SKILL_DATA_SOURCE_CHANGING" then
        Cancel("professions")
        Checkpoint("professions")
        if event == "TRADE_SKILL_CLOSE" then
            if OwnOpenProfession() then ObserveProfessions(true) end
            professionOpen = false
        end
        return
    end
    if event == "ACHIEVEMENT_EARNED" or event == "RECEIVED_ACHIEVEMENT_LIST" then
        Cancel("achievements")
        Checkpoint("achievements")
        if event == "ACHIEVEMENT_EARNED" then SaveAchievement(arg1) end
        Schedule("achievements", 0.5, ObserveAchievements)
    elseif event == "MAP_EXPLORATION_UPDATED" or event == "ZONE_CHANGED_NEW_AREA"
        or event == "ZONE_CHANGED" or event == "ZONE_CHANGED_INDOORS" then
        Schedule("exploration", 0.5, ObserveExploration)
    elseif characterEvents[event] then
        if event == "TRADE_SKILL_DATA_SOURCE_CHANGED" or event == "NEW_RECIPE_LEARNED" then
            Cancel("professions")
            Checkpoint("professions")
            if event == "NEW_RECIPE_LEARNED" and Current() then SaveLearnedRecipe(arg1) end
        end
        Schedule("professions", 0.35, ObserveProfessions)
    end
end
