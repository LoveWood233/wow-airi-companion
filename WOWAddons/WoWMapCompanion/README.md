# 魔兽陪伴精灵 · WoW 插件端 2.6.0

采集角色状态并通过 WCP1 屏幕遥测供本机桥接模块接入 AIRI。游戏画面保留数据传输码，合格的新装备会出现逐件确认换装窗口，角色、地图和金币信息在 AIRI 中查看。
插件本身不调用大模型、不联网、不读取其他进程；仅在用户点击游戏内确认后执行对应换装。

## 已实现

- 2.6.0 增加当前换装候选传输，配合 AIRI 的语音或文字气泡与 10 秒选择流程。最终仍在游戏内确认。
- 2.5.0 增加新装备逐件询问换装、槽位与实例核验、结果传输及 AIRI 结果展示。详见下方“逐件确认换装”。

- 2.4.0 增加新获得装备采集。完整实例链接、名称、类型、装等、公开属性以及附魔、宝石、触发、套装等提示文本通过同一传输码分片发送。详见下方“新获得装备”。
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

退出游戏，把此目录下 **七个 Lua 文件、TOC 文件**放入：

```text
World of Warcraft\_retail_\Interface\AddOns\WoWMapCompanion\
    WoWMapCompanion.toc
    Protocol.lua
    Telemetry.lua
    Money.lua
    Equipment.lua
    Transfer.lua
    ConfirmEquip.lua
    WoWMapCompanion.lua
```

README 可一起复制，`tests` 目录无需安装。已有旧版则用新版文件覆盖，并保留相同插件目录名。
在插件列表启用“魔兽陪伴精灵 / AIRI 桥接”。从 2.5.0 更新到 2.6.0 后执行 `/reload`，并正常退出、重启 AIRI 2.6.0 配套二开版本。首次安装或从更早版本升级时，完整重启游戏以加载 ConfirmEquip.lua。保留 SavedVariables，无需重新设定网格坐标或大小。

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

原有 20 项回归与新增 17 项装备测试，加上本次 35 项确认换装测试，共 72 项通过。原有回归覆盖：Lua/Python CRC 与位序一致、UTF-8 边界和长度、升级参数优先、心跳不生成业务事件、战斗/死亡/区域/上下线、secret 值过滤、命令参数与遥测开关，金币初始基线、快速收支、重载与角色切换、不可用值和计数溢出，以及物理像素换算、晚期 UI 缩放修复和 NDui 颜色纹理钩子的吸附恢复。

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


## 新获得装备

`Equipment.lua` 监听 `BAG_UPDATE_DELAYED`、`PLAYER_EQUIPMENT_CHANGED` 和 `ITEM_PUSH`，合并短时间通知后扫描随身背包及穿戴栏。进入世界后前 2 秒只建立基线，原有装备不作为新获得广播。以物品 GUID 去重，整理背包、穿脱同一件装备、重复事件不会重复广播。同 ID 的不同实例分别识别。

“新增”指本次登录/重载后首次观察到进入随身物品的装备，可能来自掉落、任务、邮件、交易、购买或银行取出。不能据此断言它来自某个首领。没有 GUID 时，按完整链接的历史最大持有数量保守识别，可能漏掉卖出后再获得的同链接装备。初始 2 秒内获得、在两次扫描之间获得又移走、直接进穿戴栏且未被背包扫描观察到的装备也可能漏报。

采集方式：

- `C_Item.GetItemInfoInstant` 确认装备类型。`C_Item.GetItemInfo` 读取名称、品质、类型、子类型、装备位置和等级要求。
- `C_Item.GetDetailedItemLevelInfo` 读取当前实例装等。`C_Item.GetItemStats` 返回属性 token 与数值，包含客户端公开的主属性和次属性。
- 始终保留实际完整 `itemLink`，包括链接中编码的随机属性、附魔、宝石及 bonus 信息。不会用裸 itemID 替换实例链接。
- `C_TooltipInfo.GetBagItem` 读取当前背包位置的说明。位置移动后按原 GUID 或完整链接读取，避免读到新占该位置的另一件物品。
- 保留说明中的附魔、插槽奖励、使用/装备触发、特殊词条、套装名称及套装效果原文。效果以客户端公开说明为准，不推算隐藏触发率、伤害提升百分比或套装已激活状态。
- 资料未缓存时请求加载，等待 `GET_ITEM_INFO_RECEIVED` / `ITEM_DATA_LOAD_RESULT`，最多重试 4 次（间隔 0.5、1、2、4 秒）。最终仍缺失则发送已有部分，并分别标记基本信息、属性及说明是否完整。无法确认装备类型时跳过。
- secret 值及不可访问表不做比较、转换或解密。没有公开数据时发送未知/不完整，绝不填零假装已知。

