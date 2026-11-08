# MCP 对话验收入口验证记录

日期：2026-10-31

项目：`I:\GameTools\airi`

## 本次范围

已按用户确认实现第 4.1 节的第 2 项：MCP 对话验收入口。
不将本次实现视为被排除的“完成真实链路验收”。

入口：设置 → 首次使用向导 → MCP 对话验收。
默认问题：“无限服瑟银锭有什么用”。可修改问题，该入口固定使用无限服资料。

## 行为

1. 点击后发现陪伴精灵自己连接的 MCP 工具，必须包含 `wuxianwow::search`。
2. 使用当前聊天服务、模型和角色人设，经现有 LLM 工具链触发实际查询。
3. 验收仅暴露 `wuxianwow::search` 和 `wuxianwow::fetch`，每轮最多六次查询。
4. 保留本轮成功工具调用的回执，仅在内存核对，不保存原始回执。
5. 回答必须注明“无限图鉴 wuxianwow.com”，且含本轮返回的网页链接。
6. 只有查询及来源检查通过后，才能单独点击试听本次回答。
7. 试听复用现有语音适配器和当前模型、音色、语音设置；普通合成与流式输出使用现有浏览器播放实现。
8. 播放完成后，用户点击“听见了，通过验收”才记录整体验收通过。
9. 取消、离开页面、修改问题、模型、人设、音色或相关服务配置，会作废当前结果并停止本轮试听。
10. 仅保存最近一次时间与结果，标明为历史记录。重新打开页面不会自动恢复当前通过状态。

查询回执证明成功执行，网页匹配证明引用来自本轮工具结果，不代表逐条事实已经过语义审核。
取消无法撤销服务端已经收到的请求；迟到的结果会被丢弃，不能改变当前状态。
聊天超时 90 秒，试听超时 60 秒，不自动重试。

## 验证命令与结果

工作目录均为 `I:\GameTools\airi`。

| 命令 | 结果 |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project node wow-mcp-evidence.test.ts` | 5 项通过 |
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project browser wow-mcp-check.browser.test.ts wow-guide.browser.test.ts use-wow-guide-startup.browser.test.ts wow-setup-checks.browser.test.ts` | 26 项通过，其中新入口 9 项 |
| `pnpm -F @proj-airi/stage-tamagotchi typecheck` | 通过 |
| `pnpm -F @proj-airi/stage-tamagotchi build` | 最后一次桌面构建通过 |
| `pnpm -F @proj-airi/i18n typecheck` | 通过 |
| `pnpm -F @proj-airi/i18n build` | 通过 |
| `pnpm lint` | 0 错误、670 项既有警告 |
| `pnpm typecheck` | 未通过：既有场景包缺少 vue-tsc，MediaPipe 包缺少本地依赖，与本次改动无关 |

覆盖成功调用与来源、无实际调用、工具错误、伪造链接、禁止写工具、六次调用上限、取消和迟到结果、切换模型、断连、查询后回答失败、语音确认、中文窄屏深色布局。

测试只模拟外部模型、MCP 与语音服务边界，不模拟 Pinia 或 Vue 组件。
语音测试使用模拟服务返回的有效静音 WAV，交由真实浏览器解码与播放。
开发期间没有请求真实付费模型或语音服务。
普通合成已通过浏览器回归。流式输出复用已有适配器，真实服务兼容性仍待用户试听。

## 文件与交付

- [验收界面](/I:/GameTools/airi/apps/stage-tamagotchi/src/renderer/components/wow-mcp-check.vue)
- [工具回执与来源检查](/I:/GameTools/airi/apps/stage-tamagotchi/src/renderer/utils/wow-mcp-evidence.ts)
- [设计记录](/I:/GameTools/airi/docs/ai/adr/wow-companion-mcp-acceptance.md)
- [功能现状与扩展规划](/I:/GameTools/WOWAddons/魔兽陪伴精灵-功能现状与扩展规划.md)
- [中文深色窄屏截图](/I:/GameTools/WOWAddons/output/mcp-acceptance/wow-mcp-check-zh-dark.png)
- 日志：`I:\GameTools\WOWAddons\logs\mcp-acceptance-*.log`

重启运行本项目构建的陪伴精灵，才能加载新增入口。此次未制作安装包、未变更 MCP 配置或游戏插件。
个人服务的实际回答、音色与扬声器效果，需要用户点击验收。
下一项“陪伴节奏深化”尚未实施，按用户要求先确认具体细节。
