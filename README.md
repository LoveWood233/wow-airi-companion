# 魔兽世界陪伴精灵 · WoW AIRI Companion

魔兽世界正式服与无限服插件、本机屏幕桥接服务，以及 AIRI 桌面端二开的完整项目快照。

插件把角色、地图、金币、升级、死亡等状态编码到游戏画面的 WCP1 黑白网格；Python 桥接程序解码后提供本机 HTTP 接口，AIRI 根据角色设定生成聊天和语音回应，并在本机保存每个账号的金币收支账本。

## 最新功能清单（2026-11-01）

[最新功能与待办](WOWAddons/魔兽陪伴精灵-最新功能与待办-2026-11-01.md)整理了本地已实现能力、待实机验收项目、独立成果和未开发扩展，并记录备份、安装与更新交付的最新检查结果。

本次提交只更新文档入口与清单。下方版本章节描述仓库已有代码快照，本地新增向导、连接恢复、备份及安装更新等源码和发行文件尚未在这次文档提交中同步。

## 当前版本：2.21.0（日历与组队增益提醒）

同步正式服插件 2.15.0、无限服插件 1.12.0、桥接 2.14.0，以及配套桌面代码。

- **组队增益语音提醒**：进入副本、团队副本、场景战役或战场后，检查当前角色已学会的队伍增益。有人缺少时，使用当前陪伴角色的语音提醒。同次进入同种增益最多提醒一次，战斗和静音中延后，不自动施法。
- **首次登录日历提醒**：活动开始当日、结束前一天提醒。私人日程、公会活动和当前角色的副本重置也纳入范围，并按服务器日期去重。
- **副本场景观测**：传输码增加副本类型和地图实例 ID。不可读取的数据保持未知，避免错误判断。
- 保留 [宏导入](WOWAddons/WoWMacroImport/README.md)、角色陪伴、语音字幕、装备比较与确认换装、金币账本和等级历史。

增益支持战斗怒吼、奥术智慧、真言术：韧、野性印记、天怒、青铜龙的祝福。需要启用陪伴连接并配置当前陪伴角色的语音。读取受限、离线、死亡或超出可检查距离的队友不计为缺少增益。无限服自定义客户端需提供相应现代游戏接口。

[本次推送验证记录](WOWAddons/verification-group-buffs-publish-2026-10-29.md) 说明发布树的检查结果与限制。此前的 [开发环境验证记录](WOWAddons/group-buffs-verification-2026-10-29.md) 单独保留。实际副本、战场及扬声器播报仍待实机验收。

[正式服插件 2.15.0](WOWAddons/WoWMapCompanion-2.15.0.zip) · [无限服插件 1.12.0](WOWAddons/WoWForeverCompanion-1.12.0.zip)

更新后，在游戏内输入 `/reload`，并从托盘正常退出、重新启动陪伴精灵。历史源码压缩包保留原版本内容，当前代码以仓库文件为准。

[功能现状与扩展规划](WOWAddons/魔兽陪伴精灵-功能现状与扩展规划.md) 还包括其他开发会话的进展，不能据此认定本次提交已同步全部功能。[软件使用说明](WOWAddons/魔兽陪伴精灵-使用说明.html) 提供配置步骤。

## 角色语录与未来人设参考

[阅读 12 页 PDF](WOWAddons/output/pdf/魔兽世界经典角色语录与陪伴人设.pdf)：收录希尔瓦娜斯、阿尔萨斯、伊利丹等 12 位角色的 24 条短句、6 项玩家梗或归属辨析，以及来源、语气规则和原创陪伴示例。

[结构化 JSON](WOWAddons/research/warcraft-characters/warcraft-character-library.json) 与 [生成脚本](WOWAddons/research/warcraft-characters/build_library.py) 一并保存。原作短引、中文译写和原创示例分别标注。该资料用于后续开发，尚未接入 AIRI，也未包含人物模型或原声资源。

## 游戏截图辅助

桌面端“设置 → 游戏截图辅助”可启用按需看图，选择自动识别或正式服、无限服、怀旧服窗口。
先在“视觉”设置中配置支持图片的模型，然后在聊天或语音中说“帮我看看面前这个地形能走过去吗”或“任务 NPC 在这里却找不到，你能带我过去吗”。
也可输入 `/look 帮我找附近的入口` 明确触发。精灵截取一帧已验证的游戏窗口，结合当前问题分析可见路线、任务文字与地标。
移动或转动镜头后再次请求，才会查看新画面。普通聊天和游戏事件不会触发此截图；它不自动操控角色，也不能仅凭一帧确认碰撞或任务相位。
当前支持 Windows，原图不保存到本地聊天记录。架构、验证命令和限制见[截图辅助说明](airi/docs/ai/adr/wow-screen-assist.md)。

