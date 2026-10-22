# 魔兽陪伴精灵 · WoW 插件端 2.0

在原地图面板上增加角色状态采集与 WCP1 屏幕遥测，供本机桥接模块接入 AIRI。
插件本身不调用大模型、不联网、不读取其他进程、不执行角色操作。

## 已实现

- 保留顶部地图面板，新增角色名、等级、战斗/灵魂状态。
- 采集角色 GUID、名字、服务器、等级、职业英文 token、专精 ID、地图 ID、地图名，以及战斗、死亡、是否进入世界。
- 监听升级、区域变化、专精、战斗进入/退出、死亡/复活、进入/离开世界事件。
- 升级使用 `PLAYER_LEVEL_UP` 的新等级参数，避免刚升级时 `UnitLevel` 暂时返回旧值。
- 区域事件后在 0.25、1、2、5 秒重试，等待地图数据稳定；新事件会取消旧重试。
- 只有业务状态变化时递增 `seq`；每秒递增 `tick`，使桌面端能识别静止或失效的画面。
- 左上角黑白网格承载完整快照，默认 128×128 物理像素、距游戏客户区左上 8×8 像素；不会拦截鼠标。
- CRC16 校验、明确字节长度、UTF-8 边界裁剪；纹理仅在位发生变化时更新。
- 对可能返回的 secret value 先调用 `issecretvalue`，不转换、不比较、不导出。身份字段暂不可用时保留最近公开值；地图/专精不可用时使用 0/未知文本，不把它解释成可用游戏情报。
- `SavedVariables` 保存设置和最近一次规范快照，供离线后备读取。

## 安装

退出游戏，把此目录下 **三个 Lua 文件、TOC 文件**放入：

```text
World of Warcraft\_retail_\Interface\AddOns\WoWMapCompanion\
    WoWMapCompanion.toc
    Protocol.lua
    Telemetry.lua
    WoWMapCompanion.lua
```

README 可一起复制，`tests` 目录无需安装。已有旧版则用新版文件覆盖，并保留相同插件目录名。
重新启动游戏并启用“魔兽陪伴精灵 / AIRI 桥接”。新增 SavedVariables 声明后优先完整重启客户端；后续 Lua 修改可 `/reload`。

TOC 延用本工作区的正式服接口号 `120105, 120100`。客户端更新或其他分支必须核对实际接口号：
`/dump select(4, GetBuildInfo())`。声明接口号并不代表已在该版本实机测试。

## 游戏内命令

| 命令 | 行为 |
| --- | --- |
| `/wowc` | 查看命令帮助 |
| `/wowc panel` | 显示/隐藏顶部地图面板 |
| `/wowc telemetry` | 开启/关闭黑白遥测网格；关闭后桌面端应进入失联状态 |
| `/wowc status` | 显示等级、业务序号、心跳、负载大小、遥测坐标 |
| `/wowc pos 8 8` | 遥测网格相对游戏客户区的左上坐标 |
| `/wowc cell 2` | 每个位格的像素尺寸，可用整数 1–6；对应网格 64–384 像素宽高 |
| `/wowc selftest` | 运行 WCP1 / CRC16 / UTF-8 编码自检 |
| `/wowc reset` | 重置面板与遥测设置 |

坐标和格子尺寸更改后，应同步修改桌面桥接配置。在窗口模式下，桌面绝对捕获坐标还要加上游戏客户区在桌面上的偏移。建议无边框窗口模式，保持网格不被遮挡。隐藏 UI、最小化、加载画面、屏幕锁定或捕获位置错误都会中断可读画面。

插件是单向发送器，`/wowc status` 仅描述插件本地状态，不能确认 AIRI 是否已连接。

## WCP1 协议

64 列 × 64 行，共 4096 个黑白位：黑色 = 0，白色 = 1，行优先，每字节最高位优先。

| 字节偏移（从 0 起） | 内容 |
| --- | --- |
| 0–3 | ASCII `WCP1` |
| 4–5 | UTF-8 JSON 字节数，uint16 小端 |
| 6–7 | 负载 CRC16-CCITT，初始值 0xFFFF，多项式 0x1021，小端 |
| 8–511 | JSON 负载（最多 504 字节），剩余字节补零 |

```json
{"v":1,"session":"1700000000-12500-123456","seq":2,"tick":5,"guid":"Player-1-00000001","name":"冒险者","realm":"服务器","level":30,"class":"MAGE","spec":64,"map":84,"zone":"暴风城","combat":false,"dead":false,"online":true}
```

每次登录/重载生成新的 `session`。`seq` 描述该会话内业务变化；`tick` 每秒递增。
桌面端应先验证版本、长度、CRC，再读取 JSON；初次读取或会话改变应建立基线，不应误报升级。
`PLAYER_LEAVING_WORLD` 设置 `online=false`，它也可能是加载/传送过程，并不等价于永久退出游戏。
网格传递最新状态快照，不是可靠事件队列；捕获停止期间短暂发生又结束的状态可能无法重放。

## SavedVariables 后备

声明全局变量 `WoWMapCompanionDB`，游戏写入账号目录下的 `SavedVariables\WoWMapCompanion.lua`。

- `settings`：面板、遥测开关、x/y/cell。
- `snapshot`：最后一份经过裁剪的安全快照表。
- `snapshotJSON`：与屏幕负载完全相同的 JSON 字符串。
- `updatedAt`：最后导出时的服务器 Unix 秒。

**内存变量更新不等于文件立即写入。** WoW 在退出/重载等时机保存；后备文件只可作为当时的快照，不应显示为实时连接。外部程序应解析数据，不能执行 SavedVariables 文件中的 Lua。

## 验证与实机验收

自动化测试执行真实 Lua 5.1 模块，使用最小 WoW API mock；没有模拟受保护的真实客户端运行时。

```powershell
python -m pip install --target tests/.deps lupa
python -m unittest discover -s tests -v
```

已覆盖：Lua/Python CRC 与位序一致、UTF-8 边界和长度、升级参数优先、心跳不生成业务事件、战斗/死亡/区域/上下线、secret 值过滤、命令参数与遥测开关。

游戏内还需验收：

1. 登录后地图面板和网格出现，`/wowc selftest` 通过，桌面端收到姓名和等级。
2. 升级后桌面端仅报告一次新等级；不需要 `/reload`。
3. 跨区域、进入副本、打开世界地图浏览其他区域，桌面端始终使用角色所在地图。
4. 战斗进入/退出、死亡与复活后状态正常且无 Lua 错误。
5. `/reload` 后新会话不会被误认为升级；隐藏网格或最小化游戏时桌面端及时显示失联。
6. 不同 UI 缩放、Windows 缩放、HDR/显示器布局下实际校准捕获位置。

## API 参考

- [暴雪 UI 源码镜像：Unit 接口](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/UnitDocumentation.lua)
- [暴雪 UI 源码镜像：地图接口](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/MapDocumentation.lua)
- [暴雪 UI 源码镜像：专精接口](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/SpecializationInfoDocumentation.lua)
- [暴雪 UI 源码镜像：受限操作及 InCombatLockdown](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/RestrictedActionsDocumentation.lua)
