# 自动导入宏焦点修复验证

日期：2026-11-01

## 问题与修改

旧实现调用 Windows `SetForegroundWindow` 后立即检查游戏是否处于前台。
Windows 可以拒绝前台激活。激活请求也不能作为焦点已经切换完成的证明。
这导致首次输入前就返回 `focus-lost`。

现在只请求激活一次。首次输入前最多等待 12 秒，要求游戏连续获得焦点至少 250 毫秒。
等待期间不发送按键。超时返回 `focus-not-acquired`。
输入开始后丢失焦点仍立即停止，不重新抢占焦点或自动重试。
窗口身份变化、取消操作和无效游戏状态继续阻止输入。

陪伴精灵显示切回游戏的提示，并向模型提供本地化的恢复说明。
错误回复要求使用说明文字，避免直接念出 `focus-lost`。
桌面父进程总超时改为 180 秒，覆盖首次焦点等待、战斗等待和各阶段回执等待。

Windows 行为依据：[SetForegroundWindow 官方文档](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)。

## 修改位置

- `I:\GameTools\WOWAddons\WoWCompanionBridge\macro_import.py`
- `I:\GameTools\WOWAddons\WoWCompanionBridge\macro_native.py`
- `I:\GameTools\WOWAddons\WoWCompanionBridge\test_macro_import.py`
- `I:\GameTools\airi\apps\stage-tamagotchi\src\main\services\airi\wow-companion-runtime.ts`
- `I:\GameTools\airi\apps\stage-tamagotchi\src\renderer\stores\tools\builtin\wow-macro-import.ts`
- `I:\GameTools\airi\apps\stage-tamagotchi\src\renderer\stores\tools\builtin\wow-macro-import.browser.test.ts`
- `I:\GameTools\airi\packages\i18n\src\locales\en\wow-companion.yaml`
- `I:\GameTools\airi\packages\i18n\src\locales\zh-Hans\wow-companion.yaml`
- `I:\GameTools\airi\docs\ai\adr\wow-macro-import.md`

## 验证结果

以下 pnpm 命令均使用 `--config.verify-deps-before-run=false`。
Python 命令在桥接目录运行。其余命令在 AIRI 根目录运行。

| 命令 | 结果 |
| --- | --- |
| `python -m unittest discover -q` | 274 项通过 |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project node built-in.test.ts wow-macro-import.test.ts wow-companion-runtime.test.ts` | 34 项通过，9 项环境条件测试跳过 |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project browser wow-macro-import.browser.test.ts` | 5 项通过 |
| `pnpm -F @proj-airi/i18n build` | 通过 |
| `pnpm -F @proj-airi/stage-tamagotchi typecheck` | 最终运行通过 |
| `pnpm -F @proj-airi/stage-tamagotchi build` | 通过，已更新 `out` 构建产物 |
| `pnpm exec eslint <本次修改的三个 TS 文件及两个 YAML 文件>` | 最终运行通过，无输出 |
| `pnpm lint` | 0 个错误，670 个警告 |
| `pnpm typecheck` | 未通过：`@proj-airi/scenarios-stage-tamagotchi-browser` 缺少可执行的 `vue-tsc`，退出码 127 |

初次桌面类型检查发现新增测试没有收窄工具返回类型。修正后重新检查通过。
新增测试覆盖延迟切回游戏、短暂焦点不能触发输入、首次超时、取消、窗口变化、中途丢焦停止，以及中英文恢复提示。

日志位于 `I:\GameTools\WOWAddons\logs\macro-focus-*.log`。

## 使用与验证边界

重启陪伴精灵，再请求导入宏。出现准备导入提示后，切回魔兽世界并保持游戏在前台。
焦点等待超时后，需要用户重新请求导入，不会自动重试。
只保存宏，不执行宏。

本次测试替代了 Win32 输入边界和 Electron IPC，没有向正在运行的游戏发送按键。
真实游戏中的窗口切换、粘贴及保存结果仍需要试用确认。
本次没有重启用户应用，没有推送 GitHub，也没有关机。
