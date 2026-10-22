# 魔兽陪伴精灵 · 本机桥接

把 WoW 插件显示在画面上的 WCP1 网格转为本机 JSON 状态和事件，供 AIRI 桌面二开读取。使用 **Python 3.10+ 标准库**；真实采集需要 Windows，无 pip 依赖。

## 启动与停止

```powershell
cd I:\GameTools\WOWAddons\WoWCompanionBridge
.\start.ps1
# 校准和状态页：http://127.0.0.1:18765/
.\stop.ps1
```

`start.ps1` 在隐藏窗口启动后台进程并验证健康接口；日志保存在本目录。`stop.ps1` 核对 PID 对应的命令行后，只停止运行本目录 `server.py` 的进程，不按端口杀进程。也可以前台运行 `python server.py`，用 Ctrl+C 停止。

可选参数：`python server.py --port 18765 --config <配置文件路径> --demo`。`--demo` 必须显式提供；默认真实模式，不会用演示数据假装游戏在线。脚本对应参数为 `start.ps1 -Port 18765 -Demo`。上层一键启动脚本可直接调用 `start.ps1`。

## 画面校准

默认截图区域左上角是屏幕物理坐标 `(8, 8)`，每格 `2` 物理像素，总大小 `128 × 128`。插件网格需完整可见。窗口模式、多显示器或插件移动位置后，在本机页面或 AIRI 设置页修改 X/Y 和每格像素。

点击“刷新预览”检查截图是否刚好包含 64 × 64 黑白网格。`x/y` 支持负数以覆盖主屏左侧或上方的显示器。显示缩放由 Windows DPI 感知处理，但游戏 UI 缩放、分辨率和 HDR 仍需在实际客户端验收。被遮挡、最小化或停止渲染时不保证可采集；超过 5 秒无新心跳会标记 `stale`。

配置写入 `bridge-config.json`：

```json
{"x":8,"y":8,"cellSize":2,"pollMs":500,"paused":false}
```

## 已实现

- GDI 仅截图配置的网格区域，不访问 WoW 进程内存、文件内部结构或游戏输入。
- WCP1 帧头、长度、CRC16、UTF-8、JSON 类型及范围校验；不完整或损坏帧不触发事件。
- 角色状态：姓名、服务器、等级、职业、专精、地图与区域、战斗、死亡、在线状态。
- 事件：`connected`、`level_up`、`zone`、`death`、`revive`、`combat_start`、`combat_end`、`offline`。
- 初次连接、角色切换、会话切换、画面过期恢复、暂停恢复只建立新基线；不把离线期间的等级变化当作刚发生的升级。
- `seq` 去重，`tick` 识别新心跳。相同帧反复可读也会在 5 秒后过期，避免最小化时的旧截图被当成实时状态。
- 地图 ID 为 0 或区域名称暂不可用时不触发区域通知，并保留最近有效区域用于比较；恢复原区域不重复提示。身份、会话、在线基线重建或演示切换会重置该比较基线。
- 内存中最多保留 200 个事件；不保存角色历史到磁盘。进程重启事件游标归零。
- 显式演示：升级、区域、死亡、复活、战斗；事件带 `demo: true`，状态为 `demo`。退出演示清空当前快照并等待真实帧。
- 本机校准页面、截图预览、暂停恢复、JSON API。

桥接本身不调用任何 AI 服务。AIRI 负责模型、语音和角色反应；是否让角色主动说话由 AIRI 端的陪伴规则控制。SavedVariables 由游戏插件保留作人工排查/后续导出；本服务当前实时入口只接受屏幕网格，未实现 SavedVariables 文件解析。

## HTTP 接口

只监听 `127.0.0.1`。`GET /health` 返回 `service: "wow-companion-bridge"` 和 `protocol: "WCP1"`。

| 接口 | 用途 |
| --- | --- |
| `GET /api/status` | 状态、最新快照、最近事件、配置、错误 |
| `GET /api/events?after=N` | 读取 ID 大于 N 的事件，返回 `cursor` |
| `GET /api/frame.bmp` | 最近真实采集区域的 BMP；演示期间不生成虚假截图 |
| `POST /api/config` | 更新 x/y/cellSize/pollMs/paused，返回完整状态 |
| `POST /api/demo` | `{ "enabled": true, "action": "level_up" }`，action 可省略 |

所有写入仅接受 `application/json`，请求最大 4096 字节。网页来源只允许本机 HTTP(S) 与 `airi://local`；校验 Host 避免 DNS rebinding。原生 Electron main `fetch` 不带 Origin 可以使用。无需把接口暴露到局域网，也不需要 CORS 凭据。

`GET /api/status` 结构：

```text
status: live | stale | waiting | demo | paused
source: screen | demo
snapshot: null 或 WCP1 快照
lastSeen: null 或 UTC ISO 8601 时间字符串
ageSeconds: null 或距最新心跳的秒数
eventCursor: 进程内递增整数，重启归零
instanceId: 每次桥接进程启动生成的 UUID；变化时客户端应重置游标
events: [{id, type, timestamp, title, detail, snapshot, demo}]
config: {x, y, cellSize, pollMs, paused}
error: null 或中文诊断
protocol: WCP1
staleAfterSeconds: 5
```

不要仅根据快照是否存在判断在线：过期后会保留快照供用户核对，必须同时判断 `status === "live"`。演示数据也必须按 `source/status` 区分。

## WCP1 协议

64 列 × 64 行，行优先，每字节高位在前：黑为 0，白为 1。512 字节：

| 字节 | 内容 |
| --- | --- |
| 0–3 | ASCII `WCP1` |
| 4–5 | JSON UTF-8 字节长度，小端 uint16，最大 504 |
| 6–7 | JSON 负载 CRC16-CCITT，小端，初始 `0xffff`、多项式 `0x1021` |
| 8–511 | JSON 字节，余下补 0 |

字段：`v,session,seq,tick,guid,name,realm,level,class,spec,map,zone,combat,dead,online`。`seq` 仅业务更新时增加，`tick` 每秒更新。`class` 是英文职业 token，`spec/map` 为数字 ID。

## 验证

```powershell
python -m unittest -v
```

31 个测试覆盖 UTF-8 和像素编解码、CRC、非法帧、状态切换、升级去重、过期与恢复、演示隔离、未知区域抖动和区域基线重置、事件上限、本机 HTTP 接口及来源/Host/JSON 校验、进程 UUID 和真实 Lua 编码 fixture。其中一个跨语言联测使用同级 `WoWMapCompanion/tests/.deps` 的可选 `lupa`：实际 Lua 插件收到升级事件 → 编码 → 合成像素传输 → Python 解码 → 产生唯一 `level_up` 事件；没有该测试依赖时会显式跳过，运行服务不需要 lupa。实际 WoW 网格渲染、显示缩放和 AIRI 模型语音还需联机验收；自动测试不宣称已在真实游戏中完成升级验证。
