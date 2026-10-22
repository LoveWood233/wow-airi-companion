-- Public character state only. No gameplay actions, sockets or secret unwrapping.
local addonName, ns = ...
local Protocol, Telemetry = ns.Protocol, ns.Telemetry
local Public = Protocol.Public
local state, config, db, ticker, pendingLevel
local ready, online, combat, dead = false, false, false, false
local refreshTimers = {}
local defaults = { panel = true, telemetry = true, x = 8, y = 8, cell = 2 }
local lastBusinessJSON, currentJSON

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

local function Print(text) print("|cffefd18b[魔兽陪伴精灵]|r " .. text) end

local panel = CreateFrame("Frame", "WoWMapCompanionPanel", UIParent)
panel:SetSize(390, 78)
panel:SetPoint("TOP", UIParent, "TOP", 0, -72)
panel:SetFrameStrata("MEDIUM")
panel:EnableMouse(false)
local background = panel:CreateTexture(nil, "BACKGROUND")
background:SetAllPoints(panel)
background:SetColorTexture(0.035, 0.055, 0.085, 0.85)
local accent = panel:CreateTexture(nil, "BORDER")
accent:SetPoint("TOPLEFT", panel, "TOPLEFT", 0, 0)
accent:SetPoint("TOPRIGHT", panel, "TOPRIGHT", 0, 0)
accent:SetHeight(2)
accent:SetColorTexture(0.87, 0.71, 0.36, 1)
local mapLabel = panel:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
mapLabel:SetPoint("TOPLEFT", panel, "TOPLEFT", 12, -10)
mapLabel:SetPoint("TOPRIGHT", panel, "TOPRIGHT", -12, -10)
mapLabel:SetJustifyH("CENTER")
mapLabel:SetWordWrap(true)
mapLabel:SetTextColor(1, 0.87, 0.56)
mapLabel:SetText("正在获取地图…")
local detailLabel = panel:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
detailLabel:SetPoint("BOTTOM", panel, "BOTTOM", 0, 14)
detailLabel:SetText("魔兽陪伴精灵 · /wowc")

local function UpdatePanel()
    if not state then return end
    mapLabel:SetText(online and state.zone or "正在切换世界…")
    local status = state.dead and "灵魂状态" or (state.combat and "战斗中 · 安静陪伴" or "冒险中")
    detailLabel:SetText(string.format("%s · 等级 %d · %s", state.name ~= "" and state.name or "角色", state.level, status))
    panel:SetHeight(math.max(78, mapLabel:GetStringHeight() + 50))
    panel:SetShown(config.panel)
end

local function CancelRefreshTimers()
    for _, timer in ipairs(refreshTimers) do timer:Cancel() end
    refreshTimers = {}
end

local function Export()
    if not ready or not state then return end
    local bytes, payload, clean = Protocol.Encode(state)
    if not bytes then Print("遥测编码失败：" .. tostring(payload)); return end
    currentJSON = payload
    -- The client flushes these on reload/logout, never as live disk writes.
    db.snapshot, db.snapshotJSON = clean, payload
    db.updatedAt = Number(Call(GetServerTime) or Call(time), 0)
    Telemetry.Render(bytes)
    UpdatePanel()
end

local function Sample()
    if not ready then return end
    state.guid = Text(Call(UnitGUID, "player"), state.guid or "", 48)
    state.name = Text(Call(UnitName, "player"), state.name or "", 48)
    state.realm = Text(Call(GetRealmName), state.realm or "", 48)
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
    local mapID = C_Map and Number(Call(C_Map.GetBestMapForUnit, "player"), nil, 10000000)
    local info = mapID and Call(C_Map.GetMapInfo, mapID)
    local readableInfo = type(info) == "table" and (not canaccesstable or canaccesstable(info))
    local mapName = readableInfo and Public(info.name) or nil
    local zone = Text(mapName, nil, 96) or Text(Call(GetRealZoneText), nil, 96) or Text(Call(GetZoneText), nil, 96)
    state.map, state.zone = mapID or 0, zone or "当前位置暂不可用"
    state.online, state.combat, state.dead = online, combat, dead
    local seq, tick = state.seq, state.tick
    state.seq, state.tick = 0, 0
    local businessJSON = Protocol.JSON(state)
    state.seq, state.tick = seq, tick
    if businessJSON ~= lastBusinessJSON then
        lastBusinessJSON = businessJSON
        state.seq = state.seq + 1
        Export()
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
    if type(db.settings) ~= "table" then db.settings = {} end
    config = db.settings
    for key, value in pairs(defaults) do if type(config[key]) ~= type(value) then config[key] = value end end
    config.x = Number(config.x, 8, 16000)
    config.y = Number(config.y, 8, 16000)
    config.cell = math.max(1, math.min(6, Number(config.cell, 2, 6)))
    local timestamp = Number(Call(GetServerTime) or Call(time), 0)
    local uptime = Number((Call(GetTime) or 0) * 1000, 0)
    state = { v = 1, session = string.format("%d-%d-%d", timestamp, uptime, math.random(100000, 999999)), seq = 0, tick = 0, guid = "", name = "", realm = "", level = 0, class = "", spec = 0, map = 0, zone = "当前位置暂不可用", combat = false, dead = false, online = false }
    Telemetry.Initialize(config)
    ready = true
    ticker = C_Timer.NewTicker(1, function()
        state.tick = (state.tick + 1) % 2147483647
        Export()
    end)
    Sample()