## 快捷启动魔兽世界

桌面端“设置 → 游戏启动配置”可分别保存战网、正式服、无限服和怀旧服程序路径，并设置默认启动目标。
选择实际 `.exe` 后点击“校验并保存”。角色工具栏的快捷启动按钮会启动已保存的默认目标；未配置时进入配置页。
保存与启动前均核对官方签名、程序身份和游戏安装版本，选错版本不会覆盖原配置。战网目标会打开战网，登录和更新由游戏及战网处理。
当前支持 Windows。具体安装目录、校验规则和支持范围见[启动功能说明](airi/docs/ai/adr/wow-companion-launcher.md)。

## 魔兽聊天知识库

[知识库说明](airi/packages/stage-shared/src/wow-knowledge/README.md)介绍正式服、无限服、怀旧服的知识分类，以及通用知识与中文、英文社区用语的区别。
知识条目包含缩写释义、梗的使用语境、来源和核对日期。聊天按当前消息检索相关内容，优先采用用户明确提到的游戏版本。
怀旧服目前用于知识检索与聊天，不包含新的实时采集插件。版本机制和未确认的台词归属保留明确边界。

## 可导入角色资产

[希尔瓦娜斯卡通陪伴形象 v0.3](assets/sylvanas-companion/README.md)：Spine 4.2 模型，包含 19 个动作、肘部弯曲和闭合握弓手。

[下载 AIRI 导入包](assets/sylvanas-companion/output/sylvanas-companion.spine.zip) · [全身预览](assets/sylvanas-companion/output/portrait.png) · [握弓近景](assets/sylvanas-companion/output/grip-closeup-idle.png)

该角色采用手动导入，未替换默认形象。首次导入需要按资产说明设置透明混合模式。源贴图、生成提示词、绑定脚本和验证记录一并保存在资产目录。

## 项目内容

| 路径 | 内容 |
| --- | --- |
| `WOWAddons/WoWMapCompanion/` | 正式服 Lua 插件、WCP1 编码、测试 |
| `WOWAddons/WoWForeverCompanion/` | 无限服独立 Lua 插件、WCF1 编码、测试与安装说明 |
| `WOWAddons/WoWMacroImport/` | 宏校验、保存窗口与自动导入回执 |
| `WOWAddons/WoWCompanionBridge/` | Windows 屏幕采集、协议解码、事件状态、本机校准页面和测试 |
| `airi/` | AIRI 上游完整源码快照，包含本次修改和新增的魔兽陪伴功能 |
| `assets/sylvanas-companion/` | 希尔瓦娜斯 v0.3 导入包、可重建源文件、预览与来源说明 |
| `WOWAddons/Start-WoWCompanion.cmd` | 启动已构建的 AIRI 桌面端，由 AIRI 自动管理桥接 |
| `WOWAddons/Install-WoWCompanion.ps1` | 将插件安装到正式服 AddOns 目录 |
| `WOWAddons/魔兽陪伴精灵-使用说明.html` | 启动、模型配置和日常使用说明 |
| `WOWAddons/魔兽陪伴精灵-功能现状与扩展规划.md` | 当前能力、验收边界及后续扩展建议 |
| `WOWAddons/wow-companion-implementation.html` | 功能清单、实现逻辑、配置步骤和需用户协助的验收事项 |
| `WOWAddons/WoWCompanion-PROTOCOL.md` | WCP1 数据协议与边界说明 |
| `WOWAddons/WoWIntelAPI/` | 早期独立攻略情报接口源码，保留归档，不属于当前陪伴流程的必需组件 |
| `WOWAddons/wow-ai-companion.html` | 早期研究方案 |
| `WOWAddons/*.zip` | 已生成的插件和历史交付源码包 |
| `snapshot-manifest.json` | 原文件 SHA-256、AIRI 基线及本次二开文件清单 |

`airi/` 和 `WOWAddons/` 保持同级，启动脚本可按相对路径找到 AIRI。原电脑上的工作目录仍为 `I:\GameTools\airi` 和 `I:\GameTools\WOWAddons`；本仓库不会改变正在使用的程序。

## 新电脑恢复与启动

需要 Windows、Python 3.10+、Node.js 和 AIRI 指定的 `pnpm@11.24.0`。本次成功构建使用 Node.js `24.14.0`；上游 `.tool-versions` 的版本与此次验证环境不同。在仓库根目录执行：

