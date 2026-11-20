local addonName, ns = ...
local CharacterAttributes = {}
ns.CharacterAttributes = CharacterAttributes

local Public = ns.Protocol.Public
local forever = addonName == "WoWForeverCompanion"
local player = "player"
local primaryStats = { "strength", "agility", "stamina", "intellect", "spirit" }
local schools = { "holy", "fire", "nature", "frost", "shadow", "arcane" }
-- PaperDollFrame defines these indexes; the panel itself need not be loaded.
local meleeHitRating, rangedHitRating, spellHitRating = 6, 7, 8
local damageDoneVersatility, damageTakenVersatility = 29, 31
local characterStats = {
    critChance = "GetCritChance", rangedCritChance = "GetRangedCritChance",
    haste = "GetHaste", mastery = "GetMastery", masteryEffect = "GetMasteryEffect",
    dodge = "GetDodgeChance", parry = "GetParryChance", block = "GetBlockChance",
    lifeSteal = "GetLifesteal", avoidance = "GetAvoidance", movementSpeedBonus = "GetSpeed",
    healingPower = "GetSpellBonusHealing", meleeHaste = "GetMeleeHaste",
    armorPenetration = "GetArmorPenetration", blockValue = "GetShieldBlock",
}

local function Number(value)
    value = Public(value)
    if type(value) == "number" and value == value and math.abs(value) <= 9007199254740991 then
        return value
    end
end

local function Read(api, ...)
    if type(api) ~= "function" then return end
    local ok, first, second, third = pcall(api, ...)
    if ok then return Number(first), Number(second), Number(third) end
end

local function Sum(first, second)
    if first and second then return Number(first + second) end
end

local function AttackPower(api)
    local base, positive, negative = Read(api, player)
    local effective = Sum(Sum(base, positive), negative)
    if effective then return math.max(0, effective) end
end

local function SchoolMinimum(api, attributes, fieldSuffix)
    local minimum, complete = math.huge, true
    for index, school in ipairs(schools) do
        -- Index 1 is physical damage. Spell school APIs use one-based indexes.
        local value = Read(api, index + 1)
        if fieldSuffix then attributes[school .. fieldSuffix] = value end
        if value then minimum = math.min(minimum, value) else complete = false end
    end
    if complete then return minimum end
end

function CharacterAttributes.Capture()
    local attributes = {}
    for index, stat in ipairs(primaryStats) do
        if stat ~= "spirit" or forever then
            local _, effective = Read(UnitStat, player, index)
            attributes[stat] = effective
        end
    end
    for stat, name in pairs(characterStats) do
        attributes[stat] = Read(_G[name])
    end

    local _, armor = Read(UnitArmor, player)
    attributes.armor = armor
    local maxHealth = Read(UnitHealthMax, player)
    if maxHealth and maxHealth > 0 then attributes.maxHealth = maxHealth end
    attributes.powerType = Read(UnitPowerType, player)
    attributes.maxPower = Read(UnitPowerMax, player, attributes.powerType)
    attributes.attackPower = AttackPower(UnitAttackPower)
    attributes.rangedAttackPower = AttackPower(UnitRangedAttackPower)
    attributes.mainhandSpeed, attributes.offhandSpeed = Read(UnitAttackSpeed, player)
    attributes.manaRegenPerSecond, attributes.castingManaRegenPerSecond = Read(GetManaRegen)
    attributes.spellHaste = Read(UnitSpellHaste, player)
    attributes.spellPower = SchoolMinimum(GetSpellBonusDamage, attributes, "SpellPower")
    attributes.versatilityDamage = Sum(Read(GetCombatRatingBonus, damageDoneVersatility), Read(GetVersatilityBonus, damageDoneVersatility))
    attributes.versatilityReduction = Sum(Read(GetCombatRatingBonus, damageTakenVersatility), Read(GetVersatilityBonus, damageTakenVersatility))

    if forever then
        attributes.spellCritChance = Read(GetSpellCritChance)
        attributes.rangedHaste = Sum(Read(GetRangedHaste))
        attributes.meleeHit = Sum(Read(GetCombatRatingBonus, meleeHitRating), Read(GetHitModifier))
        attributes.offhandHit = Sum(Read(GetCombatRatingBonus, meleeHitRating), Read(GetOffhandHitModifier))
        attributes.rangedHit = Sum(Read(GetCombatRatingBonus, rangedHitRating), Read(GetRangedHitModifier))
        attributes.spellHit = Sum(Read(GetCombatRatingBonus, spellHitRating), Read(GetSpellHitModifier))
        local defense = Sum(Read(UnitDefenseSkill, player))
        if defense then attributes.defenseSkill = math.max(0, defense) end
        attributes.expertise, attributes.offhandExpertise, attributes.rangedExpertise = Read(GetExpertise)
        for damageClass, school in ipairs(schools) do
            local _, _, effective = Read(UnitResistance, player, damageClass)
            attributes[school .. "Resistance"] = effective
        end
    else
        attributes.spellCritChance = SchoolMinimum(GetSpellCritChance)
    end
    if next(attributes) then return attributes end
end
