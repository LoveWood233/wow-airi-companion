"""Exercise public profile and currency observations on both actual collectors."""
import unittest

from test_addon import LuaRuntime, ROOT


RETAIL = ROOT.parent / "WoWMapCompanion"
MOCK = b'''
Secret = {}
Unreadable = setmetatable({}, {__index = function() error("table access restricted") end})
function issecretvalue(value) return rawequal(value, Secret) end
function canaccesstable(value) return not rawequal(value, Unreadable) end
function GetGuildInfo(unit) assert(unit == "player"); return "Guild", "Leader", 0 end
function IsInGuild() return true end
function GetBindLocation() return "Stormwind" end
function GetAverageItemLevel() return 608.125, 602.75, 612.25 end
function GetCurrentTitle() return 28 end
function GetTitleName(id) assert(id == 28); return "General %s", true end
C_SpecializationInfo = {
    GetSpecialization = function() return 1 end,
    GetSpecializationInfo = function(index) assert(index == 1); return 62, "Arcane", "", 318, "DAMAGER" end,
}
CurrencyRows = {
    { isHeader = true, isHeaderExpanded = true },
    { isHeader = false, currencyID = 25, name = "Valor", quantity = 0, maxQuantity = 500 },
    { isHeader = false, name = "Marks", quantity = 51, isAccountWide = true, maxWeeklyQuantity = 100,
      quantityEarnedThisWeek = 12, isAccountTransferable = false },
    { isHeader = false, currencyID = 31, name = "Undiscovered Currency", quantity = 0, discovered = false },
}
CurrencyDetails = {
    [25] = { name = "Valor", quantity = 10, maxQuantity = 500 },
    [48] = { name = "Tracked Token", quantity = 14, totalEarned = 80 },
}
C_CurrencyInfo = {
    GetCurrencyListSize = function() return #CurrencyRows end,
    GetCurrencyListInfo = function(index) return CurrencyRows[index] end,
    GetCurrencyInfo = function(id) return CurrencyDetails[id] end,
    GetCurrencyListLink = function(index) assert(index == 3); return "currency:10" end,
    GetCurrencyIDFromLink = function(link) assert(link == "currency:10"); return 10 end,
    GetBackpackCurrencyInfo = function(index)
        if index == 1 then return { currencyTypesID = 48, name = "Tracked Token", quantity = 13 } end
    end,
    ExpandCurrencyList = function() error("must not change UI state") end,
    SetCurrencyFilter = function() error("must not change UI state") end,
}
'''


class CharacterProfileTests(unittest.TestCase):
    def load(self, directory):
        lua = LuaRuntime(encoding=None)
        namespace = lua.table()
        load = lua.eval(b"function(source, name, ns) assert(loadstring(source))(name, ns) end")
        for filename in ("Protocol.lua", "CharacterProfile.lua"):
            load((directory / filename).read_bytes(), directory.name.encode(), namespace)
        return lua, namespace[b"CharacterProfile"][b"Capture"]

    def test_captures_zero_currency_balances_and_refreshes_collapsed_entries(self):
        for directory in (ROOT, RETAIL):
            with self.subTest(build=directory.name):
                lua, capture = self.load(directory)
                self.assertIsNone(capture())
                lua.execute(MOCK)
                profile = capture()
                self.assertEqual(profile[b"guildRankIndex"], 0)
                self.assertEqual(profile[b"guild"], b"Guild")
                self.assertEqual(profile[b"bindLocation"], b"Stormwind")
                self.assertEqual(profile[b"equippedItemLevel"], 602.75)
                self.assertEqual(profile[b"titleID"], 28)
                self.assertEqual(profile[b"specializationRole"], b"DAMAGER")
                currencies = profile[b"currencies"]
                rows = list(currencies[b"entries"].values())
                self.assertTrue(currencies[b"complete"])
                self.assertEqual([row[b"id"] for row in rows], [10, 25, 48])
                self.assertEqual(rows[0][b"quantityEarnedThisWeek"], 12)
                self.assertIs(rows[0][b"isAccountTransferable"], False)
                self.assertEqual(rows[1][b"quantity"], 0)
                self.assertEqual(rows[2][b"quantity"], 14)
                lua.execute(b'CurrencyRows = {{ isHeader = true, isHeaderExpanded = false }, Unreadable}')
                currencies = capture(profile)[b"currencies"]
                rows = list(currencies[b"entries"].values())
                self.assertFalse(currencies[b"complete"])
                self.assertEqual([(row[b"id"], row[b"quantity"]) for row in rows], [(25, 10), (48, 14)])

    def test_secret_values_leave_fields_unknown(self):
        for directory in (ROOT, RETAIL):
            with self.subTest(build=directory.name):
                lua, capture = self.load(directory)
                lua.execute(MOCK)
                lua.execute(b'''
                    function GetGuildInfo() return Secret, "", Secret end
                    function GetBindLocation() error("forbidden") end
                    function GetAverageItemLevel() return math.huge, Secret, 0/0 end
                    function IsInGuild() return false end
                    CurrencyRows[2].quantity = Secret
                ''')
                profile = capture()
                self.assertIs(profile[b"inGuild"], False)
                for key in (b"guild", b"guildRank", b"guildRankIndex", b"bindLocation", b"averageItemLevel",
                            b"equippedItemLevel", b"pvpItemLevel"):
                    self.assertIsNone(profile[key])
                currencies = profile[b"currencies"]
                self.assertFalse(currencies[b"complete"])
                self.assertEqual([row[b"id"] for row in currencies[b"entries"].values()], [10, 48])


if __name__ == "__main__":
    unittest.main()
