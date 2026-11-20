local _, ns = ...
local LowFrequency = { interval = 360 }
ns.LowFrequency = LowFrequency

local Public = ns.Protocol.Public
local owner, database, archives, signatures, due, raidPending, lockoutsReady
local immediately = { "professions", "achievements", "exploration" }

local function Read(fn, ...)
    if type(fn) ~= "function" then return end
    local results = { pcall(fn, ...) }
    if not results[1] then return end
    for index = 2, 16 do results[index] = Public(results[index]) end
    return unpack(results, 2, 16)
end

local function Integer(value, minimum, maximum)
    value = Public(value)
    if type(value) == "number" and value >= minimum and value <= maximum and value == math.floor(value) then return value end
end

local function Name(value)
    value = Public(value)
    if type(value) == "string" and not value:find("[%z\1-\31\127]") then
        local label = ns.Protocol.UTF8Prefix(value, 128)
        if label:find("%S") then return label end
    end
end

local function Current()
    return owner and owner.online and owner.guid ~= "" and Read(UnitGUID, "player") == owner.guid
end

local function Character()
    local guid = owner.guid
    local record = archives.characters[guid]
    if type(record) ~= "table" then
        record = {}
        archives.characters[guid] = record
    end
    return record
end

local function Save(section, data, observedAt)
    local saved = Character()
    local previous = saved[section]
    if previous and previous.observedAt and previous.observedAt > observedAt then return false end
    local old = previous and previous.data
    if old then
        if section == "progress" then
            -- XP belongs to a level and earned/spent totals belong to a ledger epoch.
            local merged = { level = data.level or old.level, copper = data.copper or old.copper,
                moneyEpoch = data.moneyEpoch or old.moneyEpoch, earned = data.earned, spent = data.spent,
                xp = data.xp, xpMax = data.xpMax, levelSeconds = data.levelSeconds, restedXP = data.restedXP }
            if merged.level == old.level then
                merged.xp, merged.xpMax = merged.xp or old.xp, merged.xpMax or old.xpMax
                merged.levelSeconds = merged.levelSeconds or old.levelSeconds
                merged.restedXP = merged.restedXP or old.restedXP
            end
            if merged.moneyEpoch == old.moneyEpoch then
                merged.earned, merged.spent = merged.earned or old.earned, merged.spent or old.spent
            end
            data = merged
        elseif section ~= "achievements" and old.complete == true and data.complete == false then
            return false
        end
    end
    saved[section] = { data = data, observedAt = observedAt }
    return true
end

local function ObservationTime(data, observedAt)
    if Current() and type(data) == "table" and next(data) ~= nil then
        return Integer(observedAt or Read(GetServerTime), 1, 4102444800)
    end
end

function LowFrequency.SaveLocal(section, data, observedAt)
    observedAt = ObservationTime(data, observedAt)
    return observedAt ~= nil and Save(section, data, observedAt)
end

function LowFrequency.Submit(section, data, observedAt)
    observedAt = ObservationTime(data, observedAt)
    if not observedAt then return false end
    Save(section, data, observedAt)
    local signature = ns.Transfer.ArchiveDataJSON(data)
    if signatures[section] == signature then return true end
    if not ns.Transfer.SetArchive(owner, section, observedAt, signature) then return false end
    signatures[section] = signature
    return true
end

local function Progress(includeRested)
    local xp = Integer(Read(UnitXP, "player"), 0, 2147483647)
    local xpMax = Integer(Read(UnitXPMax, "player"), 0, 2147483647)
    if not xpMax or not xp or xp > xpMax then xp, xpMax = nil, nil end
    local function Copper(value)
        local amount = Integer(value, 0, 9007199254740991)
        return amount and string.format("%.0f", amount)
    end
    local history = database.offlineHistory
    local character = history and history.characters and history.characters[owner.guid]
    local seconds = character and character.levelComplete and math.floor(character.levelSeconds or 0)
    local epoch = Public(owner.moneyEpoch)
    return { level = Integer(owner.level, 1, 255), xp = xp, xpMax = xpMax,
        copper = Copper(owner.copper), earned = Copper(owner.earned), spent = Copper(owner.spent),
        moneyEpoch = type(epoch) == "string" and epoch ~= "" and epoch or nil,
        restedXP = includeRested and Integer(Read(GetXPExhaustion), 0, 2147483647) or nil,
        levelSeconds = Integer(seconds, 0, 2147483647) }
end

