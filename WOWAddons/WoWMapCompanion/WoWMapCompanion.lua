-- Public telemetry and equipment actions approved by an in-game confirmation click.
local addonName, ns = ...
local L = ns.L or function(text) return text end
local Protocol, Telemetry, Money = ns.Protocol, ns.Telemetry, ns.Money
local Equipment, Transfer, ConfirmEquip = ns.Equipment, ns.Transfer, ns.ConfirmEquip
local Public = Protocol.Public
local state, config, db, ticker, transmissionTicker, pendingLevel
local ready, online, combat, dead = false, false, false, false
local refreshTimers = {}
local defaults = { telemetry = true, x = 8, y = 8, cell = 1, brightness = 85 }
local lastBusinessJSON, currentJSON
local cachedFrame, cachedSeq, cachedTick
local bootstrap, bootstrapTick, gearOwner
local locationKey, pendingLocation, locationTick
local pendingHealth, healthTick, healthID, lowThisFight = nil, nil, 0, false
local lowFrequency, characterArchive = ns.LowFrequency, ns.CharacterArchive
local savingHistory = false
local loginProgress

local function Call(fn, ...)
    if type(fn) ~= "function" then return nil end
    local ok, result = pcall(fn, ...)
    if not ok then return nil end
    return Public(result)
end

local function Number(value, fallback, maximum)
    value = Public(value)
    if type(value) ~= "number" or value ~= value or value < 0 or value > (maximum or 2147483647) then return fallback end
    return math.floor(value)
end

local function Text(value, fallback, maxBytes)
    value = Public(value)
    if type(value) ~= "string" or value == "" then return fallback end
    value = string.gsub(value, "|c%x%x%x%x%x%x%x%x", "")
    value = string.gsub(value, "|r", "")
    value = string.gsub(value, "[%z\1-\31\127]", "")
    return Protocol.UTF8Prefix(value, maxBytes or 96)
end

local function Print(text) print(L("|cffefd18b[魔兽陪伴精灵]|r ") .. text) end

local function CancelRefreshTimers()
    for _, timer in ipairs(refreshTimers) do timer:Cancel() end
    refreshTimers = {}
end

local function Export(final)
    if not ready or not state then return end
    -- The disk snapshot follows local observations. Only the login burst sends full character data.
    if cachedSeq ~= state.seq or cachedTick ~= state.tick then
        local payload, clean = Protocol.Snapshot(state)
        if not payload then Print(L("遥测编码失败：") .. tostring(clean)); return end
        cachedSeq, cachedTick, currentJSON = state.seq, state.tick, payload
        if state.online and state.guid ~= "" and state.name ~= "" and state.level > 0
            and (not bootstrap or bootstrap.guid ~= state.guid) then
            bootstrap, bootstrapTick = clean, state.tick
        end
        local position = pendingLocation and state.online and (state.map > 0 or state.instanceID)
            and state.tick - locationTick < 8 and pendingLocation or nil
        local health = pendingHealth and state.online and state.combat and not state.dead
            and state.tick - healthTick < 8 and pendingHealth or nil
        local newActivity = locationTick == state.tick or healthTick == state.tick
        local fullFrame = not (position or health) or (not newActivity and state.tick % 2 == 0)
        if bootstrap and state.online and state.tick - bootstrapTick < 12
            and (bootstrapTick == state.tick or fullFrame) then
            -- Repeat full metadata for screen calibration. Scene changes still describe the current scene.
            local frame = {}
            for key, value in pairs(bootstrap) do frame[key] = value end
            for _, key in ipairs({ "seq", "tick", "map", "zone", "instanceType", "instanceID", "px", "py", "combat", "dead", "online" }) do
                frame[key] = state[key]
            end
            cachedFrame = Protocol.Encode(frame)
        elseif bootstrap then
            cachedFrame = Protocol.EncodePulse(state, position, health)
        end
        -- The client flushes these on reload/logout, never as live disk writes.
        db.snapshot, db.snapshotJSON = clean, payload
        if ns.OfflineHistory then ns.OfflineHistory.Observe(clean, payload, savingHistory, final) end
        db.updatedAt = Number(Call(GetServerTime) or Call(time), 0)
    elseif savingHistory and ns.OfflineHistory then
        ns.OfflineHistory.Observe(db.snapshot, currentJSON, true, final)
    end
    if cachedFrame then Telemetry.Render(Transfer.Current(cachedFrame)) end
