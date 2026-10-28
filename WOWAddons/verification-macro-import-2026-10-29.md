# 宏导入验证记录

日期：2026-10-29。桌面 2.18.0、正式服插件 2.13.0、无限服插件 1.10.0、桥接 2.13.0、宏导入插件 1.0.0。

本次提交包含宏导入插件、原生输入助手、桥接回执、桌面聊天工具、测试、安装脚本及三个插件 ZIP。开发目录中的其他独立功能改动未纳入本次提交。历史源码包保持原样。

## 已执行检查

测试在实际开发目录 `I:\GameTools\airi` 和 `I:\GameTools\WOWAddons` 执行。发布仓库逐文件同步本次相关代码，保留已有文件的换行格式。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 桥接与宏流程 | 在 `WoWCompanionBridge` 执行 `python -m unittest discover -q` | 177 项通过 |
| 正式服插件 | 在 `WoWMapCompanion` 执行 `python -m unittest discover -s tests -q` | 165 项通过 |
| 无限服插件 | 在 `WoWForeverCompanion` 执行相同命令，`PYTHONPATH` 使用正式服测试依赖 | 164 项通过 |
| 桌面相关测试 | `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project node src/shared/wow-macro-import.test.ts src/main/services/airi/wow-companion-runtime.test.ts src/renderer/stores/tools/built-in.test.ts` | 38 项通过，设置了 `AIRI_WOW_RUNTIME_TEST_PYTHON`，无跳过 |
| 桌面类型检查 | `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi typecheck` | 通过 |
| 桌面构建 | `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi build` | 通过 |
| 仓库 lint | `pnpm --config.verify-deps-before-run=false lint` | 0 错误，670 条既有警告 |
| 最后修改的聊天工具及注册测试 | `pnpm --config.verify-deps-before-run=false exec eslint apps/stage-tamagotchi/src/renderer/stores/tools/builtin/wow-macro-import.ts apps/stage-tamagotchi/src/renderer/stores/tools/built-in.test.ts` | 通过 |
| Windows 原生接口 | 加载 ctypes 声明并创建、释放互斥锁 | INPUT 为 40 字节，无模拟按键或剪贴板写入 |
| 插件交付 | 对三个 ZIP 做完整性检查，逐文件核对源码 | 通过 |

## 限制

根目录 `pnpm --config.verify-deps-before-run=false typecheck` 未通过。最初缺少 `vue-tsc` 可执行路径，补充路径后仍因既有 MediaPipe 模块缺少依赖及类型失败。未修改这些模块。

当前没有运行中的魔兽客户端，未进行真实游戏粘贴和保存验收。Lua 测试使用真实 Lua 5.1，游戏 API 和桌面状态由测试替身提供。上述结果不代表 GitHub CI 通过。

本机正式服已安装宏导入插件和新版传输插件，并备份原文件。进入游戏前重启客户端与陪伴精灵。聊天模型需要支持工具调用。
