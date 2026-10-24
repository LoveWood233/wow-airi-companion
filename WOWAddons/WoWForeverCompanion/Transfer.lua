-- Equipment fragments share the existing grid with normal state frames.
local _, ns = ...
local Transfer = {}
ns.Transfer = Transfer
local Protocol = ns.Protocol
local records, cursor, current, currentPart, equipmentPhase = {}, 0, nil, 0, false
local heldFrame, dropped = nil, 0
local swaps, swapCursor, dataOpportunity = {}, 0, 0
local offer, offerOpportunity = nil, 0
local alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local keys = { "v", "id", "session", "guid", "itemID", "itemGUID", "link", "name", "type", "subtype", "equipLoc", "quality", "itemLevel", "requiredLevel", "stats", "tooltip", "quantity", "observedAt", "source", "infoComplete", "statsComplete", "tooltipComplete", "truncated" }

local function Escape(value)
    return '"' .. string.gsub(value, '[%z\1-\31\\"]', function(char)
        if char == '"' then return '\\"' end
        if char == '\\' then return '\\\\' end
        return string.format("\\u%04x", string.byte(char))
    end) .. '"'
end

local function Value(value)
    value = Protocol.Public(value)
    if type(value) == "string" then return Escape(value) end
    if type(value) == "boolean" then return value and "true" or "false" end
    if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
        return string.format("%.14g", value)
    end
    return "null"
end

