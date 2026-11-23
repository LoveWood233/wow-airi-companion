# 魔兽陪伴精灵

本仓库根目录 `./` 是项目的统一开发入口。目录统一于 2026-11-08 完成。下文的项目路径均相对于仓库根目录，命令块另行注明工作目录。

| 目录 | 内容 |
| --- | --- |
| 桌面源码目录 | 桌面二开源码、工作区依赖、构建脚本与本机发行目录，下方命令按源码布局自动定位 |
| `WOWAddons/` | 正式服与无限服插件、屏幕桥接、数据中台、数据资料、启动与交付脚本 |
| `assets/` | 仓库已有的角色与参考资源 |
| `backups/`、`WOWAddons/logs/` | 本机迁移恢复资料与验证记录，Git 忽略 |

桌面发布标识为 **2.28.0**，当前源码中的正式服插件与桥接为 **2.26.0**、无限服插件为 **1.22.0**。桌面采用 dsh-pet 透明 WebM 动画。已有安装包的配套组件版本以安装目录下的 `resources/wow-companion-release.json` 为准。无限服新增武器熟练度读取与传输，聊天可使用当前已学习武器技能的数值。

## 启动

双击仓库根目录的 [Start-WoWCompanion.cmd](Start-WoWCompanion.cmd)。启动入口按仓库布局定位桌面程序。

启动器会选择默认个人资料目录，`APP_USER_DATA_PATH` 可指定独立资料目录。实际使用位置见启动日志。
启动脚本按仓库内的相对目录定位桌面程序。后续开发、构建和交付均在本仓库执行。

## 开发与协作

先阅读 [AGENTS.md](AGENTS.md) 和 [交接文档](HANDOVER.md)，再阅读桌面源码目录中的 `AGENTS.md`。以下命令从仓库根目录执行，先按源码布局定位桌面目录。

拟开发方案：陪伴精灵人性化交互设计（桌面源码内 `docs/ai/adr/wow-companion-humanlike-interaction.md`），当前为待评审提案。

```powershell
$desktopSource = Get-ChildItem -Directory | Where-Object {
    Test-Path -LiteralPath (Join-Path $_.FullName 'apps/stage-tamagotchi/package.json')
}
Set-Location -LiteralPath $desktopSource.FullName
$env:pnpm_config_verify_deps_before_run='warn'
pnpm -C packages/i18n build
pnpm -C apps/stage-tamagotchi typecheck
pnpm -C apps/stage-tamagotchi build
```

现有工作区保留了迁移后的本机依赖。新电脑必须按交接文档安装依赖，不能复制本机的绝对目录链接。
迁移与兼容合并后的文件已纳入统一仓库。协作者拉取远端 `main` 后，运行 `git rev-parse HEAD`，以实际提交号确认共同开发基线。

## 使用与实现资料

- 桌面源码说明（桌面源码内 `README.md`）
- [当前功能、安装与实现说明](WOWAddons/wow-companion-implementation.html)
- [插件与桥接说明](WOWAddons/README.md)
- [无限服功能支持与本机验收记录](WOWAddons/docs/forever-support.md)
- [数据中台部署](WOWAddons/WoWCompanionDataHub/README.md)
- MIT许可证（桌面源码内 `LICENSE`）

旧桌面源码的 Git 元数据、原目标源码及兼容合并恢复资料保存在本机 `backups/migration-20261108-001/`。
以下保留早期同步记录。各次同步的版本、功能边界和验证结果按对应历史时点阅读。当前源码版本与启动入口见上文。

<details>
<summary>仓库既有源码快照与开发历史（保留原同步记录）</summary>

# 魔兽世界陪伴精灵源码与开发历史

魔兽世界正式服与无限服插件、本机屏幕桥接服务，以及魔兽陪伴精灵桌面端二开的完整项目快照。

插件把角色、地图、金币、升级、死亡等状态编码到游戏画面的 WCP1 黑白网格；Python 桥接程序解码后提供本机 HTTP 接口，魔兽陪伴精灵根据角色设定生成聊天和语音回应，并在本机保存每个账号的金币收支账本。

## 功能清单历史记录（2026-11-01）

