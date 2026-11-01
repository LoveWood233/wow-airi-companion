# 宏请求的聊天历史复制错误

日期：2026-11-01

## 复现与原因

用户截图显示 `structuredClone` 无法复制数组。
单独调用宏工具，以及从新聊天直接导入的测试均未复现。
加入“重新运行已记录的宏工具调用，再发送一条消息”后，真实浏览器聊天流程出现同类 `DataCloneError`。
测试调用栈定位到 `core-agent.buildContext` 复制历史生成记录的操作。
本次复现显示无法复制对象，截图显示无法复制数组，二者均来自嵌套的响应式值。
未取得用户当次报错的完整调用栈，实际客户端仍需重试确认。

`replaceToolCallResult()` 原先对响应式聊天消息和生成轮次执行浅复制。
未改动的轮次、内容数组和显示片段保留了 Vue 代理，后续构造请求时无法结构化复制。
修复在生成更新后的历史前，使用项目已有的 `cloneDeep` 复制完整源消息。
工具结果替换仍只影响指定调用，且继续使该轮及后续原生续写记录失效。
不会重复执行历史宏，也不会将聊天复制错误当成导入成功。

## 实际使用目录

进程检查确认，用户运行的是：

`I:\GameTools\wow-airi-companion\airi\apps\stage-tamagotchi\node_modules\electron\dist\electron.exe`

此前修改目录是 `I:\GameTools\airi`。
实际副本的桌面构建仍为 2026-10-29，前面的更新没有进入这份构建。
本次将共享修复保留在两个源码目录，并在实际副本同步了本轮前面已经实现的三项修改：

- 宏导入首次焦点等待、友好提示和 180 秒父进程总超时。
- 区域等级建议优先比较具体区域与角色等级，不编造条件。
- 装等更高但收益未确认时，提供信息性装备复核提醒。

同步使用针对文件和代码段的修改，未覆盖整个源码目录。
既有的用户文档修改保留。本次未推送 GitHub，也未重启应用或操作游戏。

实际副本的 workspace 依赖链接仍指向开发目录中的部分共享包，因此共享修复也同步到实际副本的源文件。
本次没有重装依赖或修改这些链接。

## 验证

除 Python 命令外，以下命令在 `I:\GameTools\wow-airi-companion\airi` 运行。
pnpm 命令均使用 `--config.verify-deps-before-run=false`。

| 命令 | 最终结果 |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project browser wow-macro-import.browser.test.ts wow-macro-import-chat.browser.test.ts wow-companion.browser.test.ts` | 97 项通过 |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project node built-in.test.ts wow-macro-import.test.ts wow-companion-equipment-prompt.test.ts wow-companion-equipment-comparisons.test.ts` | 89 项通过，2 项按运行条件跳过 |
| `node node_modules/vitest/vitest.mjs run --config packages/stage-ui/vitest.config.ts --project node tool-call-rerun.test.ts chat.contract.test.ts llm.test.ts tool-resolver.test.ts tools.test.ts` | 133 项通过 |
| `python -m unittest test_macro_import -q` | 实际副本的桥接目录中运行，26 项通过 |
| `pnpm -F @proj-airi/i18n build` | 通过 |
| `pnpm -F @proj-airi/stage-tamagotchi typecheck` | 通过 |
| `pnpm -F @proj-airi/stage-ui typecheck` | 通过 |
| `pnpm -F @proj-airi/stage-tamagotchi build` | 通过 |
| `pnpm exec eslint <本次修改的 TS 和 YAML 文件> --fix` | 无错误，保留既有注释长度警告 |
| `pnpm lint` | 0 个错误、670 个警告 |
| `pnpm typecheck` | 未通过：既有 MediaPipe 模块缺少 `@mediapipe/tasks-vision`、`three` 等依赖 |

实际副本没有测试用 Lupa，Python 测试通过 `PYTHONPATH=I:\GameTools\WOWAddons\WoWMapCompanion\tests\.deps` 使用现有测试依赖。
生产宏导入辅助进程不依赖 Lupa。

浏览器回归使用真实 Vue、Pinia、聊天历史、工具解析、模型 SDK 和事件调用。
仅模型 HTTP 和桌面 IPC 使用模拟边界，没有发送真实游戏按键。
新增测试确认正常聊天、一次宏调用、一次明确要求的工具重跑以及后续消息均可完成。
它也确认没有额外的自动重复调用。

构建产物核对确认，实际副本的 `out/renderer/assets/chat-D8AF_pf_.js` 包含深复制修复。
同一构建包含焦点恢复提示和装备复核文案。
日志位于 `I:\GameTools\WOWAddons\logs\macro-clone-*.log`。

## 使用

完全退出当前陪伴精灵，再重新打开原来使用的那份程序。
重新发送宏导入请求，出现提示后切回游戏并保持前台。
无需为本次聊天复制修复重装游戏插件或清空聊天记录。
