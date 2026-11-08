# 陪伴节奏与死亡互动验证记录

日期：2026-10-31

项目：`I:\GameTools\airi`

## 已实现

用户确认第 4.1 节的第 3 项，并要求死亡时保留符合角色人设的互动。
入口：设置 → 闲聊设置。

- 安静时段默认关闭，预设本地时间 22:00～08:00，支持跨午夜。起止相同表示全天安静。
- 安静时段暂停普通闲聊、截图互动、地图逸闻及这些操作当前的生成／播报。恢复后不补播。
- 场景覆盖默认关闭。野外与副本分别设置普通闲聊、截图频率，0 沿用基础设置，1～60 为分钟数。
- 场景来自实际观测的 instanceType；未知、战场和竞技场沿用基础频率，切换场景后重新计时。
- 主动生成预算默认关闭，预设最近 60 分钟 30 次，可设 1～1000；两个游戏版本共用额度。
- 截图互动先检查至少两次可用额度，看图和回答分别计数。地图逸闻、角色事件和日历摘要也计数，失败保留计数。
- 预算按生成任务计算，不代表金额、token 或内部工具步骤的逐笔账单。固定台词、语音合成、手动问答不占这份额度。
- 仅持久化时间戳，发起前同步保存；重启、切换版本或关闭限制不清空最近计数。设置页每秒更新已用、剩余和最早释放时间。
- 死亡回应使用当前人设，可安慰、祈愿或作游戏阵营吐槽，不固定重复某一句。
- 一次死亡周期至多回应一次；复活时丢弃待播死亡内容，随后可鼓励。连接已死亡角色不补播旧事件。
- 死亡仍遵循事件开关、静音、冷却和生成预算；死亡时残留的战斗标记不拦截死亡事件。

## 自动检查

工作目录：`I:\GameTools\airi`。

| 命令 | 结果 |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project node wow-companion-rhythm.test.ts wow-companion-policy.test.ts wow-companion-idle.test.ts wow-companion-location-policy.test.ts wow-scenery-controller.test.ts` | 154 项通过 |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project browser wow-chatter-settings.browser.test.ts wow-chatter.browser.test.ts` | 最终 35 项通过 |
| `pnpm -F @proj-airi/stage-tamagotchi typecheck` | 通过 |
| `pnpm -F @proj-airi/stage-tamagotchi build` | 通过 |
| `pnpm -F @proj-airi/i18n typecheck` | 通过 |
| `pnpm -F @proj-airi/i18n build` | 通过 |
| `pnpm lint` | 0 错误、670 项既有警告 |
| `pnpm typecheck` | 既有 scenarios-stage-tamagotchi-browser 包缺少 vue-tsc，未通过；本次桌面独立检查通过 |

覆盖跨午夜、边界时刻、全天安静、场景识别与同频率切换、恢复后重新计时、死亡重复事件与复活、冷却、静音和事件开关。
预算验证覆盖连续同步保存、滚动过期、切换开关、新建 store 读取历史、时钟回拨，以及多次调用的上限。
浏览器验证使用真实 Pinia、浏览器 localStorage 和设置控件，包含中文 375px 明暗主题与无横向溢出检查。

## 验证边界与文件

本轮没有请求真实付费模型或语音服务，也未更改游戏插件和 MCP 配置。
实际角色台词、音色及游戏事件采集仍需用户实机验证。“完成真实链路验收”仍按原要求排除。

- [节奏策略](/I:/GameTools/airi/apps/stage-tamagotchi/src/renderer/stores/wow-companion-rhythm.ts)
- [闲聊设置](/I:/GameTools/airi/apps/stage-tamagotchi/src/renderer/components/wow-chatter-settings.vue)
- [设计记录](/I:/GameTools/airi/docs/ai/adr/wow-companion-rhythm.md)
- 截图：`I:\GameTools\WOWAddons\output\companion-rhythm`
- 日志：`I:\GameTools\WOWAddons\logs\rhythm-*.log`

重启运行本项目新构建的陪伴精灵后查看新增设置。此次未制作安装包。
下一项“连接体验优化”尚未实施，需按用户要求先确认细节。
