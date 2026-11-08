# 对话频率恢复与全物品档案验证

日期：2026-11-01。

实际桌面项目：`I:\GameTools\wow-airi-companion\airi`。
插件、桥接开发源码同时同步到 `I:\GameTools\WOWAddons`。

## 使用

正式服和无限服的陪伴设置页顶部新增“对话频率”。可开关主动闲聊，设置 1～60 分钟间隔，修改自动保存。
两服共用这组频率偏好。手动问答和事件提醒的冷却设置保持独立。
原先的频率控制未同步到实际运行的桌面副本，该副本的闲聊间隔固定为一分钟。本次已把偏好连接到实际运行策略。

同页新增“角色物品档案”，显示各角色已收到的背包、银行物品格数、资料完整性与银行页观测时间。
共享银行单独统计，不会按每个角色重复保存同一账号的共享银行容器。
从未读取过的银行显示“未扫描”，不把未知内容显示为零。

请重启魔兽世界及陪伴精灵，确保加载新增 Lua 模块和新的桥接代码。
首次采集银行时打开银行，保持界面打开供容器采集完成。完整大批资料在后台分片传输，初次接收存在延迟。
关闭银行后，已经采集到的内容仍可继续传输，界面保留原始观测时间。
无限服提供 1.18.0 源码，本机未发现可核实的无限服插件安装目录，未向未知目录写入文件。

## 数据结构

正式服归档文件：`C:\Users\10413\.airi-wow-companion\wow-companion-items-v1.json`。
无限服对应：`wow-companion-forever-items-v1.json`。文件在收到有效容器后产生。
路径由 AIRI 的用户数据目录决定，其他安装环境以应用配置为准。

JSON 顶层为 `version:1`、`entries`。每条保留账号分组、角色名、服务器、接收时间、容器记录和必要的 `lastComplete`。
容器记录保留角色 GUID、会话、采集时间、位置范围、容器 ID、容量、完整性及缓存标记。
每个槽位保留位置、状态、数量，以及物品实例链接、GUID、名称、品质、装等、等级要求、类型、公开数值属性和词条文本。
附魔、宝石和奖励变体保留在实例链接及公开说明中，不据此声称效果已激活。
相同物品 ID 的不同实例不合并。限制读取、缺失和裁剪各有标记，不能用于断言完整配装收益。

按账号、角色、范围和容器更新记录。账号共享银行使用账号与容器身份，不归为每个角色独有资产。
未变化内容不产生新修订。持续拾取只合并后继版本，不重启在途数据；不同容器公平轮换。
每次 HTTP 只拉取一份变更容器，常规角色轮询与 IPC 不重复携带全部属性和词条。
单容器最多 200 格、2 MiB。归档最多 64 MiB，错误会显示，不静默覆盖损坏文件。
临时文件、同步及原子替换保护已完成存档；不完整新观测另保留上一次完整版本。

本次提供后续配装评估的数据基础，没有自动选择或穿戴最优配装。
需要结合采集时间、角色限制、槽位状态和词条完整性评估，不能把历史银行内容当成已经穿戴的装备。

## 验证

除 Python 外，pnpm 命令均加 `--config.verify-deps-before-run=false`，避免检查期间自动安装依赖。

| 命令与范围 | 结果 |
| --- | --- |
| 正式服：`python -m unittest discover -s tests -q` | 224 项通过 |
| 无限服：`python -m unittest discover -s tests -q` | 231 项通过 |
| 桥接：`python -m unittest discover -s . -q` | 279 项通过 |
| 桌面：`pnpm exec vitest run --project=node`，限定物品档案、闲聊策略、装备快照与持久化、HTTP 客户端、桥接生命周期和事件策略七个文件 | 131 项通过，11 项按运行条件跳过 |
| 桌面：`pnpm exec vitest run --project=browser src/renderer/pages/settings/wow-companion.browser.test.ts` | 95 项通过 |
| 桌面：`pnpm typecheck` | 通过 |
| i18n：`pnpm build` | 通过，更新了实际 workspace 链接指向的共享翻译产物 |
| 桌面：`pnpm build` | 通过，实际使用副本的 `out` 已更新 |
| AIRI 根目录：`pnpm lint` | 0 错误、670 个现有警告 |
| AIRI 根目录：`pnpm typecheck` | 未通过：既有 `scenarios-stage-tamagotchi-browser` 工作区缺少可执行的 `vue-tsc` |

共 960 项通过，11 项条件跳过。新增覆盖真实 Lua 到 Python、Lua 到 TypeScript 的完整实例详情契约。
还验证了实例变体、非装备物品、银行关闭与未就绪、缓存重播、分片乱序与冲突、持续拾取、共享银行去重、角色隔离、原子存储、损坏文件保留及频率持久化。
人工检查了 390 和 600 像素宽度下的频率卡片截图。没有进行真实游戏银行内容、输入法或语音设备的端到端验收。
日志位于 `I:\GameTools\WOWAddons\logs\items-*.log`。

## 本机更新

通过项目已有 `Install-WoWCompanion.ps1` 更新正式服插件，共 18 个运行文件，安装后逐字节核对与验证源码一致。
目录为 `I:\Game\World of Warcraft\_retail_\Interface\AddOns\WoWMapCompanion`。
原文件备份于 `I:\GameTools\wow-airi-companion\WOWAddons\backups\WoWMapCompanion-20261101-224714-253`。
没有修改游戏 SavedVariables 或陪伴精灵已有角色记录，没有重启正在运行的游戏或桌面进程。

相关设计：[对话频率](../airi/docs/ai/adr/wow-conversation-frequency.md)、[全物品档案](../airi/docs/ai/adr/wow-item-storage.md)。
