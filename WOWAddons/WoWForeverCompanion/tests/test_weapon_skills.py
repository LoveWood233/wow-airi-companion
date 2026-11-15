"""Public weapon skill capture and real WCF1/WCP1 frames using Lua 5.1."""
import binascii
import json
import struct
import unittest

from test_addon import LuaRuntime, MOCK, ROOT
from test_equipment import EQUIPMENT_MOCK

SKILLS_MOCK = '''SkillReads={}; HeaderChanges=0
Skills={
 [43]={skillID=43,name="单手剑",isHeader=false,isCollapsed=false,rank=125,maxRank=150,modifier=5,tempPoints=-1,skillLineCategoryID=6},
 [3014]={skillID=3014,name="野性战斗",isHeader=false,isCollapsed=false,rank=100,maxRank=150,modifier=0,tempPoints=2,skillLineCategoryID=6}}
C_SkillInfo={GetSkillLineInfoByID=function(id) SkillReads[#SkillReads+1]=id; return Skills[id] end,
 GetNumSkillLines=function() error("must not enumerate collapsed rows") end,
 GetSkillLineInfo=function() error("must not enumerate collapsed rows") end,
 ExpandSkillHeader=function() HeaderChanges=HeaderChanges+1; error("mutator") end,
 CollapseSkillHeader=function() HeaderChanges=HeaderChanges+1; error("mutator") end}
function GetServerTime() return 1700000000+math.floor(GetTime()) end
'''.encode()


