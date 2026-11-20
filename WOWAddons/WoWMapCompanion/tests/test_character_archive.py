"""Validate public character archive observations on the actual Lua module."""
import unittest

from test_addon import LuaRuntime, MOCK, ROOT
from test_equipment import EQUIPMENT_MOCK


ARCHIVE_MOCK = b'''
Owner={session="archive-session",guid=Model.guid,online=true}
Database={characterArchive={version=1,characters={}}}
Database.characterArchive.characters[Model.guid]={}
Captures={}
LocalCaptures={}
local function Record(captures,section,data,observedAt)
 local current=Database.characterArchive.characters[Owner.guid]
 current[section]={data=data,observedAt=observedAt}
 captures[#captures+1]=section
 return true
end
NS.CharacterArchive.Initialize(Owner, Database,
 function(...) return Record(Captures,...) end,
 function(...) return Record(LocalCaptures,...) end)
function GetServerTime() return 1700000000+math.floor(GetTime()) end
function GetProfessions() return 3,nil,nil,7 end
function GetProfessionInfo(index)
 if index==3 then return "Blacksmithing",123,20,100,1,1,164 end
 if index==7 then return "Fishing",456,12,100,1,1,356 end
end
RecipeIDs={100,200}
Learned={[100]=true,[200]=false}
ProfessionSource=164
C_TradeSkillUI={
 IsTradeSkillReady=function() return ProfessionReady~=false end,
 IsTradeSkillLinked=function() return LinkedProfession==true end,
 IsTradeSkillGuild=function() return false end,
 IsTradeSkillGuildMember=function() return GuildProfession==true end,
 IsNPCCrafting=function() return NPCProfession==true end,
 GetBaseProfessionInfo=function() return {professionID=ProfessionSource} end,
 GetProfessionInfoByRecipeID=function(id)
  if id==300 then return {professionID=2822,parentProfessionID=164} end
 end,
 GetAllRecipeIDs=function() return RecipeIDs end,
 GetFilteredRecipeIDs=function() return RecipeIDs end,
 GetRecipeInfo=function(id)
  if id==UnreadableRecipe then return Secret end
  return {learned=Learned[id]}
 end
}
Achievements={
 [1]={101,true,true,false},
 [2]={102,true,false,false},
 [3]={103,true,true,true},
 [4]={104,false,false,false},
}
function GetCategoryList() return {90} end
function GetCategoryNumAchievements(category) assert(category==90); return AchievementCount or 4 end
function GetAchievementInfo(category,row)
 local a
 if row then assert(category==90); a=Achievements[row]
 else
  for _, candidate in pairs(Achievements) do if candidate[1]==category then a=candidate; break end end
 end
 if a then return a[1],"Achievement",10,a[2],1,1,24,"Description",0,0,"",a[4],a[3] end
end
C_Map.GetPlayerMapPosition=function(id,unit) return Position end
Position={}
ExploredAreas={21}
ExploredOverlays={{},{}}
C_MapExplorationInfo={
 GetExploredAreaIDsAtPosition=function(id,position)
  assert(id==Model.map and position==Position)
  return ExploredAreas
 end,
 GetExploredMapTextures=function(id) assert(id==Model.map); return ExploredOverlays end,
}
'''


