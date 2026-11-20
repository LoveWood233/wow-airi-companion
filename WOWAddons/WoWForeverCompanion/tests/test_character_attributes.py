"""Exercise both builds' character sheet collectors in Lua 5.1."""
import unittest

from test_addon import LuaRuntime, ROOT


RETAIL = ROOT.parent / "WoWMapCompanion"
MOCK = b'''
Secret = {}
function issecretvalue(value) return rawequal(value, Secret) end
function UnitStat(unit, index)
    assert(unit == "player" and (Forever or index ~= 5))
    return index * 10, index * 10 + 3, 3, 0
end
function UnitArmor(unit) assert(unit == "player"); return 80, 120, 100, 40 end
function UnitHealthMax(unit) assert(unit == "player"); return 80000 end
function UnitPowerType(unit) assert(unit == "player"); return 0, "MANA" end
function UnitPowerMax(unit, power) assert(unit == "player" and power == 0); return 2300 end
function UnitAttackPower(unit) assert(unit == "player"); return 50, 20, -5 end
function UnitRangedAttackPower(unit) assert(unit == "player"); return 10, 0, -12 end
function GetSpellBonusDamage(school) assert(school >= 2 and school <= 7); return school * 10 end
function GetSpellCritChance(school)
    if Forever then assert(school == nil); return 3.75 end
    assert(school >= 2 and school <= 7)
    return (school - 3) ^ 2 + 2.25
end
function GetCritChance() return 11.25 end
function GetBlockChance() return 0 end
function GetDodgeChance() return 4.5 end
function GetHaste() return -2.5 end
function GetMasteryEffect() return 11.5, 1 end
function GetManaRegen() return 2.125, 1.75 end
function GetCombatRatingBonus(index) return ({[6] = 2, [8] = 1, [29] = 4, [31] = 2})[index] end
function GetVersatilityBonus(index) return ({[29] = 1.25, [31] = 0.625})[index] end
function UnitResistance(unit, school) assert(unit == "player" and school <= 6); return 1, 2, school * 3, 4 end
function UnitDefenseSkill(unit) assert(unit == "player"); return 300, -5 end
function GetHitModifier() return 1.5 end
function GetSpellHitModifier() return 2.75 end
function GetRangedHaste() return 4, 1.25 end
function GetExpertise() return 2.5, 3.75, 0 end
'''


class CharacterAttributesTests(unittest.TestCase):
    def load(self, directory):
        lua = LuaRuntime(encoding=None)
        namespace = lua.table()
        load = lua.eval(b"function(source, name, ns) assert(loadstring(source))(name, ns) end")
        for filename in ("Protocol.lua", "CharacterAttributes.lua"):
            load((directory / filename).read_bytes(), directory.name.encode(), namespace)
        lua.globals().Forever = directory == ROOT
        return lua, namespace[b"CharacterAttributes"][b"Capture"]

    def test_effective_public_character_attributes(self):
        for directory in (ROOT, RETAIL):
            with self.subTest(build=directory.name):
                lua, capture = self.load(directory)
                lua.execute(MOCK)
                stats = dict(capture().items())
                self.assertEqual(stats, dict(capture().items()))
                self.assertEqual(stats[b"strength"], 13)
                self.assertEqual(stats[b"agility"], 23)
                self.assertEqual(stats[b"stamina"], 33)
                self.assertEqual(stats[b"intellect"], 43)
                self.assertEqual(stats[b"armor"], 120)
                self.assertEqual(stats[b"maxHealth"], 80000)
                self.assertEqual(stats[b"powerType"], 0)
                self.assertEqual(stats[b"maxPower"], 2300)
                self.assertEqual(stats[b"attackPower"], 65)
                self.assertEqual(stats[b"rangedAttackPower"], 0)
                self.assertEqual(stats[b"critChance"], 11.25)
                self.assertEqual(stats[b"block"], 0)
                self.assertEqual(stats[b"haste"], -2.5)
                self.assertEqual(stats[b"masteryEffect"], 11.5)
                self.assertEqual(stats[b"castingManaRegenPerSecond"], 1.75)
                self.assertEqual(stats[b"spellPower"], 20)
                self.assertEqual(stats[b"fireSpellPower"], 30)
                self.assertEqual(stats[b"versatilityDamage"], 5.25)
                self.assertEqual(stats[b"versatilityReduction"], 2.625)
                if directory == ROOT:
                    self.assertEqual(stats[b"spirit"], 53)
                    self.assertEqual(stats[b"spellCritChance"], 3.75)
                    self.assertEqual(stats[b"fireResistance"], 6)
                    self.assertEqual(stats[b"defenseSkill"], 295)
                    self.assertEqual(stats[b"meleeHit"], 3.5)
                    self.assertEqual(stats[b"spellHit"], 3.75)
                    self.assertEqual(stats[b"rangedHaste"], 5.25)
                    self.assertEqual(stats[b"offhandExpertise"], 3.75)
                else:
                    self.assertEqual(stats[b"spellCritChance"], 2.25)
                    self.assertNotIn(b"spirit", stats)
                    self.assertNotIn(b"fireResistance", stats)

    def test_restricted_or_failed_apis_leave_fields_unknown(self):
        for directory in (ROOT, RETAIL):
            with self.subTest(build=directory.name):
                lua, capture = self.load(directory)
                self.assertIsNone(capture())
                lua.execute(MOCK)
                lua.execute(b'''
                    function UnitStat() return 20, Secret end
                    function UnitArmor() error("forbidden") end
                    function UnitHealthMax() return 0 end
                    function UnitAttackPower() return 50, Secret, -5 end
                    function GetRangedCritChance() return math.huge end
                    function GetCritChance() return 0/0 end
                    function GetParryChance() return "10" end
                    function GetVersatilityBonus() return Secret end
                    function GetSpellBonusDamage(school) if school ~= 4 then return school * 10 end end
                ''')
                stats = dict(capture().items())
                for field in (b"strength", b"armor", b"maxHealth", b"attackPower", b"rangedCritChance",
                              b"critChance", b"parry", b"versatilityDamage", b"versatilityReduction",
                              b"natureSpellPower", b"spellPower"):
                    self.assertNotIn(field, stats)
                self.assertEqual(stats[b"fireSpellPower"], 30)
                self.assertEqual(stats[b"dodge"], 4.5)
                self.assertEqual(stats[b"block"], 0)


if __name__ == "__main__":
    unittest.main()