```powershell
cd airi
pnpm install --frozen-lockfile --ignore-scripts --filter '@proj-airi/stage-tamagotchi...'
pnpm -r --filter '@proj-airi/stage-tamagotchi^...' run build
pnpm -F '@proj-airi/stage-tamagotchi' exec install-electron
pnpm -F '@proj-airi/stage-tamagotchi' build
cd ..\WOWAddons
.\Install-WoWCompanion.ps1 -AddOnsPath '你的魔兽目录\_retail_\Interface\AddOns'
.\Start-WoWCompanion.cmd
```

随后打开本地 HTML 说明，按步骤启用插件、校准黑白网格采集区域，并在 AIRI 中选择聊天模型和语音服务。麦克风语音识别可选；游戏数据桥接不需要视觉模型。

HTML 中出现的 `I:\GameTools\...` 是原电脑的实际路径；在其他电脑上请换成当前克隆目录。GitHub 文件预览不会执行 HTML，需下载或克隆后在浏览器打开。

2026-10-23 更新至 2.2.0：只启动 AIRI 即可。开启陪伴连接后，AIRI 自动启动隐藏的 Python 桥接；关闭连接或退出 AIRI 时清理自有子进程，意外退出也通过管道关闭触发清理。兼容的外部桥接会被复用，保持原有生命周期。启动失败显示错误，30 秒后重试。仍需本机 Python 3.10+，本次没有捆绑 Python 解释器。源码版保留原 `bridge-config.json` 校准；打包版使用 AIRI 用户数据目录保存校准。`-BridgeOnly` 仅供独立排错。

本轮验证：AIRI 相关 59 项、Python 桥接 33 项通过；默认端口的真实管理启停、重启、外部复用及原校准保留通过。桌面 typecheck、中英文资源构建和生产构建通过；全仓 lint 0 错误、671 条既有警告。全仓 typecheck 因 model-driver-mediapipe 等其他包缺少依赖/类型及场景包类型错误未通过。详细命令、边界和需用户验收项目见 HTML。

## 快照范围与验证

这是可恢复的项目源码备份，不是包含依赖和 Electron 的免安装程序。保存了插件、桥接、完整 AIRI 源码、锁文件、工作区配置、补丁、资源及现有交付包。

未上传模型 API Key、账号登录数据、`.env` 实际环境文件、依赖缓存、未被上游跟踪的构建产物、运行日志、PID、安装备份、本机金币账本、游戏 SavedVariables 或本机采集坐标配置。配置样例保留；被省略的环境文件路径列在 `snapshot-manifest.json` 中。恢复后重新配置模型服务和采集坐标。

2026-10-22 插件更新至 2.1.1：删除游戏中央的地图、角色与金币文字面板，游戏中只保留 WCP1 数据传输码。角色、地图和金币采集继续供 AIRI 使用。已复测插件 20 项、桥接 32 项测试，全部通过；该轮仅修改插件。本次 2.2.0 更新需要正常退出旧 AIRI，再启动新版。

此前账号金币汇总版本 2.1.0 的验证记录：插件 20 项、桥接 32 项、AIRI 相关 43 项测试通过（含 8 项 Chromium 界面测试和 2 项退出生命周期测试）。桌面类型检查、中英文资源构建和生产构建通过；全仓 lint 0 错误、671 条原有警告。全仓 typecheck 因非桌面场景包缺少 vue-tsc 而未完成，不标记为通过。

金币以整数铜币记录，按账号与角色汇总流入、流出、净变化和最后已知余额，支持账号备注和重启持久化。插件首次余额不算收入，演示数据不入账，重复帧与重载不重复累计。账号标识来自本机 SavedVariables，余额不包含未观察角色、战团或公会银行。首次运行需登录各角色建立记录，真实余额与收支验收步骤见 HTML。当前新增功能通过自动化测试，尚未在真实金币交易中验收。

传输码保持 64×64 像素。此前 2.0 版的连续 20 次实机采集全部为 live、无错误，CRC 正确读取等级、地图与心跳；该记录不等于本轮金币功能已实机验证。

`WoWCompanion-2.16.0-source.zip` 是历史 2.16.0 插件、桥接和 AIRI 改动包，内部不含 AIRI 上游全仓；本仓库的 `airi/` 才是完整源码。历史交付包保留原版本。保留的 `build-delivery.py` 使用原独立 AIRI Git 仓库的差异生成增量包，不能直接把它在本合并快照仓库中的输出当作完整备份。

## 上游与许可

AIRI 来源：[moeru-ai/airi](https://github.com/moeru-ai/airi)，基线提交 `747d4f68aa42180671de3071fb78d5e6129433bd`，版本 `0.12.0-beta.5`。本仓库保存当前源码快照，不复制上游完整 Git 历史。

保留 [AIRI MIT License](airi/LICENSE) 及源码、字体、模型和其他资源各自的许可、版权说明。各组件继续遵循其原有许可。