end

local function SamplePosition(mapID)
    if not online or not mapID or mapID <= 0 then return end
    local position = Call(C_Map and C_Map.GetPlayerMapPosition, mapID, "player")
    if type(position) ~= "table" then return end
    if canaccesstable and Call(canaccesstable, position) ~= true then return end
    -- Read only a public, accessible vector. Failed or restricted reads clear both axes.
    local ok, x, y = pcall(function()
        local getXY = Public(position.GetXY)
        if type(getXY) == "function" then return getXY(position) end
    end)
    if not ok then return end
    x, y = Public(x), Public(y)
    if type(x) ~= "number" or type(y) ~= "number" or x ~= x or y ~= y or x < 0 or x > 1 or y < 0 or y > 1 then return end
    -- Integral basis points preserve two decimal places in the usual 0-100 map display.
    return math.floor(x * 10000 + 0.5), math.floor(y * 10000 + 0.5)
end

local function SampleInstance()
    if not online then return "unknown", nil end
    local instanceType, instanceID = "unknown", nil
    if type(GetInstanceInfo) == "function" then
        local ok, _, kind, _, _, _, _, _, id = pcall(GetInstanceInfo)
        if ok then
            instanceType = Protocol.InstanceType(kind)
            if instanceType ~= "none" and instanceType ~= "unknown" then instanceID = Protocol.InstanceID(id) end
        end
    end
    -- A second public API can identify the scene when full instance information is unavailable.
    if instanceType == "unknown" and type(IsInInstance) == "function" then
        local ok, inside, kind = pcall(IsInInstance)
        inside, kind = Public(inside), Protocol.InstanceType(kind)
        if ok and type(inside) == "boolean" and ((inside and kind ~= "none") or (not inside and kind == "none")) then
            instanceType = kind
        end
    end
    return instanceType, instanceID
end

-- The transport session changes on every UI load. This record survives reload only after an explicit reload event.
local function ObserveLogin(isInitialLogin, isReloadingUi)
    isInitialLogin, isReloadingUi = Public(isInitialLogin), Public(isReloadingUi)
    local guid = Public(Call(UnitGUID, "player"))
    if type(guid) ~= "string" or guid == "" or type(isInitialLogin) ~= "boolean"
        or type(isReloadingUi) ~= "boolean" or (isInitialLogin and isReloadingUi) then
        loginProgress = nil
        return
    end
    if isInitialLogin then
        loginProgress = { guid = guid, id = state.session, count = 0, armed = false }
        db.loginProgress = loginProgress
    elseif isReloadingUi then
        local saved = db.loginProgress
        local id
        if type(saved) == "table" then id = Protocol.LoginProgress(saved.id, saved.count) end
        loginProgress = id and saved.guid == guid and type(saved.armed) == "boolean" and saved or nil
    elseif loginProgress and loginProgress.guid ~= guid then
        loginProgress = nil
    end
end

-- Count event transitions, including several short fights between telemetry samples. Duplicate end events add nothing.
local function ObserveCombat(entering)
    if not loginProgress then return end
    if entering then
        loginProgress.armed = true
    elseif loginProgress.armed then
        loginProgress.armed = false
        if loginProgress.count < 2147483647 then loginProgress.count = loginProgress.count + 1
        else loginProgress = nil; db.loginProgress = nil end
    end
end

