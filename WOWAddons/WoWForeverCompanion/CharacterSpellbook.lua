-- Capture confirmed player spells using the client's spellbook, including known flyout slots.
local _, ns = ...
local Spellbook = {}
ns.CharacterSpellbook = Spellbook

local Public = ns.Protocol.Public
local maxSlots = 4096

local function Read(fn, ...)
    if type(fn) ~= "function" then return end
    local ok, a, b, c, d, e, f = pcall(fn, ...)
    if ok then return Public(a), Public(b), Public(c), Public(d), Public(e), Public(f) end
end

local function Table(value)
    value = Public(value)
    if type(value) ~= "table" then return end
    if canaccesstable then
        local ok, allowed = pcall(canaccesstable, value)
        if not ok or Public(allowed) ~= true then return end
    end
    return value
end

local function Integer(value, minimum, maximum)
    value = Public(value)
    if type(value) == "number" and value >= minimum and value <= maximum and value == math.floor(value) then return value end
end

local function ID(value) return Integer(value, 1, 2147483647) end

local function Name(value)
    value = Public(value)
    if type(value) == "string" and value:find("%S") and not value:find("[%z\1-\31\127]") then
        return ns.Protocol.UTF8Prefix(value, 160)
    end
end

function Spellbook.Capture(specID)
    local api = C_SpellBook
    local enums = Enum and Enum.SpellBookItemType
    local bank = Enum and Enum.SpellBookSpellBank and Enum.SpellBookSpellBank.Player
    local count = api and Integer(Read(api.GetNumSpellBookSkillLines), 1, 128)
    if not count or not enums or enums.Spell == nil or enums.Flyout == nil or bank == nil then return end
    local entries, spells, slots, flyouts, complete = {}, {}, {}, {}, true
    specID = ID(specID)

    local function Add(baseID, spellID, name, rankText, passive, category)
        if not baseID then complete = false; return end
        if spells[baseID] then return end
        if #entries == maxSlots then complete = false; return end
        if not name then complete = false end
        local entry = { spellID = spellID or baseID, baseSpellID = baseID, name = name, rankText = rankText, category = category }
        if type(passive) == "boolean" then entry.passive = passive end
        entries[#entries + 1], spells[baseID] = entry, true
    end

    local function CaptureFlyout(id, category)
        if not id then complete = false; return end
        if flyouts[id] then return end
        flyouts[id] = true
        local _, _, size, known = Read(GetFlyoutInfo, id)
        if known == false then return end
        size = Integer(size, 0, 128)
        if known ~= true or not size then complete = false; return end
        for index = 1, size do
            local baseID, override, learned, name, slotSpec = Read(GetFlyoutSlotInfo, id, index)
            slotSpec = ID(slotSpec)
            if learned == nil or (learned == true and slotSpec and not specID) then complete = false end
            if learned == true and (not slotSpec or slotSpec == specID) then
                baseID = ID(baseID)
                local spellID = ID(override) or baseID
                local passive = spellID and Read(C_Spell and C_Spell.IsSpellPassive, spellID)
                Add(baseID, spellID, Name(name), nil, passive, category)
            end
        end
    end

    local function CaptureRange(offset, size, category)
        offset, size = Integer(offset, 0, maxSlots), Integer(size, 0, maxSlots)
        if not offset or not size or offset + size > maxSlots then complete = false; return end
        for index = offset + 1, offset + size do
            if not slots[index] then
                slots[index] = true
                local row = Table(Read(api.GetSpellBookItemInfo, index, bank))
                local offSpec = row and Public(row.isOffSpec)
                if not row or type(offSpec) ~= "boolean" then complete = false
                elseif offSpec == false then
                    local kind = Public(row.itemType)
                    local baseID = ID(row.actionID)
                    if kind == enums.Spell then
                        local known = baseID and Read(api.IsSpellKnown, baseID, bank)
                        if known == nil then complete = false end
                        if known == true then
                            Add(baseID, ID(row.spellID), Name(row.name), Name(row.subName), Public(row.isPassive), category)
                        end
                    elseif kind == enums.Flyout then CaptureFlyout(baseID, Name(row.name) or category)
                    elseif kind == nil then complete = false end
                end
            end
        end
    end

    for index = 1, count do
        local line = Table(Read(api.GetSpellBookSkillLineInfo, index))
        if not line then complete = false
        elseif Public(line.shouldHide) ~= true and not ID(line.offSpecID) then
            CaptureRange(line.itemIndexOffset, line.numSpellBookItems, Name(line.name))
        end
    end
    -- Profession tabs can lie outside GetNumSpellBookSkillLines.
    local professions = { Read(GetProfessions) }
    for index = 1, 6 do
        local profession = ID(professions[index])
        if profession then
            local name, _, _, _, size, offset = Read(GetProfessionInfo, profession)
            CaptureRange(offset, size, Name(name))
        end
    end

    if #entries == 0 then return end
    table.sort(entries, function(left, right) return left.baseSpellID < right.baseSpellID end)
    return { complete = complete, specID = specID, entries = entries }
end
