import base64
import copy
import http.client
import json
import threading
import unittest
from pathlib import Path

from item_storage import ItemStorageAssembler, validate_storage
from protocol import FrameError, ItemStorageError, decode_frame, encode_frame, validate_loadout_item
from server import BridgeServer
from state import CompanionState
from test_bridge import snapshot

FIXTURE = Path(__file__).resolve().parent.parent / 'WoWMapCompanion/tests/fixtures/lua-item-storage.json'


def fragments(record):
    body = json.dumps(record, ensure_ascii=False, separators=(',', ':')).encode()
    count = (len(body) + 239) // 240
    return [{'v': 1, 'kind': 'store', 's': record['session'], 'g': record['guid'], 'id': record['id'],
             'p': part + 1, 'n': count, 'd': base64.b64encode(body[part * 240:(part + 1) * 240]).decode()}
            for part in range(count)]


class ItemStorageTest(unittest.TestCase):
    def setUp(self):
        self.record = json.loads(FIXTURE.read_text(encoding='utf-8'))
        self.now = 10
        self.state = CompanionState(clock=lambda: self.now)
        self.player = snapshot(session=self.record['session'], guid=self.record['guid'])
        self.state.ingest(self.player)

    def send(self, record, reverse=False):
        parts = fragments(record)
        for part in reversed(parts) if reverse else parts:
            self.state.ingest(decode_frame(encode_frame(part)))

    def test_real_lua_record_round_trips_and_does_not_inflate_status_or_refresh_heartbeat(self):
        self.assertEqual(validate_storage(self.record), self.record)
        self.send(self.record, reverse=True)
        page = self.state.item_storage.read(0)
        self.assertEqual(page['record'], self.record)
        self.assertEqual(page['cursor'], 1)
        view = self.state.view()
        self.assertEqual(view['itemStorageRevision'], 1)
        self.assertNotIn('slots', json.dumps({key: value for key, value in view.items() if key.startswith('itemStorage')}))
        self.now += 6
        self.send(self.record)
        self.assertEqual(self.state.view()['status'], 'stale')
        self.assertEqual(self.state.item_storage.sequence, 1)

    def test_v2_materials_have_classification_without_requiring_an_equipment_slot(self):
        material = copy.deepcopy(self.record)
        material['v'] = 2
        for slot in material['slots']:
            if slot['item']:
                slot['item'].update(classID=7, subclassID=9, equipLoc='', type='Trade Goods', subtype='Herb')
        self.assertEqual(validate_storage(material), material)
        self.send(material)
        self.assertEqual(self.state.item_storage.read(0)['record'], material)
        item = next(slot['item'] for slot in material['slots'] if slot['item'])
        gear = {key: value for key, value in item.items() if key not in ('classID', 'subclassID')}
        gear['infoComplete'] = True
        with self.assertRaises(FrameError):
            validate_loadout_item(gear)

    def test_v2_requires_explicit_unknown_or_integer_item_classification(self):
        record = copy.deepcopy(self.record)
        record['v'] = 2
        for slot in record['slots']:
            if slot['item']:
                slot['item'].update(classID=None, subclassID=None)
        validate_storage(record)
        occupied = next(slot for slot in record['slots'] if slot['item'])
        del occupied['item']['classID']
        with self.assertRaises(FrameError):
            validate_storage(record)
        occupied['item']['classID'] = True
        with self.assertRaises(FrameError):
            validate_storage(record)

    def test_original_v1_storage_is_still_readable_without_invented_classification(self):
        record = copy.deepcopy(self.record)
        record['v'] = 1
        for slot in record['slots']:
            if slot['item']:
                slot['item'].pop('classID', None)
                slot['item'].pop('subclassID', None)
        self.assertEqual(validate_storage(record), record)

    def test_separates_containers_cursors_and_resets_on_character_change(self):
        self.send(self.record)
        bank = {**self.record, 'id': self.record['id'] + 1, 'scope': 'bank', 'container': 6}
        self.send(bank)
        first = self.state.item_storage.read(0)
        second = self.state.item_storage.read(first['cursor'])
        self.assertTrue(first['hasMore'])
        self.assertEqual(second['record']['scope'], 'bank')
        self.assertFalse(second['hasMore'])
        old = self.state.item_storage.sequence
        self.state.ingest(snapshot(guid='Player-other', session='other-session'))
        self.assertIsNone(self.state.item_storage.read(0)['record'])
        self.assertEqual(self.state.item_storage.sequence, old)

    def test_conflicts_wrong_identity_future_and_invalid_slots_cannot_replace_a_complete_record(self):
        self.send(self.record)
        wrong = {**self.record, 'id': 999, 'guid': 'Player-other'}
        self.send(wrong)
        self.assertEqual(self.state.item_storage.sequence, 1)
        bad = copy.deepcopy(self.record)
        bad['id'] = 1000
        bad['slots'][0]['slot'] = 2
        self.send(bad)
        self.assertIsNotNone(self.state.item_storage.error)
        self.assertEqual(self.state.item_storage.read(0)['record'], self.record)
        self.assertEqual(self.state.view()['status'], 'live')
        future = {**self.record, 'id': 1001, 'observedAt': 4102444800}
        self.send(future)
        self.assertEqual(self.state.item_storage.sequence, 1)

    def test_bounds_pending_revisions_and_duplicate_fragments_do_not_extend_their_deadline(self):
        assembler = ItemStorageAssembler(lambda: self.now, lambda: 2000000000)
        part = fragments(self.record)[0]
        assembler.ingest(part, self.player)
        start = assembler.pending[part['id']]['started']
        self.now += 100
        assembler.ingest(part, self.player)
        self.assertEqual(assembler.pending[part['id']]['started'], start)
        for identifier in (100, 101, 102):
            assembler.ingest({**part, 'id': identifier}, self.player)
        self.assertLessEqual(len(assembler.pending), 2)
        invalid = {**part, 'n': 8740}
        with self.assertRaises(ItemStorageError):
            decode_frame(encode_frame(invalid))

    def test_http_delivers_one_container_and_rejects_invalid_cursors(self):
        self.send(self.record)
        server = BridgeServer(('127.0.0.1', 0), self.state)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            connection = http.client.HTTPConnection(*server.server_address)
            connection.request('GET', '/api/item-storage?after=0')
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.read())['record'], self.record)
            connection.request('GET', '/api/item-storage?after=-1')
            response = connection.getresponse()
            self.assertEqual(response.status, 400)
            response.read()
            connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