class WeaponSkillTests(unittest.TestCase):
    def setUp(self):
        self.lua = LuaRuntime(encoding=None, unpack_returned_tuples=True)
        for source in (MOCK, EQUIPMENT_MOCK, SKILLS_MOCK):
            self.lua.execute(source)
        self.ns, self.g = self.lua.table(), self.lua.globals()
        self.g.NS = self.ns
        load = self.lua.eval(b'function(source,name,ns) assert(loadstring(source))(name,ns) end')
        for name in ('Protocol.lua', 'Transfer.lua', 'WeaponSkills.lua'):
            load((ROOT / name).read_bytes(), ROOT.name.encode(), self.ns)
        self.lua.execute(b'''Owner={session="1700000000-12500-123456",guid=Model.guid}; Database={}; Captures={}
NS.WeaponSkills.Initialize(Owner,Database,function(record)
 if record then Captures[#Captures+1]=record end
 return NS.Transfer.SetWeaponSkills(record)
end,NS.Transfer.WeaponSkillsBusy)''')

    def capture(self):
        self.ns[b'WeaponSkills'][b'OnEvent'](b'PLAYER_ENTERING_WORLD')
        self.g.AdvanceTime(.21)
        return self.record()

    def record(self):
        return json.loads(self.ns[b'Transfer'][b'WeaponSkillsJSON'](self.g.Captures[len(self.g.Captures)]))

    def read_frame(self):
        self.ns[b'Transfer'][b'Advance']()
        frame = self.ns[b'Transfer'][b'Current'](b'state')
        if frame == b'state':
            return None
        self.assertEqual(len(frame), 512)
        size, crc = struct.unpack('<HH', frame[4:8])
        self.assertLessEqual(size, 504)
        payload = frame[8:8+size]
        self.assertEqual(binascii.crc_hqx(payload, 0xffff), crc)
        return json.loads(payload)

    def drain(self):
        parts, heartbeats = {}, 0
        for _ in range(1000):
            fragment = self.read_frame()
            if fragment is None:
                heartbeats += 1
                continue
            if fragment['kind'] != 'wskill':
                continue
            parts[fragment['p']] = fragment
            if len(parts) == fragment['n']:
                # Alternate normal state frames still carry the normal heartbeat.
                self.assertIsNone(self.read_frame())
                return parts
        self.fail('weapon skill transmission did not finish')

    def forever_only(self):
        if ROOT.name != 'WoWForeverCompanion':
            self.skipTest('Forever-only public skill API')

    def test_retail_reports_unsupported_without_reading_or_inventing_ranks(self):
        if ROOT.name == 'WoWForeverCompanion':
            self.skipTest('Retail-only capability policy')
        self.assertEqual(self.capture()['status'], 'unsupported')
        self.assertEqual(self.record()['entries'], [])
        self.assertEqual(len(self.g.SkillReads), 0)
        self.assertIsNone(self.drain()[1]['entry'])

    def test_forever_exports_native_ids_rank_cap_and_separate_signed_bonuses(self):
        self.forever_only()
        record = self.capture()
        self.assertEqual(record['status'], 'available')
        self.assertEqual(record['entries'], [
            {'skillLineID':43,'name':'单手剑','rank':125,'maxRank':150,'modifier':5,'temporary':-1},
            {'skillLineID':3014,'name':'野性战斗','rank':100,'maxRank':150,'modifier':0,'temporary':2}])
        self.assertEqual(json.loads(self.ns[b'Transfer'][b'WeaponSkillsJSON'](self.g.Database[b'weaponSkills'])), record)
        ids = list(self.g.SkillReads.values())
        self.assertIn(162, ids)
        for wrong in (473,95,164):
            self.assertNotIn(wrong, ids)
        parts = self.drain()
        self.assertEqual([parts[i]['entry'] for i in (1,2)], record['entries'])

    def test_no_header_mutation_or_profession_enumeration(self):
        self.forever_only()
        self.lua.execute(b'Skills[43].isCollapsed=true; Skills[164]={skillID=164,name="Blacksmithing",rank=300,maxRank=300}')
        self.assertEqual(len(self.capture()['entries']), 2)
        self.assertEqual(self.g.HeaderChanges, 0)

    def test_static_zero_over_zero_is_not_reported_as_a_learned_weapon(self):
        self.forever_only()
        self.lua.execute(b'Skills[44]={skillID=44,name="Axes",isHeader=false,rank=0,maxRank=0,modifier=0,tempPoints=0}')
        self.assertEqual([e['skillLineID'] for e in self.capture()['entries']], [43,3014])

    def test_unreadable_api_or_empty_cache_is_unavailable_without_fabricated_zero(self):
        self.forever_only()
        for change in (b'C_SkillInfo=nil', b'C_SkillInfo.GetSkillLineInfoByID=nil',
                       b'C_SkillInfo.GetSkillLineInfoByID=function() error("restricted") end',
                       b'C_SkillInfo.GetSkillLineInfoByID=function() return Secret end', b'Skills={}'):
            with self.subTest(change=change):
                self.setUp(); self.lua.execute(change)
                self.assertEqual(self.capture()['status'], 'unavailable')
                self.assertEqual(self.record()['entries'], [])

    def test_secret_malformed_and_mismatched_fields_do_not_form_a_partial_snapshot(self):
        self.forever_only()
        for field,value in [('rank','Secret'),('modifier','Secret'),('tempPoints','nil'),('maxRank','-1'),
                            ('rank','65536'),('rank','151'),('rank','0/0'),('skillID','164'),('isHeader','true')]:
            with self.subTest(field=field,value=value):
                self.setUp(); self.lua.execute(('Skills[43].'+field+'='+value).encode())
                self.assertEqual(self.capture()['status'], 'unavailable')
                self.assertEqual(self.record()['entries'], [])

    def test_continuous_skill_events_wait_for_inflight_parts_and_keep_the_latest_value(self):
        self.forever_only()
        first = self.capture()
        for rank in range(126,135):
            self.lua.execute(f'Skills[43].rank={rank}'.encode())
            self.ns[b'WeaponSkills'][b'OnEvent'](b'CHAT_MSG_SKILL', self.g.Secret)
            self.g.AdvanceTime(.21)
        self.assertEqual(len(self.g.Captures), 1)
        old = self.drain()
        self.assertEqual(old[1]['entry']['rank'], 125)
        self.ns[b'WeaponSkills'][b'Tick'](); self.g.AdvanceTime(.21)
        self.assertEqual(self.record()['entries'][0]['rank'], 134)
        self.assertGreater(self.record()['id'], first['id'])

    def test_thirty_second_replay_advances_revision_even_without_rank_change(self):
        first = self.capture(); self.drain()
        self.ns[b'WeaponSkills'][b'OnEvent'](b'SKILL_LINES_CHANGED')
        self.g.AdvanceTime(.21)
        self.assertEqual(len(self.g.Captures), 1)
        self.g.AdvanceTime(30)
        self.ns[b'WeaponSkills'][b'Tick'](); self.g.AdvanceTime(.21)
        self.assertGreater(self.record()['id'], first['id'])
        self.assertGreater(self.record()['observedAt'], first['observedAt'])

    def test_logout_clears_held_data_and_cancels_pending_scans_but_preserves_last_known_db(self):
        self.capture()
        self.ns[b'Transfer'][b'Advance']()
        self.ns[b'WeaponSkills'][b'OnEvent'](b'PLAYER_LOGOUT')
        self.assertEqual(self.ns[b'Transfer'][b'Current'](b'state'), b'state')
        self.g.AdvanceTime(60)
        self.ns[b'WeaponSkills'][b'Tick']()
        self.assertEqual(len(self.g.Captures), 1)
        for _ in range(15):
            self.assertIsNone(self.read_frame())
        self.assertIsNotNone(self.g.Database[b'weaponSkills'])

    def test_identity_change_during_capture_is_never_published(self):
        self.forever_only()
        self.lua.execute(b'local read=C_SkillInfo.GetSkillLineInfoByID; C_SkillInfo.GetSkillLineInfoByID=function(id) local info=read(id); Model.guid="Player-2-other"; return info end')
        self.ns[b'WeaponSkills'][b'OnEvent'](b'PLAYER_ENTERING_WORLD')
        self.g.AdvanceTime(.21)
        self.assertEqual(len(self.g.Captures), 0)
        self.assertIsNone(self.g.Database[b'weaponSkills'])

    def test_encoder_rejects_invalid_counts_status_ids_and_timestamp(self):
        for invalid in (b'R.id=0',b'R.status="ready"',b'R.status="unavailable"; R.entries={{}}',
                        b'R.observedAt=2147483648',b'R.entries={[2]={}}',b'for i=1,33 do R.entries[i]={} end'):
            with self.subTest(invalid=invalid):
                self.lua.execute(b'R={v=1,id=1,session=Owner.session,guid=Owner.guid,observedAt=1700000000,status="available",entries={}};'+invalid)
                self.assertIsNone(self.ns[b'Transfer'][b'EncodeWeaponSkills'](self.g.R)[0])
        self.lua.execute(b'R={v=1,id=1,session=Owner.session,guid=Owner.guid,observedAt=1700000000,status="available",entries={}}')
        frames,_ = self.ns[b'Transfer'][b'EncodeWeaponSkills'](self.g.R)
        self.assertEqual(len(frames), 1)
        size = struct.unpack('<H',frames[1][4:6])[0]
        self.assertIsNone(json.loads(frames[1][8:8+size])['entry'])

    def test_inventory_quest_gear_and_skill_streams_all_finish_with_heartbeats(self):
        if ROOT.name == 'WoWForeverCompanion':
            self.lua.execute(b'C_SkillInfo.GetSkillLineInfoByID=function(id) return {skillID=id,name="Weapon",isHeader=false,rank=125,maxRank=150,modifier=0,tempPoints=0} end')
        self.capture()
        self.lua.execute(b'''NS.Transfer.SetInventory({v=1,id=1,session=Owner.session,guid=Owner.guid,observedAt=1700000000,source="bags",bank="unknown",complete=true,items={}})
NS.Transfer.SetQuests({v=1,id=1,session=Owner.session,guid=Owner.guid,observedAt=1700000000,source="quest-log",log={complete=true,truncated=false,total=0,entries={}},completion={source="unknown",scope="unknown",complete=false,truncated=false,total=nil,ids={},turnIns={}}})
local gear={v=1,id=1,session=Owner.session,guid=Owner.guid,observedAt=1700000000,reason="login",slots={}}
for n=1,19 do gear.slots[n]={slot=n,state="empty"} end
NS.Transfer.SetGear(gear)''')
        seen,totals,heartbeats = {},{},0
        for _ in range(1000):
            part = self.read_frame()
            self.ns[b'WeaponSkills'][b'OnEvent'](b'SKILL_LINES_CHANGED')
            self.g.AdvanceTime(.21)
            if part is None:
                heartbeats += 1; continue
            seen.setdefault(part['kind'],set()).add(part['p'])
            totals[part['kind']] = part['n']
            if all(k in seen and len(seen[k])==totals[k] for k in ('wskill','inv','qlog','gear')):
                break
        self.assertGreater(heartbeats, 0)
        for kind in ('wskill','inv','qlog','gear'):
            self.assertIn(kind, seen)
            self.assertEqual(len(seen[kind]), totals[kind])

    def test_fixture_uses_real_collector_encoder_and_crc_frames(self):
        self.capture()
        frames,body = self.ns[b'Transfer'][b'EncodeWeaponSkills'](self.g.Captures[1])
        game = 'forever' if ROOT.name == 'WoWForeverCompanion' else 'retail'
        fixture = ROOT/'tests'/'fixtures'
        (fixture/f'lua-{game}-weapon-skills.json').write_bytes(body)
        (fixture/f'lua-{game}-weapon-skills.bin').write_bytes(b''.join(frames[i] for i in range(1,len(frames)+1)))
        parts = self.drain()
        self.assertEqual(parts[1]['s'], self.record()['session'])
        self.assertEqual(parts[1]['g'], self.record()['guid'])
        self.assertEqual(parts[1]['t'], self.record()['observedAt'])


if __name__ == '__main__':
    unittest.main()
