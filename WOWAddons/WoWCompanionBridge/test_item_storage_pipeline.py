"""Synthetic game APIs -> real Lua collector/rendered pixels -> bridge HTTP pages.

This test never captures a screen, starts the desktop app, or reads a game profile.
The exported pages are input for a separate SQLite verification step.
"""
from __future__ import annotations

import hashlib
import http.client
import importlib.util
import json
import sys
import threading
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

from item_storage import validate_storage
from protocol import decode_pixels
from server import BridgeServer
from state import CompanionState
from test_bridge import snapshot
from test_cross_language import ADDON, LuaRuntime

OUTPUT = ADDON.parent / "logs" / "item-storage-sqlite-20261104" / "pipeline-pages.json"


def equipment_mock():
    harness_spec = importlib.util.spec_from_file_location("item_storage_pipeline_equipment_base", ADDON / "tests" / "test_addon.py")
    harness = importlib.util.module_from_spec(harness_spec)
    harness_spec.loader.exec_module(harness)
    equipment_spec = importlib.util.spec_from_file_location("item_storage_pipeline_equipment_mock", ADDON / "tests" / "test_equipment.py")
    equipment = importlib.util.module_from_spec(equipment_spec)
    sentinel = object()
    previous = sys.modules.get("test_addon", sentinel)
    # This helper's one absolute import is bound only while loading its constants. Discovery never sees the addon test directory.
    sys.modules["test_addon"] = harness
    try:
        equipment_spec.loader.exec_module(equipment)
    finally:
        if previous is sentinel:
            sys.modules.pop("test_addon", None)
        else:
            sys.modules["test_addon"] = previous
    return equipment.EQUIPMENT_MOCK


EQUIPMENT_MOCK = equipment_mock() if LuaRuntime else None