class CharacterArchiveTests(unittest.TestCase):
    def setUp(self):
        self.lua = LuaRuntime(encoding=None, unpack_returned_tuples=True)
        for source in (MOCK, EQUIPMENT_MOCK):
            self.lua.execute(source)
        self.ns, self.g = self.lua.table(), self.lua.globals()
        self.g.NS = self.ns
        load = self.lua.eval(b'function(source,name,ns) assert(loadstring(source))(name,ns) end')
        for filename in ('Protocol.lua', 'CharacterArchive.lua'):
            load((ROOT / filename).read_bytes(), ROOT.name.encode(), self.ns)
        self.lua.execute(ARCHIVE_MOCK)
        self.collector = self.ns[b'CharacterArchive']
        self.collector[b'Enter']()
        self.g.AdvanceTime(2)

    def record(self, section):
        return self.g.Database[b'characterArchive'][b'characters'][self.g.Model[b'guid']][section]

    def entries(self):
        return self.record(b'professions')[b'data'][b'entries']

    def event(self, event, seconds=1):
        self.collector[b'OnEvent'](event)
        self.g.AdvanceTime(seconds)

    def test_archives_only_learned_recipes_from_own_open_profession(self):
        entries = self.entries()
        self.assertEqual([entry[b'id'] for entry in entries.values()], [164, 356])
        self.assertEqual(entries[1][b'rank'], 20)
        self.assertIsNone(entries[1][b'recipes'])
        self.lua.execute(b'LinkedProfession=true')
        self.event(b'TRADE_SKILL_SHOW')
        self.assertIsNone(self.entries()[1][b'recipes'])
        self.lua.execute(b'LinkedProfession=false; GuildProfession=true')
        self.event(b'TRADE_SKILL_LIST_UPDATE')
        self.assertIsNone(self.entries()[1][b'recipes'])
        self.lua.execute(b'GuildProfession=false; NPCProfession=true')
        self.event(b'TRADE_SKILL_LIST_UPDATE')
        self.assertIsNone(self.entries()[1][b'recipes'])
        self.lua.execute(b'NPCProfession=false')
        self.event(b'TRADE_SKILL_LIST_UPDATE')
        self.assertEqual(list(self.entries()[1][b'recipes'].values()), [100])
        self.assertIsNone(self.entries()[2][b'recipes'])
        captured = self.entries()[1][b'recipesObservedAt']
        self.event(b'TRADE_SKILL_LIST_UPDATE')
        self.assertEqual(self.entries()[1][b'recipesObservedAt'], captured)

    def test_preserves_dated_recipes_across_reload_until_observed_again(self):
        self.event(b'TRADE_SKILL_SHOW')
        captured = self.entries()[1][b'recipesObservedAt']
        self.event(b'PLAYER_LOGOUT')
        self.g.Owner[b'session'] = b'next-session'
        self.collector[b'Enter']()
        self.g.AdvanceTime(2)
        self.assertEqual(list(self.entries()[1][b'recipes'].values()), [100])
        self.assertEqual(self.entries()[1][b'recipesObservedAt'], captured)
        self.lua.execute(b'UnreadableRecipe=100')
        self.event(b'TRADE_SKILL_SHOW')
        self.assertEqual(list(self.entries()[1][b'recipes'].values()), [100])
        self.assertEqual(self.entries()[1][b'recipesObservedAt'], captured)

    def test_filtered_fallback_adds_learned_recipes_without_removing_hidden_rows(self):
        self.event(b'TRADE_SKILL_SHOW')
        self.lua.execute(b'C_TradeSkillUI.GetAllRecipeIDs=nil; RecipeIDs={200}; Learned[200]=true')
        self.event(b'TRADE_SKILL_LIST_UPDATE')
        self.assertEqual(list(self.entries()[1][b'recipes'].values()), [100, 200])
        self.lua.execute(b'RecipeIDs={}')
        self.event(b'TRADE_SKILL_LIST_UPDATE')
        self.assertEqual(list(self.entries()[1][b'recipes'].values()), [100, 200])

    def test_archives_character_achievements_and_preserves_verified_rows_on_partial_reads(self):
        before = self.record(b'achievements')[b'data']
        self.assertTrue(before[b'complete'])
        self.assertEqual(list(before[b'earnedIds'].values()), [101])
        self.lua.execute(b'Achievements[1]=nil; Achievements[4]={104,true,true,false}')
        self.event(b'ACHIEVEMENT_EARNED')
        after = self.record(b'achievements')[b'data']
        self.assertFalse(after[b'complete'])
        self.assertEqual(list(after[b'earnedIds'].values()), [101, 104])
        captured = self.record(b'achievements')[b'observedAt']
        self.lua.execute(b'Achievements={}')
        self.event(b'RECEIVED_ACHIEVEMENT_LIST')
        self.assertEqual(self.record(b'achievements')[b'observedAt'], captured)

    def test_exploration_keeps_observed_areas_per_map_across_new_observations(self):
        first_map = self.record(b'exploration')[b'data'][b'maps'][1]
        self.assertEqual(first_map[b'mapId'], 84)
        self.assertEqual(first_map[b'overlayCount'], 2)
        self.assertEqual(list(first_map[b'areaIds'].values()), [21])
        self.lua.execute(b'ExploredAreas={32}; ExploredOverlays=Secret')
        self.event(b'MAP_EXPLORATION_UPDATED')
        first_map = self.record(b'exploration')[b'data'][b'maps'][1]
        self.assertEqual(first_map[b'overlayCount'], 2)
        self.assertEqual(list(first_map[b'areaIds'].values()), [21, 32])
        self.lua.execute(b'Model.map=85; Model.zone="Orgrimmar"; ExploredAreas={56}; ExploredOverlays={{}}')
        self.event(b'ZONE_CHANGED_NEW_AREA')
        maps = self.record(b'exploration')[b'data'][b'maps']
        self.assertEqual([record[b'name'] for record in maps.values()], [b'Stormwind', b'Orgrimmar'])
        self.assertEqual(list(maps[2][b'areaIds'].values()), [56])

    def test_cancel_inflight_recipe_scan_when_the_panel_closes(self):
        self.lua.execute(b'RecipeIDs={}; for i=1,220 do RecipeIDs[i]=i; Learned[i]=true end')
        self.event(b'TRADE_SKILL_SHOW', .35)
        self.assertEqual(len(self.entries()[1][b'recipes']), 100)
        self.lua.execute(b'ProfessionReady=false')
        self.event(b'TRADE_SKILL_CLOSE')
        self.assertEqual(len(self.entries()[1][b'recipes']), 100)
        self.lua.execute(b'ProfessionReady=true')
        self.event(b'TRADE_SKILL_SHOW')
        self.assertEqual(len(self.entries()[1][b'recipes']), 220)

    def test_recipe_learning_is_saved_immediately_without_opening_the_panel(self):
        wire_count = len(self.g.Captures)
        self.collector[b'OnEvent'](b'NEW_RECIPE_LEARNED', 300)
        self.assertEqual(list(self.entries()[1][b'recipes'].values()), [300])
        self.assertEqual(len(self.g.Captures), wire_count)
        self.collector[b'Flush']()
        self.event(b'PLAYER_LOGOUT')
        self.assertEqual(list(self.entries()[1][b'recipes'].values()), [300])

    def test_final_scan_keeps_verified_rows_on_both_sides_of_an_unreadable_recipe(self):
        self.event(b'TRADE_SKILL_SHOW')
        self.lua.execute(b'RecipeIDs={100,200,300}; UnreadableRecipe=200; Learned[100]=false; Learned[300]=true')
        self.collector[b'Flush']()
        self.assertEqual(list(self.entries()[1][b'recipes'].values()), [100, 300])

    def test_open_profession_saves_expansion_rank_and_specialization_details_locally(self):
        self.lua.execute(b'''
C_TradeSkillUI.GetChildProfessionInfos=function()
 return {{professionID=2822,parentProfessionID=164,professionName="Blacksmithing",expansionName="Khaz Algar",skillLevel=42,maxSkillLevel=100}}
end
Enum={ProfessionsSpecTabState={Locked=0,Unlocked=1,Unlockable=2}}
C_ProfSpecs={
 SkillLineHasSpecialization=function(id) return id==2822 end,
 GetConfigIDForSkillLine=function() return 100 end,
 GetSpecTabIDsForSkillLine=function() return {201,202} end,
 GetTabInfo=function(id) return {name=id==201 and "Armor" or "Weapons"} end,
 GetStateForTab=function(id,config) assert(config==100); return id==201 and 1 or 2 end,
}
''')
        self.event(b'TRADE_SKILL_SHOW', 0)
        detail = self.record(b'professionDetails')[b'data'][b'entries'][1]
        self.assertEqual(detail[b'id'], 164)
        tier = detail[b'tiers'][1]
        self.assertEqual((tier[b'expansion'], tier[b'rank'], tier[b'maxRank']), (b'Khaz Algar', 42, 100))
        self.assertEqual(tier[b'specializations'][1][b'name'], b'Armor')
        self.assertTrue(tier[b'specializations'][1][b'unlocked'])
        self.assertFalse(tier[b'specializations'][2][b'unlocked'])
        self.assertNotIn(b'professionDetails', list(self.g.Captures.values()))
        self.lua.execute(b'ProfessionReady=false')
        self.event(b'TRADE_SKILL_CLOSE')
        self.collector[b'Flush']()
        current = self.record(b'professionDetails')[b'data'][b'entries'][1]
        self.assertEqual(current[b'tiers'][1][b'rank'], 42)

    def test_flush_is_local_and_preserves_verified_work_without_waiting_for_timers(self):
        self.lua.execute(b'''
RecipeIDs={}; for i=1,220 do RecipeIDs[i]=i; Learned[i]=true end
Achievements[4]={104,true,true,false}; ExploredAreas={32}
''')
        self.event(b'TRADE_SKILL_SHOW', .35)
        self.collector[b'OnEvent'](b'ACHIEVEMENT_EARNED', 104)
        self.collector[b'OnEvent'](b'MAP_EXPLORATION_UPDATED')
        wire_count = len(self.g.Captures)
        self.collector[b'Flush']()
        self.assertEqual(len(self.g.Captures), wire_count)
        self.assertEqual(len(self.entries()[1][b'recipes']), 220)
        self.assertEqual(list(self.record(b'achievements')[b'data'][b'earnedIds'].values()), [101, 104])
        self.assertEqual(list(self.record(b'exploration')[b'data'][b'maps'][1][b'areaIds'].values()), [21, 32])


