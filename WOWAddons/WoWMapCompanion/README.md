# 魔兽陪伴精灵 · WoW 插件端 2.1.1

采集角色状态并通过 WCP1 屏幕遥测供本机桥接模块接入 AIRI。游戏画面只保留数据传输码，角色、地图和金币信息在 AIRI 中查看。
插件本身不调用大模型、不联网、不读取其他进程、不执行角色操作。

## 已实现

- 2.1.1 移除游戏内的地图、角色和金币文字面板，只显示黑白数据传输码。数据采集和 AIRI 读取继续运行。
- 采集角色 GUID、名字、服务器、等级、职业英文 token、专精 ID、地图 ID、地图名，以及战斗、死亡、是否进入世界。
- 金币：监听 `PLAYER_MONEY`，读取 `GetMoney()` 的铜币整数，保存当前余额和累计流入/流出。首次读数只建立余额基线，不把原有财富计入收入。
- 本机账号标识保存在账号级 SavedVariables，角色计数以 GUID 分开；重载沿用累计数，不能补回未观察到的交易。
- 监听升级、区域变化、专精、战斗进入/退出、死亡/复活、进入/离开世界事件。
- 升级使用 `PLAYER_LEVEL_UP` 的新等级参数，避免刚升级时 `UnitLevel` 暂时返回旧值。
- 区域事件后在 0.25、1、2、5 秒重试，等待地图数据稳定；新事件会取消旧重试。
- 只有业务状态变化时递增 `seq`；每秒递增 `tick`，使桌面端能识别静止或失效的画面。
- 左上角黑白网格承载完整快照，默认 128×128 物理像素、距游戏客户区左上 8×8 像素；不会拦截鼠标。
- 可用 `/wowc cell 1` 缩至 64×64 物理像素，同时将桥接端每格像素改为 1；尺寸和偏移按物理像素换算，不随游戏 UI 缩放放大。
- 按 `768 / 屏幕物理高度` 换算 UI 单位，并抵消父级缩放；心跳检查登录后较晚发生的 UI 缩放变化，仅在变化时重新布局。
- 颜色更新后恢复纹理像素吸附，兼容 NDui 等界面插件全局关闭吸附的行为；原生布局取整 API 可用时也会启用。
- CRC16 校验、明确字节长度、UTF-8 边界裁剪；纹理仅在位发生变化时更新。
- 对可能返回的 secret value 先调用 `issecretvalue`，不转换、不比较、不导出。身份字段暂不可用时保留最近公开值；地图/专精不可用时使用 0/未知文本，不把它解释成可用游戏情报。
- `SavedVariables` 保存设置和最近一次规范快照，供离线后备读取。

## 安装

退出游戏，把此目录下 **四个 Lua 文件、TOC 文件**放入：

```text
World of Warcraft\_retail_\Interface\AddOns\WoWMapCompanion\
    WoWMapCompanion.toc
    Protocol.lua
    Telemetry.lua
    Money.lua
    WoWMapCompanion.lua
```

README 可一起复制，`tests` 目录无需安装。已有旧版则用新版文件覆盖，并保留相同插件目录名。
在插件列表启用“魔兽陪伴精灵 / AIRI 桥接”。从 2.1.0 更新到 2.1.1 后，游戏输入 `/reload` 即可移除文字面板，无需重启 AIRI。首次安装或从 2.0 更新时，需完整重启客户端以加载 Money.lua。

TOC 延用本工作区的正式服接口号 `120105, 120100`。客户端更新或其他分支必须核对实际接口号：
`/dump select(4, GetBuildInfo())`。声明接口号并不代表已在该版本实机测试。

## 游戏内命令

| 命令 | 行为 |
| --- | --- |
| `/wowc` | 查看命令帮助 |
| `/wowc telemetry` | 开启/关闭黑白遥测网格；关闭后桌面端应进入失联状态 |
| `/wowc status` | 显示金币、等级、业务序号、心跳、负载大小、遥测坐标 |
| `/wowc pos 8 8` | 遥测网格相对游戏客户区的左上坐标 |
| `/wowc cell 2` | 每个位格的像素尺寸，可用整数 1–6；对应网格 64–384 像素宽高 |
| `/wowc selftest` | 运行 WCP1 / CRC16 / UTF-8 编码自检 |
| `/wowc reset` | 重置遥测显示设置 |

坐标和格子尺寸更改后，应同步修改桌面桥接配置。在窗口模式下，桌面绝对捕获坐标还要加上游戏客户区在桌面上的偏移。建议无边框窗口模式，保持网格不被遮挡。隐藏 UI、最小化、加载画面、屏幕锁定或捕获位置错误都会中断可读画面。

缩小网格：在游戏内输入 `/wowc cell 1`，无需重载即可生效；桥接页的“每格像素”同步设为 `1`。此时网格为 64×64 像素，面积是标准 128×128 网格的四分之一。若显示链路使单像素模糊，可恢复 `/wowc cell 2`，桥接也改回 `2`。首次更新旧版缩放逻辑后需 `/reload`，再校准坐标；主屏无边框、插件位置 `(8,8)` 时桥接也设 `(8,8)`。

