# 新装备复核提醒修复

日期：2026-11-01

## 实际观察

通过正式服本机桥接 `http://127.0.0.1:18765/api/status` 读取到实时画面数据。
角色为 11 级术士，专精 266，在线、存活、非战斗。
新获取记录和比较记录都包含“邪恶女巫玺戒”（143902，装等 19）。
比较目标是“育幼所苏醒者的戒指”（232349，装等 10）。
记录属性如下，均来自这次游戏遥测，不是外部数据库：

| 属性 | 旧戒指 | 新戒指 |
| --- | --- | --- |
| 耐力 | 2 | 5 |
| 爆击 | 5 | 未记录此属性 |
| 急速 | 未记录此属性 | 11 |
| 全能 | 2 | 6 |

专精适配为未知，两个物品均被标记为需要复杂效果或装备限制复核。
当时没有游戏换装 offer，桥接也没有装备解析错误。
安装目录与源目录的 `EquipmentCompare.lua` 哈希一致。

## 原因与行为

原桌面提醒只接受游戏已发出确认邀请的明确提升，或主属性提升且副属性有取舍的装备。
未知专精适配和需要人工比较的结果没有对应提醒，因而出现“获取已记录，但陪伴精灵没有提示”。

现在增加信息性复核提醒，复用现有语音和字幕气泡。
它要求新获取记录和比较记录在物品、编号、角色、会话及采集时间上匹配。
只针对三分钟内、装等高于获得时比较目标、但评估仍需复核的获取记录。
保存的历史记录和单独的背包复查不能触发这条提醒。

提醒展示物品名、获得时对比装等和当前无法确认收益的原因，并请用户打开背包自行比较。
它不会承诺收益更高，不提供换装按钮，也不向游戏发送输入。
原有明确提升的换装确认流程继续保留。

静音时保留文字。战斗和其他对话会延后提醒，超过时效就不补播。
当前角色改变或遥测失效会取消提醒。
复核提醒和正式换装建议分别去重，避免新提醒吞掉传输途中较早的换装建议。
正式换装建议可以在复核语音停止并确认静默后优先展示。

## 修改位置

- `I:\GameTools\airi\apps\stage-tamagotchi\src\renderer\stores\wow-companion-equipment-prompt.ts`
- `I:\GameTools\airi\apps\stage-tamagotchi\src\renderer\stores\wow-companion.ts`
- 对应控制器单元测试和 `wow-companion.browser.test.ts`
- `I:\GameTools\airi\packages\i18n\src\locales\en\wow-companion.yaml`
- `I:\GameTools\airi\packages\i18n\src\locales\zh-Hans\wow-companion.yaml`
- `I:\GameTools\airi\docs\ai\adr\wow-companion-fast-equipment-offers.md`

## 验证结果

pnpm 命令均带 `--config.verify-deps-before-run=false`，在 AIRI 根目录运行。

| 命令 | 最终结果 |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project node wow-companion-equipment-prompt.test.ts wow-companion-equipment-comparisons.test.ts` | 97 项通过，2 项按运行条件跳过 |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project browser wow-companion.browser.test.ts` | 128 项通过 |
| `pnpm -F @proj-airi/i18n build` | 通过 |
| `pnpm -F @proj-airi/stage-tamagotchi typecheck` | 通过 |
| `pnpm -F @proj-airi/stage-tamagotchi build` | 通过，更新本地 `out` 构建 |
| `pnpm exec eslint <本次修改的四个 TS 文件和两个 YAML 文件> --fix` | 通过，无输出 |
| `pnpm lint` | 0 个错误、670 个警告 |
| `pnpm typecheck` | 未通过：既有模块 `@proj-airi/scenarios-stage-tamagotchi-browser` 找不到 `vue-tsc`，退出码 127 |

新增回归用例先复现了原来的静默行为。
后续测试还发现并修复了复核提醒与延迟换装邀请的去重和优先级冲突。
最终测试包含中英文文字、真实浏览器语音队列、静音、去重、战斗延后、角色变化、过期和无效记录。
日志位于 `I:\GameTools\WOWAddons\logs\equipment-review-*.log`。

## 生效与限制

重启陪伴精灵后加载新桌面构建。此次没有修改游戏插件，不需要为这次修复执行 `/reload`。
这枚已获得的戒指已经超过新提醒的三分钟时效，不会在重启后自动补播。
测试验证了模拟新获取数据在真实浏览器语音队列中的处理，没有向游戏注入新拾取或执行换装。
下一次真实获得类似装备时，仍需确认实机采集和播报效果。
