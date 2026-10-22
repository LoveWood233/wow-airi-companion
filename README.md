# 魔兽世界陪伴精灵 · WoW AIRI Companion

魔兽世界正式服插件、本机屏幕桥接服务，以及 AIRI 桌面端二开的完整项目快照。

插件把角色、地图、金币、升级、死亡等状态编码到游戏画面的 WCP1 黑白网格；Python 桥接程序解码后提供本机 HTTP 接口，AIRI 根据角色设定生成聊天和语音回应，并在本机保存每个账号的金币收支账本。

## 项目内容

| 路径 | 内容 |
| --- | --- |
| `WOWAddons/WoWMapCompanion/` | 正式服 Lua 插件、WCP1 编码、测试 |
| `WOWAddons/WoWCompanionBridge/` | Windows 屏幕采集、协议解码、事件状态、本机校准页面和测试 |
| `airi/` | AIRI 上游完整源码快照，包含本次修改和新增的魔兽陪伴功能 |
| `WOWAddons/Start-WoWCompanion.cmd` | 一键启动桥接和已构建的 AIRI 桌面端 |
| `WOWAddons/Install-WoWCompanion.ps1` | 将插件安装到正式服 AddOns 目录 |
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

## 快照范围与验证

这是可恢复的项目源码备份，不是包含依赖和 Electron 的免安装程序。保存了插件、桥接、完整 AIRI 源码、锁文件、工作区配置、补丁、资源及现有交付包。

未上传模型 API Key、账号登录数据、`.env` 实际环境文件、依赖缓存、未被上游跟踪的构建产物、运行日志、PID、安装备份、本机金币账本、游戏 SavedVariables 或本机采集坐标配置。配置样例保留；被省略的环境文件路径列在 `snapshot-manifest.json` 中。恢复后重新配置模型服务和采集坐标。

2026-10-22 插件更新至 2.1.1：删除游戏中央的地图、角色与金币文字面板，游戏中只保留 WCP1 数据传输码。角色、地图和金币采集继续供 AIRI 使用。已复测插件 20 项、桥接 32 项测试，全部通过；当前已安装 2.1.0 的电脑只需在游戏输入 `/reload`，无需重启 AIRI。

此前账号金币汇总版本 2.1.0 的验证记录：插件 20 项、桥接 32 项、AIRI 相关 43 项测试通过（含 8 项 Chromium 界面测试和 2 项退出生命周期测试）。桌面类型检查、中英文资源构建和生产构建通过；全仓 lint 0 错误、671 条原有警告。全仓 typecheck 因非桌面场景包缺少 vue-tsc 而未完成，不标记为通过。

金币以整数铜币记录，按账号与角色汇总流入、流出、净变化和最后已知余额，支持账号备注和重启持久化。插件首次余额不算收入，演示数据不入账，重复帧与重载不重复累计。账号标识来自本机 SavedVariables，余额不包含未观察角色、战团或公会银行。首次运行需登录各角色建立记录，真实余额与收支验收步骤见 HTML。当前新增功能通过自动化测试，尚未在真实金币交易中验收。

传输码保持 64×64 像素。此前 2.0 版的连续 20 次实机采集全部为 live、无错误，CRC 正确读取等级、地图与心跳；该记录不等于本轮金币功能已实机验证。

`WoWCompanion-2.1.1-source.zip` 是已更新的插件、桥接和 AIRI 改动包，内部不含 AIRI 上游全仓；本仓库的 `airi/` 才是完整源码。保留的 `build-delivery.py` 使用原独立 AIRI Git 仓库的差异生成增量包，不能直接把它在本合并快照仓库中的输出当作完整备份。

## 上游与许可

AIRI 来源：[moeru-ai/airi](https://github.com/moeru-ai/airi)，基线提交 `747d4f68aa42180671de3071fb78d5e6129433bd`，版本 `0.12.0-beta.5`。本仓库保存当前源码快照，不复制上游完整 Git 历史。

保留 [AIRI MIT License](airi/LICENSE) 及源码、字体、模型和其他资源各自的许可、版权说明。各组件继续遵循其原有许可。
