# 魔兽世界陪伴精灵 · WoW AIRI Companion

魔兽世界正式服与无限服插件、本机屏幕桥接服务，以及 AIRI 桌面端二开的完整项目快照。

插件把角色、地图、金币、升级、死亡等状态编码到游戏画面的 WCP1 黑白网格；Python 桥接程序解码后提供本机 HTTP 接口，AIRI 根据角色设定生成聊天和语音回应，并在本机保存每个账号的金币收支账本。

## 当前版本：2.12.4

同步正式服插件 2.10.1、无限服插件 1.7.1、桥接 2.11.1，以及 AIRI 配套源码。无限服尚需在开放后的客户端验收。

- 登录和获取新装备时，同步全身当前穿戴信息。AIRI 按角色保存，聊天可结合角色名、阵营、种族和装备资料。
- 按角色记录现实世界的等级变化时间和每级耗时，包含离线时间。
- 比较新装备与对应槽位的旧装备。符合提升规则时祝贺并询问换装，说明已识别的属性取舍。
- 配置语音后使用语音和字幕气泡。选择“好”后，仍需在游戏内点击确认换装。
- 连续非战斗每 1 分钟尝试一次简短语音互动。战斗、离线、静音和过期状态会重置计时。
- 传输码默认缩至 64×64 物理像素。屏幕校准支持预览和原位置附近的局部识别。
- 桌面使用固定用户数据目录，重启后恢复模型配置和角色资料。
- 正式服和无限服设置内的产品文案改为“魔兽陪伴精灵”。窗口采用 W 图标，角色窗口最小宽度为 300 逻辑像素。

提交前复测：正式服 Lua 151 项、无限服 Lua 155 项、Python 桥接 146 项、AIRI Node 320 项、桌面界面 141 项、聊天与字幕契约 84 项通过，共 997 项。AIRI Node 另有 15 项跳过。

桌面类型检查和生产构建通过，全仓 lint 为 0 错误、671 条既有警告。实机边界见 [HTML 说明](WOWAddons/wow-companion-implementation.html)。全仓类型检查仍因场景包缺少 `vue-tsc` 而未通过。

[软件使用说明](WOWAddons/魔兽陪伴精灵-使用说明.html) 提供启动、配置和日常使用步骤。更新桌面代码后，从托盘正常退出，再运行 `WOWAddons/Start-WoWCompanion.cmd`。正式服插件更新后，在游戏输入 `/reload`。

## 角色语录与未来人设参考

[阅读 12 页 PDF](WOWAddons/output/pdf/魔兽世界经典角色语录与陪伴人设.pdf)：收录希尔瓦娜斯、阿尔萨斯、伊利丹等 12 位角色的 24 条短句、6 项玩家梗或归属辨析，以及来源、语气规则和原创陪伴示例。

[结构化 JSON](WOWAddons/research/warcraft-characters/warcraft-character-library.json) 与 [生成脚本](WOWAddons/research/warcraft-characters/build_library.py) 一并保存。原作短引、中文译写和原创示例分别标注。该资料用于后续开发，尚未接入 AIRI，也未包含人物模型或原声资源。

## 可导入角色资产

[希尔瓦娜斯卡通陪伴形象 v0.3](assets/sylvanas-companion/README.md)：Spine 4.2 模型，包含 19 个动作、肘部弯曲和闭合握弓手。

[下载 AIRI 导入包](assets/sylvanas-companion/output/sylvanas-companion.spine.zip) · [全身预览](assets/sylvanas-companion/output/portrait.png) · [握弓近景](assets/sylvanas-companion/output/grip-closeup-idle.png)

该角色采用手动导入，未替换默认形象。首次导入需要按资产说明设置透明混合模式。源贴图、生成提示词、绑定脚本和验证记录一并保存在资产目录。

## 项目内容

| 路径 | 内容 |
| --- | --- |
| `WOWAddons/WoWMapCompanion/` | 正式服 Lua 插件、WCP1 编码、测试 |
| `WOWAddons/WoWForeverCompanion/` | 无限服独立 Lua 插件、WCF1 编码、测试与安装说明 |
| `WOWAddons/WoWCompanionBridge/` | Windows 屏幕采集、协议解码、事件状态、本机校准页面和测试 |
| `airi/` | AIRI 上游完整源码快照，包含本次修改和新增的魔兽陪伴功能 |
| `assets/sylvanas-companion/` | 希尔瓦娜斯 v0.3 导入包、可重建源文件、预览与来源说明 |
| `WOWAddons/Start-WoWCompanion.cmd` | 启动已构建的 AIRI 桌面端，由 AIRI 自动管理桥接 |
| `WOWAddons/Install-WoWCompanion.ps1` | 将插件安装到正式服 AddOns 目录 |
| `WOWAddons/魔兽陪伴精灵-使用说明.html` | 启动、模型配置和日常使用说明 |
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

`WoWCompanion-2.12.4-source.zip` 是当前插件、桥接和 AIRI 改动包，内部不含 AIRI 上游全仓；本仓库的 `airi/` 才是完整源码。历史交付包保留原版本。保留的 `build-delivery.py` 使用原独立 AIRI Git 仓库的差异生成增量包，不能直接把它在本合并快照仓库中的输出当作完整备份。

## 上游与许可

AIRI 来源：[moeru-ai/airi](https://github.com/moeru-ai/airi)，基线提交 `747d4f68aa42180671de3071fb78d5e6129433bd`，版本 `0.12.0-beta.5`。本仓库保存当前源码快照，不复制上游完整 Git 历史。

保留 [AIRI MIT License](airi/LICENSE) 及源码、字体、模型和其他资源各自的许可、版权说明。各组件继续遵循其原有许可。