local function ObserveActivity()
    local changed = false
    if state.online and (state.map > 0 or state.instanceID) then
        local key = state.map .. ":" .. state.instanceType .. ":" .. (state.instanceID or "")
        if key ~= locationKey then
            if locationKey or bootstrap then
                pendingLocation = { map = state.map, zone = state.zone, instanceType = state.instanceType,
                    instanceID = state.instanceID, px = state.px, py = state.py }
                locationTick, changed = state.tick, true
            end
            locationKey = key
        end
    end
    if not state.combat or state.dead then
        lowThisFight, pendingHealth = false, nil
    elseif state.online and not lowThisFight then
        local health = Number(Call(UnitHealth, "player", false), nil)
        local maximum = Number(Call(UnitHealthMax, "player"), nil)
        if health and maximum and health > 0 and health * 5 < maximum then
            healthID, lowThisFight = healthID + 1, true
            pendingHealth = { id = healthID, percent = math.floor(health * 100 / maximum) }
            healthTick, changed = state.tick, true
        end
    end
    return changed
end

local function Sample(preserveScene)
    preserveScene = preserveScene == true
    if not ready then return end
    local guid = Text(Call(UnitGUID, "player"), nil, 48)
    state.guid = guid or state.guid or ""
    state.loginId, state.combatEnds = nil, nil
    if online and guid and loginProgress and loginProgress.guid == guid then
        state.loginId, state.combatEnds = Protocol.LoginProgress(loginProgress.id, loginProgress.count)
    end
    state.account, state.moneyEpoch, state.copper, state.earned, state.spent = Money.Sample(guid, online)
    state.name = Text(Call(UnitName, "player"), state.name or "", 48)
    state.realm = Text(Call(GetRealmName), state.realm or "", 48)
    -- Never infer faction from race or retain either identity field when its API is unavailable.
    state.faction = Protocol.Faction(Call(UnitFactionGroup, "player"))
    state.race = Protocol.Race(Call(UnitRace, "player"))
    local level = Number(Call(UnitLevel, "player"), state.level or 0, 255)
    if pendingLevel then level = math.max(level, pendingLevel) end
    state.level = level
    local ok, _, class = pcall(UnitClass, "player")
    if ok then state.class = Text(class, state.class or "", 20) end
    local specAPI = C_SpecializationInfo
    local getSpec = specAPI and specAPI.GetSpecialization or GetSpecialization
    local getSpecInfo = specAPI and specAPI.GetSpecializationInfo or GetSpecializationInfo
    local specIndex = Number(Call(getSpec), nil, 10)
    state.spec = specIndex and Number(Call(getSpecInfo, specIndex), state.spec or 0, 65535) or 0
    if not preserveScene then
        local mapID = C_Map and Number(Call(C_Map.GetBestMapForUnit, "player"), nil, 10000000)
        local info = mapID and Call(C_Map.GetMapInfo, mapID)
        local readableInfo = type(info) == "table" and (not canaccesstable or canaccesstable(info))
        local mapName = readableInfo and Public(info.name) or nil
        local zone = Text(mapName, nil, 96) or Text(Call(GetRealZoneText), nil, 96) or Text(Call(GetZoneText), nil, 96)
        state.map, state.zone = mapID or 0, zone or L("当前位置暂不可用")
        state.px, state.py = SamplePosition(mapID)
        state.instanceType, state.instanceID = SampleInstance()
    end
    state.online, state.combat, state.dead = online, combat, dead
    local activityChanged = not preserveScene and ObserveActivity()
    local seq, tick = state.seq, state.tick
    state.seq, state.tick = 0, 0
    local businessJSON = Protocol.JSON(state)
    state.seq, state.tick = seq, tick
    if activityChanged or businessJSON ~= lastBusinessJSON then
        lastBusinessJSON = businessJSON
        state.seq = state.seq + 1
        Export()
    end
end

