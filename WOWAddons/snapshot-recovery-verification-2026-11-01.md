# 快照暂不可用时的重载提示（2026-11-01）

已修改当前角色快照提问的共用请求上下文。装备、金币、等级、背包、天赋与任务日志缺失、停更、过期、读错角色或不完整时，要求模型给出友好恢复提示：

> 我暂时还没有收到当前角色的完整信息。请在游戏内输入 /reload 重载插件，等待数据接收完成后再问我一次。

提示不暴露错误代码、技术状态、堆栈或文件路径，也不使用其他角色或旧会话的数据冒充当前快照。不会自动执行 /reload，也不保证重载能修复所有根因。

正常的完整实时快照仍用于回答。已知 0 金币不是缺失数据。明确查询历史装备且已有匹配记录时，仍可读取带历史标签的记录。掉落、配方、拍卖价格和一般推荐类数据库问题不会因此要求个人快照。

中文和英文文案位于 i18n 资源中。实现通过当前 owner 的请求上下文指导模型回答，本次测试验证输入政策与数据筛选，不代表已调用真实模型验证每一种措辞。

## 检查

| 命令 | 结果 |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project node wow-companion-snapshot-request.test.ts wow-companion-loadout-context.test.ts` | 28 项通过 |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project browser src/renderer/pages/settings/wow-companion.browser.test.ts` | 最终 123 项通过；首次启动遇到动态模块加载失败，重试后通过 |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/i18n build` | 通过 |
| 本次 TypeScript 文件与中英文文案专项 ESLint | 通过 |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi typecheck` | 最终通过 |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi build` | 最终通过 |
| `pnpm --config.verify-deps-before-run=false lint` | 最终 0 错误、670 警告 |
| `pnpm --config.verify-deps-before-run=false typecheck` | 被现有 scenarios-stage-tamagotchi-browser 缺少 vue-tsc 阻塞 |

日志为 `logs/snapshot-recovery-*.log`。正常退出并重启陪伴精灵后加载这次修改。
