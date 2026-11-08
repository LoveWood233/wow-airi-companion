# 插件独立离线保存验证（2026-11-01）

## 本次修正

上一版仅由桌面程序保存，无法覆盖陪伴精灵未运行的游玩。本次改为插件自身独立采集并放入账号级 SavedVariables。
`WoWMapCompanionDB.snapshotJSON` / `WoWForeverCompanionDB.snapshotJSON` 的 `offlineHistory` 保存多角色最近装备、金币余额、金币变化与升级记录。
原有实时快照字段保留，屏幕传输码不加入历史大包，仍为 512 字节帧。

游戏正常 `/reload`、登出和退出时写 SavedVariables。记录在本次更新后开始。崩溃、断电可能来不及落盘，不能恢复更新前未记录的数据。
离线角色保留最后一次已知金币余额；金币合计为精确十进制铜币字符串。金币变化没有无法确认的商品名称或用途。
升级耗时累计插件观察到的在线秒数，不等同于 /played；保留 partial / complete / unknown 标记。

桌面程序按“游戏快捷启动”中配置的版本路径扫描 SavedVariables，安全解析 JSON 字符串，绝不执行 Lua。
导入保存到用户资料目录的 `wow-companion-retail-addon-history-v1.json` / `wow-companion-forever-addon-history-v1.json`，并进入固定角色档案的 `addonHistory` 字段。
离线数据不会伪装成实时在线状态，也不会重复计入现有桌面账本。现有实时界面与离线档案仍分别保留。
当前已配置正式服路径，尚未配置无限服路径；无限服自动导入需先配置对应路径。

## 检查

| 命令 | 结果 |
| --- | --- |
| `python -m unittest discover -s WoWMapCompanion/tests -p test_offline_history.py -q` | 最终 2 项通过，实际执行正式服与无限服 Lua，覆盖重载保存、金币与升级、精确大额合计和帧尺寸 |
| `python -m unittest discover -s WoWMapCompanion/tests -q` | 189 项中 188 项通过，1 项被同时开发的两个 Localization.lua 内容不同阻塞；本次未修改语言文件 |
| `python -m unittest discover -s WoWForeverCompanion/tests -q` | 196 项通过 |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project node wow-companion-saved-history.test.ts wow-companion-archive.test.ts wow-companion-gold.test.ts wow-companion-level-history.test.ts wow-companion-loadouts.test.ts` | 68 项通过 |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi typecheck` | 通过 |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi build` | 通过 |
| 本次 4 个 TypeScript 文件专项 ESLint | 通过 |
| `pnpm --config.verify-deps-before-run=false lint` | 7 个其他并行开发脚本错误、670 个警告，本次文件专项检查通过 |
| `pnpm --config.verify-deps-before-run=false typecheck` | 被现有 scenarios-stage-tamagotchi-browser 缺少 vue-tsc 阻塞 |
| `pnpm --config.verify-deps-before-run=false exec tsx I:/GameTools/WOWAddons/tmp/verify-offline-roundtrip.ts` | 真实 Lua 生成的 SavedVariables 经桌面解析、校验、导入成功 |

日志位于 `logs/offline-*.log`。没有操作游戏执行实际 /reload 或登出。

## 安装与使用

正式服插件 2.17.0 已安装并校验文件哈希，原文件备份到 `backups/offline-history-20261101`。
新增 Inventory/Transfer 是当前插件主模块已有的依赖，与本次更新一起补齐，未修改用户 SavedVariables。
已生成并校验 `WoWMapCompanion-2.17.0.zip` 与 `WoWForeverCompanion-1.15.0.zip`。
在游戏内输入一次 `/reload` 加载新插件。之后即使不开陪伴精灵，正常游玩和退出也会保存新记录。
重启陪伴精灵加载新桌面构建后，即可补存这些离线记录。