范围限制：最多 32 个数值属性、48 行说明，每行 256 UTF-8 字节，普通文字 128 字节。超过限制或整个 JSON 超过 8192 字节时裁掉尾部说明/属性，并设置 `truncated=true` 和对应完整性标志。完整实例链接超过 1024 字节时整件跳过，不破坏链接。异步等待上限为 64 件，状态命令会报告等待数及跳过数。

## 装备分片传输

`Transfer.lua` 在原有 512 字节帧内发送 `kind=eq` 包。每片格式为 `{"v":1,"kind":"eq","s":"会话","g":"角色GUID","id":1,"p":1,"n":4,"d":"Base64数据"}`。最多 35 片，每个非末片解码后恰好 240 字节。UTF-8 文本可以跨片拆分；桌面端先拼接全部字节，再严格解码 JSON。每片使用原有帧头和 CRC16。

状态和装备片每秒交替，保持同一片完整显示 1 秒，业务变化不打断这段显示。有装备时角色状态每 2 秒发送一次；无装备时仍保留原有每秒心跳。默认 500 毫秒采集能覆盖正常显示，但遮挡、缩放、慢采集或游戏卡顿仍可能造成缺片。装备越长、队列越长，完整读取时间越久，通常为数秒到数十秒，极长多件连续获得可能需要数分钟。

最多缓存 6 件、每件保留 10 分钟，先发送尚未完成首轮的新记录，再循环重播缓存。队列溢出会移除最旧记录，状态命令报告跳过数。登录/重载会清空装备缓存，不写入 SavedVariables。该通道是单向、有限缓存的尽力传输，没有桌面 ACK，不能保证离线期间全部装备都能补回。

更新后请手动验收：

1. 完整重启游戏和 AIRI，进入对应版本页面，保持数据传输码无遮挡。原有坐标和大小设置保留。
2. 等角色与地图正常出现后，再通过拾取、购买或任务奖励获得一件装备。
3. 在 AIRI 的装备区域核对名称、类型、装等、属性值和提示原文。带附魔、宝石、套装的物品逐项对照游戏提示。
4. 整理背包并穿脱该物品，确认没有重复新增。连续获得同 ID 的不同实例时检查分别显示。
5. 缺失字段或不完整标志出现时保留截图、链接及 `/dump GetBuildInfo()` 输出。无限服尚未实机验收，以上 API 以开放后的客户端结果为准。

真实 Lua 5.1 测试增加 17 项：登录基线、受限背包数据不建立空基线、移动/穿脱去重、同实例链接、缓存异步加载、有限重试、部分信息、secret 值、非装备过滤、无 GUID 保守计数、位置替换、UTF-8/CRC/Base64 分片、说明及基本文字截断、长链接跳过、等待上限、缓存过期和实际主入口事件到网格像素集成。`tests/fixtures/lua-equipment.json` 及四个 `lua-equipment-*.bin` 由真实 Lua 采集和编码生成，供桌面桥接跨语言联测。

API 核对依据（暴雪 UI 的 generated API 文档镜像）：

