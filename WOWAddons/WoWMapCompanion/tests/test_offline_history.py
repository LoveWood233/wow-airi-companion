import json
import unittest
from pathlib import Path
import test_addon
from test_equipment import EQUIPMENT_MOCK


class OfflineHistoryTests(unittest.TestCase):
    def runtime(self, folder):
        root = Path(__file__).resolve().parents[2] / folder
        lua = test_addon.LuaRuntime(encoding=None, unpack_returned_tuples=True)
        lua.execute(test_addon.MOCK)
        if folder == "WoWForeverCompanion": lua.execute(b'function GetBuildInfo() return "1.60.1","build","date",16001 end')
        lua.execute(b'clock=100; function GetTime() return clock end; function GetServerTime() return 1700000000+clock end')
        ns = lua.table()
        for name in ('Protocol.lua', 'Money.lua', 'Equipment.lua', 'Transfer.lua', 'OfflineHistory.lua', 'EquipmentCompare.lua', 'ConfirmEquip.lua', 'Inventory.lua', 'ItemStorage.lua', 'Quests.lua', 'Talents.lua','WeaponSkills.lua', 'Telemetry.lua', folder+'.lua'):
            lua.execute((root/name).read_bytes(), folder.encode(), ns)
        lua.globals().Fire(b'ADDON_LOADED', folder.encode())
        lua.globals().Fire(b'PLAYER_ENTERING_WORLD')
        return lua, ns, root

    def test_money_and_levels_survive_without_any_desktop_and_flush_on_logout(self):
        for folder in ('WoWMapCompanion', 'WoWForeverCompanion'):
            lua, ns, root = self.runtime(folder)
            g = lua.globals()
            lua.execute(b'clock=101; Model.copper=99900; Fire("PLAYER_MONEY"); clock=102; Model.level=30; Fire("PLAYER_LEVEL_UP",30); Fire("PLAYER_LOGOUT")')
            db = g[(folder+'DB').encode()]
            result = json.loads(db[b'snapshotJSON'])
            character = result['offlineHistory']['characters']['Player-1-00000001']
            self.assertEqual(character['money'][0]['deltaCopper'], -100)
            self.assertEqual(character['levels'][-1]['level'], 30)
            self.assertEqual(character['levels'][-1]['durationBasis'], 'partial')
            self.assertEqual(result['offlineHistory']['game'], 'retail' if folder=='WoWMapCompanion' else 'forever')
            # Retain the SavedVariables table while resetting addon runtime, as /reload does.
            lua.execute(test_addon.MOCK)
            if folder == "WoWForeverCompanion": lua.execute(b'function GetBuildInfo() return "1.60.1","build","date",16001 end')
            lua.execute(b'clock=500; function GetTime() return clock end; function GetServerTime() return 1700000000+clock end; Model.level=30; Model.copper=99900')
            second = lua.table()
            for name in ('Protocol.lua','Money.lua','Equipment.lua','Transfer.lua','OfflineHistory.lua','EquipmentCompare.lua','ConfirmEquip.lua','Inventory.lua', 'ItemStorage.lua','Quests.lua','Talents.lua','WeaponSkills.lua','Telemetry.lua',folder+'.lua'):
                lua.execute((root/name).read_bytes(), folder.encode(), second)
            g.Fire(b'ADDON_LOADED', folder.encode()); g.Fire(b'PLAYER_ENTERING_WORLD')
            lua.execute(b'clock=501; Model.copper=99850; Fire("PLAYER_MONEY"); Fire("PLAYER_LOGOUT")')
            result = json.loads(db[b'snapshotJSON'])
            money = result['offlineHistory']['characters']['Player-1-00000001']['money']
            self.assertEqual([row['deltaCopper'] for row in money], [-100, -50])
            self.assertEqual([row['id'] for row in money], [1, 2])

    def test_large_balances_multicharacter_and_json_do_not_change_grid_budget(self):
        lua, ns, _ = self.runtime('WoWMapCompanion')
        record = lua.eval(b'function() local slots={}; for i=1,19 do slots[i]={slot=i,state="empty"} end; return {v=1,id=1,guid="Player-1-00000001",session=WoWMapCompanionDB.snapshot.session,observedAt=GetServerTime(),reason="login",slots=slots} end')()
        ns.OfflineHistory.Equipment(record)
        lua.execute(b'Model.copper=9007199254740991; Fire("PLAYER_MONEY"); Fire("PLAYER_LOGOUT")')
        db = lua.globals().WoWMapCompanionDB
        result = json.loads(db[b'snapshotJSON'])
        self.assertEqual(result['offlineHistory']['characters']['Player-1-00000001']['snapshot']['copper'],9007199254740991)
        self.assertIsNone(result['offlineHistory']['characters']['Player-1-00000001']['equipment']['slots'][0]['item'])
        self.assertEqual(len(ns.Protocol.Encode(db[b'snapshot'])[0]),512)
        lua.execute(b'Model.guid="Player-2"; Model.copper=50; Fire("PLAYER_ENTERING_WORLD"); Fire("PLAYER_LOGOUT")')
        result = json.loads(db[b'snapshotJSON'])
        self.assertEqual(len(result['offlineHistory']['characters']),2)
        self.assertEqual(result['offlineHistory']['balanceCopper'], '9007199254741041')

    def test_complete_toc_resaves_latest_per_character_data_after_world_access_ends(self):
        for folder in ('WoWMapCompanion', 'WoWForeverCompanion'):
            with self.subTest(folder=folder):
                root = Path(__file__).resolve().parents[2] / folder
                lua = test_addon.LuaRuntime(encoding=None, unpack_returned_tuples=True)
                files = [line.strip() for line in (root / (folder + '.toc')).read_text(encoding='utf-8-sig').splitlines()
                         if line.strip().endswith('.lua')]

                def load_addon():
                    lua.execute(test_addon.MOCK)
                    lua.execute(EQUIPMENT_MOCK)
                    lua.execute(b'''
function GetBuildInfo() return "1.60.1","build","date",16001 end
function GetServerTime() return 1700000000 + math.floor(Now) end
function UnitStat(unit, index) return 100, 100 + index end
function UnitXP() return Model.xp end
function UnitXPMax() return 1000 end
function IsInGuild() return false end
C_Item.DoesItemExist=function(location)
 if location.inventory then return Inventory[location.slot] ~= nil end
 return Bags[location.bag] ~= nil and Bags[location.bag][location.slot] ~= nil
end
local numSlots=C_Container.GetContainerNumSlots
C_Container.GetContainerNumSlots=function(bag) return bag==-1 and 2 or numSlots(bag) end
NUM_BAG_SLOTS, BANK_CONTAINER = 5, -1
Bags[-1]={[1]=NewItem(31,"Item-bank","Last known bank item")}
C_QuestLog={
 GetNumQuestLogEntries=function() return 1,1 end,
 GetInfo=function() return {questID=42,isHeader=false,title="Active quest",level=29} end,
 GetAllCompletedQuestIDs=function() local ids={}; for i=1,600 do ids[i]=i end; return ids end,
}
Enum={SpellBookSpellBank={Player=0},SpellBookItemType={Spell=1,FutureSpell=2,Flyout=4}}
function GetNumLanguages() return 1 end
function GetLanguageByIndex() return "Common",7 end
function GetProfessions() return nil,nil,nil,1 end
function GetProfessionInfo() return "Fishing",1,27,75,1,6,356,0 end
local spellRows={
 {itemType=1,actionID=100,spellID=101,isOffSpec=false,isPassive=false,name="Attack",subName="Rank 2"},
 {itemType=2,actionID=102,isOffSpec=false,name="Future"},
 {itemType=1,actionID=103,isOffSpec=true,name="Other specialization"},
 {itemType=4,actionID=104,isOffSpec=false,name="Teleports"},
 {itemType=1,actionID=105,isOffSpec=false,isPassive=true,name="Passive"},
 {itemType=1,actionID=106,isOffSpec=false,isPassive=false,name="Unlearned"},
 {itemType=1,actionID=107,isOffSpec=false,isPassive=false,name="Cast fishing line"},
}
C_SpellBook={
 GetNumSpellBookSkillLines=function() return 1 end,
 GetSpellBookSkillLineInfo=function() return {name="General",itemIndexOffset=0,numSpellBookItems=6} end,
 GetSpellBookItemInfo=function(slot,bank) assert(bank==0); return spellRows[slot] end,
 IsSpellKnown=function(id,bank) assert(bank==0); return id~=106 end,
}
function GetFlyoutInfo() return "Teleports","",3,true end
function GetFlyoutSlotInfo(id,slot)
 if slot==1 then return 1041,1042,true,"Teleport",64 end
 if slot==2 then return 1043,1043,false,"Unlearned teleport",64 end
 return 1044,1044,true,"Other specialization teleport",62
end
''')
                    namespace = lua.table()
                    for file in files:
                        lua.execute((root / file).read_bytes(), folder.encode(), namespace)
                    lua.globals().NS = namespace
                    lua.globals().Fire(b'ADDON_LOADED', folder.encode())

                load_addon()
                lua.execute(b'''
Inventory[5]=NewItem(11,"Item-old","Before equipment change")
Fire("PLAYER_ENTERING_WORLD",true,false)
Fire("BANKFRAME_OPENED")
AdvanceTime(4)
Fire("BANKFRAME_CLOSED")
local pushes=0
for _, name in ipairs({"SetGear","SetQuests","SetInventory","SetWeaponSkills","SetStorage","SetArchive"}) do
 local original=NS.Transfer[name]
 NS.Transfer[name]=function(row,...) if row then pushes=pushes+1 end; return original(row,...) end
end
Inventory[5]=NewItem(12,"Item-new","After equipment change")
Bags[0][1]=NewItem(21,"Item-bag","Material")
Bags[0][1].quantity=7
Model.copper, Model.xp = 99875, 250
Fire("PLAYER_EQUIPMENT_CHANGED")
Fire("BAG_UPDATE_DELAYED")
Fire("PLAYER_LEAVING_WORLD")
Model.guid, Model.name, Model.map, Model.zone = nil, nil, nil, "Loading"
Fire("PLAYER_LOGOUT")
assert(pushes==0)
''')
                db = lua.globals()[(folder + 'DB').encode()]
                character = json.loads(db[b'snapshotJSON'])['offlineHistory']['characters']['Player-1-00000001']
                self.assertFalse(character['snapshot']['online'])
                self.assertEqual(character['snapshot']['map'], 84)
                self.assertEqual(character['snapshot']['copper'], 99875)
                self.assertEqual(character['money'][-1]['deltaCopper'], -125)
                self.assertEqual(character['equipment']['slots'][4]['item']['itemID'], 12)
                self.assertEqual(character['attributes']['data']['strength'], 101)
                self.assertFalse(character['profile']['data']['inGuild'])
                self.assertEqual(character['itemStorage']['bags:0']['slots'][0]['quantity'], 7)
                self.assertEqual(character['itemStorage']['bank:-1']['slots'][0]['item']['itemID'], 31)
                self.assertEqual(character['inventory']['items'][0], {'itemID': 21, 'quantity': 7})
                self.assertEqual(character['quests']['log']['entries'][0]['questID'], 42)
                self.assertEqual(len(character['quests']['completion']['ids']), 600)
                self.assertEqual(character['characterArchive']['progress']['data']['xp'], 250)
                profession = character['characterArchive']['professions']['data']['entries'][0]
                self.assertEqual((profession['name'], profession['rank']), ('Fishing', 27))
                spellbook = character['spellbook']['data']
                self.assertTrue(spellbook['complete'])
                self.assertEqual([spell['baseSpellID'] for spell in spellbook['entries']], [100, 105, 107, 1041])
                self.assertEqual(spellbook['entries'][0]['spellID'], 101)
                self.assertEqual(spellbook['entries'][0]['rankText'], 'Rank 2')
                self.assertTrue(spellbook['entries'][1]['passive'])
                self.assertEqual(spellbook['entries'][2]['category'], 'Fishing')
                self.assertEqual(character['languages']['data']['entries'], [{'id': 7, 'name': 'Common'}])

                load_addon()
                lua.execute(b'''
Model.guid, Model.name, Model.copper = "Player-2", "Different character", 10
Fire("PLAYER_ENTERING_WORLD",true,false)
Fire("PLAYER_LOGOUT")
''')
                history = json.loads(db[b'snapshotJSON'])['offlineHistory']
                self.assertEqual(history['characters']['Player-1-00000001'], character)
                self.assertEqual(history['characters']['Player-2']['snapshot']['name'], 'Different character')

    def test_incomplete_spellbook_keeps_one_same_spec_complete_observation(self):
        lua, ns, _ = self.runtime('WoWMapCompanion')
        lua.execute(b'''
local history = ...
local guid = Model.guid
history.Save(guid,"spellbook",{observedAt=10,data={complete=true,specID=64,entries={{spellID=42}}}})
history.Save(guid,"spellbook",{observedAt=20,data={complete=false,specID=64,entries={}}})
history.Save(guid,"spellbook",{observedAt=30,data={complete=false,specID=64,entries={{spellID=43}}}})
Fire("PLAYER_LOGOUT")
''', ns.OfflineHistory)
        archive = json.loads(lua.globals().WoWMapCompanionDB[b'snapshotJSON'])['offlineHistory']
        spellbook = archive['characters']['Player-1-00000001']['spellbook']
        self.assertEqual(spellbook['data']['entries'], [{'spellID': 43}])
        self.assertEqual(spellbook['lastComplete']['observedAt'], 10)
        self.assertEqual(spellbook['lastComplete']['data']['entries'], [{'spellID': 42}])
        self.assertNotIn('lastComplete', spellbook['lastComplete'])


if __name__ == '__main__':
    unittest.main()
