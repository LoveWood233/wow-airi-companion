# 首次使用向导：实现与验证

日期：2026-10-31。

## 已实现

- 首次使用时，在原有服务配置引导完成或跳过后，打开设置中的首次使用向导。
- 使用遮罩、高亮区域与说明气泡，分 11 步介绍角色形象、模型服务、聊天、语音、游戏连接、闲聊、截图、MCP 和快捷启动。
- 正式服／无限服可选择，连接步骤进入对应设置页。
- 支持上一步、下一步、Esc／按钮跳过、暂停配置、继续和重新开始。
- 记录浏览进度，完成或跳过后不重复自动弹出。设置首页新增“首次使用向导”入口。
- 配置时收起遮罩，允许实际填写、跳转服务子页面。向导不代填密钥，不修改偏好，不安装插件，也不自动调用模型。
- 完成向导仅表示浏览完成，不表示已验证聊天、语音或游戏连接。
- 设置窗口已经打开时，也可接收首次启动引导请求。
- 键盘焦点由 Reka Dialog 管理；遮罩收起后可以继续使用页面，支持小窗口与深色模式。

## 检查结果

| 检查 | 结果 |
| --- | --- |
| 浏览器：向导 6 项、首次启动 4 项、闲聊与启动器回归 | 共 32 项通过 |
| `pnpm -F @proj-airi/i18n build` | 通过 |
| `pnpm -F @proj-airi/i18n typecheck` | 通过 |
| `pnpm -F @proj-airi/stage-tamagotchi typecheck` | 通过 |
| `pnpm -F @proj-airi/stage-tamagotchi build` | 通过 |
| `pnpm lint` | 0 错误、670 个现有警告 |
| 根目录 `pnpm typecheck` | 未通过：现有 MediaPipe 包缺依赖、scenarios-stage-tamagotchi-browser 缺 vue-tsc |

检查时使用 `--config.verify-deps-before-run=false`，浏览器测试使用桌面项目的 Vitest Chromium 配置。
日志位于 `I:/GameTools/WOWAddons/logs/guide-*.log`。
已查看窄窗口深色截图，确认气泡和按钮位于可视范围内。

复现命令（工作目录 `I:/GameTools/airi`）：

```powershell
node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project browser wow-guide.browser.test.ts use-wow-guide-startup.browser.test.ts wow-chatter.browser.test.ts wow-launcher.browser.test.ts
pnpm --config.verify-deps-before-run=false -F @proj-airi/i18n build
pnpm --config.verify-deps-before-run=false -F @proj-airi/i18n typecheck
pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi typecheck
pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi build
pnpm --config.verify-deps-before-run=false lint
pnpm --config.verify-deps-before-run=false typecheck
```

## 文件与使用

- 页面：`I:/GameTools/airi/apps/stage-tamagotchi/src/renderer/pages/settings/wow-guide.vue`。
- 遮罩：`I:/GameTools/airi/apps/stage-tamagotchi/src/renderer/components/wow-guide-overlay.vue`。
- 进度：`I:/GameTools/airi/apps/stage-tamagotchi/src/renderer/stores/wow-guide.ts`。
- 启动：`I:/GameTools/airi/apps/stage-tamagotchi/src/renderer/composables/use-wow-guide-startup.ts`。
- 构建输出：`I:/GameTools/airi/apps/stage-tamagotchi/out`。

本次未重启正在运行的游戏或陪伴精灵。正常退出并重新打开陪伴精灵后加载新构建，可从“设置 → 首次使用向导”手动查看。
真实 Electron 多窗口显示、用户自己的服务配置与游戏连接仍需实际使用验证。