local function FlushCharacter()
    if not online then return end
    local guid = Text(Call(UnitGUID, "player"), nil, 48)
    if not guid or (state.guid ~= "" and guid ~= state.guid) then return end
    -- The client may revoke world access before PLAYER_LOGOUT, so capture before leaving.
    Sample(true)
    Equipment.Flush()
    ns.ItemStorage.Flush()
    ns.Inventory.Flush()
    ns.Quests.Flush()
    ns.Talents.Flush()
    ns.WeaponSkills.Flush()
    if lowFrequency then lowFrequency.Flush() end
    if characterArchive then characterArchive.Flush() end
    local observedAt = Number(Call(GetServerTime), nil, 4102444800)
    if not observedAt or observedAt == 0 then return end
    local attributes = ns.CharacterAttributes and ns.CharacterAttributes.Capture()
    local profile = ns.CharacterProfile and ns.CharacterProfile.Capture(ns.OfflineHistory.Read(guid, "profile"))
    ns.OfflineHistory.Save(guid, "attributes", attributes and { data = attributes, observedAt = observedAt })
    ns.OfflineHistory.Save(guid, "profile", profile and { data = profile, observedAt = observedAt })
    local spellbook = ns.CharacterSpellbook and ns.CharacterSpellbook.Capture(state.spec)
    local skillLines = ns.CharacterSkillLines and ns.CharacterSkillLines.Capture(ns.OfflineHistory.Read(guid, "skillLines"))
    ns.OfflineHistory.Save(guid, "spellbook", spellbook and { data = spellbook, observedAt = observedAt })
    if skillLines then
        local languages = skillLines.languages
        skillLines.languages = nil
        ns.OfflineHistory.Save(guid, "skillLines", skillLines.entries and { data = skillLines, observedAt = observedAt })
        ns.OfflineHistory.Save(guid, "languages", languages and { data = languages, observedAt = observedAt })
    end
end

