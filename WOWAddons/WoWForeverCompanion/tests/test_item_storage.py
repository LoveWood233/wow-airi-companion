"""Execute real container capture, instance detail collection and wire encoding."""
import base64
import binascii
import json
import struct
import unittest

from test_addon import LuaRuntime, MOCK, ROOT
from test_equipment import EQUIPMENT_MOCK


class ItemStorageTests(unittest.TestCase):
    def setUp(self):
        self.lua = LuaRuntime(encoding=None, unpack_returned_tuples=True)
        self.lua.execute(MOCK)
        self.lua.execute(EQUIPMENT_MOCK)
        self.ns, self.g = self.lua.table(), self.lua.globals()
        self.g.NS = self.ns
        load = self.lua.eval(b'function(source,name,ns) assert(loadstring(source))(name,ns) end')
        for file in ('Protocol.lua', 'Transfer.lua', 'Equipment.lua', 'ItemStorage.lua'):
            load((ROOT / file).read_bytes(), ROOT.name.encode(), self.ns)
        self.lua.execute(b'''
Owner={session="test-session",guid=Model.guid}; Database={}; Captures={}; BankAccessible=false
Enum={BankType={Character=0,Account=2}}
C_Bank={CanViewBank=function() return BankAccessible end,FetchPurchasedBankTabIDs=function(kind) return kind==0 and {6,7} or {12} end}
local original=NS.Transfer.SetStorage
NS.Transfer.SetStorage=function(record)
 local accepted=original(record)
 if accepted then Captures[#Captures+1]=NS.Transfer.StorageJSON(record) end
 return accepted
end
NS.Equipment.Initialize(Owner,function() end,function() end)
NS.ItemStorage.Initialize(Owner,Database)
''')

    def fire(self, event):
        self.ns[b'ItemStorage'][b'OnEvent'](event.encode())
        self.g.AdvanceTime(3)

    def records(self):
        return [json.loads(value) for value in self.g.Captures.values()]

    def test_preserves_same_id_item_variants_attributes_tooltips_and_locations(self):
        self.lua.execute(b'''local a=NewItem(10,"Item-A","First"); local b=NewItem(10,"Item-B","Second")
Bags[0][1]=a; Bags[0][2]=b''')
        self.fire('PLAYER_ENTERING_WORLD')
        record = next(record for record in self.records() if record['container'] == 0)
        first, second = record['slots'][:2]
        self.assertEqual(first['item']['itemID'], second['item']['itemID'])
        self.assertNotEqual(first['item']['itemGUID'], second['item']['itemGUID'])
        self.assertNotEqual(first['item']['link'], second['item']['link'])
        self.assertTrue(first['item']['stats'])
        self.assertTrue(first['item']['tooltip'])
        self.assertEqual(first['quantity'], 1)
        self.assertEqual(record['slots'][2]['state'], 'empty')
        self.assertFalse(any(record['scope'] != 'bags' for record in self.records()))
        (ROOT / 'tests/fixtures/lua-item-storage.json').write_text(json.dumps(record, ensure_ascii=False), encoding='utf-8')

    def test_reads_purchased_character_and_account_tabs_only_when_bank_is_viewable(self):
        # Use explicit numeric results, including nonempty first slots in both bank kinds.
        self.lua.execute(b'''C_Container.GetContainerNumSlots=function(bag) if bag==6 or bag==7 or bag==12 then return 2 else return 0 end end
Bags[6]={[1]=NewItem(20,"Bank-A","Bank")}; Bags[12]={[1]=NewItem(21,"Shared-A","Shared")}''')
        self.fire('PLAYER_ENTERING_WORLD')
        self.assertFalse(any(record['scope'] != 'bags' for record in self.records()))
        self.lua.execute(b'BankAccessible=true')
        self.fire('BANKFRAME_OPENED')
        bank = [record for record in self.records() if record['scope'] == 'bank']
        shared = [record for record in self.records() if record['scope'] == 'account-bank']
        self.assertEqual({record['container'] for record in bank}, {6, 7})
        self.assertEqual(shared[0]['slots'][0]['item']['name'], 'Shared')
        count = len(self.records())
        self.lua.execute(b'BankAccessible=false')
        self.fire('BANKFRAME_CLOSED')
        self.fire('BAG_UPDATE_DELAYED')
        self.assertEqual(len(self.records()), count)

    def test_unknown_slots_are_not_empty_and_unchanged_containers_do_not_requeue(self):
        self.lua.execute(b'''local original=C_Container.GetContainerItemInfo
C_Container.GetContainerItemInfo=function(bag,slot) if bag==0 and slot==1 then return Secret end return original(bag,slot) end''')
        self.fire('PLAYER_ENTERING_WORLD')
        record = next(record for record in self.records() if record['container'] == 0)
        self.assertFalse(record['complete'])
        self.assertEqual(record['slots'][0]['state'], 'unknown')
        count = len(self.records())
        self.fire('BAG_UPDATE_DELAYED')
        self.assertEqual(len(self.records()), count)

    def test_collects_nonequipment_and_retries_bank_metadata_without_publishing_an_empty_bank(self):
        self.lua.execute(b'''local item=NewItem(55,"Material-A","Material"); item.class=7; Bags[0][1]=item
local original=C_Item.GetItemInfo
C_Item.GetItemInfo=function(link) local name,_,quality,level,required=original(link); return name,link,quality,level,required,"Trade Goods","Metal",20,"" end
''')
        self.fire('PLAYER_ENTERING_WORLD')
        item = next(record for record in self.records() if record['container'] == 0)['slots'][0]['item']
        self.assertEqual(item['name'], 'Material')
        self.assertEqual(item['equipLoc'], '')
        self.assertTrue(item['infoComplete'])
        self.lua.execute(b'BankAccessible=true')
        self.fire('BANKFRAME_OPENED')
        self.assertFalse(any(record['scope'] != 'bags' for record in self.records()))

    def test_includes_the_public_reagent_bag_when_only_the_ordinary_bag_count_is_available(self):
        self.lua.execute(b'''NUM_TOTAL_EQUIPPED_BAG_SLOTS=nil; NUM_BAG_SLOTS=4; Enum.BagIndex={ReagentBag=5}
C_Container.GetContainerNumSlots=function(bag) return bag==5 and 1 or 0 end
Bags[5]={[1]=NewItem(80,"Reagent-A","Reagent")}''')
        self.fire('PLAYER_ENTERING_WORLD')
        record = next(record for record in self.records() if record['container'] == 5)
        self.assertEqual(record['slots'][0]['item']['name'], 'Reagent')

    def test_restores_dated_bank_capture_after_reload_and_round_trips_fragments(self):
        self.fire('PLAYER_ENTERING_WORLD')
        record = self.records()[0]
        # Actual output fragments retain independent identity, CRC and full JSON details.
        parts = {}
        for _ in range(10000):
            self.ns[b'Transfer'][b'Advance']()
            frame = self.ns[b'Transfer'][b'Current'](b'state')
            if frame == b'state':
                continue
            size, crc = struct.unpack('<HH', frame[4:8])
            body = frame[8:8 + size]
            self.assertEqual(binascii.crc_hqx(body, 0xffff), crc)
            fragment = json.loads(body)
            if fragment['kind'] != 'store' or fragment['id'] != record['id']:
                continue
            parts[fragment['p']] = base64.b64decode(fragment['d'])
            if len(parts) == fragment['n']:
                break
        self.assertEqual(json.loads(b''.join(parts[index] for index in range(1, len(parts) + 1))), record)
        self.lua.execute(b'''local saved=Database.itemStorage.characters[Owner.guid]["bags:0"]
saved.scope="bank"; saved.container=6
Database.itemStorage.characters[Owner.guid]["bank:6"]=saved
''')
        self.fire('PLAYER_LEAVING_WORLD')
        self.lua.execute(b'Owner.session="new-session"')
        self.fire('PLAYER_ENTERING_WORLD')
        cached = [entry for entry in self.records() if entry['scope'] == 'bank' and entry['session'] == 'new-session']
        self.assertTrue(cached[0]['cached'])
        self.assertEqual(cached[0]['observedAt'], record['observedAt'])

    def test_repeated_changes_do_not_restart_an_inflight_container_or_starve_other_containers(self):
        self.fire('PLAYER_ENTERING_WORLD')
        first = None
        for _ in range(10):
            self.ns[b'Transfer'][b'Advance']()
            frame = self.ns[b'Transfer'][b'Current'](b'state')
            if frame != b'state':
                size = struct.unpack('<H', frame[4:6])[0]
                value = json.loads(frame[8:8 + size])
                if value['kind'] == 'store':
                    first = value
                    break
        self.assertIsNotNone(first)
        old = first['id']
        self.lua.execute(b'''local saved=Database.itemStorage.characters[Owner.guid]["bags:0"]
for id=100,105 do saved.id=id; NS.Transfer.SetStorage(saved) end''')
        parts = {first['p']}
        later = set()
        for _ in range(500):
            self.ns[b'Transfer'][b'Advance']()
            frame = self.ns[b'Transfer'][b'Current'](b'state')
            if frame == b'state':
                continue
            size = struct.unpack('<H', frame[4:6])[0]
            value = json.loads(frame[8:8 + size])
            if value['kind'] != 'store':
                continue
            if value['id'] == old:
                parts.add(value['p'])
            else:
                later.add(value['id'])
        self.assertEqual(len(parts), first['n'])
        self.assertTrue(any(identifier < 100 for identifier in later))
        self.assertIn(105, later)
        self.assertNotIn(100, later)

    def test_version_two_preserves_material_recipe_and_profession_tool_classification(self):
        self.lua.execute(b'''
for slot,class in ipairs({5,7,9,19}) do
 local item=NewItem(200+slot,"Class-"..class,"Professional "..class)
 item.class=class; item.subclass=0; item.stats={}; Bags[0][slot]=item
end
C_Item.GetItemInfoInstant=function(link)
 local item=Catalog[link]
 return item.id,"Profession","Subclass",item.class==19 and "INVTYPE_PROFESSION_TOOL" or "",123,item.class,item.subclass
end
C_Item.GetItemInfo=function(link)
 local item=Catalog[link]
 return item.name,link,1,1,0,"Profession","Subclass",1000,item.class==19 and "INVTYPE_PROFESSION_TOOL" or ""
end
''')
        self.fire('PLAYER_ENTERING_WORLD')
        record = next(entry for entry in self.records() if entry['container'] == 0)
        self.assertEqual(record['v'], 2)
        self.assertEqual([slot['item']['classID'] for slot in record['slots'][:4]], [5, 7, 9, 19])
        self.assertEqual([slot['item']['subclassID'] for slot in record['slots'][:4]], [0, 0, 0, 0])
        self.assertEqual(record['slots'][0]['item']['equipLoc'], '')
        self.assertTrue(record['slots'][0]['item']['infoComplete'])
        self.assertEqual(record['slots'][3]['item']['equipLoc'], 'INVTYPE_PROFESSION_TOOL')

    def test_secret_or_fractional_classification_stays_unknown_instead_of_being_inferred(self):
        self.lua.execute(b'''
Bags[0][1]=NewItem(250,"Class-secret","Material")
C_Item.GetItemInfoInstant=function(link) return 250,"Trade Goods","Metal","",123,Secret,1.5 end
''')
        self.fire('PLAYER_ENTERING_WORLD')
        item = next(entry for entry in self.records() if entry['container'] == 0)['slots'][0]['item']
        self.assertIsNone(item['classID'])
        self.assertIsNone(item['subclassID'])
        self.assertFalse(item['infoComplete'])

    def test_item_cache_recovers_with_bounded_retries_without_requiring_a_second_bag_event(self):
        self.lua.execute(b'Late=NewItem(300,"Late-item","Loaded later"); Late.loaded=false; Bags[0][1]=Late')
        self.fire('PLAYER_ENTERING_WORLD')
        partial = next(entry for entry in self.records() if entry['container'] == 0)
        self.assertIsNone(partial['slots'][0]['item']['name'])
        self.lua.execute(b'Late.loaded=true')
        self.g.AdvanceTime(10)
        recovered = [entry for entry in self.records() if entry['container'] == 0][-1]
        self.assertEqual(recovered['slots'][0]['item']['name'], 'Loaded later')
        self.assertTrue(recovered['slots'][0]['item']['infoComplete'])
        self.assertGreater(recovered['id'], partial['id'])

    def test_classification_outside_the_wire_integer_range_remains_null(self):
        self.lua.execute(b'''
Bags[0][1]=NewItem(251,"Class-range","Future item")
C_Item.GetItemInfoInstant=function(link) return 251,"Future","Future","",123,256,-1 end
''')
        self.fire('PLAYER_ENTERING_WORLD')
        item = next(entry for entry in self.records() if entry['container'] == 0)['slots'][0]['item']
        self.assertIsNone(item['classID'])
        self.assertIsNone(item['subclassID'])
        self.assertFalse(item['infoComplete'])

    def test_closing_the_bank_discards_an_inflight_scan_and_still_allows_bag_updates(self):
        self.fire('PLAYER_ENTERING_WORLD')
        self.lua.execute(b'''
BankAccessible=true
local original=C_Container.GetContainerNumSlots
C_Container.GetContainerNumSlots=function(bag) return bag==6 and 100 or original(bag) end
Bags[6]={[1]=NewItem(400,"Bank-item","Bank item")}
''')
        self.ns[b'ItemStorage'][b'OnEvent'](b'BANKFRAME_OPENED')
        self.g.AdvanceTime(.40)
        self.assertEqual(self.ns[b'ItemStorage'][b'current'][b'scope'], b'bank')
        self.lua.execute(b'BankAccessible=false')
        self.ns[b'ItemStorage'][b'OnEvent'](b'BANKFRAME_CLOSED')
        self.lua.execute(b'Bags[0][1]=NewItem(401,"Bag-item","Carried item")')
        self.fire('BAG_UPDATE_DELAYED')
        self.assertFalse(any(entry['scope'] != 'bags' for entry in self.records()))
        carried = [entry for entry in self.records() if entry['container'] == 0][-1]
        self.assertEqual(carried['slots'][0]['item']['name'], 'Carried item')

    def test_classic_global_container_and_item_apis_preserve_bags_and_open_bank(self):
        self.lua.execute(b'''
Bags[0][1]=NewItem(500,"Classic-bag","Classic carried")
Bags[-1]={[1]=NewItem(501,"Classic-bank","Classic bank")}
BANK_CONTAINER=-1; NUM_BANKBAGSLOTS=7; NUM_TOTAL_EQUIPPED_BAG_SLOTS=4
C_Bank=nil; Enum=nil
GetContainerNumSlots=function(bag) return (bag==0 or bag==-1) and 1 or 0 end
GetContainerItemInfo=function(bag,slot)
 local item=Bags[bag] and Bags[bag][slot]
 if item then return 123,item.quantity or 1,false,4,false,false,item.link,false,false,item.id end
end
GetContainerItemLink=C_Container.GetContainerItemLink
GetItemInfo=C_Item.GetItemInfo; GetItemInfoInstant=C_Item.GetItemInfoInstant
GetDetailedItemLevelInfo=C_Item.GetDetailedItemLevelInfo; GetItemStats=C_Item.GetItemStats
C_Container=nil; C_Item=nil
''')
        self.fire('PLAYER_ENTERING_WORLD')
        carried = next(entry for entry in self.records() if entry['container'] == 0)
        self.assertEqual(carried['slots'][0]['item']['name'], 'Classic carried')
        self.assertEqual(carried['slots'][0]['item']['classID'], 4)
        self.assertIsNone(carried['slots'][0]['item']['itemGUID'])
        self.assertFalse(any(entry['scope'] == 'bank' for entry in self.records()))
        self.fire('BANKFRAME_OPENED')
        bank = next(entry for entry in self.records() if entry['container'] == -1)
        self.assertEqual(bank['slots'][0]['item']['name'], 'Classic bank')

    def test_summary_budget_is_explicit_and_does_not_truncate_the_separate_gear_reader(self):
        self.lua.execute(b'''
local item=NewItem(600,"Summary-item","Summary")
item.lines={}; for index=1,30 do item.lines[index]={leftText=string.rep("Summary ",30)} end
item.stats={}; for index=1,20 do item.stats["STAT_"..index]=index end
Bags[0][1]=item
''')
        self.fire('PLAYER_ENTERING_WORLD')
        item = next(entry for entry in self.records() if entry['container'] == 0)['slots'][0]['item']
        self.assertEqual(len(item['tooltip']), 4)
        self.assertLessEqual(max(len(line.encode()) for line in item['tooltip']), 128)
        self.assertEqual(len(item['stats']), 12)
        self.assertTrue(item['truncated'])
        self.assertFalse(item['tooltipComplete'])
        self.assertFalse(item['statsComplete'])
        self.assertEqual(len(self.g.Bags[0][1][b'lines']), 30)
        self.assertEqual(len(list(self.g.Bags[0][1][b'stats'].items())), 20)

    def test_legacy_dated_bank_record_keeps_version_one_until_a_new_capture_is_possible(self):
        self.lua.execute(b'Bags[0][1]=NewItem(650,"Saved-item","Saved equipment")')
        self.fire('PLAYER_ENTERING_WORLD')
        self.lua.execute(b'''
local saved=Database.itemStorage.characters[Owner.guid]["bags:0"]
saved.v=1; saved.scope="bank"; saved.container=6
Database.itemStorage.characters[Owner.guid]["bank:6"]=saved
''')
        self.fire('PLAYER_LEAVING_WORLD')
        self.lua.execute(b'Owner.session="next-session"')
        self.fire('PLAYER_ENTERING_WORLD')
        record = next(entry for entry in self.records() if entry['scope'] == 'bank' and entry['session'] == 'next-session')
        self.assertEqual(record['v'], 1)
        self.assertTrue(record['cached'])
        self.assertNotIn('classID', record['slots'][0]['item'])
        self.assertEqual(record['slots'][0]['item']['name'], 'Saved equipment')

    def test_typical_34_slot_mixed_archive_keeps_normal_state_and_competing_inventory_frames(self):
        self.lua.execute(b'''
C_Container.GetContainerNumSlots=function(bag) return bag==0 and 34 or 0 end
for index=1,34 do
 local item=NewItem(700+index,"Mixed-"..index,"Mixed item "..index)
 if index>17 then item.class=7; item.stats={}; item.quantity=200 end
 Bags[0][index]=item
end
local original=C_Item.GetItemInfo
C_Item.GetItemInfo=function(link)
 local item=Catalog[link]
 return item.name,link,1,1,0,item.class==7 and "Trade Goods" or "Armor","Subclass",1000,item.class==7 and "" or "INVTYPE_CHEST"
end
''')
        self.fire('PLAYER_ENTERING_WORLD')
        record = next(entry for entry in self.records() if entry['container'] == 0)
        self.lua.execute(b'''
Owner.online=true; Owner.loginId="login"; Owner.combatEnds=5; Owner.tick=1
NS.Transfer.SetMacroState(Owner)
NS.Transfer.SetInventory({v=1,id=1,session=Owner.session,guid=Owner.guid,observedAt=1700000000,source="bags",bank="unknown",complete=true,items={{itemID=717,quantity=200}}})
''')
        parts, inventory, states, life = {}, 0, 0, 0
        ticks = 0
        for ticks in range(1, 2001):
            self.ns[b'Transfer'][b'Advance']()
            frame = self.ns[b'Transfer'][b'Current'](b'state')
            if frame == b'state':
                states += 1
                continue
            self.assertEqual(len(frame), 512)
            size, crc = struct.unpack('<HH', frame[4:8])
            self.assertEqual(binascii.crc_hqx(frame[8:8 + size], 0xffff), crc)
            value = json.loads(frame[8:8 + size])
            inventory += value['kind'] == 'inv'
            life += value['kind'] == 'life'
            if value['kind'] == 'store' and value['id'] == record['id']:
                parts[value['p']] = base64.b64decode(value['d'])
                if len(parts) == value['n']:
                    break
        body = b''.join(parts[index] for index in range(1, len(parts) + 1))
        self.assertEqual(json.loads(body), record)
        self.assertLess(len(parts), 150)
        self.assertLess(ticks * .25, 150)
        self.assertGreater(inventory, 0)
        self.assertGreater(life, 0)
        self.assertGreaterEqual(states, ticks // 2)
        self.budget = {'bytes': len(body), 'parts': len(parts), 'ticks': ticks, 'secondsAt4Hz': ticks * .25,
                       'normalStateFrames': states, 'inventoryFrames': inventory, 'lifeFrames': life}
        print('STORAGE_BUDGET', json.dumps(self.budget, sort_keys=True))


if __name__ == '__main__':
    unittest.main()
