# 插件源码同步与通信文档验证

日期：2026-11-01。

发布仓库：`LoveWood233/wow-airi-companion`，分支 `main`。
同步来源：`I:\GameTools\WOWAddons`。发布工作区：`I:\GameTools\wow-airi-companion`。

## 提交内容

- 新增 [游戏插件与 AIRI 通信说明](wow-addon-airi-communication.md)，并在根 README、两服插件、桥接和宏导入说明中添加入口。
- 同步正式服插件 2.19.0、无限服插件 1.17.0、桥接 2.19.0 的源文件、测试和合成测试样本。
- 同步离线历史、背包库存、任务、天赋及相关分片协议。无限服同时包含区域等级提示的已有实现。
- 宏导入插件 1.0.0 和早期外部情报服务代码已经在仓库中，本次核对与本机一致。
- 补齐正式服共享语言表缺少的一条中英文提示，使两服共用显示目录保持一致。未删除或放宽原回归断言。

同步只包含代码、说明和测试样本。未收录用户配置、SavedVariables、角色存档、日志、SQLite 资料库、依赖缓存或截图。
没有修改实际游戏安装目录，没有模拟游戏输入，也没有启动或重启用户正在运行的程序。
历史 ZIP 保留原有版本。最新可安装源码是对应插件目录，不将旧 ZIP 标成新版本。

## 运行结果

测试在发布工作区中运行，使用现有测试专用 Lua 5.1 Lupa 依赖。
生产插件和桥接不增加此依赖。

| 工作目录与命令 | 结果 |
| --- | --- |
| `WOWAddons/WoWMapCompanion`：`python -m unittest discover -s tests -q` | 217 项通过 |
| `WOWAddons/WoWForeverCompanion`：`python -m unittest discover -s tests -q` | 224 项通过 |
| `WOWAddons/WoWCompanionBridge`：`python -m unittest discover -s . -q` | 274 项通过 |
| AIRI 桌面工作区：`pnpm exec vitest run --project=node wow-companion-client.test.ts wow-companion-runtime.test.ts wow-companion-gold.test.ts wow-companion-loadouts.test.ts wow-companion-level-history.test.ts` | 85 项通过，9 项按测试运行条件跳过 |
| 实际 Lua 帧 → 当前 Python `CompanionState` → AIRI `bridgeSchema` | 两服均接受，状态均为 `live`，来源均为 `screen` |
| AIRI 根目录：`pnpm lint` | 0 错误，670 个现有警告 |
| 新文档本地链接、各 TOC 所列文件 | 全部存在 |
| 改动文件的密钥与运行数据筛查 | 未发现密钥字面量或运行数据文件 |
| Git 差异空白检查 | 通过 |

pnpm 命令均带 `--config.verify-deps-before-run=false`，避免检查时自动安装依赖。
合计 800 项自动化测试通过，另有 9 项条件跳过。Lua 测试覆盖编码、显示、分片与功能逻辑，桥接覆盖解码、重组、状态和 HTTP。
直接契约验证使用仓库中的合成角色样本，没有读取真实角色信息。

完整日志位于 `I:\GameTools\WOWAddons\logs\plugin-publish-*.log`。

## 实现边界

本次同步保持主心跳 v3 和 WCP1/WCF1 帧边界。新增数据模块不代表 AIRI 界面已经消费了所有字段。
插件的 `snapshotJSON` 离线保存已包含在源码中，但当前仓库 AIRI 角色服务尚未扫描 SavedVariables 并自动补录。
文档明确区分插件存档、桥接接收与桌面消费，未把其他本地开发成果写成已发布桌面能力。
没有执行真实游戏画面、输入法、窗口焦点和语音设备验收。
