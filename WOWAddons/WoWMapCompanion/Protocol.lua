-- WCP1: fixed 512-byte frame, 8-byte header and up to 504 UTF-8 JSON bytes.
-- Independent of game/UI APIs for cross-language tests.
local _, ns = ...
local Protocol = {}
ns.Protocol = Protocol
local keys = { "v", "session", "seq", "tick", "guid", "name", "realm", "level", "class", "faction", "race", "spec", "map", "zone", "combat", "dead", "online", "account", "moneyEpoch", "copper", "earned", "spent" }
local limits = { session = 40, guid = 48, name = 48, realm = 48, class = 20, zone = 96 }

local function Public(value)
    if issecretvalue and issecretvalue(value) then return nil end
    return value
end
Protocol.Public = Public

function Protocol.Faction(value)
    value = Public(value)
    if value == "Alliance" or value == "Horde" or value == "Neutral" then return value end
end

function Protocol.Race(value)
    value = Public(value)
    if type(value) ~= "string" then return nil end
    value = string.gsub(value, "|c%x%x%x%x%x%x%x%x", "")
    value = string.gsub(value, "|r", "")
    value = string.gsub(value, "[%z\1-\31\127]", "")
    value = string.gsub(value, "\194[\128-\159]", "")
    -- A partial race name has no reliable meaning; unavailable or oversized is unknown.
    if #value > 48 or string.match(value, "^%s*$") then return nil end
    return value
end

function Protocol.UTF8Prefix(value, maxBytes)
    value = Public(value)
    if type(value) ~= "string" then return "" end
    if #value <= maxBytes then return value end
    local length = maxBytes
    while length > 0 do
        local nextByte = string.byte(value, length + 1)
        if not nextByte or nextByte < 128 or nextByte >= 192 then break end
        length = length - 1
    end
    return string.sub(value, 1, length)
end

local function Escape(value)
    return '"' .. string.gsub(value, '[%z\1-\31\\"]', function(char)
        if char == '"' then return '\\"' end
        if char == '\\' then return '\\\\' end
        return string.format("\\u%04x", string.byte(char))
    end) .. '"'
end

function Protocol.JSON(snapshot)
    local items = {}
    for _, key in ipairs(keys) do
        local value = Public(snapshot[key])
        local kind, encoded = type(value)
        if kind == "string" then encoded = Escape(value)
        elseif kind == "boolean" then encoded = value and "true" or "false"
        elseif kind == "number" and value == value and value ~= math.huge and value ~= -math.huge then encoded = string.format("%.0f", value)
        else encoded = "null" end
        items[#items + 1] = Escape(key) .. ":" .. encoded
    end
    return "{" .. table.concat(items, ",") .. "}"
end

local function XOR(a, b)
    local result, bitValue = 0, 1
    for _ = 1, 16 do
        if a % 2 ~= b % 2 then result = result + bitValue end
        a, b, bitValue = math.floor(a / 2), math.floor(b / 2), bitValue * 2
    end
    return result
end

function Protocol.CRC16(payload)
    local crc = 65535
    for index = 1, #payload do
        crc = XOR(crc, string.byte(payload, index) * 256)
        for _ = 1, 8 do
            if crc >= 32768 then crc = XOR((crc * 2) % 65536, 4129)
            else crc = (crc * 2) % 65536 end
        end
    end
    return crc
end

function Protocol.Frame(payload)
    if type(payload) ~= "string" or #payload > 504 then return nil end
    local crc = Protocol.CRC16(payload)
    local header = "WCP1" .. string.char(#payload % 256, math.floor(#payload / 256), crc % 256, math.floor(crc / 256))
    return header .. payload .. string.rep(string.char(0), 504 - #payload)
end

function Protocol.Encode(snapshot)
    local clean = {}
    for _, key in ipairs(keys) do
        local value = Public(snapshot[key])
        if limits[key] then value = Protocol.UTF8Prefix(value, limits[key]) end
        if key == "faction" then value = Protocol.Faction(value) end
        if key == "race" then value = Protocol.Race(value) end
        clean[key] = value
    end
    local payload = Protocol.JSON(clean)
    -- Preserve faction, IDs and counters. Shrink display labels before dropping the whole race label.
    for _, key in ipairs({ "zone", "realm", "name" }) do
        while #payload > 504 and #clean[key] > 0 do
            clean[key] = Protocol.UTF8Prefix(clean[key], math.max(0, #clean[key] - 8))
            payload = Protocol.JSON(clean)
        end
    end
    if #payload > 504 and clean.race ~= nil then
        clean.race = nil
        payload = Protocol.JSON(clean)
    end
    if #payload > 504 then return nil, "snapshot exceeds 504 bytes" end
    return Protocol.Frame(payload), payload, clean
end

function Protocol.Bit(frame, index)
    local byte = string.byte(frame, math.floor(index / 8) + 1) or 0
    return math.floor(byte / (2 ^ (7 - index % 8))) % 2
end

function Protocol.SelfTest()
    if Protocol.CRC16("123456789") ~= 10673 then return false, "CRC16 check failed" end
    if Protocol.UTF8Prefix("中文", 4) ~= "中" then return false, "UTF-8 check failed" end
    local frame = Protocol.Encode({ v = 3, session = "test", seq = 1, tick = 1, guid = "test", name = "测试", realm = "测试", level = 30, class = "MAGE", faction = "Alliance", race = "人类", spec = 64, map = 84, zone = "暴风城", combat = false, dead = false, online = true, account = "test-account", moneyEpoch = "test-epoch", copper = 12345, earned = 0, spent = 0 })
    if not frame or #frame ~= 512 or string.sub(frame, 1, 4) ~= "WCP1" then return false, "frame check failed" end
    return true, "WCP1 / CRC16 / UTF-8"
end
