local _, ns = ...
local History = {}
ns.OfflineHistory = History
local db, saved, lastTick, lastGUID, cached, encodedAt = nil, nil, nil, nil, nil, -100
local Public = ns.Protocol.Public
local arrayFields = {
    money = true, levels = true, stats = true, tooltip = true, slots = true, entries = true,
    nodes = true, knownZeroNodes = true, subtreeIDs = true, treeIDs = true, objectives = true,
    ids = true, turnIns = true, items = true, recipes = true, earnedIds = true, areaIds = true,
}
local offlineFields = {
    quests = true, inventory = true, weaponSkills = true, attributes = true, profile = true,
    spellbook = true, skillLines = true, languages = true,
}
local coverageFields = { spellbook = true, skillLines = true, languages = true }

local function AddCopper(left, right)
    local result, carry, i, j = "", 0, #left, #right
    while i > 0 or j > 0 or carry > 0 do
        local total = (i > 0 and tonumber(string.sub(left, i, i)) or 0)
            + (j > 0 and tonumber(string.sub(right, j, j)) or 0) + carry
        result, carry, i, j = tostring(total % 10) .. result, math.floor(total / 10), i - 1, j - 1
    end
    return result
end

local function Copy(value)
    value = Public(value)
    if type(value) ~= "table" then return value end
    if canaccesstable and not canaccesstable(value) then return nil end
    local result = {}
    for key, child in pairs(value) do result[key] = Copy(child) end
    return result
end