- [C_Item：物品详情、属性、装等、缓存加载](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/ItemDocumentation.lua)
- [C_Container：背包扫描与 BAG_UPDATE_DELAYED](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/ContainerDocumentation.lua)
- [C_TooltipInfo：背包、GUID 与实例链接说明](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/TooltipInfoDocumentation.lua)
- [Forever 的 C_Item](https://github.com/Gethe/wow-ui-source/blob/forever/Interface/AddOns/Blizzard_APIDocumentationGenerated/ItemDocumentation.lua) 和 [C_TooltipInfo](https://github.com/Gethe/wow-ui-source/blob/forever/Interface/AddOns/Blizzard_APIDocumentationGenerated/TooltipInfoDocumentation.lua)


## 逐件确认换装

默认开启，命令 `/wowc equip on`、`/wowc equip off`、`/wowc equip status` 可开启、关闭或查看状态。只处理本次登录基线之后新进入背包的装备，不会扫描旧背包并批量换装。关闭后再开启只处理之后新观察到的装备。

新物品必须有公开 GUID、完整实例链接、名称、装等、要求等级、属性和提示资料，并由客户端报告可装备、可使用。只有装等严格高于目标槽，或目标槽为空时，才询问用户。这只是装等候选，不是 DPS 推荐；套装、饰品特效、附魔、宝石和属性组合没有计入收益。

1. 在非战斗且存活时，游戏弹出对话框，显示新旧装备名、装等和目标槽。
2. 核对背包和穿戴栏物品提示后，点击“确认换装”。点击“保留原装备”、按 Esc 或候选的剩余有效期内未选择（总计最多 120 秒），都不会换装，同一件不会反复询问。
3. 点击时再次核验角色、会话、候选 GUID 和完整实例链接，重新查找其真实背包格，并检查目标槽身份、锁定状态、光标、战斗和死亡状态。
4. 本次点击内通过 `C_Container.PickupContainerItem` 拾起准确实例，核验客户端允许该槽后调用 `PickupInventoryItem`。不会按装备名称查找，也不会模拟键鼠。
5. 原生绑定、失去退款资格、失去交易资格等确认仍需要你手动选择。插件不会替你确认这些弹窗，也不会绕过客户端限制。
6. 仅在目标槽的物品 GUID 已等于候选 GUID 时，才记录“已穿戴”。最多等待 45 秒；未确认时提示检查穿戴栏，不再次执行。若之后才完成原生确认，历史结果仍可能显示“未能确认”，以游戏穿戴栏为准。
7. 同一次点击内立即成功、光标上仍是已批准替换的旧装备、来源袋格仍为空时，插件将旧装备放回该格。任何身份不明、来源格被占用或异步完成的情况，都保留光标物品并提示你手工放回；不会清除或丢弃光标物品。

战斗或死亡会隐藏尚未点击的询问，恢复后重新询问，绝不沿用以前的点击自动重试。正在等待原生确认时进入战斗、死亡、离开世界或关闭功能，会结束本次请求；已显示的原生确认仍由游戏管理。询问队列最多 6 件，入队 120 秒到期；退出或重载不保留队列。

普通盔甲、披风、项链可逐件处理。戒指和饰品选择空槽或较低装等槽，但不计算套装、唯一装备分类和特效收益，最终仍由客户端检查装备限制。单手武器区分主手和客户端允许的双持副手；不会替换盾牌来推断双持方案。双手仅处理副手为空且不跨单/双手布局的情况，跨布局、多槽拆装及泰坦之握不推断。远程武器通过 `C_PaperDollInfo.IsRangedSlotShown` 和 `GetInventorySlotInfo("RangedSlot")` 判断是否使用独立 18 号槽；不能确认时跳过。衬衣、战袍、箭袋等不按装等推荐。

换装结果通过同一网格的 `kind:"swap"` 单帧发送，包含装备记录 ID、新旧物品 ID、槽位、结果、原因及时间。最多缓存 10 条结果，重播 10 分钟；尚未首播的新结果优先于旧结果重播。没有候选提示帧时，单条新结果通常在 8 秒内获得发送时隙；同时传送候选提示时约为 12 秒，多条新增则依次排队。正常状态仍每 2 秒至少一帧。候选提示每 3 个数据机会占一个，其余数据机会每 4 个最多一个换装结果。最大 35 片的单件装备单独传送约需 70 秒，加上换装结果约 94 秒，同时传送候选提示和结果时不超过约 140 秒（不含排队、丢帧与重传）。网格面积保持不变。AIRI 只展示和解释结果，聊天中的“同意”不构成游戏内确认。

### 换装实机验收

完整退出并重启游戏与 AIRI，以加载新增 `ConfirmEquip.lua`。先用不重要的、可用且装等较高的新装备验收：确认询问的新旧名称和槽位正确；先取消一次确认穿戴不变，再用另一件装备点击确认；遇到原生绑定等弹窗自行决定；核对实际穿戴栏及 AIRI 的换装结果。另测试战斗中获得装备会延后询问、关闭功能不再弹窗。没有合格的新装备时不应弹窗。自动化测试不能替代客户端受保护 API、职业限制和原生弹窗的实机验收。

本次新增 35 项真实 Lua 5.1 测试覆盖真实 OnAccept 到动作 API、准确实例与背包移动、旧槽变更、光标、锁定、死亡、战斗、身份变化、秘密值、取消/超时、原生确认、双击和重入、世界切换、队列上限、武器槽位、旧装备归还边界、完整 35 片混合调度，以及主入口到像素结果。`tests/fixtures/lua-swap.json` 与 `lua-swap.bin` 来自各版本真实 Lua 回调和编码器，供 Python 跨语言校验。

当前动作接口依据：[官方界面装备管理代码](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_FrameXML/Mainline/EquipmentManager.lua)、[无限客户端槽位接口](https://github.com/Gethe/wow-ui-source/blob/forever/Interface/AddOns/Blizzard_APIDocumentationGenerated/PaperDollInfoDocumentation.lua)。


## AIRI 装备升级提示（2.6.0）

游戏弹窗可确认时，通过 `kind=offer` 单帧发送当前候选及其有效期。它包含会话、角色、装备记录 ID、递增状态序号、名称、槽位和新旧装等。候选完成或失效时改发 closed。

AIRI 朗读固定提示并显示气泡。没有语音配置、静音或失败时只显示文字。播报结束后显示“好”“不用”，10 秒未选择自动关闭桌面气泡。选择“好”仅提示返回游戏点击确认；选择“不用”不关闭游戏弹窗。只有游戏内确认按钮执行换装，候选总有效期仍为 120 秒。

此功能按装等或空槽筛选，不推断套装、特效及属性组合收益。新提议占部分数据时隙，网格面积保持不变。
