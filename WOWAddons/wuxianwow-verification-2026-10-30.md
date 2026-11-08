# 无限图鉴接入验证（2026-10-30）

- 已在用户资料目录 `C:/Users/10413/.airi-wow-companion/mcp.json` 中添加 `wuxianwow`，使用 `https://wuxianwow.com/mcp`，保留其他服务器配置。
- 配置备份位于 `backups/wuxianwow-20261030/mcp.json`，不用于发布。
- 使用陪伴精灵已安装的 MCP SDK、Streamable HTTP 传输及保存的 endpoint，真实连接成功，发现 49 个工具。
- 实际调用 `search`，参数为 `{"query":"瑟银锭","limit":5}`。首项为 `item:12359`，链接 https://wuxianwow.com/item/12359 。共 211 条相关命中，含 6 条物品、204 条配方、1 条任务。
- 查询结果保存在 `tmp/wuxianwow-search-thorium.json`，工具目录保存在 `tmp/wuxianwow-tools.json`。
- 共享查询上下文新增无限服优先使用 wuxianwow、署名附链接、工具不可用说明及版本隔离规则。拍卖价格保留采集时间。
- `AGENTS.md` 保存用户指定的后续查询偏好。
- 没有重启当前应用。外部编辑的配置和新构建需正常退出、重启陪伴精灵后加载。
- 本次验证 MCP 实际连通和 search，不等于已经完成陪伴角色的一轮模型回复。

## 检查

| 命令 | 结果 |
| --- | --- |
| `node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts src/wow-knowledge/index.test.ts`（stage-shared） | 16 项通过 |
| `node node_modules/vitest/vitest.mjs run --config packages/stage-ui/vitest.config.ts wow-knowledge-context.test.ts`（airi） | 7 项通过 |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-shared typecheck` | 通过 |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi build` | 通过 |
| `pnpm --config.verify-deps-before-run=false lint` | 0 错误、670 警告 |
| `pnpm --config.verify-deps-before-run=false typecheck` | 被现有 scenarios-stage-tamagotchi-browser 缺少 vue-tsc 阻塞 |

来源：[无限图鉴接入说明](https://wuxianwow.com/ai)。测试日志为 `logs/wuxianwow-*.log`。
