# 组队增益提醒验证记录（2026-10-29）

已实现：组队进入副本、团队副本、场景战役或战场后，检查角色已学会的队伍增益，发现可确认的缺失后语音提醒。支持战斗怒吼、奥术智慧、真言术：韧、野性印记、天怒、青铜龙的祝福。静音和战斗中不提醒，同次进入同种增益最多一次。不会施法。

## 自动化检查

| 命令 | 结果 |
| --- | --- |
| `python -m unittest discover -q`（WoWCompanionBridge） | 201 项通过，包含 7 项新增 Lua/协议/桥接测试 |
| `python -m unittest discover -s WoWMapCompanion/tests -q` | 176 项通过 |
| `python -m unittest discover -s WoWForeverCompanion/tests -q` | 175 项通过 |
| `python -m unittest test_addon.AddonTest.test_both_toc_variants_are_complete_and_identical -q`（无限服 tests） | 版本号更新后 TOC 检查通过 |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project node wow-companion-group-buffs.test.ts wow-companion-client.test.ts` | 25 项通过 |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project browser src/renderer/pages/settings/wow-companion.browser.test.ts` | 120 项通过，含 7 项新增语音流程测试 |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/i18n build` | 通过 |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi typecheck` | 通过 |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi build` | 通过 |
| `pnpm --config.verify-deps-before-run=false lint` | 0 个错误，670 个警告 |
| `pnpm --config.verify-deps-before-run=false typecheck` | 未通过：scenarios-stage-tamagotchi-browser 包找不到 vue-tsc（现有环境问题） |

日志位于 `logs/buff-*.log`。新增语音测试使用真实语音 store 和模拟语音服务，不产生真实声音。

## 安装与交付

- 正式服插件 2.15.0 已安装至 `I:/Game/World of Warcraft/_retail_/Interface/AddOns/WoWMapCompanion`。
- 本次覆盖的 5 个文件已备份至 `backups/group-buffs-20261029`，复制后哈希一致。
- 安装目录的全部 TOC Lua 文件与当前源码哈希一致。
- 已生成并校验 `WoWMapCompanion-2.15.0.zip` 和 `WoWForeverCompanion-1.12.0.zip`。
- 桌面构建输出位于 `I:/GameTools/airi/apps/stage-tamagotchi/out`。
- 未重启当前游戏或陪伴精灵。用户正常重启陪伴精灵并在游戏内 `/reload` 后生效。

## 实机验证范围

尚未验证真实副本或战场的增益读取及扬声器播报。客户端限制导致的数据不可读会跳过提醒。
无限服源码包含相同模块，但仍要求现代 spellbook/aura API，未在无限服客户端验证。

推荐实机验收：战士与队友组队进入副本，保持非战斗且至少一人无战斗怒吼，等待加载和两次稳定检查。听到一次提醒后，补上怒吼并确认没有重复播报。离开后重新进入可产生下一次提醒。战斗、静音或失去传输码时不应播报。
