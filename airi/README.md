# 魔兽陪伴精灵

Windows 桌面端，提供魔兽世界角色陪伴、模型聊天、语音字幕、关系记忆和截图对话。

当前本机交付版：桌面 **2.27.1**，正式服插件和桥接 **2.25.0**，无限服插件 **1.21.0**。文档更新：2026-11-08。

## 使用

1. 从系统托盘正常退出旧版。
2. 在同级 `WOWAddons` 目录运行 [Start-WoWCompanion.cmd](../WOWAddons/Start-WoWCompanion.cmd)。
3. 在设置中配置聊天模型和形象，按需配置语音、听觉与视觉服务。软件无需账号登录。
4. 在“魔兽世界正式服”或“魔兽世界：无限”中开启游戏陪伴。
5. 更新配套插件后，完整重启游戏，登录角色并检查传输码采集区域。

其他电脑使用完整解压的 Windows x64 便携包。发行包自带桌面运行环境及 Python，不需要安装 Node.js、pnpm 或 Python。

## 2.27.0 桌宠显示

桌面采用 dsh-pet 的透明 WebM 动画。内置114段蓝发小女仆动作，支持点击、拖动、随机动作、睡眠、唤醒、转身及聊天状态联动。

“设置 → 桌宠形象”提供预览、动画包导入和50–200%大小。主桌面与工作区使用同一选择，语音由主窗口统一播放，字幕跟随实际播放状态。原模型加载入口由桌宠界面替换。详细格式与安装方式见[说明](../WOWAddons/wow-companion-implementation.html#dsh-pet-2-27)。

## 2.26.0 安装与用量统计

客户端增加“设置 → 安装与用量统计”。首次告知默认勾选开启，点击“继续”后才开始收集和发送，可随时关闭。服务器地址为空时不发送。

独立[数据中台](../WOWAddons/WoWCompanionDataHub/README.md)使用 Docker 与 SQLite，提供管理员面板、安装及活跃数量、Token 汇总和每日趋势。客户端立即登记随机安装身份，每 300 秒上传累计检查点，重试不重复累计。

仅统计服务商返回的模型用量，不发送聊天、角色、截图、音频或 API Key。缺失用量保留未知，SDK 工具调用覆盖可能不完整，TTS／ASR 未纳入。安装数不等于人数，统计不能作为账单。详细字段、部署和限制见服务端说明。

## 2.25.0 精简

- 插件统一提供装备判定和任务候选，桌面保留关联、时效和表达，不重复判断。
- 换装只在游戏内确认，桌面气泡不再显示第二组确认按钮。
- 升级、生死、日历及增益等固定通知使用模板，共用语音和字幕，不调用聊天模型。
- 无语音模型或语音失败时显示文字；自然聊天、记忆、地图逸闻及截图对话继续使用原服务和人设。
- 游戏设置默认保留连接、角色概览及偏好；角色档案、诊断和事件按需展开。
- 附加功能集中到“设置 → 魔兽工具”，包括插件中心、启动配置、资料查询、更新与备份。

插件中心的 CurseForge API Key 与模型服务凭据分别配置。数据码解码不需要视觉模型或 CurseForge Key。

## 个人资料

默认位置为 `%USERPROFILE%\.airi-wow-companion`，设置 `APP_USER_DATA_PATH` 时使用指定目录。
物品仓库保存在 `wow-companion-items.sqlite`。银行需在游戏内打开才能扫描，旧记录保留采集日期与完整性标记。

原模型配置、历史档案、关系记忆和 SQLite 保留。普通软件备份不包含服务密钥和模型文件，迁移自己的完整资料前先退出两边程序。

本机程序包按独立系列保留最近 5 个版本，源码、个人配置、数据库和备份不参与清理。

详细步骤见 [项目 README](../WOWAddons/README.md)、[软件使用说明](../WOWAddons/魔兽陪伴精灵-使用说明.html)和[实现说明](../WOWAddons/wow-companion-implementation.html#companion-slim-2-25)。

## 开发

使用仓库指定的 Node.js 和 pnpm 版本，安装依赖后运行：

```powershell
$env:pnpm_config_verify_deps_before_run='warn'
pnpm -F @proj-airi/i18n build
pnpm -F @proj-airi/stage-tamagotchi typecheck
pnpm -F @proj-airi/stage-tamagotchi build
```

源目录名、工作区包名、通信协议和存储标识保持稳定，现有用户无需迁移模型配置和角色资料。

开发模式桥接需要 Python 3.10 或更新版本。桌面类型检查和构建已通过；全仓类型检查仍受独立场景包缺少 `vue-tsc` 阻断。
职责和版本边界见 [架构说明](docs/ai/adr/wow-companion-responsibilities.md)。

## 开源许可

保留 [MIT 许可证](LICENSE) 以及各组件的版权与许可证。第三方组件继续遵循原许可证。

项目地址：[wow-airi-companion](https://github.com/LoveWood233/wow-airi-companion)。本机开发目录与仓库检出目录独立维护，README 更新不代表已同步源码或推送 GitHub。
