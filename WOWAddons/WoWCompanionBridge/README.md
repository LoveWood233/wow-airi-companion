# 魔兽陪伴精灵 · 本机桥接

把 WoW 插件显示在画面上的 WCP1 网格转为本机 JSON 状态和事件，供 AIRI 桌面二开读取。使用 **Python 3.10+ 标准库**；真实采集需要 Windows，无 pip 依赖。

## 正常使用：只启动 AIRI

2.2.0 起，AIRI 主进程自动管理桥接。双击上层 `Start-WoWCompanion.cmd`，然后在 **设置 → 魔兽陪伴精灵** 开启陪伴连接即可。启动脚本的正常模式只启动 AIRI，无需另外打开终端或运行桥接脚本。

AIRI 先检查本机服务。没有服务时，它在隐藏窗口中启动 Python 子进程，等待健康检查成功，再读取角色状态。启动失败会显示错误，并按延迟重试。已经运行的兼容桥接会被复用，不会启动第二份。端口上是不兼容服务时会报错，不会停止那个进程。

关闭设置窗口不影响连接。关闭陪伴连接或退出 AIRI，会停止 AIRI 自己启动的子进程；再开启连接会重新启动。子进程通过 `--managed-stdin` 监测父进程管道，AIRI 崩溃或被强制关闭后也会退出。复用的外部桥接仍由原启动方式管理，不随 AIRI 关闭。

本次保留 **Python 3.10+** 本机依赖，没有把解码器改写为 JavaScript，也没有打包 Python 解释器。真实截图仍需 Windows。源码开发版支持 `airi` 与 `WOWAddons` 并列的目录布局；桌面打包配置通过 `extraResources` 包含桥接脚本。插件仍为 2.1.1，WCP1/v2 协议不变。

更新后，先正常退出旧 AIRI，再运行启动脚本。脚本提示 `already running` 时不会替换旧进程。已有模型、语音和金币账本继续使用原配置。

## 独立启动与停止：仅用于调试

需要单独排查采集服务时，可从工作区运行：

```powershell
cd I:\GameTools\WOWAddons
.\Start-WoWCompanion.ps1 -BridgeOnly
```

也可以直接使用桥接脚本：

```powershell
cd I:\GameTools\WOWAddons\WoWCompanionBridge
.\start.ps1
# 校准和状态页：http://127.0.0.1:18765/
.\stop.ps1
```

`start.ps1` 在隐藏窗口启动后台进程并验证健康接口；日志保存在本目录。`stop.ps1` 核对 PID 对应的命令行后，只停止运行本目录 `server.py` 的进程，不按端口杀进程。也可以前台运行 `python server.py`，用 Ctrl+C 停止。

可选参数：`python server.py --port 18765 --config <配置文件路径> --demo`。`--demo` 必须显式提供；默认真实模式，不会用演示数据假装游戏在线。脚本对应参数为 `start.ps1 -Port 18765 -Demo`。`--managed-stdin` 供 AIRI 父进程管理使用，手动调试无需添加。

独立启动的服务属于外部桥接。退出 AIRI 不会停止它。停止这类服务时使用本目录的 `stop.ps1`；AIRI 管理的服务通过关闭陪伴连接或退出 AIRI 停止。

## 自动启动排错

先看 AIRI **设置 → 魔兽陪伴精灵** 的连接、采集状态与错误，再按现象处理。通过上层启动脚本运行时，AIRI 日志位于 `I:\GameTools\WOWAddons\logs`。自动桥接没有单独新增的日志目录。

| 现象 | 处理方式 |
| --- | --- |
| 找不到 Python 或版本不足 | 安装 Python 3.10+，正常退出后重新启动 AIRI。当前电脑已有解释器，无需重复安装。 |
| 找不到桥接文件 | 源码版恢复 `airi` 与 `WOWAddons` 并列布局。安装版使用包含桥接资源的完整构建。 |
| 端口冲突或服务不兼容 | 核对占用 `127.0.0.1:18765` 的程序。先由其原启动方式退出，再重试。不要按端口批量结束未知进程。 |
| 启动失败、正在重试 | 保留页面错误和日志。修复原因后等待重试，或关闭再开启陪伴连接。 |
| 已连接但等待游戏 | 服务已启动。登录角色并保持传输码可见，再按下一节校准。 |

`http://127.0.0.1:18765/` 校准页只在桥接运行时可用。关闭陪伴连接或退出 AIRI 后，自动管理的服务会停止，此时网页打不开属于正常情况。

## 画面校准

默认截图区域左上角是屏幕物理坐标 `(8, 8)`，每格 `2` 物理像素，总大小 `128 × 128`。插件网格需完整可见。窗口模式、多显示器或插件移动位置后，在本机页面或 AIRI 设置页修改 X/Y 和每格像素。