local function Reputation()
    local api = C_Reputation
    local count = Integer(Read(api and api.GetNumFactions or GetNumFactions), 0, 10000)
    if not count or count == 0 then return end
    local result, seen = { complete = count <= 512, entries = {} }, {}
    for index = 1, math.min(count, 512) do
        local id, name, rank, value, minimum, maximum, header, withRep, collapsed
        if api and api.GetFactionDataByIndex then
            local data = Read(api.GetFactionDataByIndex, index)
            if type(data) == "table" and (not canaccesstable or canaccesstable(data)) then
                id, name, rank = data.factionID, data.name, data.reaction
                value, minimum, maximum = data.currentStanding, data.currentReactionThreshold, data.nextReactionThreshold
                header, withRep, collapsed = Public(data.isHeader), Public(data.isHeaderWithRep), Public(data.isCollapsed)
            end
        else
            local unused
            name, unused, rank, minimum, maximum, value, unused, unused, header, collapsed, withRep, unused, id = Read(GetFactionInfo, index)
        end
        if header == true and collapsed == true then result.complete = false end
        if header == false or withRep == true then
            id, name = Integer(id, 1, 2147483647), Name(name)
            if id and name and not seen[id] then
                local entry = { id = id, name = name, rank = Integer(rank, 1, 255),
                    value = Integer(value, -2147483648, 2147483647), min = Integer(minimum, -2147483648, 2147483647),
                    max = Integer(maximum, -2147483648, 2147483647) }
                result.entries[#result.entries + 1] = entry
                seen[id] = true
            else result.complete = false end
        elseif header == nil then result.complete = false end
    end
    table.sort(result.entries, function(a, b) return a.id < b.id end)
    return result
end

local function Lockouts()
    local now = Integer(Read(GetServerTime), 1, 4102444800)
    local count = Integer(Read(GetNumSavedInstances), 0, 10000)
    if not now or not count or (count == 0 and type(RequestRaidInfo) == "function"
        and (raidPending or not lockoutsReady)) then return end
    local result, known, seen = { complete = count <= 128, entries = {} }, {}, {}
    local previous = Character().lockouts
    for _, row in ipairs(previous and previous.data and previous.data.entries or {}) do
        known[row.id .. ":" .. (row.difficulty or 0)] = row.resetAt
    end
    for index = 1, math.min(count, 128) do
        local name, lockoutID, remaining, difficulty, locked, extended, _, _, _, _, _, _, _, instanceID = Read(GetSavedInstanceInfo, index)
        local id = Integer(instanceID, 1, 2147483647) or Integer(lockoutID, 1, 2147483647)
        name, remaining = Name(name), Integer(remaining, 0, 31536000)
        difficulty = Integer(difficulty, 0, 65535)
        if id and name and remaining and type(locked) == "boolean" and type(extended) == "boolean" then
            local key = id .. ":" .. (difficulty or 0)
            if not seen[key] then
                local reset = now + remaining
                local old = known[key]
                if old and math.abs(reset - old) <= 3 then reset = old end
                result.entries[#result.entries + 1] = { id = id, name = name, difficulty = difficulty,
                    resetAt = reset, locked = locked, extended = extended }
                seen[key] = true
            else result.complete = false end
        else result.complete = false end
    end
    table.sort(result.entries, function(a, b)
        return a.id < b.id or (a.id == b.id and (a.difficulty or 0) < (b.difficulty or 0))
    end)
    return result, now
end

function LowFrequency.Initialize(state, db)
    owner, database = state, db
    local data = db.characterArchive
    if type(data) ~= "table" or data.version ~= 1 or data.account ~= (db.money and db.money.account)
        or type(data.characters) ~= "table" then
        data = { version = 1, account = db.money and db.money.account, characters = {} }
        db.characterArchive = data
    end
    archives, signatures = data, {}
    due, raidPending, lockoutsReady = nil, nil, false
    state.lowFrequency = true
end

function LowFrequency.SaveTalents(record)
    if record and Current() then
        local character = Character()
        local previous = character.talents
        if record.complete then
            character.talents, character.talentsLatest = record, nil
        elseif record.status == "active" and (#record.nodes > 0 or #record.knownZeroNodes > 0) then
            if previous and previous.complete then character.talentsLatest = record
            else character.talents = record end
        elseif not previous then character.talents = record end
    end
end

function LowFrequency.OnEvent(event)
    if event == "UPDATE_INSTANCE_INFO" and Current() then
        lockoutsReady = true
        local requestedAt = raidPending
        raidPending = nil
        if requestedAt and (Read(GetTime) or math.huge) - requestedAt <= 30 then
            LowFrequency.Submit("lockouts", Lockouts())
        end
    end
end

function LowFrequency.Flush()
    if not Current() then return end
    local now = Integer(Read(GetServerTime), 1, 4102444800)
    if not now then return end
    LowFrequency.SaveLocal("progress", Progress(true), now)
    LowFrequency.SaveLocal("reputation", Reputation(), now)
    LowFrequency.SaveLocal("lockouts", Lockouts())
    local schedule = ns.Calendar and ns.Calendar.Capture and ns.Calendar.Capture()
    if schedule then LowFrequency.SaveLocal("schedule", schedule, now) end
end

function LowFrequency.Tick()
    if not Current() then return end
    local now = Read(GetTime)
    if type(now) ~= "number" then return end
    if not due then
        due = now
        local saved = Character()
        for _, section in ipairs(immediately) do
            local record = saved[section]
            if record and record.data then LowFrequency.Submit(section, record.data, record.observedAt) end
        end
    end
    if ns.Calendar then ns.Calendar.Check(now) end
    if now < due then return end
    due = now + LowFrequency.interval
    if owner.level > 0 then LowFrequency.Submit("progress", Progress()) end
    local reputation = Reputation()
    if reputation then LowFrequency.Submit("reputation", reputation) end
    if type(RequestRaidInfo) == "function" then
        raidPending = now
        if not pcall(RequestRaidInfo) then raidPending = nil end
    elseif type(GetNumSavedInstances) == "function" then
        LowFrequency.Submit("lockouts", Lockouts())
    end
end
