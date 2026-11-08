# 区域等级提醒修正

日期：2026-11-01

## 原因

普通对话中已有角色等级和区域名，但没有明确规定先比较具体区域的等级条件。
进入区域的独立播报没有传入角色等级。
未收录区域的旧播报规则直接邀请探索，没有约束区域是否适合当前等级。
这允许模型把资料片整体练级范围当成具体区域的适用范围。

用户引用的“奥丹姆 30～35 级”不是本次核实的当前版本数据。
现有角色遥测和区域历史资料不提供当前区域最低等级、推荐等级或克罗米时间状态。

## 修改

`I:\GameTools\airi\apps\stage-tamagotchi\src\renderer\stores\wow-companion.ts`：

- 区域播报增加角色当前等级。
- 普通对话和区域播报共享区域等级建议规则。
- 低于已核实的最低等级时，明确说明等级不足并建议以后再来。
- 低于已核实的推荐等级时，解释等级差距并建议稍后再来练级，不把推荐当成硬性准入要求。
- 等级提醒优先于区域故事和探索邀请。
- 未知等级条件时明确说明尚未确认，不编造等级区间、经验惩罚、任务锁定、路线或 NPC。
- 禁止把资料片整体范围或其他游戏版本要求作为当前区域的结论。

ADR：`I:\GameTools\airi\docs\ai\adr\wow-companion-location-lore.md`。

## 验证

以下 pnpm 命令均带 `--config.verify-deps-before-run=false`，在 AIRI 根目录运行。

| 命令 | 结果 |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project browser wow-companion.browser.test.ts -t 'includes player level and evidence limits\|requires specific zone level evidence'` | 修改前新增的 2 项回归用例均失败，复现缺少等级和约束的问题 |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project browser wow-companion.browser.test.ts` | 最终 125 项通过 |
| `pnpm exec eslint apps/stage-tamagotchi/src/renderer/stores/wow-companion.ts apps/stage-tamagotchi/src/renderer/pages/settings/wow-companion.browser.test.ts` | 通过，无输出 |
| `pnpm -F @proj-airi/stage-tamagotchi typecheck` | 通过 |
| `pnpm -F @proj-airi/stage-tamagotchi build` | 通过，更新本地 `out` 构建产物 |
| `pnpm lint` | 通过，0 个错误、670 个警告 |

日志：`I:\GameTools\WOWAddons\logs\zone-level-*.log`。

## 使用边界

重启陪伴精灵后加载新规则。本次没有重启应用或游戏。
本次修正模型输入和回答规则，没有增加区域等级数据库。
测试核实了输入模型的等级及规则，没有调用真实模型或验证生成文本。
具体区域的等级结论仍需要对应游戏版本的可靠资料。
