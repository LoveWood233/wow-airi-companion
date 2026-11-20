local _, ns = ...
local Warning = {}
ns.ExplorationWarning = Warning
local Public = ns.Protocol.Public
local L = ns.L or function(text) return text end
local identity, destination, enteredAt
local warningID = 0

local function Read(fn)
    if type(fn) ~= "function" then return nil end
    local ok, value = pcall(fn)
    if ok then return Public(value) end
end

-- Runtime arrivals belong to one character. Login establishes a baseline, while
-- short loading gaps retain the previous map and discard unfinished warnings.
function Warning.Observe(state, sampledLevel)
    if not state.online then enteredAt = nil; return end
    if not state.guid or state.guid == "" or not state.map or state.map <= 0 then return end
    if identity ~= state.guid then
        identity, destination, enteredAt = state.guid, state.map, nil
        return
    end
    local now = Read(GetTime)
    if type(now) ~= "number" then return end
    if destination ~= state.map then
        destination = state.map
        enteredAt = now
    end
    if not enteredAt then return end
    local elapsed = now - enteredAt
    if elapsed < 0 or elapsed > 5 or state.dead then enteredAt = nil; return end
    -- Let the scene and current level settle after the boundary event.
    if elapsed < 0.25 or state.instanceType == "unknown" then return end
    if state.instanceType ~= "none" then enteredAt = nil; return end
    local range = ns.ExplorationLevels and ns.ExplorationLevels[state.map]
    if not range then enteredAt = nil; return end
    if type(sampledLevel) ~= "number" or sampledLevel <= 0 then return end
    enteredAt = nil
    if sampledLevel >= range.min then return end
    local message = L("前面的区域，以后再来探索吧")
    if UIErrorsFrame and type(UIErrorsFrame.AddMessage) == "function" then
        UIErrorsFrame:AddMessage(message, 1, 0.82, 0, 1)
    end
    print(L("|cffefd18b[魔兽无限陪伴精灵]|r ") .. message)
    warningID = warningID + 1
    return { id = warningID, map = state.map, level = sampledLevel, min = range.min }
end