local function JSON(value, field)
    local kind = type(value)
    if kind == "string" then
        return '"' .. string.gsub(value, '[%z\1-\31\\"]', function(c)
            if c == '"' then return '\\"' end
            if c == '\\' then return '\\\\' end
            return string.format("\\u%04x", string.byte(c))
        end) .. '"'
    end
    if kind == "number" then return value == value and value ~= math.huge and value ~= -math.huge and string.format(value == math.floor(value) and "%.0f" or "%.14g", value) or "null" end
    if kind == "boolean" then return value and "true" or "false" end
    if kind ~= "table" then return "null" end
    if field == "snapshot" then return ns.Protocol.JSON(value) end
    if field == "equipment" then return ns.Transfer.GearJSON(value) end
    local entries = {}
    if #value > 0 or arrayFields[field] then
        for _, child in ipairs(value) do entries[#entries+1] = JSON(child) end
        return "[" .. table.concat(entries, ",") .. "]"
    end
    for key, child in pairs(value) do entries[#entries+1] = JSON(tostring(key)) .. ":" .. JSON(child, key) end
    table.sort(entries)
    return "{" .. table.concat(entries, ",") .. "}"
end

-- Keep bulky observations out of the periodic encoder. These are already maintained in
-- SavedVariables tables. Project them into the offline JSON when the client writes it.
local function Document(final)
    local result = {}
    for key, value in pairs(saved) do result[key] = value end
    result.characters = {}
    for guid, character in pairs(saved.characters) do
        local entry = {}
        for key, value in pairs(character) do
            if final or not offlineFields[key] then entry[key] = value end
        end
        if final then
            entry.characterArchive = db.characterArchive and db.characterArchive.characters[guid]
            entry.itemStorage = db.itemStorage and db.itemStorage.characters[guid]
        end
        result.characters[guid] = entry
    end
    return result
end

local function Character(guid)
    if type(guid) ~= "string" or guid == "" then return nil end
    if type(saved.characters[guid]) ~= "table" then
        saved.characters[guid] = { money = {}, levels = {}, levelSeconds = 0, levelComplete = false }
    end
    return saved.characters[guid]
end

function History.Initialize(database, game)
    db = database
    if type(db.offlineHistory) ~= "table" then
        db.offlineHistory = { version = 1, game = game, account = db.money.account, characters = {} }
    end
    saved = db.offlineHistory
    lastTick, lastGUID, cached, encodedAt = nil, nil, nil, -100
end

function History.Money(guid, delta, balance, epoch)
    if not saved then return end
    local character = Character(guid)
    if not character then return end
    local sequence = (character.moneySequence or 0) + 1
    character.moneySequence = sequence
    character.money[#character.money+1] = { id = sequence, observedAt = GetServerTime(), deltaCopper = delta,
        balanceCopper = balance, epoch = epoch, source = "addon-money-observation" }
end

function History.Equipment(record)
    if not saved or type(record) ~= "table" then return end
    local character = Character(record.guid)
    if not character then return end
    local old = character.equipment
    local known = false
    for _, slot in ipairs(record.slots) do
        if slot.state ~= "unknown" then known = true; break end
    end
    if not known and old then return end
    record = Copy(record)
    if old and old.slots then
        for index, slot in ipairs(record.slots) do
            local item = slot.item
            local previous = old.slots[index] and old.slots[index].item
            if item and previous and item.link == previous.link
                and (not item.itemGUID or not previous.itemGUID or item.itemGUID == previous.itemGUID) then
                if not item.infoComplete and previous.infoComplete then
                    for _, key in ipairs({ "name", "itemLevel", "type", "subtype", "equipLoc", "quality", "requiredLevel" }) do
                        if item[key] == nil then item[key] = previous[key] end
                    end
                    item.infoComplete = true
                end
                if not item.statsComplete and previous.statsComplete then
                    item.stats, item.statsComplete = previous.stats, true
                end
                if not item.tooltipComplete and previous.tooltipComplete then
                    item.tooltip, item.tooltipComplete = previous.tooltip, true
                end
            end
        end
    end
    character.equipment = record
end

function History.Save(guid, field, record)
    if not saved or type(record) ~= "table" then return end
    local character = Character(guid)
    if not character then return end
    local previous = character[field]
    if previous then
        if (field == "inventory" and not record.complete and previous.complete)
            or (field == "weaponSkills" and record.status ~= "available" and previous.status == "available") then return end
        if field == "quests" then
            if not record.log.complete and #record.log.entries == 0 then record.log = previous.log end
            if record.completion.source == "unknown" then record.completion = previous.completion end
        end
        if coverageFields[field] and record.data.complete ~= true then
            local lastComplete = previous.data.complete == true and previous or previous.lastComplete
            if lastComplete and lastComplete.data.specID == record.data.specID then record.lastComplete = lastComplete end
        end
    end
    character[field] = Copy(record)
end

function History.Read(guid, field)
    local character = saved and saved.characters[guid]
    local record = character and character[field]
    return record and record.data
end

function History.Observe(snapshot, payload, force, final)
    if not saved then return end
    local now, guid = GetTime(), snapshot.guid
    local character = snapshot.online and Character(guid) or saved.characters[guid]
    if character and (snapshot.online or (character.snapshot and character.snapshot.online)) then
        if snapshot.online and lastGUID == guid and lastTick and now >= lastTick then
            local elapsed = now - lastTick
            if elapsed <= 5 then character.levelSeconds = character.levelSeconds + elapsed
            else character.levelComplete = false end
        end
        local previous = character.snapshot
        if snapshot.level > 0 and (not previous or snapshot.level ~= previous.level) then
            local continuous = previous and snapshot.online and lastGUID == guid and snapshot.level == previous.level + 1
            character.levels[#character.levels+1] = { id = #character.levels + 1, level = snapshot.level,
                fromLevel = previous and previous.level or nil, observedAt = GetServerTime(),
                durationSeconds = continuous and math.floor(character.levelSeconds) or nil,
                durationBasis = continuous and (character.levelComplete and "complete" or "partial") or "unknown" }
            character.levelSeconds, character.levelComplete = 0, continuous and true or false
        end
        if previous and not snapshot.online then
            -- Some APIs stop returning character data before the logout event.
            character.snapshot = Copy(previous)
            character.snapshot.online = false
        else
            character.snapshot = Copy(snapshot)
            if character.snapshot.copper == nil and previous then character.snapshot.copper = previous.copper end
        end
        character.lastSeen = GetServerTime()
    end
    lastGUID, lastTick = snapshot.online and guid or nil, snapshot.online and now or nil
    saved.updatedAt = GetServerTime()
    -- Only the saved JSON includes history. The screen frame retains its bounded v3 snapshot.
    if final or force or not cached or now - encodedAt >= 10 then
        local balance = "0"
        for _, entry in pairs(saved.characters) do
            if entry.snapshot and type(entry.snapshot.copper) == "number" then
                balance = AddCopper(balance, string.format("%.0f", entry.snapshot.copper))
            end
        end
        saved.balanceCopper = balance
        cached, encodedAt = JSON(Document(final)), now
    end
    db.snapshotJSON = string.sub(payload, 1, -2) .. ',"offlineHistory":' .. cached .. '}'
end