end

local events = CreateFrame("Frame")
for _, event in ipairs({ "ADDON_LOADED", "PLAYER_ENTERING_WORLD", "PLAYER_LEAVING_WORLD", "PLAYER_LOGOUT", "PLAYER_LEVEL_UP", "ZONE_CHANGED_NEW_AREA", "ZONE_CHANGED", "ZONE_CHANGED_INDOORS", "PLAYER_SPECIALIZATION_CHANGED", "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED", "PLAYER_DEAD", "PLAYER_ALIVE", "PLAYER_UNGHOST", "UI_SCALE_CHANGED", "DISPLAY_SIZE_CHANGED" }) do events:RegisterEvent(event) end
events:SetScript("OnEvent", function(_, event, arg1)
    if event == "ADDON_LOADED" then if arg1 == addonName then Initialize() end; return end
    if not ready then return end
    if event == "PLAYER_ENTERING_WORLD" then
        online = true
        local isCombat, isDead = Call(InCombatLockdown), Call(UnitIsDeadOrGhost, "player")
        if type(isCombat) == "boolean" then combat = isCombat end
        if type(isDead) == "boolean" then dead = isDead end
        ScheduleRefresh()
    elseif event == "PLAYER_LEAVING_WORLD" or event == "PLAYER_LOGOUT" then
        CancelRefreshTimers()
        online = false
        Sample()
        Export()
    elseif event == "PLAYER_LEVEL_UP" then pendingLevel = Number(arg1, pendingLevel, 255); Sample()
    elseif event == "PLAYER_REGEN_DISABLED" then combat = true; Sample()
    elseif event == "PLAYER_REGEN_ENABLED" then combat = false; Sample()
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
    if command == "panel" then
        config.panel = not config.panel
        UpdatePanel()
        Print("地图面板：" .. (config.panel and "显示" or "隐藏"))
    elseif command == "telemetry" then
        config.telemetry = not config.telemetry
        Telemetry.UpdateLayout()
        Export()
        Print("屏幕遥测：" .. (config.telemetry and "开启" or "关闭（桌面端将检测为离线）"))
    elseif command == "pos" then
        local x, y = string.match(arg, "^(%d+)%s+(%d+)$")
        x, y = tonumber(x), tonumber(y)
        if not x or not y or x > 16000 or y > 16000 then Print("用法：/wowc pos 8 8（相对游戏客户区左上角）"); return end
        config.x, config.y = x, y
        Telemetry.UpdateLayout(); Export()
        Print(string.format("遥测位置：%d, %d；请同步桌面端坐标。", x, y))
    elseif command == "cell" then
        local cell = tonumber(arg)
        if not cell or cell ~= math.floor(cell) or cell < 1 or cell > 6 then Print("用法：/wowc cell 2（1–6 整数像素）"); return end
        config.cell = cell
        Telemetry.UpdateLayout(); Export()
        Print("遥测单元尺寸：" .. cell .. " 像素；请同步桌面端设置。")
    elseif command == "selftest" then
        local ok, detail = Protocol.SelfTest()
        Print((ok and "编码自检通过：" or "编码自检失败：") .. detail)
    elseif command == "reset" then
        for key, value in pairs(defaults) do config[key] = value end
        Telemetry.UpdateLayout(); Export()
        Print("已重置显示设置。")
    elseif command == "status" then
        Print(string.format("WCP1 · 等级 %d · 状态序号 %d · 心跳 %d · JSON %d/504 字节", state.level, state.seq, state.tick, #(currentJSON or "")))
        Print(string.format("遥测：%s · 左上(%d,%d) · 每格%dpx · 画面区%d×%dpx", config.telemetry and "开启" or "关闭", config.x, config.y, config.cell, 64 * config.cell, 64 * config.cell))
        Print("这是单向发送状态；插件无法确认桌面端是否已连接。")
    else
        Print("/wowc panel 地图面板；telemetry 遥测；status 状态；selftest 编码自检")
        Print("/wowc pos 8 8 位置；cell 2 像素尺寸；reset 重置设置")
    end
end