需要减少遮挡时，在游戏输入 `/wowc cell 1`，并在桥接页把每格像素设为 `1`，即可使用 64×64 像素网格。缩小不改变数据容量和协议。更新修正物理像素缩放的插件后，旧版按放大画面填写的坐标和格宽需重新校准。

插件端已按屏幕物理高度换算 UI 单位，心跳会修复登录后较晚发生的 UI 缩放变化；颜色更新后会恢复像素吸附，兼容 NDui 的全局纹理钩子。桥接仍要求最终呈现在桌面上的网格没有被额外缩放。

点击“刷新预览”检查截图是否刚好包含 64 × 64 黑白网格。`x/y` 支持负数以覆盖主屏左侧或上方的显示器。显示缩放由 Windows DPI 感知处理，但游戏 UI 缩放、分辨率和 HDR 仍需在实际客户端验收。被遮挡、最小化或停止渲染时不保证可采集；超过 5 秒无新心跳会标记 `stale`。

**灰色或背景色混入网格、CRC 持续失败：**在确认坐标、格宽和遮挡无误后，进入游戏“系统 → 图形”，先切换到窗口模式并应用，再切回“全屏（窗口化）”并应用，选择显示器原生分辨率；然后输入 `/reload` 重建游戏布局，再重新校准并刷新预览。游戏内部报告的分辨率与 Windows 实际游戏客户区不一致，会使网格被再次拉伸。本机曾报告 2560×1440，但客户区实际为 2576×1460；重新应用显示模式并重载后恢复一致，64×64 单像素网格持续处于 `live`，正确读取等级 90、“银月城”，心跳持续递增。此次保存的采集配置为 `x=8、y=32、cellSize=1`，其他布局须按实际位置填写。如果仍无法可靠采集，可将游戏与桥接都恢复为每格 2 像素，继续核对分辨率和 HDR，而不是只放宽校验阈值。

源码版自动启动和独立脚本都使用本目录的 `bridge-config.json`，保留已有校准。打包版使用 AIRI 用户数据目录下的 `wow-companion-bridge/bridge-config.json`；首次运行能找到源码配置时复制一次，不覆盖已有配置。启动错误显示在 AIRI 设置页，后台 Python 的错误输出仅在内存中保留末尾 4KB 用于诊断。两种启动方式使用相同的配置字段：

```json
{"x":8,"y":8,"cellSize":2,"pollMs":500,"paused":false}
```

## 已实现

- GDI 仅截图配置的网格区域，不访问 WoW 进程内存、文件内部结构或游戏输入。
- WCP1 帧头、长度、CRC16、UTF-8、JSON 类型及范围校验；不完整或损坏帧不触发事件。
- 金币快照：严格验证 v2 的本机账号标识、角色计数段、当前铜币余额和累计流入/流出，金额必须为非负安全整数。余额不可用时为 null。
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

字段：`v,session,seq,tick,guid,name,realm,level,class,spec,map,zone,combat,dead,online,account,moneyEpoch,copper,earned,spent`。
JSON 快照版本 `v=2`，WCP1 帧布局和 64×64 位网格不变。插件、桥接和 AIRI 需一起更新；旧 v1 快照会被拒绝。
`account` 为本机账号级保存标识，`moneyEpoch` 为角色计数段；后三个金额字段使用铜币整数。金币汇总及磁盘账本由 AIRI 主进程管理，桥接只校验并传递。
`seq` 仅业务更新时增加，`tick` 每秒更新。`class` 是英文职业 token，`spec/map` 为数字 ID。

## 验证

```powershell
python -m unittest -v
```

2.1.1 历史记录为 32 项测试通过，覆盖 UTF-8 和像素编解码、CRC、非法帧、状态切换、升级去重、过期与恢复、演示隔离、未知区域抖动和区域基线重置、事件上限、本机 HTTP 接口及来源/Host/JSON 校验、进程 UUID、金币类型/边界/空余额校验和真实 Lua 编码 fixture。其中一个跨语言联测使用同级 `WoWMapCompanion/tests/.deps` 的可选 `lupa`：实际 Lua 插件收到升级事件 → 编码 → 合成像素传输 → Python 解码 → 产生唯一 `level_up` 事件；没有该测试依赖时会显式跳过，运行服务不需要 lupa。本机已验证真实 WoW 网格采集和当前角色状态；其他显示器/缩放组合、真实升级与死亡事件、AIRI 模型语音仍需分别验收，自动测试不替代这些实机验证。

2.2.0 新增父进程管道关闭后的退出测试。本轮整体复测与 AIRI 自动启动验证结果见上层 `wow-companion-implementation.html`。

此前 2.0 版的网格实机采样记录：采集配置 `x=8、y=32、cellSize=1`，每隔 500ms 采样一次，共 20 次，20/20 为 `live`、0 个错误，心跳 41→50；返回的 BMP 精确为 64×64，标准 CRC 解码成功读取 90 级、“银月城”。此记录仅代表本次电脑、显示模式与会话。