**网格有灰色/背景色边缘、CRC 校验失败时：**先确认两端每格大小一致、采集区域无遮挡。若仍失败，在游戏“系统 → 图形”中切到窗口模式并应用，再切回“全屏（窗口化）”，使用显示器原生分辨率并应用；然后输入 `/reload` 重建布局，再运行 `/wowc status`、校准桥接坐标并刷新预览。游戏报告的分辨率与 Windows 实际游戏客户区不一致时，整幅画面可能被再次拉伸，插件内部坐标正确也无法逐像素解码。本机曾出现游戏报告 2560×1440、实际客户区 2576×1460 的情况；重新应用显示模式并重载后，客户区恢复一致，64×64 网格成功实时解码。此时不要仅通过反复调解码阈值或盲目放大网格排错。

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
{"v":2,"session":"1700000000-12500-123456","seq":2,"tick":5,"guid":"Player-1-00000001","name":"冒险者","realm":"服务器","level":30,"class":"MAGE","spec":64,"map":84,"zone":"暴风城","combat":false,"dead":false,"online":true,"account":"local-example","moneyEpoch":"segment-example","copper":12345,"earned":1000,"spent":250}
```

每次登录/重载生成新的 `session`。`seq` 描述该会话内业务变化；`tick` 每秒递增。
桌面端应先验证版本、长度、CRC，再读取 JSON；初次读取或会话改变应建立基线，不应误报升级。
`PLAYER_LEAVING_WORLD` 设置 `online=false`，它也可能是加载/传送过程，并不等价于永久退出游戏。
网格仍为 64×64 位，WCP1 帧头不变。JSON 版本升级为 2，插件、桥接和 AIRI 必须一起更新。
网格传递最新状态快照，不是可靠事件队列；捕获停止期间短暂发生又结束的状态可能无法重放。金币使用累计计数，能补上插件持续观察期间尚未被桌面读取的收支，但不保存逐笔时间或原因。

## SavedVariables 后备

声明全局变量 `WoWMapCompanionDB`，游戏写入账号目录下的 `SavedVariables\WoWMapCompanion.lua`。

- `money`：本机账号标识，以及按角色 GUID 保存的计数段、累计流入和流出铜币数。
- `settings`：遥测开关、x/y/cell。旧版 `panel` 设置在初始化时移除。
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

本轮 20 项测试通过，覆盖：Lua/Python CRC 与位序一致、UTF-8 边界和长度、升级参数优先、心跳不生成业务事件、战斗/死亡/区域/上下线、secret 值过滤、命令参数与遥测开关，金币初始基线、快速收支、重载与角色切换、不可用值和计数溢出，以及物理像素换算、晚期 UI 缩放修复和 NDui 颜色纹理钩子的吸附恢复。

此前 2.0 版的网格实测：重新应用显示模式并 `/reload` 后，`/wowc cell 1` 的 64×64 物理像素网格已成功实时读取。以 500ms 间隔连续采样 20 次，20/20 均为 `live`、0 个错误，心跳从 41 递增至 50；BMP 实测为 64×64，标准 CRC 解码得到真实等级 90、区域“银月城”。此次保存的桌面采集设置为 `x=8、y=32、cellSize=1`；这是当前布局的校准结果，不是所有电脑的通用坐标。这验证了真实画面采集与状态读取；真实升级、死亡和 AI 语音回应仍需分别验收。

游戏内还需验收：

1. 登录后只出现数据传输码，不再出现地图、角色和金币文字面板；`/wowc selftest` 通过，桌面端收到姓名和等级。
2. 升级后桌面端仅报告一次新等级；不需要 `/reload`。
3. 跨区域、进入副本、打开世界地图浏览其他区域，桌面端始终使用角色所在地图。
4. 战斗进入/退出、死亡与复活后状态正常且无 Lua 错误。
5. `/reload` 后新会话不会被误认为升级；隐藏网格或最小化游戏时桌面端及时显示失联。
6. 不同 UI 缩放、Windows 缩放、HDR/显示器布局下实际校准捕获位置。

## AIRI 金币汇总

打开 AIRI 的“设置 → 魔兽陪伴精灵”，查看金币汇总。首次读取有效累计数后建立账号与角色记录。
同账号各角色合并显示流入、流出、净变化与已知余额；可给账号添加备注。金额显示为金、银、铜。

- 首次持有余额不计为收入；累计统计从插件开始观察起，不查询历史交易。
- 已知余额是各角色最近读数的合计。先逐个登录需要统计的角色，不会自动查询未登录角色。
- 统计对象是角色钱包。邮件、交易和银行存取会改变流入/流出；战团及公会银行自身余额不计入。
- 同账号转账会在不同角色分别体现收入、支出，不等于纯经济利润。
- 不读取战网账户信息。删除 SavedVariables 会产生新标识；跨账号复制该文件也会复制标识。
- 插件未运行、值不可用和游戏崩溃前未保存的变化无法完整追回。恢复旧 SavedVariables 导致同段计数回退时，AIRI 会拒绝该角色回退记录，直到收入和支出均追上桌面记录。
- 备份时先正常退出游戏与 AIRI，再保留插件 SavedVariables 和 AIRI 用户数据根目录的 `wow-companion-gold-v1.json`。

## API 参考

- [暴雪 UI 源码镜像：Unit 接口](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/UnitDocumentation.lua)
- [暴雪 UI 源码镜像：地图接口](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/MapDocumentation.lua)
- [暴雪 UI 源码镜像：专精接口](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/SpecializationInfoDocumentation.lua)
- [暴雪 UI 源码镜像：受限操作及 InCombatLockdown](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/RestrictedActionsDocumentation.lua)

- [暴雪 UI 源码镜像：PLAYER_MONEY 与 GetMoney 使用](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_AuctionHouseUI/Shared/Blizzard_AuctionHouseFrame.lua)