def runtime(addon: Path, game: str, captured_at: int):
    spec = importlib.util.spec_from_file_location("item_storage_pixel_harness_" + game, addon / "tests" / "test_addon.py")
    harness = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(harness)
    lua = LuaRuntime(encoding=None, unpack_returned_tuples=True)
    lua.execute(harness.MOCK)
    lua.execute(EQUIPMENT_MOCK)
    namespace = lua.table()
    lua.globals().NS = namespace
    lua.globals().PipelineGame = game.encode()
    lua.globals().PipelineNow = captured_at
    loader = lua.eval(b"function(source,name,ns) assert(loadstring(source))(name,ns) end")
    for filename in ("Protocol.lua", "Transfer.lua", "Equipment.lua", "ItemStorage.lua", "Telemetry.lua"):
        loader((addon / filename).read_bytes(), addon.name.encode(), namespace)
    lua.execute(b'''
function GetServerTime() return PipelineNow end
Model.guid="Player-Pipeline-"..PipelineGame
Owner={session="pipeline-"..PipelineGame,guid=Model.guid}
Database={money={account="pipeline-account-"..PipelineGame}}
Captures={}
local original=NS.Transfer.SetStorage
NS.Transfer.SetStorage=function(record)
 local accepted=original(record)
 if accepted then Captures[#Captures+1]=NS.Transfer.StorageJSON(record) end
 return accepted
end
NS.Equipment.Initialize(Owner,function() end,function() end)
NS.ItemStorage.Initialize(Owner,Database)
NS.Telemetry.Initialize({telemetry=true,x=0,y=0,cell=1})
local function Make(id,guid,name,class,subclass,location,quantity,stats)
 local item=NewItem(id,guid,name)
 item.class=class; item.subclass=subclass; item.location=location
 item.quantity=quantity; item.stats=stats or {}
 item.lines={{leftText=name},{leftText="Synthetic pipeline fixture"}}
 return item
end
Bags[0][1]=Make(1000,"Item-Bag-Chest-"..PipelineGame,"Pipeline Chest",4,4,"INVTYPE_CHEST",1,{ITEM_MOD_STRENGTH_SHORT=15})
Bags[0][2]=Make(2000,"Item-Bag-Herb-"..PipelineGame,"Pipeline Herb",7,9,"",23)
Bags[0][3]=Make(3000,"Item-Bag-Recipe-"..PipelineGame,"Pipeline Recipe",9,2,"",1)
Bags[0][4]=Make(4000,"Item-Bag-Tool-"..PipelineGame,"Pipeline Pickaxe",19,0,"INVTYPE_PROFESSION_TOOL",1,{ITEM_MOD_FINESSE_RATING_SHORT=8})
Bags[0][5]=Make(5000,"Item-Bag-Potion-"..PipelineGame,"Pipeline Potion",0,1,"",5)
Bags[6]={[1]=Make(1000,"Item-Bank-Chest-"..PipelineGame,"Pipeline Chest",4,4,"INVTYPE_CHEST",1,{ITEM_MOD_STRENGTH_SHORT=20}),
 [2]=Make(2000,"Item-Bank-Herb-"..PipelineGame,"Pipeline Herb",7,9,"",40)}
Bags[12]={[1]=Make(2000,"Item-Account-Herb-"..PipelineGame,"Pipeline Herb",7,9,"",100)}
local types={[0]="Consumable",[4]="Armor",[7]="Trade Goods",[9]="Recipe",[19]="Profession"}
C_Item.GetItemInfoInstant=function(link)
 local item=Catalog[link]
 if item then return item.id,types[item.class],"Fixture subclass",item.location,123,item.class,item.subclass end
end
C_Item.GetItemInfo=function(link)
 local item=Catalog[link]
 if item then return item.name,link,2,item.class==4 and 42 or 1,0,types[item.class],"Fixture subclass",1000,item.location end
end
C_Item.GetDetailedItemLevelInfo=function(link) local item=Catalog[link]; return item and (item.class==4 and 42 or 1) end
C_Container.GetContainerNumSlots=function(bag) return bag==0 and 5 or bag==6 and 2 or bag==12 and 1 or 0 end
Enum={BankType={Character=0,Account=2}}
BankAccessible=false
C_Bank={CanViewBank=function() return BankAccessible end,
 FetchPurchasedBankTabIDs=function(kind) return kind==0 and {6} or {12} end}
NS.ItemStorage.OnEvent("PLAYER_ENTERING_WORLD")
AdvanceTime(3)
BankAccessible=true
NS.ItemStorage.OnEvent("BANKFRAME_OPENED")
AdvanceTime(3)
''')
    return lua, namespace


def pixels(lua, namespace, frame: bytes, magic: str):
    namespace[b"Telemetry"][b"Render"](frame)
    name = b"WoWCompanionTelemetry" if magic == "WCP1" else b"WoWForeverCompanionTelemetry"
    textures = lua.globals().Objects[name][b"textures"]
    image = bytearray()
    for index in range(1, 4097):
        color = textures[index][b"color"]
        image.extend((round(color[3] * 255), round(color[2] * 255), round(color[1] * 255), 255))
    return decode_pixels(bytes(image), 64, 64, 1, magic)


def lua_snapshot(lua, source: dict):
    return lua.table_from({key.encode(): value.encode() if isinstance(value, str) else value for key, value in source.items()})


