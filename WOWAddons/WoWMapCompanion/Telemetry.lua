local _, ns = ...
local Telemetry = {}
ns.Telemetry = Telemetry
local frame, textures, previous, settings

local function Layout()
    if not frame or not settings then return end
    local scale = UIParent:GetEffectiveScale()
    if scale and scale > 0 then frame:SetScale(1 / scale) end
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
    frame:SetShown(settings.telemetry)
end

function Telemetry.Initialize(config)
    settings = config
    if not frame then
        frame = CreateFrame("Frame", "WoWCompanionTelemetry", UIParent)
        frame:SetFrameStrata("TOOLTIP")
        frame:SetFrameLevel(1000)
        frame:EnableMouse(false)
        frame:SetAlpha(1)
        frame:SetClampedToScreen(true)
        textures, previous = {}, {}
        for index = 1, 4096 do
            local texture = frame:CreateTexture(nil, "OVERLAY")
            texture:SetColorTexture(0, 0, 0, 1)
            textures[index], previous[index] = texture, -1
        end
    end
    Layout()
end

function Telemetry.UpdateLayout() Layout() end

function Telemetry.Render(bytes)
    if not frame or not settings.telemetry or not bytes then return end
    for index = 0, 4095 do
        local value = ns.Protocol.Bit(bytes, index)
        if previous[index + 1] ~= value then
            textures[index + 1]:SetColorTexture(value, value, value, 1)
            previous[index + 1] = value
        end
    end
end
