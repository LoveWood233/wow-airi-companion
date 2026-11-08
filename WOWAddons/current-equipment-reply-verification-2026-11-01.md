# 当前装备回答修复验证（2026-11-01）

## 已定位并修复

原 LoadoutContext 仅查询 equipmentLoadouts.entries，没有优先读取桥接已收到的当前角色装备。因此存在两个确定问题：实时修订比持久化记录更新时仍注入旧装备；首次实时快照尚未写入保存记录时仍注入 not_received。
两个新增回归用例在修复前失败，修复后通过。

当前优先选取同游戏、同账号、同 GUID、同登录会话的有效实时穿戴快照，拒绝过期、停更、错误和其他角色的桥接数据。较旧桥接修订不会覆盖更新的已保存修订。
装备上下文包含角色、职业、专精、来源、修订号、观察时间、19 个槽位及实际已知属性。

用户提问“装备如何”等问题时，通过现有 owner request-context 机制重新刷新并附加装备数据到本轮请求，明确优先于旧聊天记录。
回答规则要求引用实际物品名和已知属性，不能把新增背包物品或通用配装建议冒充当前穿戴。
当前数据未收到、属于旧会话或只有历史保存记录时，必须先说明，不能声称已核实当前装备。

## 实际检查时的数据状态

本机正式服桥接接口返回 waiting，snapshot 与 equipmentLoadout 均为空。磁盘有 3 个历史角色装备记录，最近记录来自较早游玩日期。
这只能证明检查当时没有当前装备数据，不证明用户最初提问时的实时连接状态，也无法从这些数据判断当前穿戴。
本次没有操作真实游戏或调用用户配置的模型生成完整回复。

## 检查

| 命令 | 结果 |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project node wow-companion-loadout-context.test.ts wow-companion-player-address.test.ts wow-companion-loadouts.test.ts` | 最终 46 项通过 |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project browser src/renderer/pages/settings/wow-companion.browser.test.ts` | 122 项通过，含提问时刷新、切换角色后移除旧装备的浏览器用例 |
| 本次四个文件专项 ESLint | 通过 |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi build` | 通过；输出文件含本轮请求装备优先规则 |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi typecheck` | 仍被其他并行开发的天赋字段、配装模块导出和相关测试夹具不一致阻塞。本次新增用例的清理函数返回类型问题已修复 |
| `pnpm --config.verify-deps-before-run=false lint` | 全仓库 102 个错误、670 个警告，集中在其他开发内容；本次四文件专项检查通过 |

日志为 `logs/gear-reply-*.log`。未宣称 CI 通过或真实模型已按新规则作答。

正常退出并重启陪伴精灵后加载修复。登录目标角色，保持传输码可见，等完整装备快照接收后再询问“我当前的装备如何”。若仍未收到，回答应明确说明无法核实当前装备。