@unittest.skipUnless(LuaRuntime, "Real Lua pixels require the existing test-only Lua 5.1 runtime")
class ItemStoragePixelHttpPipelineTest(unittest.TestCase):
    def test_both_games_collect_materials_gear_recipe_and_tool_then_export_actual_http_pages(self):
        captured_at = int(time.time())
        results = []
        for addon, game, magic in ((ADDON, "retail", "WCP1"), (ADDON.parent / "WoWForeverCompanion", "forever", "WCF1")):
            with self.subTest(game=game):
                lua, namespace = runtime(addon, game, captured_at)
                captures = [json.loads(value) for value in lua.globals().Captures.values()]
                self.assertEqual(len(captures), 8)
                expected = {(record["scope"], record["container"]): validate_storage(record) for record in captures}
                player = snapshot(session="pipeline-" + game, guid="Player-Pipeline-" + game,
                                  account="pipeline-account-" + game, name="Pipeline" + game.title(), realm="TestRealm")
                base, _, _ = namespace[b"Protocol"][b"Encode"](lua_snapshot(lua, player))
                decoded_player = pixels(lua, namespace, base, magic)
                self.assertEqual(decoded_player["guid"], player["guid"])
                self.assertEqual(decoded_player["account"], player["account"])
                state = CompanionState(game=game)
                state.ingest(decoded_player)
                kinds, frame_count, wire_hash = {}, 0, hashlib.sha256()
                for _ in range(2000):
                    namespace[b"Transfer"][b"Advance"]()
                    frame = namespace[b"Transfer"][b"Current"](base)
                    self.assertEqual(len(frame), 512)
                    wire_hash.update(frame)
                    decoded = pixels(lua, namespace, frame, magic)
                    kind = decoded.get("kind", "state")
                    kinds[kind] = kinds.get(kind, 0) + 1
                    frame_count += 1
                    state.ingest(decoded)
                    if state.item_storage.sequence == len(expected):
                        break
                self.assertEqual(state.item_storage.sequence, len(expected))
                self.assertIsNone(state.item_storage.error)
                server = BridgeServer(("127.0.0.1", 0), state)
                thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=.01), daemon=True)
                thread.start()
                try:
                    connection = http.client.HTTPConnection(*server.server_address, timeout=5)

                    def get(path):
                        connection.request("GET", path)
                        response = connection.getresponse()
                        self.assertEqual(response.status, 200)
                        return json.loads(response.read())

                    bridge_status = get("/api/status")
                    pages, cursor = [], 0
                    while True:
                        page = get("/api/item-storage?after=" + str(cursor))
                        self.assertEqual(page["instanceId"], state.instance_id)
                        if page["record"] is None:
                            break
                        self.assertGreater(page["cursor"], cursor)
                        self.assertEqual(page["record"], expected[(page["record"]["scope"], page["record"]["container"])])
                        pages.append(page)
                        cursor = page["cursor"]
                        if not page["hasMore"]:
                            break
                    connection.close()
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join(timeout=5)
                self.assertEqual(len(pages), 8)
                occupied = [slot for page in pages for slot in page["record"]["slots"] if slot["state"] == "occupied"]
                self.assertEqual(len(occupied), 8)
                for slot in occupied:
                    if slot["item"]["classID"] in (0, 7, 9):
                        self.assertEqual(slot["item"]["equipLoc"], "")
                        self.assertTrue(slot["item"]["infoComplete"])
                self.assertEqual({slot["item"]["classID"] for slot in occupied}, {0, 4, 7, 9, 19})
                results.append({
                    "game": game, "protocol": magic, "snapshot": decoded_player,
                    "bridgeStatus": bridge_status, "pages": pages,
                    "frameStats": {"count": frame_count, "kinds": kinds, "bytesPerFrame": 512,
                                   "bgraSize": [64, 64], "wireSha256": wire_hash.hexdigest()},
                    "expectedCounts": {"containers": 8, "occupiedSlots": 8,
                                       "scopes": {"bags": 5, "bank": 2, "account-bank": 1},
                                       "itemClasses": {"0": 1, "4": 2, "7": 3, "9": 1, "19": 1}},
                })
        report = {
            "format": "wow-item-storage-pipeline", "synthetic": True,
            "generatedAt": datetime.now(timezone.utc).isoformat(), "capturedAt": captured_at,
            "coverage": "Actual Lua collector, Transfer serializer, Telemetry texture pixels, Python decoder/state and localhost HTTP. SQLite is verified separately.",
            "liveGameTested": False, "games": results,
        }
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("PIPELINE_PAGES", OUTPUT)
        print("PIPELINE_COUNTS", json.dumps({entry["game"]: entry["expectedCounts"] for entry in results}, sort_keys=True))


if __name__ == "__main__":
    unittest.main()
