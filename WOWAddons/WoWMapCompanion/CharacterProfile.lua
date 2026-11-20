local _, ns = ...
local CharacterProfile = {}
ns.CharacterProfile = CharacterProfile

local Public = ns.Protocol.Public
local player = "player"
local maxCurrencyRows = 2048
local maxTrackedCurrencies = 32
local maxNumber = 9007199254740991

local function Read(api, ...)
    if type(api) ~= "function" then return end
    local ok, first, second, third, fourth, fifth = pcall(api, ...)
    if ok then return Public(first), Public(second), Public(third), Public(fourth), Public(fifth) end
end

local function Table(value)
    value = Public(value)
    if type(value) == "table" and (not canaccesstable or canaccesstable(value)) then return value end
end

local function Number(value, minimum, maximum)
    value = Public(value)
    if type(value) == "number" and value >= minimum and value <= maximum then return value end
end

local function Integer(value, minimum, maximum)
    value = Number(value, minimum, maximum)
    if value and value == math.floor(value) then return value end
end

local function Boolean(value)
    value = Public(value)
    if type(value) == "boolean" then return value end
end

local function Name(value)
    value = Public(value)
    if type(value) ~= "string" or value:find("[%z\1-\31\127]") then return end
    local label = ns.Protocol.UTF8Prefix(value, 160)
    if label:find("%S") then return label end
end

local function CurrencyEntry(info, id)
    info = Table(info)
    if not info then return end
    local name = Name(info.name)
    local quantity = Integer(info.quantity, 0, maxNumber)
    if not name or not quantity then return end
    return {
        id = id, name = name, quantity = quantity,
        maxQuantity = Integer(info.maxQuantity, 0, maxNumber),
        maxWeeklyQuantity = Integer(info.maxWeeklyQuantity, 0, maxNumber),
        quantityEarnedThisWeek = Integer(info.quantityEarnedThisWeek, 0, maxNumber),
        totalEarned = Integer(info.totalEarned, 0, maxNumber),
        isAccountWide = Boolean(info.isAccountWide),
        isAccountTransferable = Boolean(info.isAccountTransferable),
    }
end

local function CaptureCurrencies(previous)
    local api = C_CurrencyInfo
    if not api then return end
    local count = Integer(Read(api.GetCurrencyListSize), 0, maxNumber)
    local complete = count ~= nil and count <= maxCurrencyRows
    local entries, seen = {}, {}
    for index = 1, math.min(count or 0, maxCurrencyRows) do
        local row = Table(Read(api.GetCurrencyListInfo, index))
        local header = row and Boolean(row.isHeader)
        if header == true then
            if Boolean(row.isHeaderExpanded) ~= true then complete = false end
        elseif header == false then
            local id = Integer(row.currencyID, 1, 2147483647)
            if not id then
                local link = Read(api.GetCurrencyListLink, index)
                if type(link) == "string" then id = Integer(Read(api.GetCurrencyIDFromLink, link), 1, 2147483647) end
            end
            local entry = id and CurrencyEntry(row, id)
            if not entry then complete = false
            elseif not seen[id] and (Boolean(row.discovered) ~= false or entry.quantity > 0) then
                entries[#entries + 1], seen[id] = entry, true
            end
        else
            complete = false
        end
    end

    -- A collapsed category hides rows from the list. Refresh previously seen
    -- currencies directly without changing the user's category or filter settings.
    for index = 1, maxTrackedCurrencies do
        if #entries >= maxCurrencyRows then break end
        local tracked = Table(Read(api.GetBackpackCurrencyInfo, index))
        if not tracked then break end
        local id = Integer(tracked.currencyTypesID, 1, 2147483647)
        if id and not seen[id] then
            local entry = CurrencyEntry(Read(api.GetCurrencyInfo, id), id) or CurrencyEntry(tracked, id)
            if entry then entries[#entries + 1], seen[id] = entry, true end
        end
    end
    local oldEntries = Table(previous and previous.entries)
    if oldEntries then
        for _, old in ipairs(oldEntries) do
            old = Table(old)
            local id = old and Integer(old.id, 1, 2147483647)
            if id and not seen[id] and #entries < maxCurrencyRows then
                local entry = CurrencyEntry(Read(api.GetCurrencyInfo, id), id)
                if entry then entries[#entries + 1], seen[id] = entry, true
                else complete = false end
            end
        end
    end

    if count == nil and #entries == 0 then return end
    table.sort(entries, function(left, right) return left.id < right.id end)
    return { complete = complete, entries = entries }
end

function CharacterProfile.Capture(previous)
    previous = Table(previous)
    local guild, guildRank, guildRankIndex = Read(GetGuildInfo, player)
    local average, equipped, pvp = Read(GetAverageItemLevel)
    local titleID = Integer(Read(GetCurrentTitle), 1, 2147483647)
    local spec = C_SpecializationInfo
    local specIndex = Integer(Read(spec and spec.GetSpecialization or GetSpecialization), 1, 100)
    local specName, specRole
    if specIndex then
        local _, name, _, _, role = Read(spec and spec.GetSpecializationInfo or GetSpecializationInfo, specIndex)
        specName = Name(name)
        if role == "TANK" or role == "HEALER" or role == "DAMAGER" or role == "NONE" then specRole = role end
    end

    local profile = {
        guild = Name(guild), guildRank = Name(guildRank), guildRankIndex = Integer(guildRankIndex, 0, 100),
        inGuild = Boolean(Read(IsInGuild)), bindLocation = Name(Read(GetBindLocation)),
        equippedItemLevel = Number(equipped, 1, maxNumber), averageItemLevel = Number(average, 1, maxNumber),
        pvpItemLevel = Number(pvp, 1, maxNumber), titleID = titleID, title = titleID and Name(Read(GetTitleName, titleID)),
        specializationName = specName, specializationRole = specRole,
        currencies = CaptureCurrencies(Table(previous and previous.currencies)),
    }
    if next(profile) then return profile end
end