local function ScheduleRefresh()
    CancelRefreshTimers()
    Sample()
    for _, delay in ipairs({ 0.25, 1, 2, 5 }) do
        refreshTimers[#refreshTimers + 1] = C_Timer.NewTimer(delay, Sample)
    end
end

local function Initialize()
    if ready then return end
    if type(WoWMapCompanionDB) ~= "table" then WoWMapCompanionDB = {} end
    db = WoWMapCompanionDB
    Money.Initialize(db)
    if ns.OfflineHistory then ns.OfflineHistory.Initialize(db, "retail") end
    if type(db.settings) ~= "table" then db.settings = {} end
    config = db.settings
    config.panel = nil
    for key, value in pairs(defaults) do if type(config[key]) ~= type(value) then config[key] = value end end
    config.x = Number(config.x, 8, 16000)
    config.y = Number(config.y, 8, 16000)
    config.cell = math.max(1, math.min(6, Number(config.cell, 1, 6)))
    config.brightness = math.max(85, math.min(100, Number(config.brightness, 85, 100)))
    -- Migrate existing large grids once; later explicit cell choices survive reloads.
    if config.compactLayoutVersion ~= 1 then
        config.cell, config.compactLayoutVersion = 1, 1
    end
    local timestamp = Number(Call(GetServerTime) or Call(time), 0)
    local uptime = Number((Call(GetTime) or 0) * 1000, 0)
    state = { v = 3, session = string.format("%d-%d-%d", timestamp, uptime, math.random(100000, 999999)), seq = 0, tick = 0, guid = "", name = "", realm = "", level = 0, class = "", spec = 0, map = 0, zone = L("当前位置暂不可用"), combat = false, dead = false, online = false }
    Telemetry.Initialize(config)
    Transfer.SetMacroState(state)
    if lowFrequency then lowFrequency.Initialize(state, db) end
    if characterArchive and lowFrequency then characterArchive.Initialize(state, db, lowFrequency.Submit, lowFrequency.SaveLocal) end
    if ns.Calendar then ns.Calendar.Initialize(db, lowFrequency and lowFrequency.Submit, lowFrequency and lowFrequency.interval) end
    if ns.GroupBuffs then ns.GroupBuffs.Initialize() end
    ConfirmEquip.Initialize(state, config, Transfer.AddSwap, Print, function(offer)
        Transfer.SetOffer(offer)
        if ready then Export() end
    end, Transfer.AddComparison)
    Equipment.Initialize(state, function(record)
        Transfer.Add(record)
        local offered, comparison = ConfirmEquip.Add(record)
        local review = comparison and comparison.current and comparison.candidate.itemLevel > comparison.current.itemLevel
            and comparison.assessment.verdict == "review" and comparison.assessment.reason ~= "primary_upgrade_tradeoff"
        if not offered and not review then Transfer.AddLoot(record) end
    end, function(record)
        if ns.OfflineHistory then ns.OfflineHistory.Equipment(record) end
        if gearOwner ~= record.guid and Transfer.SetGear(record) then gearOwner = record.guid end
    end, Transfer.AddLoot)
    ns.ItemStorage.Initialize(state, db)
    local interval = lowFrequency and lowFrequency.interval
    ns.Inventory.Initialize(state, Transfer.SetInventory, interval)
    ns.Quests.Initialize(state, function(record)
        return Transfer.SetQuests(record, interval ~= nil)
    end, Transfer.QuestsBusy, interval)
    ns.Talents.Initialize(state, function(record)
        return Transfer.SetTalents(record, interval ~= nil)
    end, Transfer.TalentsBusy, interval ~= nil)
    ns.WeaponSkills.Initialize(state, db, Transfer.SetWeaponSkills, Transfer.WeaponSkillsBusy)
    ready = true
    ticker = C_Timer.NewTicker(1, function()
        state.tick = (state.tick + 1) % 2147483647
        Sample()
        ConfirmEquip.Tick()
        ns.ItemStorage.Tick()
        ns.Inventory.Tick()
        ns.Quests.Tick()
        ns.Talents.Tick()
        ns.WeaponSkills.Tick()
        if lowFrequency then lowFrequency.Tick() end
        Export()
    end)
    -- Keep business heartbeats at one second while each data frame remains visible for 250 ms.
    transmissionTicker = C_Timer.NewTicker(0.25, function()
        Transfer.Advance()
        Export()
    end)
    Sample()
end

local events = CreateFrame("Frame")
pcall(events.RegisterEvent, events, "UPDATE_INSTANCE_INFO")
if characterArchive then
    for event in pairs(characterArchive.Events) do pcall(events.RegisterEvent, events, event) end
end
for _, event in ipairs({ "UNIT_HEALTH", "UNIT_MAXHEALTH" }) do pcall(events.RegisterEvent, events, event) end
for _, event in ipairs({ "BANKFRAME_OPENED", "BANKFRAME_CLOSED", "PLAYERBANKSLOTS_CHANGED", "PLAYERREAGENTBANKSLOTS_CHANGED", "BANK_TABS_CHANGED", "PLAYER_ACCOUNT_BANK_TAB_SLOTS_CHANGED" }) do pcall(events.RegisterEvent, events, event) end
for _, event in ipairs({ "ADDON_LOADED", "PLAYER_ENTERING_WORLD", "PLAYER_LEAVING_WORLD", "PLAYER_LOGOUT", "PLAYER_MONEY", "PLAYER_LEVEL_UP", "ZONE_CHANGED_NEW_AREA", "ZONE_CHANGED", "ZONE_CHANGED_INDOORS", "PLAYER_SPECIALIZATION_CHANGED", "NEUTRAL_FACTION_SELECT_RESULT", "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED", "PLAYER_DEAD", "PLAYER_ALIVE", "PLAYER_UNGHOST", "UI_SCALE_CHANGED", "DISPLAY_SIZE_CHANGED", "BAG_UPDATE_DELAYED", "PLAYER_EQUIPMENT_CHANGED", "ITEM_PUSH", "GET_ITEM_INFO_RECEIVED", "ITEM_DATA_LOAD_RESULT" }) do events:RegisterEvent(event) end
for _, event in ipairs({"QUEST_LOG_UPDATE", "QUEST_ACCEPTED", "QUEST_REMOVED", "QUEST_WATCH_UPDATE", "QUEST_TURNED_IN"}) do events:RegisterEvent(event) end

for _, event in ipairs({"PLAYER_TALENT_UPDATE", "TRAIT_CONFIG_UPDATED", "TRAIT_CONFIG_LIST_UPDATED", "TRAIT_NODE_CHANGED", "TRAIT_TREE_CHANGED"}) do events:RegisterEvent(event) end

for _, event in ipairs({"SKILL_LINES_CHANGED", "CHAT_MSG_SKILL", "UNIT_STATS"}) do pcall(events.RegisterEvent, events, event) end

events:SetScript("OnEvent", function(_, event, arg1, arg2)
    if event == "ADDON_LOADED" then if arg1 == addonName then Initialize() end; return end
    if not ready then return end
    if event == "UNIT_HEALTH" or event == "UNIT_MAXHEALTH" then
        if Public(arg1) == "player" and online and combat and not dead and not lowThisFight then Sample() end
        return
    end
    if (event == "PLAYER_LEAVING_WORLD" or event == "PLAYER_LOGOUT") and ns.OfflineHistory then FlushCharacter() end
    if lowFrequency then lowFrequency.OnEvent(event) end
    if characterArchive then characterArchive.OnEvent(event, arg1, arg2) end
    if event == "UPDATE_INSTANCE_INFO" or event == "ACHIEVEMENT_EARNED" or event == "RECEIVED_ACHIEVEMENT_LIST"
        or event == "MAP_EXPLORATION_UPDATED" or event == "NEW_RECIPE_LEARNED" or event:sub(1, 12) == "TRADE_SKILL_" then return end
    ns.ItemStorage.OnEvent(event)
    ns.Inventory.OnEvent(event)
    ns.Quests.OnEvent(event, arg1)
    ns.Talents.OnEvent(event, arg1)
    ns.WeaponSkills.OnEvent(event, arg1)
    if event == "SKILL_LINES_CHANGED" or event == "CHAT_MSG_SKILL" or event == "UNIT_STATS" then return end
    if string.sub(event, 1, 6) == "QUEST_" or string.sub(event, 1, 6) == "TRAIT_" or event == "PLAYER_TALENT_UPDATE" then return end
    ConfirmEquip.OnEvent(event, arg1, arg2)
    if event ~= "PLAYER_ENTERING_WORLD" then Equipment.OnEvent(event, arg1, arg2) end
    if event == "PLAYER_ENTERING_WORLD" then
        ObserveLogin(arg1, arg2)
        online = true
        local isCombat, isDead = Call(InCombatLockdown), Call(UnitIsDeadOrGhost, "player")
        if type(isCombat) == "boolean" then combat = isCombat end
        if type(isDead) == "boolean" then dead = isDead end
        ScheduleRefresh()
        if characterArchive then characterArchive.Enter() end
        Equipment.OnEvent(event, arg1, arg2)
    elseif event == "PLAYER_LEAVING_WORLD" or event == "PLAYER_LOGOUT" then
        if event == "PLAYER_LOGOUT" then loginProgress = nil end
        savingHistory = true
        CancelRefreshTimers()
        online = false
        Sample()
        Export(event == "PLAYER_LOGOUT")
        savingHistory = false
    elseif event == "BAG_UPDATE_DELAYED" or event == "PLAYER_EQUIPMENT_CHANGED" or event == "ITEM_PUSH" or event == "GET_ITEM_INFO_RECEIVED" or event == "ITEM_DATA_LOAD_RESULT" then return
    elseif event == "PLAYER_MONEY" then Sample()
    elseif event == "PLAYER_LEVEL_UP" then pendingLevel = Number(arg1, pendingLevel, 255); Sample()
    elseif event == "PLAYER_REGEN_DISABLED" then ObserveCombat(true); combat = true; Sample()
    elseif event == "PLAYER_REGEN_ENABLED" then ObserveCombat(false); combat = false; Sample()
    elseif event == "PLAYER_DEAD" then dead = true; Sample()
    elseif event == "PLAYER_ALIVE" or event == "PLAYER_UNGHOST" then
        local isDead = Call(UnitIsDeadOrGhost, "player")
        if type(isDead) == "boolean" then dead = isDead
        elseif event == "PLAYER_UNGHOST" then dead = false end
        Sample()
    elseif event == "UI_SCALE_CHANGED" or event == "DISPLAY_SIZE_CHANGED" then Telemetry.UpdateLayout(); Export()
    elseif event == "PLAYER_SPECIALIZATION_CHANGED" then if Public(arg1) == "player" then ScheduleRefresh() end
    else ScheduleRefresh() end
end)

SLASH_WOWMAPCOMPANION1 = "/wowc"
SlashCmdList.WOWMAPCOMPANION = function(message)
    if not ready then return end
    local command, arg = string.match(message or "", "^%s*(%S*)%s*(.-)%s*$")
    command = string.lower(command)
    if command == "equip" then
        ConfirmEquip.Command(string.lower(arg))
    elseif command == "telemetry" then
        config.telemetry = not config.telemetry
        Telemetry.UpdateLayout()
        Export()
        Print(L("屏幕遥测：") .. (config.telemetry and L("开启") or L("关闭（桌面端将检测为离线）")))
    elseif command == "pos" then
        local x, y = string.match(arg, "^(%d+)%s+(%d+)$")
        x, y = tonumber(x), tonumber(y)
        if not x or not y or x > 16000 or y > 16000 then Print(L("用法：/wowc pos 8 8（相对游戏客户区左上角）")); return end
        config.x, config.y = x, y
        Telemetry.UpdateLayout(); Export()
        Print(string.format(L("遥测位置：%d, %d；请同步桌面端坐标。"), x, y))
    elseif command == "cell" or command == "compact" then
        local cell = command == "compact" and 1 or tonumber(arg)
        if not cell or cell ~= math.floor(cell) or cell < 1 or cell > 6 then Print(L("用法：/wowc cell 1（1–6 整数像素）")); return end
        config.cell = cell
        Telemetry.UpdateLayout(); Export()
        Print(L("遥测单元尺寸：") .. cell .. L(" 像素；请同步桌面端设置。"))
    elseif command == "contrast" then
        local brightness = tonumber(arg)
        if not brightness or brightness ~= math.floor(brightness) or brightness < 85 or brightness > 100 then
            Print(string.format(L("用法：%s contrast 85（85–100）"), "/wowc")); return
        end
        config.brightness = brightness
        Export()
        Print(string.format(L("数据码亮度：%d%%"), brightness))
    elseif command == "selftest" then
        local ok, detail = Protocol.SelfTest()
        Print((ok and L("编码自检通过：") or L("编码自检失败：")) .. detail)
    elseif command == "reset" then
        for key, value in pairs(defaults) do config[key] = value end
        Telemetry.UpdateLayout(); Export()
        Print(L("已重置显示设置。"))
    elseif command == "status" then
        Print(string.format(L("WCP1 · 等级 %d · 状态序号 %d · 心跳 %d · JSON %d/504 字节"), state.level, state.seq, state.tick, #(currentJSON or "")))
        Print(string.format(L("遥测：%s · 左上(%d,%d) · 每格%dpx · 画面区%d×%dpx"), config.telemetry and L("开启") or L("关闭"), config.x, config.y, config.cell, 64 * config.cell, 64 * config.cell))
        Print(L("这是单向发送状态；插件无法确认桌面端是否已连接。"))
        Print(Equipment.Status())
        Print(ConfirmEquip.Status())
        Print(Transfer.Status())
        Print(Money.Format(state.copper) .. L(" · 累计收入 ") .. Money.Format(state.earned) .. L(" · 累计支出 ") .. Money.Format(state.spent))
    else
        Print(L("/wowc telemetry 遥测；status 状态；selftest 编码自检"))
        Print(string.format(L("用法：%s contrast 85（85–100）"), "/wowc"))
        Print(L("equip on | off | status；equip check [物品ID]：复查当前背包装备"))
        Print(L("/wowc pos 8 8 位置；compact 最小网格；cell 1 像素尺寸；reset 重置设置"))
    end
end
