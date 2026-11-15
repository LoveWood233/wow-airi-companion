"""Exercise actual CRC frames and elapsed delivery times on the unchanged 250 ms carrier."""
import binascii
import collections
import json
import struct
import unittest

from test_addon import LuaRuntime, MOCK, ROOT


class TransferPacingTests(unittest.TestCase):
    def setUp(self):
        self.lua = LuaRuntime(encoding=None, unpack_returned_tuples=True)
        self.lua.execute(MOCK)
        self.lua.execute(b'''Clock=0
function GetTime() return Clock end
function GetServerTime() return 1700000000+math.floor(Clock) end
Owner={session="1700000000-12500-123456",guid=Model.guid,online=true,loginId="game-login",combatEnds=5,tick=0}
''')
        self.ns, self.g = self.lua.table(), self.lua.globals()
        self.g.NS = self.ns
        self.load = self.lua.eval(b'function(source,name,ns) assert(loadstring(source))(name,ns) end')
        for name in ('Protocol.lua', 'Transfer.lua'):
            self.load((ROOT / name).read_bytes(), ROOT.name.encode(), self.ns)

    def table(self, value):
        if isinstance(value, dict):
            return self.lua.table_from({key.encode(): self.table(item) for key, item in value.items()})
        if isinstance(value, list):
            return self.lua.table_from([self.table(item) for item in value])
        return value.encode() if isinstance(value, str) else value

    def fixture(self, name):
        return self.table(json.loads((ROOT / 'tests' / 'fixtures' / name).read_bytes()))

    def step(self):
        self.lua.execute(b'Clock=Clock+0.25; Owner.tick=math.floor(Clock)')
        self.ns[b'Transfer'][b'Advance']()
        frame = self.ns[b'Transfer'][b'Current'](b'state')
        if frame == b'state':
            return None
        self.assertEqual(len(frame), 512)
        size, checksum = struct.unpack('<HH', frame[4:8])
        self.assertLessEqual(size, 504)
        payload = frame[8:8 + size]
        self.assertEqual(binascii.crc_hqx(payload, 0xffff), checksum)
        return json.loads(payload)

    def inventory(self, size=800):
        record = {'v': 1, 'id': 1, 'session': '1700000000-12500-123456', 'guid': 'Player-1-00000001',
                  'observedAt': 1700000000, 'source': 'bags', 'bank': 'unknown', 'complete': True,
                  'items': [{'itemID': 1000 + index, 'quantity': 200} for index in range(size)]}
        value = self.table(record)
        frames, _ = self.ns[b'Transfer'][b'EncodeInventory'](value)
        self.assertTrue(self.ns[b'Transfer'][b'SetInventory'](value))
        return len(frames)

    def continuous_weapon_updates(self):
        self.lua.execute(b'''WeaponRecord={v=1,id=1,session=Owner.session,guid=Owner.guid,observedAt=1700000000,
status="available",entries={}}
for _,skill in ipairs({43,44,45,46,54,55,136}) do
    WeaponRecord.entries[#WeaponRecord.entries+1]={skillLineID=skill,name="Weapon "..skill,rank=50,maxRank=300,modifier=0,temporary=0}
end
function RefreshWeapons()
    if not NS.Transfer.WeaponSkillsBusy() then
        WeaponRecord.id,WeaponRecord.observedAt=WeaponRecord.id+1,GetServerTime()
        assert(NS.Transfer.SetWeaponSkills(WeaponRecord))
    end
end''')

    def test_ordinary_fresh_background_uses_half_the_previous_data_opportunities(self):
        self.assertGreaterEqual(self.inventory(), 100)
        parts, states, delivered_at = [], 0, []
        # The 250 ms carrier used to offer 100 alternating data slots in 50 seconds.
        # A large immutable inventory keeps this window wholly inside its first pass.
        for _ in range(200):
            value = self.step()
            if value is None:
                states += 1
            else:
                self.assertEqual(value['kind'], 'inv')
                parts.append(value['p'])
                delivered_at.append(self.g.Clock)
        self.assertEqual(parts, list(range(1, 51)))
        self.assertEqual(states, 150)
        self.assertTrue(all(right - left == 1 for left, right in zip(delivered_at, delivered_at[1:])))

    def test_fresh_equipment_remains_fast_but_completed_replays_are_halved(self):
        record = self.fixture('lua-equipment.json')
        frames, _ = self.ns[b'Transfer'][b'Encode'](record)
        self.ns[b'Transfer'][b'Add'](record)
        seen, delivery_times = set(), []
        while len(seen) < len(frames):
            value = self.step()
            if value is not None:
                self.assertEqual(value['kind'], 'eq')
                seen.add(value['p'])
                delivery_times.append(self.g.Clock)
            self.assertLess(self.g.Clock, 8)
        self.assertTrue(all(right - left == .5 for left, right in zip(delivery_times, delivery_times[1:])))
        replay = 0
        for _ in range(200):
            value = self.step()
            replay += value is not None and value['kind'] == 'eq'
        self.assertEqual(replay, 50)

    def test_offer_swap_and_fresh_comparison_keep_their_original_fast_slots(self):
        comparison = self.fixture('lua-comparison.json')
        frames, _ = self.ns[b'Transfer'][b'EncodeComparison'](comparison)
        self.assertTrue(self.ns[b'Transfer'][b'AddComparison'](comparison))
        self.ns[b'Transfer'][b'SetOffer'](self.fixture('lua-offer.json'))
        self.ns[b'Transfer'][b'AddSwap'](self.fixture('lua-swap.json'))
        parts, offers, swaps = set(), [], []
        for _ in range(32):
            value = self.step()
            if value is None:
                continue
            if value['kind'] == 'cmp':
                parts.add(value['p'])
            elif value['kind'] == 'offer':
                offers.append(self.g.Clock)
            elif value['kind'] == 'swap':
                swaps.append(self.g.Clock)
            if len(parts) == len(frames) and offers and swaps:
                break
        self.assertEqual(len(parts), len(frames))
        self.assertEqual(offers[0], .25)
        self.assertTrue(swaps)
        self.assertLessEqual(self.g.Clock, 8)

    def test_life_macro_buff_and_calendar_cadence_does_not_slow_with_background(self):
        self.inventory()
        for name in ('Calendar.lua', 'GroupBuffs.lua'):
            self.load((ROOT / name).read_bytes(), ROOT.name.encode(), self.ns)
        # Real calendar and buff producers read mocked public game APIs.
        # The separate macro addon is an external producer at the transfer boundary.
        self.lua.execute(b'''C_DateAndTime={GetCurrentCalendarTime=function() return {year=2026,month=11,monthDay=8,hour=10,minute=0} end}
C_Calendar={}
Database={calendarV2={day="2026-11-08",characters={}}}
Database.calendarV2.characters[Model.guid]={day="2026-11-08",realm=Model.realm,items={}}
function IsInInstance() return true,"party" end
function IsInGroup() return true end
function GetInstanceInfo() return "Dungeon","party",1,"Normal",5,false,false,36 end
function UnitAffectingCombat() return false end
function IsInRaid() return false end
function GetNumGroupMembers() return 2 end
function UnitExists() return true end
function UnitIsConnected() return true end
function UnitIsVisible() return true end
function UnitInRange() return true,true end
function UnitGUID(unit) return unit=="player" and Model.guid or "Player-1-partner" end
C_SpellBook={IsSpellKnown=function() return true end}
C_Spell={GetSpellName=function() return "Arcane Intellect" end}
C_UnitAuras={GetAuraDataByIndex=function() return nil end}
WoWCompanionMacroImport={Telemetry=function()
 return {q=math.floor(Clock*4)+1,id="",st="idle",r="",hash=0,bytes=0,focus=false,input=false,chat=false,combat=false}
end}
NS.Calendar.Initialize(Database)
NS.GroupBuffs.Initialize()
NS.Transfer.SetMacroState(Owner)
Fire("PLAYER_ENTERING_WORLD")''')
        times = collections.defaultdict(list)
        ready_buffs = 0
        states = 0
        for _ in range(400):
            value = self.step()
            if value is None:
                states += 1
                continue
            times[value['kind']].append(self.g.Clock)
            ready_buffs += value['kind'] == 'buff' and value['st'] == 'ready'
        self.assertEqual({kind: len(values) for kind, values in times.items()},
                         {'calendar': 25, 'life': 50, 'macro': 50, 'buff': 25, 'inv': 25})
        self.assertEqual(states, 225)
        for kind, interval in [('life', 2), ('macro', 2), ('buff', 4), ('calendar', 4)]:
            self.assertTrue(all(right - left == interval for left, right in zip(times[kind], times[kind][1:])), kind)
        self.assertGreater(ready_buffs, 0)

    def test_sixteen_weapon_parts_and_parallel_large_streams_finish_inside_existing_ttls(self):
        self.inventory(200)
        record = {'v': 1, 'id': 1, 'session': '1700000000-12500-123456', 'guid': 'Player-1-00000001',
                  'observedAt': 1700000000, 'status': 'available', 'entries': [
                      {'skillLineID': skill, 'name': 'Weapon ' + str(skill), 'rank': 125, 'maxRank': 150,
                       'modifier': 0, 'temporary': 0}
                      for skill in [43, 44, 45, 46, 54, 55, 136, 160, 162, 172, 173, 176, 226, 228, 229, 3014]]}
        self.assertTrue(self.ns[b'Transfer'][b'SetWeaponSkills'](self.table(record)))
        game = 'forever' if ROOT.name == 'WoWForeverCompanion' else 'retail'
        self.assertTrue(self.ns[b'Transfer'][b'SetTalents'](self.fixture('lua-' + game + '-talents.json')))
        self.lua.execute(b'''NS.Transfer.SetQuests({v=1,id=1,session=Owner.session,guid=Owner.guid,observedAt=1700000000,source="quest-log",
log={complete=true,truncated=false,total=0,entries={}},completion={source="unknown",scope="unknown",complete=false,truncated=false,total=nil,ids={},turnIns={}}})
local gear={v=1,id=1,session=Owner.session,guid=Owner.guid,observedAt=1700000000,reason="login",slots={}}
for slot=1,19 do gear.slots[slot]={slot=slot,state="empty"} end
NS.Transfer.SetGear(gear)
local container={v=2,id=1,session=Owner.session,guid=Owner.guid,observedAt=1700000000,scope="bags",container=0,capacity=34,complete=true,cached=false,slots={}}
for slot=1,34 do container.slots[slot]={slot=slot,state="empty",quantity=0,item=nil} end
assert(NS.Transfer.SetStorage(container))
NS.Transfer.SetMacroState(Owner)''')
        kinds = {'wskill', 'inv', 'traits', 'qlog', 'gear', 'store'}
        parts, totals, completed_at = {}, {}, {}
        state_frames = 0
        for _ in range(4800):
            value = self.step()
            if value is None:
                state_frames += 1
                continue
            kind = value['kind']
            if kind not in kinds:
                continue
            parts.setdefault(kind, set()).add(value['p'])
            totals[kind] = value['n']
            if len(parts[kind]) == totals[kind]:
                completed_at.setdefault(kind, self.g.Clock)
            if kinds <= completed_at.keys():
                break
        self.assertEqual(kinds, completed_at.keys())
        self.assertLess(completed_at['wskill'], 120)
        self.assertTrue(all(elapsed < 1200 for elapsed in completed_at.values()))
        self.assertGreater(state_frames, 0)

    def test_late_receiver_recovers_gear_while_observations_keep_changing(self):
        record = self.fixture('lua-forever-gear.json')
        for slot in record[b'slots'].values():
            if slot[b'state'] == b'equipped':
                slot[b'item'][b'tooltip'] = self.table(['Observed equipment property ' * 16] * 10)
        frames, _ = self.ns[b'Transfer'][b'EncodeGear'](record)
        self.assertGreaterEqual(len(frames), 40)
        self.ns[b'Transfer'][b'SetGear'](record)
        # A receiver joining halfway through the first broadcast still needs the missed prefix.
        received = set()
        while True:
            value = self.step()
            if value and value['kind'] == 'gear':
                if value['p'] > len(frames) // 2:
                    received.add(value['p'])
                if value['p'] == len(frames):
                    break
            self.assertLess(self.g.Clock, 60)
        self.assertLess(len(received), len(frames))
        self.inventory(800)
        self.g.TalentRecord = self.fixture('lua-forever-talents.json')
        self.lua.execute(b'''CaptureRevision=1
QuestRecord={v=1,id=1,session=Owner.session,guid=Owner.guid,observedAt=1700000000,source="quest-log",
log={complete=true,truncated=false,total=0,entries={}},completion={source="unknown",scope="unknown",complete=false,truncated=false,total=nil,ids={},turnIns={}}}
WeaponRecord={v=1,id=1,session=Owner.session,guid=Owner.guid,observedAt=1700000000,status="available",
entries={{skillLineID=43,name="Sword",rank=125,maxRank=150,modifier=0,temporary=0}}}
StorageRecord={v=2,id=1,session=Owner.session,guid=Owner.guid,observedAt=1700000000,scope="bags",container=0,capacity=1,
complete=true,cached=false,slots={{slot=1,state="empty",quantity=0,item=nil}}}
function RefreshObservations()
    CaptureRevision=CaptureRevision+1
    for _,record in ipairs({QuestRecord,TalentRecord,WeaponRecord,StorageRecord}) do
        record.id,record.observedAt=CaptureRevision,GetServerTime()
    end
    if not NS.Transfer.QuestsBusy() then assert(NS.Transfer.SetQuests(QuestRecord)) end
    if not NS.Transfer.TalentsBusy() then assert(NS.Transfer.SetTalents(TalentRecord)) end
    if not NS.Transfer.WeaponSkillsBusy() then assert(NS.Transfer.SetWeaponSkills(WeaponRecord)) end
    assert(NS.Transfer.SetStorage(StorageRecord))
end''')
        started = self.g.Clock
        counts = collections.Counter()
        while self.g.Clock - started < 180:
            self.g.RefreshObservations()
            value = self.step()
            if value:
                counts[value['kind']] += 1
                if value['kind'] == 'gear':
                    self.assertEqual(value['n'], len(frames))
                    received.add(value['p'])
            if len(received) == len(frames):
                break
        self.assertEqual(len(received), len(frames),
                         'A late receiver cannot complete the cached loadout while observations stay fresh')
        self.assertLess(self.g.Clock - started, 180)
        for kind in ['inv', 'store', 'qlog', 'traits', 'wskill']:
            self.assertGreater(counts[kind], 0, kind)

    def test_all_cold_streams_replay_missing_prefixes_while_weapon_observations_stay_fresh(self):
        self.inventory(64)
        self.ns[b'Transfer'][b'SetGear'](self.fixture('lua-forever-gear.json'))
        self.assertTrue(self.ns[b'Transfer'][b'SetTalents'](self.fixture('lua-forever-talents.json')))
        self.assertTrue(self.ns[b'Transfer'][b'SetQuests'](self.fixture('lua-forever-quests.json')))
        self.lua.execute(b'''local record={v=2,id=1,session=Owner.session,guid=Owner.guid,observedAt=1700000000,scope="bags",
container=0,capacity=34,complete=true,cached=false,slots={}}
for slot=1,34 do record.slots[slot]={slot=slot,state="empty",quantity=0,item=nil} end
assert(NS.Transfer.SetStorage(record))''')
        kinds = {'gear', 'inv', 'qlog', 'traits', 'store'}
        first_pass, received, totals = collections.defaultdict(set), collections.defaultdict(set), {}
        while set(totals) != kinds or any(len(first_pass[kind]) < totals[kind] for kind in totals):
            value = self.step()
            if value and value['kind'] in kinds:
                kind = value['kind']
                totals[kind] = value['n']
                first_pass[kind].add(value['p'])
                # The receiver missed each prefix before the cached streams finished their first pass.
                if value['p'] > value['n'] // 2:
                    received[kind].add(value['p'])
            self.assertLess(self.g.Clock, 180)
        self.assertTrue(all(0 < len(received[kind]) < totals[kind] for kind in kinds))
        self.continuous_weapon_updates()
        started, weapon_frames = self.g.Clock, 0
        while self.g.Clock - started < 600:
            self.g.RefreshWeapons()
            value = self.step()
            if value and value['kind'] in kinds:
                received[value['kind']].add(value['p'])
            elif value and value['kind'] == 'wskill':
                weapon_frames += 1
            if all(len(received[kind]) == totals[kind] for kind in kinds):
                break
        missing = {kind: (len(received[kind]), totals[kind]) for kind in kinds if len(received[kind]) != totals[kind]}
        self.assertEqual(missing, {}, 'Fresh observations must not strand any cached transfer')
        self.assertLess(self.g.Clock - started, 600)
        self.assertGreater(weapon_frames, 0)

    def test_empty_replay_reservation_never_wastes_a_fresh_weapon_opportunity(self):
        self.continuous_weapon_updates()
        weapons, states = 0, 0
        for _ in range(200):
            self.g.RefreshWeapons()
            value = self.step()
            if value is None:
                states += 1
            else:
                self.assertEqual(value['kind'], 'wskill')
                weapons += 1
        self.assertEqual((weapons, states), (100, 100))


if __name__ == '__main__':
    unittest.main()
