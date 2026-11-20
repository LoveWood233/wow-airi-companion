local _, ns = ...
local CharacterSkillLines = {}
ns.CharacterSkillLines = CharacterSkillLines

local Public = ns.Protocol.Public
local maxSkillLines = 2048
local maxLanguages = 64
local maxID = 2147483647

local function Read(api, ...)
    if type(api) ~= "function" then return end
    local ok, first, second = pcall(api, ...)
    if ok then return Public(first), Public(second) end
end

local function Table(value)
    value = Public(value)
    if type(value) == "table" and (not canaccesstable or Read(canaccesstable, value) == true) then return value end
end

local function Integer(value, minimum, maximum)
    value = Public(value)
    if type(value) == "number" and value >= minimum and value <= maximum and value == math.floor(value) then return value end
end

local function Name(value)
    value = Public(value)
    if type(value) ~= "string" or value:find("[%z\1-\31\127|]") then return end
    local label = ns.Protocol.UTF8Prefix(value, 128)
    if label:find("%S") then return label end
end

local function SkillEntry(row)
    local rank, cap = Integer(row.rank, 0, 65535), Integer(row.maxRank, 0, 65535)
    if rank == 0 and cap == 0 then return nil, true end -- Static data with no player ranks.
    local id, name = Integer(row.skillID, 1, maxID), Name(row.name)
    if not id or not name or not rank or not cap or rank > cap then return end
    return {
        skillLineID = id, name = name, rank = rank, maxRank = cap,
        modifier = Integer(row.modifier, -65535, 65535), temporary = Integer(row.tempPoints, -65535, 65535),
        parentSkillLineID = Integer(row.parentSkillLineID, 1, maxID), categoryID = Integer(row.skillLineCategoryID, 0, maxID),
    }, true
end

local function CaptureSkillLines(previous)
    local api = Table(C_SkillInfo)
    if not api or type(api.GetSkillLineInfo) ~= "function" then return end
    local count = Integer(Read(api.GetNumSkillLines), 1, maxID)
    if not count then return end
    local complete, entries, seen = count <= maxSkillLines, {}, {}
    for index = 1, math.min(count, maxSkillLines) do
        local row = Table(Read(api.GetSkillLineInfo, index))
        local header = row and Public(row.isHeader)
        if header == true then
            if Public(row.isCollapsed) ~= false then complete = false end
        elseif header == false then
            local entry, readable = SkillEntry(row)
            if not readable then complete = false end
            if entry and not seen[entry.skillLineID] then
                entries[#entries + 1], seen[entry.skillLineID] = entry, true
            end
        else
            complete = false
        end
    end

    -- Known IDs can be refreshed even if their categories are now collapsed.
    local oldEntries = Table(previous and previous.entries)
    if not complete and oldEntries then
        for _, old in ipairs(oldEntries) do
            if #entries >= maxSkillLines then break end
            old = Table(old)
            local id = old and Integer(old.skillLineID, 1, maxID)
            if id and not seen[id] then
                local row = Table(Read(api.GetSkillLineInfoByID, id))
                local entry = row and Public(row.isHeader) == false and SkillEntry(row)
                if entry and entry.skillLineID == id then entries[#entries + 1], seen[id] = entry, true end
            end
        end
    end

    if #entries == 0 then return end
    table.sort(entries, function(left, right) return left.skillLineID < right.skillLineID end)
    return { complete = complete, entries = entries }
end

local function CaptureLanguages()
    local count = Integer(Read(GetNumLanguages), 1, maxID)
    if not count then return end
    local complete, entries, seen = count <= maxLanguages, {}, {}
    for index = 1, math.min(count, maxLanguages) do
        local rawName, rawID = Read(GetLanguageByIndex, index)
        local id, name = Integer(rawID, 0, maxID), Name(rawName)
        if not id or not name then complete = false
        elseif not seen[id] then entries[#entries + 1], seen[id] = { id = id, name = name }, true end
    end
    if #entries == 0 then return end
    table.sort(entries, function(left, right) return left.id < right.id end)
    return { complete = complete, entries = entries }
end

function CharacterSkillLines.Capture(previous)
    local result = CaptureSkillLines(Table(previous))
    local languages = CaptureLanguages()
    if languages then
        result = result or {}
        result.languages = languages
    end
    return result
end
