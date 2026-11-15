local _, ns = ...
local Telemetry = {}
ns.Telemetry = Telemetry
local frame, textures, previous, settings
local previousBytes, renderedFrame, renderedLight
local layoutScale, layoutPixelToUI

local function PixelToUIUnit()
    if PixelUtil and type(PixelUtil.GetPixelToUIUnitFactor) == "function" then
        local factor = PixelUtil.GetPixelToUIUnitFactor()
        if type(factor) == "number" and factor > 0 and factor < math.huge then return factor end
    end
    if type(GetPhysicalScreenSize) == "function" then
        local _, height = GetPhysicalScreenSize()
        if type(height) == "number" and height > 0 and height < math.huge then return 768 / height end
    end
end

local function Layout()
    if not frame or not settings then return end
    local scale = UIParent:GetEffectiveScale()
    local pixelToUI = PixelToUIUnit()
    if not pixelToUI or type(scale) ~= "number" or scale <= 0 or scale >= math.huge then
        layoutScale, layoutPixelToUI = nil, nil
        frame:SetShown(false)
        return
    end
    -- UI units use a 768-high viewport. Cancelling parent scale alone still enlarges every cell by screenHeight / 768.
    -- Source: Blizzard_SharedXML/PixelUtil.lua, GetPixelToUIUnitFactor and GetNearestPixelSize.
    frame:SetScale(pixelToUI / scale)
    frame:ClearAllPoints()
    frame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", settings.x, -settings.y)
    local cell = settings.cell
    frame:SetSize(64 * cell, 64 * cell)
    for index = 0, 4095 do
        local texture = textures[index + 1]
        texture:ClearAllPoints()
        texture:SetPoint("TOPLEFT", frame, "TOPLEFT", (index % 64) * cell, -math.floor(index / 64) * cell)
        texture:SetSize(cell, cell)
    end
    layoutScale, layoutPixelToUI = scale, pixelToUI
    frame:SetShown(settings.telemetry)
end

function Telemetry.Initialize(config)
    settings = config
    if not frame then
        frame = CreateFrame("Frame", "WoWForeverCompanionTelemetry", UIParent)
        frame:SetFrameStrata("TOOLTIP")
        frame:SetFrameLevel(1000)
        frame:EnableMouse(false)
        frame:SetAlpha(1)
        frame:SetClampedToScreen(true)
        -- Blizzard's PixelUtil recommends native layout rounding for pixel-aligned regions.
        if frame.SetRoundLayoutToNearestPixel then frame:SetRoundLayoutToNearestPixel(true) end
        textures, previous, previousBytes, renderedFrame, renderedLight = {}, {}, {}, nil, nil
        for index = 1, 4096 do
            local texture = frame:CreateTexture(nil, "OVERLAY")
            if texture.SetRoundLayoutToNearestPixel then texture:SetRoundLayoutToNearestPixel(true) end
            texture:SetColorTexture(0, 0, 0, 1)
            -- UI skins can disable snapping in a global SetColorTexture hook.
            if texture.SetSnapToPixelGrid then texture:SetSnapToPixelGrid(true) end
            textures[index], previous[index] = texture, -1
        end
    end
    Layout()
end

function Telemetry.UpdateLayout() Layout() end

function Telemetry.Render(bytes)
    if not frame or not settings.telemetry or not bytes then return end
    -- Login can change UIParent after its scale event. Repair on the next heartbeat,
    -- while leaving all 4096 texture positions untouched when the scale is stable.
    if UIParent:GetEffectiveScale() ~= layoutScale or PixelToUIUnit() ~= layoutPixelToUI then Layout() end
    local brightness = settings.brightness
    if type(brightness) ~= "number" or brightness ~= brightness or brightness < 85 or brightness > 100 then brightness = 85 end
    local light = brightness / 100
    if bytes == renderedFrame and light == renderedLight then return end
    if light ~= renderedLight then previousBytes, previous = {}, {} end
    renderedFrame, renderedLight = bytes, light
    -- A changed byte affects only its eight pixels. Unchanged bytes need no bit decoding.
    for offset = 0, 511 do
        local byte = string.byte(bytes, offset + 1) or 0
        if previousBytes[offset + 1] ~= byte then
            previousBytes[offset + 1] = byte
            for bit = 0, 7 do
                local index = offset * 8 + bit + 1
                local value = math.floor(byte / 2 ^ (7 - bit)) % 2
                if previous[index] ~= value then
                    local texture = textures[index]
                    -- Keep alpha opaque. The dimmer light bit still exceeds the decoder's 160/255 threshold.
                    local color = value * light
                    texture:SetColorTexture(color, color, color, 1)
                    if texture.SetSnapToPixelGrid then texture:SetSnapToPixelGrid(true) end
                    previous[index] = value
                end
            end
        end
    end
end