class LowFrequencyTests(unittest.TestCase):
    def setUp(self):
        self.lua = LuaRuntime(encoding=None, unpack_returned_tuples=True)
        self.lua.execute(MOCK)
        self.ns, self.g = self.lua.table(), self.lua.globals()
        self.g.NS = self.ns
        load = self.lua.eval(b'function(source,name,ns) assert(loadstring(source))(name,ns) end')
        for filename in ('Protocol.lua', 'LowFrequency.lua'):
            load((ROOT / filename).read_bytes(), ROOT.name.encode(), self.ns)
        self.lua.execute(b'''
Owner={guid=Model.guid,online=true,level=29,copper=100000,earned=200,spent=100,moneyEpoch="ledger"}
Database={money={account="account"}}
Attempts=0
NS.Transfer={ArchiveDataJSON=function() return "record" end,
 SetArchive=function() Attempts=Attempts+1; return false end}
NS.LowFrequency.Initialize(Owner,Database)
function UnitXP() return 500 end
function UnitXPMax() return 5000 end
function GetXPExhaustion() return 40 end
''')
        self.module = self.ns[b'LowFrequency']

    def record(self, section):
        return self.g.Database[b'characterArchive'][b'characters'][self.g.Model[b'guid']][section][b'data']

    def test_persists_locally_when_wire_transfer_rejects_data(self):
        self.assertFalse(self.module[b'Submit'](b'progress', self.lua.table_from({b'xp': 150})))
        self.assertEqual(self.g.Attempts, 1)
        self.assertEqual(self.record(b'progress')[b'xp'], 150)

    def test_final_progress_merges_only_with_same_level_and_money_epoch(self):
        self.module[b'Flush']()
        self.lua.execute(b'''
function UnitXP() return Secret end
function GetXPExhaustion() return 0 end
Owner.copper=nil
''')
        self.module[b'Flush']()
        data = self.record(b'progress')
        self.assertEqual(data[b'xp'], 500)
        self.assertEqual(data[b'copper'], b'100000')
        self.assertEqual(data[b'restedXP'], 0)
        self.lua.execute(b'Owner.level=30; Owner.moneyEpoch="other"; Owner.earned=nil; Owner.spent=nil; GetXPExhaustion=nil')
        self.module[b'Flush']()
        data = self.record(b'progress')
        self.assertEqual(data[b'level'], 30)
        for field in (b'xp', b'xpMax', b'earned', b'spent', b'restedXP'):
            self.assertIsNone(data[field])
        self.assertEqual(self.g.Attempts, 0)

    def test_unloaded_zero_lockout_count_keeps_last_confirmed_rows(self):
        self.lua.execute(b'''
function RequestRaidInfo() end
function GetNumSavedInstances() return PendingCount or 1 end
function GetSavedInstanceInfo() return "A raid",1,3600,2,true,false end
''')
        self.module[b'Flush']()
        self.assertEqual(len(self.record(b'lockouts')[b'entries']), 1)
        self.module[b'Tick']()
        self.lua.execute(b'PendingCount=0')
        self.module[b'Flush']()
        self.assertEqual(len(self.record(b'lockouts')[b'entries']), 1)
        self.module[b'OnEvent'](b'UPDATE_INSTANCE_INFO')
        self.assertEqual(len(self.record(b'lockouts')[b'entries']), 0)


if __name__ == '__main__':
    unittest.main()
