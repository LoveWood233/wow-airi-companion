# 魔兽无限陪伴精灵 · 独立插件 1.3.0

这是为《魔兽世界：无限》准备的独立插件，供 AIRI 的“魔兽世界：无限”设置页读取。保留角色、地图、升级、死亡、金币采集，游戏内保留左上角黑白数据传输码，没有中央状态面板；合格的新装备会出现逐件确认换装窗口。

**当前没有用户的无限客户端，尚未完成实机验收。** 2026-10-24 的开发基线为公开的 Forever UI 源码分支、客户端版本 `1.60.x`、接口号 `16001`。未来下载的客户端可能改变接口和加载方式，安装后必须按下面步骤核对。此目录不需要正式服插件一起安装。

## 功能与隔离

- 1.1.0 增加新获得装备采集：完整实例链接、名称、类型、装等、公开属性及附魔、触发、套装等提示文本。用原有网格轮播分片，不增加屏幕面积。详情见“新获得装备”。
- 角色 GUID、姓名、服务器、等级、职业、公开可读的专精 ID；专精尚未开放或接口不可用时发送 `0`，不推测天赋。
- 使用现代 `C_Map` 读取角色所在地图；区域变更后延迟重试。地图暂不可用时显示可读的区域名称。
- 监听升级、战斗、死亡、复活、进入与离开世界；每秒心跳。升级优先使用事件的新等级参数。
- 监听 `PLAYER_MONEY`，记录角色钱包铜币余额、累计流入和流出。首次读数只建立基线，重载沿用已保存累计数。
- 默认网格为 **64×64 物理像素**，位于游戏客户区左上 `(8,8)`。可调整格子为 1–6 像素。抵消 UI 缩放，在心跳时修复晚期缩放变化，并恢复 NDui 颜色钩子可能关闭的纹理像素吸附。
- 独立插件名 `WoWForeverCompanion`、独立全局设置 `WoWForeverCompanionDB`、独立命令 `/wowf`、独立帧名 `WoWForeverCompanionTelemetry`，不改正式服插件数据。
- 无限服帧标识为 **`WCF1`**；正式服为 `WCP1`。桥接必须按所选版本校验，选错版本应报告不匹配，不能将无限服金币混入正式服账本。
- 只读取公开状态；遇到 secret value 直接忽略，不转换、不解包。插件不调用大模型、不联网；仅在用户点击游戏内确认后执行对应换装。

账号标识是本机 SavedVariables 中生成的随机标识，不是战网账号。角色钱包转账、邮件和银行存取均可能产生流入/流出，不等于经济利润。未登录角色余额、银行自身余额和历史交易不会自动获取；插件没有观察到的变化也无法补回。

## 将来如何安装

