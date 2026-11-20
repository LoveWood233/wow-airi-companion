"""Check skill coverage and language observations using the real addon Lua."""
import unittest

from test_addon import LuaRuntime, ROOT


RETAIL = ROOT.parent / "WoWMapCompanion"
LANGUAGES = b'''
Secret = {}
function issecretvalue(value) return rawequal(value, Secret) end
function GetNumLanguages() return 2 end
function GetLanguageByIndex(index)
    if index == 1 then return "Darnassian", 2 end
    return "Common", 7
end
'''
SKILLS = b'''
Rows = {
    { isHeader = true, isCollapsed = false, skillID = 9 },
    { isHeader = false, skillID = 762, name = "Riding", rank = 75, maxRank = 75, modifier = 0, tempPoints = 0 },
    { isHeader = false, skillID = 356, name = "Fishing", rank = 30, maxRank = 75, modifier = -1, tempPoints = 5,
      parentSkillLineID = 900, skillLineCategoryID = 9 },
    { isHeader = false, skillID = 197, name = "Static metadata", rank = 0, maxRank = 0 },
}
OtherRows = {
    [356] = { isHeader = false, skillID = 356, name = "Fishing", rank = 42, maxRank = 75 },
    [762] = { isHeader = false, skillID = 763, name = "Mismatched ID", rank = 75, maxRank = 75 },
}
C_SkillInfo = {
    GetNumSkillLines = function() return #Rows end,
    GetSkillLineInfo = function(index) return Rows[index] end,
    GetSkillLineInfoByID = function(id) return OtherRows[id] end,
    ExpandSkillHeader = function() error("must not change UI state") end,
    CollapseSkillHeader = function() error("must not change UI state") end,
}
'''


class CharacterSkillLineTests(unittest.TestCase):
    def load(self, directory):
        lua = LuaRuntime(encoding=None)
        namespace = lua.table()
        load = lua.eval(b"function(source, name, ns) assert(loadstring(source))(name, ns) end")
        for filename in ("Protocol.lua", "CharacterSkillLines.lua"):
            load((directory / filename).read_bytes(), directory.name.encode(), namespace)
        return lua, namespace[b"CharacterSkillLines"][b"Capture"]

    def test_read_ranked_forever_skills_and_refresh_collapsed_rows(self):
        lua, capture = self.load(ROOT)
        lua.execute(LANGUAGES)
        lua.execute(SKILLS)
        skills = capture()
        self.assertTrue(skills[b"complete"])
        fish, riding = skills[b"entries"].values()
        self.assertEqual(fish[b"skillLineID"], 356)
        self.assertEqual(fish[b"parentSkillLineID"], 900)
        self.assertEqual(fish[b"categoryID"], 9)
        self.assertEqual(fish[b"modifier"], -1)
        self.assertEqual(fish[b"temporary"], 5)
        self.assertEqual(riding[b"rank"], 75)
        self.assertEqual(skills[b"languages"][b"entries"][1][b"name"], b"Darnassian")

        lua.execute(b'Rows = {{ isHeader = true, isCollapsed = true }, Secret}')
        updated = capture(skills)
        self.assertFalse(updated[b"complete"])
        rows = list(updated[b"entries"].values())
        self.assertEqual([(row[b"skillLineID"], row[b"rank"]) for row in rows], [(356, 42)])
        self.assertIsNone(rows[0][b"modifier"])

    def test_retail_languages_do_not_claim_rank_coverage(self):
        lua, capture = self.load(RETAIL)
        self.assertIsNone(capture())
        lua.execute(LANGUAGES)
        result = capture()
        self.assertIsNone(result[b"entries"])
        self.assertTrue(result[b"languages"][b"complete"])
        self.assertEqual([row[b"id"] for row in result[b"languages"][b"entries"].values()], [2, 7])

        lua.execute(b'function GetLanguageByIndex(index) if index == 1 then return "Darnassian", 2 end; return Secret end')
        result = capture()
        self.assertFalse(result[b"languages"][b"complete"])
        self.assertEqual([row[b"id"] for row in result[b"languages"][b"entries"].values()], [2])


if __name__ == "__main__":
    unittest.main()
