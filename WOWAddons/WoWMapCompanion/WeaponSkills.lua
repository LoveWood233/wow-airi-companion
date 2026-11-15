-- Observe public player skill ranks. This module never changes the skill panel or trains skills.
local _, ns = ...
local WeaponSkills = {}
ns.WeaponSkills = WeaponSkills
local Public, Prefix = ns.Protocol.Public, ns.Protocol.UTF8Prefix
local owner, database, publish, pending, timer, active, dirty
local revision, lastCapture, lastSignature, lastIdentity, eventSerial = 0, nil, nil, nil, 0
local supported = false

-- Blizzard_UIPanels_Game/Camelot/SkillsFrame.lua WEAPON_SKILL_LINES, exported from the Forever client.
-- 162 covers fists/unarmed, and 3014 is Feral Combat. Do not substitute classic-era spell IDs.
-- https://github.com/reckhou/WoWBlzCode/blob/main/Forever/BlizzardInterfaceCode/Interface/AddOns/Blizzard_UIPanels_Game/Camelot/SkillsFrame.lua
local skillLines = { 43, 44, 45, 46, 54, 55, 136, 160, 162, 172, 173, 176, 226, 228, 229, 3014 }

local function Call(fn, ...)
    if type(fn) ~= "function" then return nil, false end
    local ok, value = pcall(fn, ...)
    if not ok or (issecretvalue and issecretvalue(value)) then return nil, false end
    return Public(value), true
end
local function Table(value)
    value = Public(value)
    if type(value) ~= "table" then return nil end
    if canaccesstable then
        local ok, allowed = pcall(canaccesstable, value)
        if not ok or Public(allowed) ~= true then return nil end
    end
    return value
end
local function Integer(value, low, high)
    value = Public(value)
    return type(value) == "number" and value == value and value >= low and value <= high
        and value == math.floor(value) and value or nil
end
local function Name(value)
    value = Public(value)
    if type(value) ~= "string" then return nil end
    value = string.gsub(value, "|c%x%x%x%x%x%x%x%x", "")
    value = string.gsub(value, "|r", "")
    value = string.gsub(value, "[%z\1-\31\127|]", " ")
    value = string.gsub(value, "\194[\128-\159]", " ")
    value = Prefix(value, 64)
    if string.match(value, "^%s*$") then return nil end
    return value
end
local function Identity()
    local guid = Call(UnitGUID, "player")
    return owner and type(owner.session) == "string" and owner.session ~= "" and type(guid) == "string"
        and guid ~= "" and guid == owner.guid and owner.session .. "/" .. guid or nil
end
local function Capture()
    if not supported then return "unsupported", {} end
    local api = Table(C_SkillInfo)
    if not api or type(api.GetSkillLineInfoByID) ~= "function" then return "unavailable", {} end
    local entries = {}
    for _, id in ipairs(skillLines) do
        -- A direct ID lookup includes collapsed headers without mutating the user's panel state.
        -- Source: the client-generated C_SkillInfo.GetSkillLineInfoByID documentation.
        local raw, readable = Call(api.GetSkillLineInfoByID, id)
        local info = Table(raw)
        if not readable or (raw ~= nil and not info) then return "unavailable", {} end
        if info then
            local rank, maximum = Integer(info.rank, 0, 65535), Integer(info.maxRank, 0, 65535)
            local modifier, temporary = Integer(info.modifier, -65535, 65535), Integer(info.tempPoints, -65535, 65535)
            local name = Name(info.name)
            if Integer(info.skillID, 1, 2147483647) ~= id or Public(info.isHeader) ~= false
                or not rank or not maximum or not modifier or not temporary or not name or rank > maximum then
                return "unavailable", {}
            end
            -- Some lookup results contain only static metadata. A 0/0 record does not prove a learned weapon skill.
            if maximum > 0 then
                entries[#entries + 1] = { skillLineID = id, name = name, rank = rank, maxRank = maximum,
                    modifier = modifier, temporary = temporary }
            end
        end
    end
    -- Without one observable player rank, an unloaded skill cache cannot be distinguished from an empty list.
    return #entries > 0 and "available" or "unavailable", entries
end

function WeaponSkills.Scan()
    timer = nil
    local key = Identity()
    if not active or not key then return end
    if key ~= lastIdentity then
        publish(nil)
        if database.weaponSkills and (database.weaponSkills.guid ~= owner.guid or database.weaponSkills.session ~= owner.session) then
            database.weaponSkills = nil
        end
        lastIdentity, lastCapture, lastSignature = key, nil, nil
    end
    if pending() then dirty = true; return end
    local observedAt, now = Integer(Call(GetServerTime), 1, 2147483647), Call(GetTime)
    if not observedAt or type(now) ~= "number" or now ~= now or now < 0 or now > 1e10 then return end
    local serial = eventSerial
    local status, entries = Capture()
    if key ~= Identity() or serial ~= eventSerial or not active then dirty = true; return end
    local record = { v = 1, id = 1, session = owner.session, guid = owner.guid, observedAt = 1, status = status, entries = entries }
    local signature = ns.Transfer.WeaponSkillsJSON(record)
    dirty = false
    if signature == lastSignature and lastCapture and now - lastCapture < 30 then return end
    revision = revision % 2147483647 + 1
    record.id, record.observedAt = revision, observedAt
    if publish(record) then
        database.weaponSkills = record
        lastCapture, lastSignature = now, signature
    else dirty = true end
end
local function Schedule()
    dirty = true
    if not active or timer then return end
    timer = C_Timer.NewTimer(0.2, WeaponSkills.Scan)
end
function WeaponSkills.Initialize(state, db, callback, busy)
    owner, database, publish, pending = state, db, callback, busy
end
function WeaponSkills.OnEvent(event, unit)
    if event == "PLAYER_LOGOUT" or event == "PLAYER_LEAVING_WORLD" then
        active, dirty = false, false
        if timer then timer:Cancel(); timer = nil end
        publish(nil)
    elseif event == "PLAYER_ENTERING_WORLD" then
        active, lastCapture, lastSignature = true, nil, nil
        Schedule()
    elseif event == "UNIT_STATS" and Public(unit) ~= "player" then return
    elseif event == "SKILL_LINES_CHANGED" or event == "CHAT_MSG_SKILL" or event == "PLAYER_LEVEL_UP"
        or event == "PLAYER_EQUIPMENT_CHANGED" or event == "UNIT_STATS" then
        -- CHAT_MSG_SKILL is only a signal. Its text can be secret during chat lockdown.
        eventSerial = eventSerial + 1
        Schedule()
    end
end
function WeaponSkills.Tick()
    local now = Call(GetTime)
    if active and not timer and type(now) == "number" and (dirty or not lastCapture or now - lastCapture >= 30)
        and not pending() then Schedule() end
end