1. 下载并退出无限客户端。在战网中选择“魔兽世界：无限”，打开该版本的安装位置，找到该客户端实际使用的 `Interface\AddOns`。公开测试资料使用过 `_classic_beta_`，**未来正式开放的目录以实际客户端为准**，不要复制到正式服的 `_retail_`。
2. 解压 `WoWForeverCompanion-1.3.0.zip`，将整个 `WoWForeverCompanion` 文件夹放入上述 `AddOns`。
3. 确认没有多套一层目录，以下文件必须直接位于 `AddOns\WoWForeverCompanion\`：

```text
WoWForeverCompanion.toc
WoWForeverCompanion_Camelot.toc
Protocol.lua
Money.lua
Equipment.lua
Transfer.lua
ConfirmEquip.lua
Telemetry.lua
WoWForeverCompanion.lua
README.md
```

4. 完整启动游戏，在插件列表启用“魔兽无限陪伴精灵 / AIRI 桥接”，加载 TOC 中的全部模块。同时更新并重启 AIRI 2.6.0 配套二开版本。
5. 游戏内输入 `/dump GetBuildInfo()`，核对版本 `1.60.x` 和第 4 项接口号 `16001`。插件不以 `WOW_PROJECT_ID` 区分，因为无限客户端也可能报告 Mainline。其他版本会停止采集并显示提示；请记录输出以便更新兼容层，**不要只改 TOC 来假装兼容**。
6. 输入 `/wowf selftest` 和 `/wowf status`。正常时编码自检包含 `WCF1 / CRC16 / UTF-8`，状态中有等级、金币、心跳和网格位置。编码自检只验证本地协议，不能证明客户端 API 和画面采集全部正常。
7. 打开 AIRI，进入“设置 → 魔兽陪伴精灵 → 魔兽世界：无限”，启用该版本连接。首次将每格像素设为 `1`，采集坐标先设为 `(8,8)`，保持网格无遮挡；窗口模式时要加上游戏客户区相对桌面的偏移，推荐无边框窗口模式。
8. 核对 AIRI 里的角色姓名、等级、地图、金币与游戏一致，再按下方清单验收。当前没有客户端时只能开发、运行自动化测试和查看演示数据，不能接收真实无限服数据。

同时提供普通 TOC 和 `_Camelot.toc`，两者内容一致，覆盖普通及 Forever 专用清单加载入口；不依赖 `_Classic.toc` 的回退行为。运行时仍检查客户端版本，避免误装到正式服后输出无限服帧。

## 游戏命令

| 命令 | 功能 |
| --- | --- |
| `/wowf` | 帮助 |
| `/wowf status` | 等级、金币、序号、心跳、负载大小和网格位置 |
| `/wowf selftest` | WCF1、CRC16、UTF-8 编码自检 |
| `/wowf pos 8 8` | 设置相对游戏客户区左上角的物理像素位置 |
| `/wowf cell 1` | 每格 1 像素，对应 64×64 网格；可选整数 1–6 |
| `/wowf telemetry` | 显示或隐藏数据传输码；隐藏会导致桌面端失联 |
| `/wowf reset` | 恢复显示设置：网格开启、`x=8`、`y=8`、`cell=1`；保留金币记录 |

位置或格子尺寸更改后，AIRI 无限服设置中的采集参数也要同步。如果单像素被拉伸变模糊，可改 `/wowf cell 2` 并把 AIRI 每格像素改为 `2`，网格会变为 128×128。先保证 Windows 和游戏采用原生分辨率、采集区域没有遮挡，再校准。最小化、锁屏、隐藏 UI、加载画面都会中断屏幕读取。

## 协议与保存

64 列 × 64 行，行优先，黑色为 0、白色为 1，每字节最高位先发送。固定 512 字节：

| 偏移 | 内容 |
| --- | --- |
| 0–3 | ASCII `WCF1` |
| 4–5 | UTF-8 JSON 长度，uint16 小端 |
| 6–7 | CRC16-CCITT 校验，小端；初始值 `0xFFFF`、多项式 `0x1021` |
| 8–511 | 最多 504 字节 JSON，剩余补零 |

JSON 保留正式服已有的 `v=2` 快照字段：`session/seq/tick/guid/name/realm/level/class/spec/map/zone/combat/dead/online/account/moneyEpoch/copper/earned/spent`。帧标识负责隔离游戏版本，不增加屏幕面积。业务变化递增 `seq`，每秒递增 `tick`，登录或重载更换 `session`。金币按累计计数传输，桌面漏采几帧后仍可合并插件已观察到的收支；其他短暂事件可能在漏采期间丢失，不是可靠事件队列。

`WoWForeverCompanionDB` 保存显示设置、账号标识、各角色金币计数和最新快照。游戏通常在 `/reload` 或正常退出时写入账号目录的 `SavedVariables\WoWForeverCompanion.lua`，不是实时磁盘接口。备份时先正常退出游戏；勿把正式服的 SavedVariables 复制过来。外部程序不得执行该数据文件中的 Lua。

## 自动化验证与待验收项

在本目录运行真实 Lua 5.1 模块的 API 模拟测试：

```powershell
python -m pip install --target tests/.deps lupa
python -m unittest discover -s tests -v
```

77 项测试覆盖帧标识、长度、CRC 与位序、UTF-8、升级与地图/战斗/死亡事件、现代专精 API 和无专精分支、secret 值过滤、金币基线/收支/重载/换角色/溢出、UI 缩放和 NDui 钩子、64×64 默认布局、独立命令/存档/帧名、错误客户端拒绝采集、缺失可选 API、两份 TOC 的文件完整性，以及下方的装备采集与分片场景。

**这些测试不包含真实无限客户端。开放后还需你协助完成：**

1. 保存 `/dump GetBuildInfo()` 的完整输出，确认插件无 Lua 错误；若提示版本未知，反馈版本与接口号。
2. 确认只出现传输码、没有中央面板；在 AIRI 无限服页校准并确认实时心跳、角色、地图与金币正确。
3. 实际升级一次、跨区域、死亡再复活，确认 AIRI 事件和陪伴回应只触发一次；战斗免打扰按设置生效。
4. 完成一次已知收入和支出，检查金币汇总分别增加正确金额；换角色、`/reload` 和正常退出再登录后检查连续性。
5. 隐藏网格、最小化再恢复，检查离线提示和恢复连接；切换正式服页面，确认数据及账本不会混用。

## 核对来源

- [暴雪 UI 源码镜像：Forever 分支](https://github.com/Gethe/wow-ui-source/tree/forever)
- [Forever 专精接口定义](https://github.com/Gethe/wow-ui-source/blob/forever/Interface/AddOns/Blizzard_APIDocumentationGenerated/SpecializationInfoDocumentation.lua)
- [Forever 地图接口定义](https://github.com/Gethe/wow-ui-source/blob/forever/Interface/AddOns/Blizzard_APIDocumentationGenerated/MapDocumentation.lua)
- [Forever API 实测记录：接口号、Mainline 项目及测试安装目录](https://github.com/Thunderz96/forever-addon-kit)
- [ManaMaster 开发者记录：`_Camelot.toc` 加载实测与 Interface 16001](https://github.com/olav9/ManaMaster/blob/main/CLAUDE.md)

外部开发者的实测只用于核对客户端基线和加载规则，不代表本插件已完成实机验收。没有引入这些项目的代码。


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

默认开启，命令 `/wowf equip on`、`/wowf equip off`、`/wowf equip status` 可开启、关闭或查看状态。只处理本次登录基线之后新进入背包的装备，不会扫描旧背包并批量换装。关闭后再开启只处理之后新观察到的装备。

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