function Transfer.JSON(record)
    local result = {}
    for _, key in ipairs(keys) do
        local value = record[key]
        local encoded
        if key == "stats" then
            local items = {}
            for _, stat in ipairs(value) do items[#items + 1] = '{"key":' .. Value(stat.key) .. ',"value":' .. Value(stat.value) .. '}' end
            encoded = "[" .. table.concat(items, ",") .. "]"
        elseif key == "tooltip" then
            local items = {}
            for _, line in ipairs(value) do items[#items + 1] = Value(line) end
            encoded = "[" .. table.concat(items, ",") .. "]"
        else encoded = Value(value) end
        result[#result + 1] = Escape(key) .. ":" .. encoded
    end
    return "{" .. table.concat(result, ",") .. "}"
end

function Transfer.Base64(bytes)
    local result = {}
    for index = 1, #bytes, 3 do
        local a, b, c = string.byte(bytes, index, index + 2)
        local value = a * 65536 + (b or 0) * 256 + (c or 0)
        local p, q, r, s = math.floor(value / 262144) % 64, math.floor(value / 4096) % 64, math.floor(value / 64) % 64, value % 64
        result[#result + 1] = string.sub(alphabet, p + 1, p + 1) .. string.sub(alphabet, q + 1, q + 1)
            .. (b and string.sub(alphabet, r + 1, r + 1) or "=") .. (c and string.sub(alphabet, s + 1, s + 1) or "=")
    end
    return table.concat(result)
end

function Transfer.Encode(record)
    local body = Transfer.JSON(record)
    while #body > 8192 and #record.tooltip > 0 do
        table.remove(record.tooltip)
        record.truncated, record.tooltipComplete = true, false
        body = Transfer.JSON(record)
    end
    while #body > 8192 and #record.stats > 0 do
        table.remove(record.stats)
        record.truncated, record.statsComplete = true, false
        body = Transfer.JSON(record)
    end
    if #body > 8192 then return nil, "equipment exceeds 8192 bytes" end
    local count, frames = math.ceil(#body / 240), {}
    for part = 1, count do
        local payload = '{"v":1,"kind":"eq","s":' .. Value(record.session) .. ',"g":' .. Value(record.guid)
            .. ',"id":' .. Value(record.id) .. ',"p":' .. part .. ',"n":' .. count
            .. ',"d":' .. Escape(Transfer.Base64(string.sub(body, (part - 1) * 240 + 1, part * 240))) .. '}'
        if #payload > 504 then return nil, "equipment fragment exceeds 504 bytes" end
        frames[part] = Protocol.Frame(payload)
    end
    return frames, body
end

function Transfer.Add(record)
    local frames = Transfer.Encode(record)
    if not frames then dropped = dropped + 1; return end
    local entry = { id = record.id, frames = frames, fresh = true, expires = (GetTime() or 0) + 600 }
    records[#records + 1] = entry
    if #records > 6 then
        local removed = table.remove(records, 1)
        if current == removed then current, currentPart = nil, 0 end
        cursor = math.max(0, cursor - 1)
        dropped = dropped + 1
    end
end

local swapKeys = { "v", "kind", "s", "g", "id", "e", "st", "r", "at", "slot", "item", "old" }
local failedReasons = { timeout = true, combat = true, changed = true, unavailable = true, locked = true,
    cursor = true, dead = true, restricted = true, disabled = true, left_world = true }
local function Integer(value, low, high)
    return type(value) == "number" and value == math.floor(value) and value >= low and value <= high
end
local function Identity(value, maximum)
    return type(value) == "string" and #value >= 1 and #value <= maximum and not string.find(value, "[^A-Za-z0-9_-]")
end
function Transfer.EncodeSwap(result)
    if result.v ~= 1 or result.kind ~= "swap" or not Identity(result.s, 40) or not Identity(result.g, 48)
        or not Integer(result.id, 1, 2147483647) or not Integer(result.e, 1, 2147483647)
        or not Integer(result.at, 0, 4102444800) or not Integer(result.slot, 1, 19)
        or not Integer(result.item, 1, 2147483647) or not Integer(result.old, 0, 2147483647) then return nil end
    local valid = (result.st == "equipped" and result.r == "confirmed") or (result.st == "declined" and result.r == "user")
        or (result.st == "expired" and result.r == "timeout") or (result.st == "failed" and failedReasons[result.r])
    if not valid then return nil end
    local values, allowed = {}, {}
    for _, key in ipairs(swapKeys) do values[#values + 1] = Escape(key) .. ":" .. Value(result[key]); allowed[key] = true end
    for key in pairs(result) do if not allowed[key] then return nil end end
    local json = "{" .. table.concat(values, ",") .. "}"
    if #json > 504 then return nil end
    return Protocol.Frame(json), json
end
function Transfer.AddSwap(result)
    for _, entry in ipairs(swaps) do if entry.id == result.id then return end end
    local frame = Transfer.EncodeSwap(result)
    if not frame then dropped = dropped + 1; return end
    swaps[#swaps + 1] = { id = result.id, frame = frame, fresh = true, expires = (GetTime() or 0) + 600 }
    if #swaps > 10 then table.remove(swaps, 1); swapCursor = math.max(0, swapCursor - 1) end
end

local offerKeys = { "v", "kind", "s", "g", "id", "q", "st", "slot", "item", "n", "il", "old", "ol", "until" }
local function Level(value, minimum)
    return type(value) == "number" and value == value and value >= minimum and value <= 100000
end
local function PlainName(value)
    if type(value) ~= "string" or #value == 0 or #value > 96 or string.find(value, "[%z\1-\31\127|]") then return false end
    local index = 1
    while index <= #value do
        local first, second = string.byte(value, index, index + 1)
        local width = first < 128 and 1 or first >= 194 and first <= 223 and 2
            or first >= 224 and first <= 239 and 3 or first >= 240 and first <= 244 and 4
        if not width or index + width - 1 > #value then return false end
        for offset = 1, width - 1 do
            local byte = string.byte(value, index + offset)
            if byte < 128 or byte > 191 then return false end
        end
        if (first == 224 and second < 160) or (first == 237 and second >= 160)
            or (first == 240 and second < 144) or (first == 244 and second >= 144) then return false end
        index = index + width
    end
    return string.find(value, "%S") ~= nil
end
function Transfer.EncodeOffer(result)
    if type(result) ~= "table" or result.v ~= 1 or result.kind ~= "offer" or not Identity(result.s, 40) or not Identity(result.g, 48)
        or not Integer(result.id, 1, 2147483647) or not Integer(result.q, 1, 2147483647)
        or (result.st ~= "ready" and result.st ~= "closed") or not Integer(result.slot, 1, 19)
        or not Integer(result.item, 1, 2147483647) or not Integer(result.old, 0, 2147483647)
        or not PlainName(result.n) or not Level(result.il, 0) or not Level(result.ol, -1)
        or (result.old == 0 and result.ol ~= -1) or (result.old ~= 0 and result.ol < 0)
        or result.il <= result.ol
        or not Integer(result["until"], 1, 4102444800) then return nil end
    local values, allowed = {}, {}
    for _, key in ipairs(offerKeys) do values[#values + 1] = Escape(key) .. ":" .. Value(result[key]); allowed[key] = true end
    for key in pairs(result) do if not allowed[key] then return nil end end
    local json = "{" .. table.concat(values, ",") .. "}"
    if #json > 504 then return nil end
    return Protocol.Frame(json), json
end
function Transfer.SetOffer(result)
    local previous = offer and offer.frame
    local frame = result and Transfer.EncodeOffer(result)
    if result and not frame then dropped = dropped + 1 end
    -- A close replaces even a frame already held on the grid. No old ready frame is queued for replay.
    offer = frame and { frame = frame, expires = (GetTime() or 0) + 180 } or nil
    if previous and heldFrame == previous then heldFrame = frame end
end

function Transfer.Advance()
    equipmentPhase = not equipmentPhase
    heldFrame = nil
    if not equipmentPhase then return end
    local now = GetTime() or 0
    for index = #swaps, 1, -1 do
        if swaps[index].expires <= now then table.remove(swaps, index); swapCursor = math.max(0, swapCursor - 1) end
    end
    for index = #records, 1, -1 do
        if records[index].expires <= now then
            if current == records[index] then current, currentPart = nil, 0 end
            table.remove(records, index)
            cursor = math.max(0, cursor - 1)
        end
    end
    if offer and offer.expires <= now then offer = nil end
    offerOpportunity = offerOpportunity + 1
    -- Offers use one in three data slots. Results use one in four of the remaining slots.
    -- Even with both, 35 equipment parts finish within 140 seconds, below the 180s receiver TTL.
    if offer and (offerOpportunity % 3 == 1 or (#records == 0 and #swaps == 0)) then
        heldFrame = offer.frame
        return
    end
    dataOpportunity = dataOpportunity + 1
    if #swaps > 0 and (#records == 0 or dataOpportunity % 4 == 0) then
        local nextSwap
        for _, entry in ipairs(swaps) do if entry.fresh then nextSwap = entry; break end end
        if not nextSwap then
            swapCursor = swapCursor % #swaps + 1
            nextSwap = swaps[swapCursor]
        end
        heldFrame, nextSwap.fresh = nextSwap.frame, false
        return
    end
    if not current then
        for _, record in ipairs(records) do if record.fresh then current = record; break end end
        if not current and #records > 0 then
            cursor = cursor % #records + 1
            current = records[cursor]
        end
        currentPart = 0
    end
    if not current then return end
    currentPart = currentPart + 1
    heldFrame = current.frames[currentPart]
    if currentPart >= #current.frames then current.fresh = false; current, currentPart = nil, 0 end
end

function Transfer.Current(stateFrame) return heldFrame or stateFrame end

function Transfer.Status()
    return string.format("装备传输：缓存 %d/6 · 换装结果 %d/10 · 过载/编码跳过 %d · 状态与数据每秒交替", #records, #swaps, dropped)
end