[最新功能与待办](WOWAddons/魔兽陪伴精灵-最新功能与待办-2026-11-01.md)整理了本地已实现能力、待实机验收项目、独立成果和未开发扩展，并记录备份、安装与更新交付的最新检查结果。

## 游戏插件如何与魔兽陪伴精灵通信

[游戏插件通信协议](WOWAddons/WoWCompanion-PROTOCOL.md)介绍 Lua 采集与 WCP1/WCF1 屏幕传输。桌面通过 Python 本机 HTTP 和 Eventa IPC 接收数据，离线存档和宏导入回执的排查入口见插件与桥接说明。

本次同步正式服插件 **2.20.0**、无限服插件 **1.18.0**、桥接 **2.20.0** 的源码与测试。宏导入插件 **1.0.0** 的源码已在仓库中。
新增源码包含离线历史、库存、任务和天赋传输。插件保存能力、桥接接收能力与魔兽陪伴精灵界面消费能力分别说明，不能由插件版本推断桌面功能已经全部接通。
该次同步时，魔兽陪伴精灵的通用角色服务尚未导入 SavedVariables 中的 `snapshotJSON`。当前桌面已实现从已配置游戏目录读取 `snapshotJSON.offlineHistory`，导入离线角色、金币、等级与装备历史，相关实现位于桌面源码中的离线历史导入模块。其他本地向导、备份及安装更新功能的历史同步范围按当时记录阅读。

## 已有桌面功能基线：日历与组队增益提醒

该功能基线最初使用正式服插件 2.15.0、无限服插件 1.12.0、桥接 2.14.0。当前插件源码版本见上方同步说明。

- **组队增益语音提醒**：进入副本、团队副本、场景战役或战场后，检查当前角色已学会的队伍增益。有人缺少时，使用当前陪伴角色的语音提醒。同次进入同种增益最多提醒一次，战斗和静音中延后，不自动施法。
- **首次登录日历提醒**：活动开始当日、结束前一天提醒。私人日程、公会活动和当前角色的副本重置也纳入范围，并按服务器日期去重。
- **副本场景观测**：传输码增加副本类型和地图实例 ID。不可读取的数据保持未知，避免错误判断。
- 保留 [宏导入](WOWAddons/WoWMacroImport/README.md)、角色陪伴、语音字幕、装备比较与确认换装、金币账本和等级历史。

增益支持战斗怒吼、奥术智慧、真言术：韧、野性印记、天怒、青铜龙的祝福。需要启用陪伴连接并配置当前陪伴角色的语音。读取受限、离线、死亡或超出可检查距离的队友不计为缺少增益。无限服自定义客户端需提供相应现代游戏接口。

[本次推送验证记录](WOWAddons/verification-group-buffs-publish-2026-10-29.md) 说明发布树的检查结果与限制。此前的 [开发环境验证记录](WOWAddons/group-buffs-verification-2026-10-29.md) 单独保留。实际副本、战场及扬声器播报仍待实机验收。

当前插件请使用 [正式服源码与安装说明](WOWAddons/WoWMapCompanion/README.md) 或 [无限服源码与安装说明](WOWAddons/WoWForeverCompanion/README.md)。旧版本插件安装包和增量 source 包已于 2026-11-01 从当前分支删除。

更新后，在游戏内输入 `/reload`，并从托盘正常退出、重新启动陪伴精灵。当前代码以仓库文件为准；完整源码可从仓库首页下载 ZIP 或通过 Git 克隆。

[功能现状与扩展规划](WOWAddons/魔兽陪伴精灵-功能现状与扩展规划.md) 还包括其他开发会话的进展，不能据此认定本次提交已同步全部功能。[软件使用说明](WOWAddons/魔兽陪伴精灵-使用说明.html) 提供配置步骤。

## 角色语录与未来人设参考

[阅读 12 页 PDF](WOWAddons/output/pdf/魔兽世界经典角色语录与陪伴人设.pdf)：收录希尔瓦娜斯、阿尔萨斯、伊利丹等 12 位角色的 24 条短句、6 项玩家梗或归属辨析，以及来源、语气规则和原创陪伴示例。

