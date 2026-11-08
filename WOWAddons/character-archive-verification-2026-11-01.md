# 固定角色 JSON 档案验证（2026-11-01）

## 已实现

桌面端维护两个固定文件：

- `C:/Users/10413/.airi-wow-companion/wow-companion-retail-archive-v1.json`
- `C:/Users/10413/.airi-wow-companion/wow-companion-forever-archive-v1.json`

数据由现有传输码采集，再从经过校验的持久化存储汇总。文件约每 5 秒替换一次，正常退出时再次保存。
现有金币、装备与等级原始存储继续保留。新文件包含跨账号总额、每个角色的余额、装备、装备获取历史、升级耗时记录及新增收支变化日志。
余额是已采集角色最后一次已知余额，不代表所有角色此刻在线查询的结果。金额单位是铜币，10000 铜币等于 1 金币。

已用真实本地保存数据初始化：正式服包含 1 个账号、3 个角色装备和3个等级历史。无限服没有已保存的角色数据，初始化为空档案。
两个文件均能解析为 JSON，源存储无读取错误，未导出模型设置、密钥或实时战斗状态。

## 账单与升级耗时口径

旧账本只有累计收支，无法重建过去每一笔交易。新日志从初始化基线以后记录，重启不会重复记账。
每行记录账号、角色、前后观察时间、前后余额、区间收入与支出，可能合并区间内的多笔交易。
交易确切发生时间、购买物品及用途无法从当前遥测确认，`occurredAt`、`reason` 为 null，不编造消费分类。
升级耗时保留原有 complete/partial/unknown 标记。它是桌面观察间隔，不等于游戏 /played 在线时长，未观察到的区间可为空。

## 检查

| 命令 | 结果 |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project node wow-companion-archive.test.ts wow-companion-gold.test.ts wow-companion-level-history.test.ts wow-companion-loadouts.test.ts` | 最终 64 项通过 |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi typecheck` | 最终通过 |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi build` | 最终通过 |
| `pnpm --config.verify-deps-before-run=false exec eslint apps/stage-tamagotchi/src/main/services/airi/wow-companion-archive.ts apps/stage-tamagotchi/src/main/services/airi/wow-companion-archive.test.ts apps/stage-tamagotchi/src/main/services/airi/wow-companion.ts --fix` | 通过 |
| `pnpm --config.verify-deps-before-run=false lint` | 全仓库未通过：其他同时开发的文件有 5 个错误，另有 670 个警告；本次三个代码文件专项检查通过 |

测试覆盖首次基线、收入与支出同时发生、重启去重、大额精度、累计计数重置、写入节流、退出保存、损坏文件保护、版本隔离和源数据读取失败。
测试日志为 `logs/archive-*.log`。构建日志为 `logs/archive-build-final.log`。

正常退出、重启陪伴精灵后，新逻辑持续更新文件。本次没有中断正在运行的游戏或桌面应用。
