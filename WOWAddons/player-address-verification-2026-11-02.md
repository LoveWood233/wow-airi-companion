# 陪伴精灵称呼设置验证记录

日期：2026-11-02

## 功能

- “设置 → 魔兽陪伴”新增“对我的称呼”。默认跟随当前登录角色名。
- 选择“自定义固定称呼”后，输入称呼并点击“保存称呼”。两个游戏版本共用此设置，重启后保留。
- 在对话中输入或说出“喊我小木”“以后请叫我‘拿铁’”，会保存为固定称呼并同步设置界面。
- “叫我当前角色名”恢复默认模式。无可用角色名时使用中性第二人称。
- 称呼适用于后续普通对话、事件回应、主动闲聊和装备提示，不改动历史消息。
- 自定义称呼限制为 1～40 个 Unicode 字符，不允许换行和控制字符。无效输入保留原设置。
- 否定、问句和引用示例不会改动设置。未加引号的名字完整保留，例如“喊我网吧”。
- 名字仅影响称呼，角色身份、装备归属和游戏版本查询继续使用实际游戏数据。

## 自动化验证

命令中的公共前缀为 `pnpm --config.verify-deps-before-run=false`，避免触发依赖重装。

| 目录 | 命令（公共前缀之后） | 结果 |
| --- | --- | --- |
| `airi/apps/stage-tamagotchi` | `exec vitest run --project=node wow-companion-player-address.test.ts wow-player-address-request.test.ts` | 93 项通过 |
| `airi/apps/stage-tamagotchi` | `exec vitest run --project=browser wow-companion.browser.test.ts wow-player-address-settings.browser.test.ts companion-chat-prompt.browser.test.ts InteractiveArea.browser.test.ts` | 156 项通过 |
| `airi/apps/stage-tamagotchi` | `typecheck` | 通过 |
| `airi/apps/stage-tamagotchi` | `build` | 通过，已更新运行目录的 `out` |
| `airi` | `lint` | 通过，0 个错误，670 个已有警告 |
| `airi` | `typecheck` | 未通过，见下方说明 |

已对改动的 TypeScript、Vue 文件执行定向 ESLint。`git diff --check` 通过。

覆盖默认模式、持久保存、跨窗口同步及重复写入、手动设置、对话修改、角色切换、登出、主动语音、装备提示及移动宽度布局。

全仓类型检查受未改动模块的问题阻塞：`model-driver-mediapipe` 缺少 `@mediapipe/tasks-vision`、`three` 等依赖，浏览器场景模块缺少 `vue-tsc`，Electron 场景模块存在上下文类型错误。本次未修改这些模块。

浏览器测试存在原有的 ResizeObserver 和 UnoCSS 警告，最终测试结果及退出码通过。

截图已人工检查：`airi/apps/stage-tamagotchi/src/renderer/pages/settings/__screenshots__/wow-player-address-390.png`。

日志位于 `I:/GameTools/WOWAddons/logs/player-address-*.log`。

## 范围与使用

对话修改采用现有的新用户请求观察接口，支持本轮文本及已完成的语音转写。历史重放、通知、后台任务和模型回复不能修改设置。

现有接口不授予包含图片附件的请求或远程输入此权限。这些输入可通过设置界面修改称呼。

本次使用自动化测试验证，没有调用真实模型或实际操作游戏。请完全退出陪伴精灵（含托盘）后重新启动。游戏插件无需重载。

未提交或推送 GitHub。原有未提交修改完整保留。