[结构化 JSON](WOWAddons/research/warcraft-characters/warcraft-character-library.json) 与 [生成脚本](WOWAddons/research/warcraft-characters/build_library.py) 一并保存。原作短引、中文译写和原创示例分别标注。该资料用于后续开发，尚未接入魔兽陪伴精灵，也未包含人物模型或原声资源。

## 游戏截图辅助

桌面端“设置 → 游戏截图辅助”可启用按需看图，选择自动识别或正式服、无限服、怀旧服窗口。
先在“视觉”设置中配置支持图片的模型，然后在聊天或语音中说“帮我看看面前这个地形能走过去吗”或“任务 NPC 在这里却找不到，你能带我过去吗”。
也可输入 `/look 帮我找附近的入口` 明确触发。精灵截取一帧已验证的游戏窗口，结合当前问题分析可见路线、任务文字与地标。
移动或转动镜头后再次请求，才会查看新画面。普通聊天和游戏事件不会触发此截图；它不自动操控角色，也不能仅凭一帧确认碰撞或任务相位。
当前支持 Windows，原图不保存到本地聊天记录。架构、验证命令和限制见截图辅助说明（桌面源码内 `docs/ai/adr/wow-screen-assist.md`）。

## 快捷启动魔兽世界

桌面端“设置 → 游戏启动配置”可分别保存战网、正式服、无限服和怀旧服程序路径，并设置默认启动目标。
选择实际 `.exe` 后点击“校验并保存”。角色工具栏的快捷启动按钮会启动已保存的默认目标；未配置时进入配置页。
保存与启动前均核对官方签名、程序身份和游戏安装版本，选错版本不会覆盖原配置。战网目标会打开战网，登录和更新由游戏及战网处理。
当前支持 Windows。具体安装目录、校验规则和支持范围见启动功能说明（桌面源码内 `docs/ai/adr/wow-companion-launcher.md`）。

## 魔兽聊天知识库

知识库说明（桌面源码内 `packages/stage-shared/src/wow-knowledge/README.md`）介绍正式服、无限服、怀旧服的知识分类，以及通用知识与中文、英文社区用语的区别。
知识条目包含缩写释义、梗的使用语境、来源和核对日期。聊天按当前消息检索相关内容，优先采用用户明确提到的游戏版本。
怀旧服目前用于知识检索与聊天，不包含新的实时采集插件。版本机制和未确认的台词归属保留明确边界。

## 可导入角色资产

[希尔瓦娜斯卡通陪伴形象 v0.3](assets/sylvanas-companion/README.md)：Spine 4.2 模型，包含 19 个动作、肘部弯曲和闭合握弓手。

[下载魔兽陪伴精灵导入包](assets/sylvanas-companion/output/sylvanas-companion.spine.zip) · [全身预览](assets/sylvanas-companion/output/portrait.png) · [握弓近景](assets/sylvanas-companion/output/grip-closeup-idle.png)

该角色采用手动导入，未替换默认形象。首次导入需要按资产说明设置透明混合模式。源贴图、生成提示词、绑定脚本和验证记录一并保存在资产目录。

## 大肥鱼经典八职业动作资产

[大肥鱼 × 经典八职业](assets/dafeiyu-classic/README.md) 当前为 **v0.4.0 修复候选版**，包含源图、配置与重建工具，可生成八职业各 120 段 640×360、60 fps 透明 WebM。完整媒体通过资产说明中的 GitHub Release 分发，候选版仍有装备、遮挡和关节连续性问题待视觉验收。

历史 v0.3.2 只修复战士开心蹦跳，其余 959 段媒体沿用前一版。

