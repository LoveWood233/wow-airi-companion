# 首次使用向导深化：配置检查

日期：2026-10-31。范围为用户已确认的 4.1 第 1 项，不包含后续 MCP 对话验收、节奏、连接优化、通用备份或安装包更新流程。

## 入口与行为

“设置 → 首次使用向导”新增配置检查卡。向导欢迎和完成步骤均可点击“配置检查”，收起遮罩后操作。

| 项目 | 实际检查与边界 |
| --- | --- |
| 客户端 | 支持选择和手动修改版本目录；核对 WoW 可执行文件、目录归属、`.flavor.info` 与 `.build.info`，显示所选产品版本。已有启动路径可作为初始目录建议。 |
| 插件 | 核对 TOC 版本和所有清单 Lua 文件；无限服同时要求普通／Camelot 清单一致。与随应用提供的版本比较。 |
| Python | 复用桥接的检测流程，实际运行短命令确认 Python 3.10+，排除 WindowsApps 商店别名；显示解释器路径。 |
| 桥接 | 检查入口及 capture／geometry／protocol／state 文件，显示当前桥接生命周期和错误。仅文件存在而未运行时仍为“未测试”。检查不启动桥接。 |
| 实时角色 | 页面打开时定期读取状态，要求真实 screen 来源、近期有效时间、在线角色与未暂停采集；显示角色、服务器、最近有效时间。演示数据不能通过。 |
| 聊天 | 配置存在只算“未测试”。用户点击后，用当前服务和模型发送固定短测试，无工具、历史、截图或角色资料；非空回复才通过。 |
| 语音 | 用户点击后，用当前语音服务／模型／音色生成固定短语并播放；播放开始后仍为“未测试”，用户确认听见才通过。“没听见”保留失败。 |

状态为“通过／失败／未配置／未测试”，没有“浏览完即通过”的转换。
模型测试支持超时和取消，切换选择或离开页面会取消进行中的测试并释放音频。
语音检查使用服务的 speech 请求接口，专用流式服务如果不提供该接口会报告失败，可到原语音设置页使用服务专用试听。

## 安装动作

- 只有点击“安装／更新配套插件”才写入游戏目录。
- 只允许安装选中版本对应的自有插件，不通过 CurseForge 下载，不需要其 API Key。
- 先校验客户端、源文件及目标目录，拒绝符号链接；写入临时目录后再替换。
- 已有插件先移动到同一客户端 `Interface/CompanionBackups`，安装失败时尝试恢复。
- 界面显示备份路径和完整重启游戏的提示，不代替用户启用插件或登录角色。
- 应用退出时等待当前安装结束。安装包资源清单已加入两服自有插件。
- 本次没有对用户的真实 AddOns 目录执行安装或更新。

## 验证

- Node：插件检查、显式安装、备份保留、无源文件拒绝安装、目录穿越拒绝、两份无限服清单，以及既有桥接回归，共 26 项通过、9 项显式启用的旧集成测试跳过。
- Chromium：配置检查、已配置但无效的模型、实际浏览器音频解码和人工确认、向导回归及首次启动，共 17 项通过。
- 语音服务在自动化测试中返回合法静音 WAV，浏览器实际解码和播放；这不是扬声器真实听感验收。
- 实际只读检查：本机正式服 `12.1.5.70575`、已安装插件 `2.15.0`、Python 3.13 和桥接文件被识别。检测实例的运行状态为 stopped，没有据此标记连接成功。
- 未调用真实付费聊天或语音服务，未重启游戏或陪伴精灵。

| 工程检查 | 结果 |
| --- | --- |
| i18n 构建与类型检查 | 通过 |
| 桌面类型检查 | 通过 |
| 桌面构建 | 通过，新输出已生成 |
| 全仓库 lint | 0 错误、670 个现有警告 |
| 全仓库类型检查 | 被现有 scenarios-stage-tamagotchi-browser 缺少 vue-tsc 阻塞；未宣称全仓库通过 |

日志：`I:/GameTools/WOWAddons/logs/setup-*.log`。截图保存在 `output/first-use-guide`。

复现命令（工作目录 `I:/GameTools/airi`）：

```powershell
node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project node wow-setup-files.test.ts wow-companion-runtime.test.ts
node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project browser wow-setup-checks.browser.test.ts wow-guide.browser.test.ts use-wow-guide-startup.browser.test.ts
pnpm --config.verify-deps-before-run=false -F @proj-airi/i18n build
pnpm --config.verify-deps-before-run=false -F @proj-airi/i18n typecheck
pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi typecheck
pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi build
pnpm --config.verify-deps-before-run=false lint
pnpm --config.verify-deps-before-run=false typecheck
```

新构建在 `I:/GameTools/airi/apps/stage-tamagotchi/out`。正常重启陪伴精灵后加载。
用户自己的模型连接、输出设备及真实角色画面，以检查卡中的实际测试结果为准。
