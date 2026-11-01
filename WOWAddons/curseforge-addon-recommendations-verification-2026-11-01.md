# 插件中心修复与聊天推荐验证

日期：2026-11-01。

实际修改并构建的桌面项目：`I:\GameTools\wow-airi-companion\airi`。
桌面项目的共享包链接指向 `I:\GameTools\airi\packages`，因此同步了本次涉及的共享聊天卡片行为和中英文翻译，并重建该处 i18n 包。

## 插件中心故障

配置的 CurseForge API key 有效。旧代码请求魔兽分类时使用 `classId=447`，真实接口返回 HTTP 404。
已统一修正分类请求、搜索请求、插件对象校验为魔兽的 `gameId=1`、`classId=1`。
使用现有密钥实测读取到 72 个分类。密钥未写入代码、报告或日志。

正式服、无限服在 API 仅返回一个匹配分支时可以直接使用，不再因尚未保存版本类型而阻止加载。
怀旧服具有多个分支，仍需要在插件设置中选择具体分支；过期或跨客户端的版本 ID 不会被静默替换。

## 新功能

对话默认提供 `wow_recommend_addons` 工具，用于“推荐背包插件”“某功能有没有插件”等请求。
工具根据用户明确指定或当前观测到的客户端查询 CurseForge；无法确定时询问客户端。
常见中文、英文功能匹配 API 分类；合并下载量与热度搜索结果，去重后按名称和功能相关度、总下载量排序。
验证项目文件的客户端分支，优先正式发布版本，其次 Beta，最多返回五项。
兼容性依据 API 客户端分支标签，卡片同时展示文件版本与游戏补丁标签，不声称已经逐个在当前游戏补丁中运行验证。

聊天卡片展示五项插件、简介、下载量、版本和 CurseForge 项目链接，首次自动展开，用户手动收起后保持收起。
用户点击某项“安装”后才下载并安装。模型的推荐工具不能直接触发安装。
复用现有安装器处理必需依赖、文件大小和 SHA-1、ZIP 路径、文件夹所有权、暂存与回滚。
安装时重新检查作者授权、配置及文件兼容性。推荐在十分钟后过期，修改插件设置或重启应用也会使推荐失效。
重复点击、旧卡片安装响应、未知推荐 ID、接口错误、目录冲突和安装失败均有处理。

作者禁止第三方下载的项目会显示原因与官网链接，禁用安装按钮。不会拼接 CDN 地址绕过限制。
安装新插件后，重启魔兽客户端可以确保扫描并加载新增插件目录。

## 真实接口试用

通过生产目录客户端和推荐服务进行只读试用，时间为北京时间 2026-11-01 18:40，正式服、`bags`。

| 顺序 | 插件 | 总下载量 | 自动安装状态 |
| --- | --- | ---: | --- |
| 1 | [Bagnon](https://www.curseforge.com/wow/addons/bagnon) | 168,919,529 | 作者禁止第三方下载 |
| 2 | [Baganator](https://www.curseforge.com/wow/addons/baganator) | 39,701,586 | 作者禁止第三方下载 |
| 3 | [ArkInventory](https://www.curseforge.com/wow/addons/ark-inventory) | 13,995,184 | API 元数据允许安装 |
| 4 | [BagBrother](https://www.curseforge.com/wow/addons/bagbrother) | 13,252,726 | 作者禁止第三方下载 |
| 5 | [BetterBags](https://www.curseforge.com/wow/addons/better-bags) | 4,875,479 | API 元数据允许安装 |

五项均具有正式服分支文件，文件标签均包含 12.1.5。此次没有选择并安装到用户真实游戏目录。
来源为 [CurseForge API](https://docs.curseforge.com/rest-api/)，公开结果保存在 `logs/addons-live-check.log`。
可使用 `apps/stage-tamagotchi/scripts/wow-addons-live-check.ts` 再次执行只读验证；通过环境变量提供密钥，输出仅含公开目录字段。

## 验证结果

以下 pnpm 命令均带有 `--config.verify-deps-before-run=false`，避免测试期间自动安装依赖。

- 桌面工作区 `pnpm exec vitest run --project=node`，限定 `wow-addons-catalog`、`wow-addons-settings`、`wow-addons-install`、`wow-addons`、`wow-addon-recommendations`、共享版本选择与内建工具注册七个测试文件：133 项通过。
- 桌面工作区 `pnpm exec vitest run --project=browser`，限定插件中心、推荐卡片、聊天推荐工具三个测试文件：19 项通过。聊天测试使用真实聊天 SDK、Pinia 和 Eventa，只替换模型 HTTP 与桌面边界；未调用付费模型。
- stage-ui 工作区 `pnpm exec vitest run --project=browser src/components/scenarios/chat/components/tool-call-group.browser.test.ts`：3 项通过。
- 桌面工作区与 stage-ui 工作区分别执行 `pnpm typecheck`：通过。
- 根目录 `pnpm lint`：0 错误，670 个现有警告。本次修改文件的定向 ESLint 校验也通过。
- 根目录 `pnpm typecheck`：未通过。原有 `scenarios-stage-tamagotchi-electron` 包缺少 `@vishot/source-electron`、`@moeru/std` 等依赖/类型，并出现相关场景上下文类型错误；没有通过修改配置隐藏这些错误。
- 共享 i18n 工作区 `pnpm build`：通过；实际桌面工作区 `pnpm build`：通过，最终构建包含本次功能。
- 人工检查了 375/600 宽度、中文、浅色与深色推荐卡片截图；五项选择可见，文本与按钮无横向溢出。
- Git 差异空白检查通过，并保留已跟踪文件的原有换行格式。

安装器集成测试向临时模拟客户端目录写入测试 ZIP，覆盖主插件与必需依赖安装，不改动真实游戏插件。
完整日志位于 `I:\GameTools\WOWAddons\logs\addons-*.log`。

## 启用

完全退出魔兽陪伴精灵，包括系统托盘进程，再启动原来的入口以加载新的桌面构建。
现有 API key 无需重新输入。可询问“给我推荐正式服的背包插件”，然后在卡片中点击可安装项目的“安装”。
