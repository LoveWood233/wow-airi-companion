# 日历与组队增益提醒：发布树验证（2026-10-29）

本次发布 2.21.0 同步官方日历、私人日程、副本重置、组队增益提醒及所需场景遥测。正式服插件 2.15.0，无限服插件 1.12.0，桥接 2.14.0。

桌面整合基于仓库原有语音和交互实现。未带入其他开发会话的风景闲聊、地点逸闻等独立改动。开发目录另有 120 项浏览器测试，此发布树运行的是 88 项。

## 本次执行结果

以下检查在 `wow-airi-companion` 发布目录执行，复用本机已安装的依赖。依赖目录、缓存和构建产物均被 Git 忽略。

| 命令 | 结果 |
| --- | --- |
| `python -m unittest discover -q`（WOWAddons/WoWCompanionBridge） | 201 项通过 |
| `python -m unittest discover -s WoWMapCompanion/tests -q`（WOWAddons） | 176 项通过 |
| `python -m unittest discover -s WoWForeverCompanion/tests -q`（WOWAddons） | 175 项通过 |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project node wow-companion-group-buffs.test.ts wow-companion-calendar.test.ts wow-companion-instance.test.ts wow-companion-client.test.ts`（airi） | 60 项通过 |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project browser src/renderer/pages/settings/wow-companion.browser.test.ts`（airi） | 88 项通过 |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi typecheck`（airi） | 通过 |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi build`（airi） | 通过。首次因模型文件下载超时失败，使用已有本地模型缓存后重试通过 |
| `pnpm --config.verify-deps-before-run=false lint`（airi） | 最终 0 错误、670 警告；新增导入排序问题已修复 |
| `pnpm --config.verify-deps-before-run=false typecheck`（airi） | 被现有环境问题阻塞：scenarios-stage-tamagotchi-browser 找不到 vue-tsc |
| `git -c core.whitespace=cr-at-eol diff --check` | 通过，保留仓库既有 CRLF 文本格式 |

测试使用模拟游戏接口和语音服务，不代表已通过真实副本、战场或扬声器播报验收。无限服客户端缺少所需现代 API 时保持静默。

## 交付

- 仓库保存实际代码、回归测试和设计说明。
- 两个新增插件压缩包分别为 `WoWMapCompanion-2.15.0.zip`、`WoWForeverCompanion-1.12.0.zip`。
- `snapshot-manifest.json` 更新本次文件 SHA-256 和版本信息。
- 历史源码压缩包保持原内容，不代表此版本。
- 不包含用户配置、模型密钥、SavedVariables、依赖目录、缓存或构建产物。
- 更新插件后输入 `/reload`，并正常退出、重新启动陪伴精灵。