[修复后战士蹦跳预览](assets/dafeiyu-classic/preview/happy-jump.mp4) · [生成与导入说明](assets/dafeiyu-classic/README.md#安装与重建)。完整视频及可导入 ZIP 在本地生成；修复范围、历史验收遗漏和其余动作的限制见资产说明。

## Live2D Q 版角色

[希尔瓦娜斯 Q 版 Live2D v2](assets/sylvanas-live2d/README.md)：约 2.5 头身，紫色兜帽、银发、灰蓝肤色、红瞳，冷傲中带一点傲娇。

提供[Live2D v2 导入 ZIP](assets/sylvanas-live2d/output/sylvanas-chibi-v2.live2d.zip)、Cubism 源工程、七层可编辑 PSD 与[制作说明](assets/sylvanas-live2d/production-guide.md)。v2 增加鼠标视线跟随、内置眨眼与打哈欠，保留口型和循环呼吸。导入后开启鼠标跟踪，将眨眼模式设为“自动”，空闲动画选择 `Idle`。

## 项目内容

| 路径 | 内容 |
| --- | --- |
| `WOWAddons/WoWMapCompanion/` | 正式服 Lua 插件、WCP1 编码、测试 |
| `WOWAddons/WoWForeverCompanion/` | 无限服独立 Lua 插件、WCF1 编码、测试与安装说明 |
| `WOWAddons/WoWMacroImport/` | 宏校验、保存窗口与自动导入回执 |
| `WOWAddons/WoWCompanionBridge/` | Windows 屏幕采集、协议解码、事件状态、本机校准页面和测试 |
| 桌面源码目录 | 桌面程序源码及魔兽陪伴功能 |
| `assets/sylvanas-companion/` | 希尔瓦娜斯 v0.3 导入包、可重建源文件、预览与来源说明 |
| `assets/sylvanas-live2d/` | 希尔瓦娜斯 Q 版 Live2D 导入包、Cubism 源工程、七层 PSD、提示词与验证记录 |
| `assets/dafeiyu-classic/` | 大肥鱼八职业源图、120动作配置、60fps生成工具和原生导入验证 |
| `WOWAddons/Start-WoWCompanion.cmd` | 启动已构建的魔兽陪伴精灵桌面端，由魔兽陪伴精灵自动管理桥接 |
| `WOWAddons/Install-WoWCompanion.ps1` | 将插件安装到正式服 AddOns 目录 |
| `WOWAddons/魔兽陪伴精灵-使用说明.html` | 启动、模型配置和日常使用说明 |
| `WOWAddons/魔兽陪伴精灵-功能现状与扩展规划.md` | 当前能力、验收边界及后续扩展建议 |
| `WOWAddons/wow-companion-implementation.html` | 功能清单、实现逻辑、配置步骤和需用户协助的验收事项 |
| `WOWAddons/WoWCompanion-PROTOCOL.md` | WCP1/WCF1 数据协议与边界说明 |
| `WOWAddons/WoWIntelAPI/` | 早期独立攻略情报接口源码，保留归档，不属于当前陪伴流程的必需组件 |
| `WOWAddons/wow-ai-companion.html` | 早期研究方案 |
| `snapshot-manifest.json` | 早期源码快照的 SHA-256、上游基线与同步记录，字段按当时目录和版本解释 |

桌面源码目录和 `WOWAddons/` 保持同级，启动脚本按相对路径找到桌面程序。后续开发和启动均使用当前仓库。

## 新电脑恢复与启动

需要 Windows、Python 3.10+、Node.js 和魔兽陪伴精灵指定的 `pnpm@11.24.0`。本次成功构建使用 Node.js `24.14.0`；上游 `.tool-versions` 的版本与此次验证环境不同。在仓库根目录执行：

```powershell
$desktopSource = Get-ChildItem -Directory | Where-Object {
    Test-Path -LiteralPath (Join-Path $_.FullName 'apps/stage-tamagotchi/package.json')
}
Set-Location -LiteralPath $desktopSource.FullName
pnpm install --frozen-lockfile --ignore-scripts --filter '{./apps/stage-tamagotchi}...'
pnpm -r --filter '{./apps/stage-tamagotchi}^...' run build
pnpm -C apps/stage-tamagotchi exec install-electron
pnpm -C apps/stage-tamagotchi build
Set-Location ..\WOWAddons
$addOnsPath = Read-Host '请输入正式服 Interface\AddOns 目录（相对于当前目录）'
.\Install-WoWCompanion.ps1 -AddOnsPath $addOnsPath
.\Start-WoWCompanion.cmd
```

随后打开本地 HTML 说明，按步骤启用插件、校准黑白网格采集区域，并在魔兽陪伴精灵中选择聊天模型和语音服务。麦克风语音识别可选；游戏数据桥接不需要视觉模型。

配套 HTML 说明中的历史安装路径应按当前克隆目录替换。GitHub 文件预览不会执行 HTML，需下载或克隆后在浏览器打开。

2026-10-23 更新至 2.2.0：只启动魔兽陪伴精灵即可。开启陪伴连接后，魔兽陪伴精灵自动启动隐藏的 Python 桥接；关闭连接或退出魔兽陪伴精灵时清理自有子进程，意外退出也通过管道关闭触发清理。兼容的外部桥接会被复用，保持原有生命周期。启动失败显示错误，30 秒后重试。仍需本机 Python 3.10+，本次没有捆绑 Python 解释器。源码版保留原 `bridge-config.json` 校准；打包版使用魔兽陪伴精灵用户数据目录保存校准。`-BridgeOnly` 仅供独立排错。

本轮验证：魔兽陪伴精灵相关 59 项、Python 桥接 33 项通过；默认端口的真实管理启停、重启、外部复用及原校准保留通过。桌面 typecheck、中英文资源构建和生产构建通过；全仓 lint 0 错误、671 条既有警告。全仓 typecheck 因 model-driver-mediapipe 等其他包缺少依赖/类型及场景包类型错误未通过。详细命令、边界和需用户验收项目见 HTML。

## 快照范围与验证

这是可恢复的项目源码备份，不是包含依赖和 Electron 的免安装程序。保存了插件、桥接、完整魔兽陪伴精灵源码、锁文件、工作区配置、补丁、资源及仍保留的独立组件包。

未上传模型 API Key、账号登录数据、`.env` 实际环境文件、依赖缓存、未被上游跟踪的构建产物、运行日志、PID、安装备份、本机金币账本、游戏 SavedVariables 或本机采集坐标配置。配置样例保留；被省略的环境文件路径列在 `snapshot-manifest.json` 中。恢复后重新配置模型服务和采集坐标。

2026-10-22 插件更新至 2.1.1：删除游戏中央的地图、角色与金币文字面板，游戏中只保留 WCP1 数据传输码。角色、地图和金币采集继续供魔兽陪伴精灵使用。已复测插件 20 项、桥接 32 项测试，全部通过；该轮仅修改插件。本次 2.2.0 更新需要正常退出旧魔兽陪伴精灵，再启动新版。

此前账号金币汇总版本 2.1.0 的验证记录：插件 20 项、桥接 32 项、魔兽陪伴精灵相关 43 项测试通过（含 8 项 Chromium 界面测试和 2 项退出生命周期测试）。桌面类型检查、中英文资源构建和生产构建通过；全仓 lint 0 错误、671 条原有警告。全仓 typecheck 因非桌面场景包缺少 vue-tsc 而未完成，不标记为通过。

金币以整数铜币记录，按账号与角色汇总流入、流出、净变化和最后已知余额，支持账号备注和重启持久化。插件首次余额不算收入，演示数据不入账，重复帧与重载不重复累计。账号标识来自本机 SavedVariables，余额不包含未观察角色、战团或公会银行。首次运行需登录各角色建立记录，真实余额与收支验收步骤见 HTML。当前新增功能通过自动化测试，尚未在真实金币交易中验收。

传输码保持 64×64 像素。此前 2.0 版的连续 20 次实机采集全部为 live、无错误，CRC 正确读取等级、地图与心跳；该记录不等于本轮金币功能已实机验证。

本仓库的桌面源码目录保存完整桌面程序源码。此前的版本化插件 ZIP 和增量 source ZIP 已从当前分支删除，历史提交仍保留。`snapshot-manifest.json` 已移除相应包的文件校验项与交付路径引用，其他历史同步元数据保留原有含义。保留的 `build-delivery.py` 使用原独立桌面源码 Git 仓库的差异生成增量包，不能直接把它在本合并快照仓库中的输出当作完整备份。

## 开源许可

保留 MIT 许可证（桌面源码内 `LICENSE`）及源码、字体、模型和其他资源各自的许可、版权说明。各组件继续遵循其原有许可。

</details>
