# 2.16.0 源码同步验证记录

日期：2026 年 10 月 29 日。

本次同步当前本地代码、游戏插件、桥接、使用说明和《功能现状与扩展规划》。保留仓库已有角色资产，更新源码包及快照清单。

## 本次修改

- 同步桌面端的产品命名、多语言、插件中心及相关功能更新。
- 同步正式服插件 2.12.0、无限服插件 1.9.0 和桥接 2.12.0，包括地图坐标。
- 将功能现状与扩展规划加入仓库及源码交付包。
- 补齐交付清单遗漏的快捷启动按钮文件。
- 将更新清单测试中的安装包名称改为当前产品名称，保留文件内容及清单校验断言。

## 验证环境

测试在本机实际开发目录 `I:\GameTools\airi` 和 `I:\GameTools\WOWAddons` 执行。GitHub 快照位于 `I:\GameTools\wow-airi-companion`。

交付包逐文件校验 SHA-256，并核对原开发文件。同步时保留已有文本换行格式，新文本使用 LF。运行日志、依赖和用户配置不在本次提交中。

打包后，开发目录的 `build-delivery.py` 和 `wow-companion-implementation.html` 又出现传送门数据相关改动。本次提交保留已经核验的交付包版本，未覆盖后续本地改动，也未纳入仍在更新的传送门数据目录。

## 通过的检查

以下 `pnpm` 命令均加上 `--config.verify-deps-before-run=false`，避免检查过程自动安装依赖。

| 检查 | 实际命令与执行位置 | 结果 |
| --- | --- | --- |
| 正式服插件 | 在 `WOWAddons/WoWMapCompanion` 执行 `python -m unittest discover -s tests -q` | 165 项通过。 |
| 无限服插件 | 在 `WOWAddons/WoWForeverCompanion` 执行 `python -m unittest discover -s tests -q`，`PYTHONPATH` 指向正式服测试的 `.deps` | 164 项通过。 |
| 本机桥接 | 在 `WOWAddons/WoWCompanionBridge` 执行 `python -m unittest discover -q` | 157 项通过。 |
| 桌面相关 Node 测试 | 在 `airi` 执行 `pnpm exec vitest run --config apps/stage-tamagotchi/vitest.config.ts --project node wow- computer-use/runtime windows/shared windows/desktop-overlay/window-contract libs/electron/application-menu scripts/update-test/generate-manifest.test.ts` | 634 项通过，16 项跳过。包含修正后的安装包名称测试。 |
| 桌面相关界面测试 | 在 `airi` 执行 `pnpm exec vitest run --config apps/stage-tamagotchi/vitest.config.ts --project browser wow-companion wow-addons wow-launcher wow-screen-assist speech-caption-bubble controls-island local-routes` | 183 项通过。 |
| 多语言 | 在 `airi` 执行 `pnpm -F @proj-airi/i18n exec vitest run` | 84 项通过。 |
| 知识库 | 在 `airi` 执行 `pnpm -F @proj-airi/stage-shared exec vitest run src/wow-knowledge/index.test.ts` | 15 项通过。 |
| 聊天、字幕与请求上下文 | 在 `airi` 执行 `pnpm exec vitest run --config packages/stage-ui/vitest.config.ts --project node chat.contract.test.ts playback-caption.test.ts wow-knowledge-context.test.ts request-context.test.ts` | 103 项通过。 |
| 桌面类型检查 | 在 `airi` 执行 `pnpm -F @proj-airi/stage-tamagotchi typecheck` | 通过。 |
| 共享逻辑类型检查 | 在 `airi` 执行 `pnpm -F @proj-airi/stage-shared typecheck` | 通过。 |
| 共享界面类型检查 | 在 `airi` 执行 `pnpm -F @proj-airi/stage-ui typecheck` | 通过。 |
| 桌面生产构建 | 在 `airi` 执行 `pnpm -F @proj-airi/stage-tamagotchi build` | 通过。构建产物不纳入源码快照。 |
| 全仓 lint | 在 `airi` 执行 `pnpm lint` | 0 错误、670 条警告。 |
| 修改后测试文件 lint | 在 `airi` 执行 `pnpm exec eslint apps/stage-tamagotchi/scripts/update-test/generate-manifest.test.ts` | 通过。 |
| 源码包 | 在 `WOWAddons` 执行 `python build-delivery.py` | 558 个交付文件通过 SHA-256 核对及 ZIP 完整性检查。 |
| 差异空白检查 | 在快照仓库执行 `git -c core.whitespace=cr-at-eol diff --check` | 通过，允许仓库保留的 CRLF。 |

## 未全部通过的检查

### 全仓类型检查

命令：在 `airi` 执行 `pnpm --config.verify-deps-before-run=false typecheck`。

场景包 `@proj-airi/scenarios-stage-tamagotchi-browser` 缺少可调用的 `vue-tsc`，命令退出码为 127。不能将桌面与相关包的单独类型检查通过表述为全仓通过。

### 完整桌面 Node 测试

命令：在 `airi` 执行 `pnpm --config.verify-deps-before-run=false exec vitest run --config apps/stage-tamagotchi/vitest.config.ts --project node`。

首次运行结果为 1183 项通过、6 项失败、17 项跳过。

- 其中 1 项是安装包测试仍期待 `AIRI-...`，实际名称已为 `魔兽陪伴精灵-...`。本次修正断言，并在后续相关 Node 测试中复测通过。
- 4 项因 Windows 创建符号链接时报 `EPERM` 而失败，涉及扩展宿主和静态资源测试。
- 1 项静态资源路径测试期待 `/`，而 Windows 返回 `\`。

后 5 项所在模块未在本次同步中修改。未关闭这些测试、修改系统权限或将失败改为跳过。修正名称断言后只复测相关集合，未重新运行完整桌面 Node 集合。

## 实机边界

本次未启动真实游戏进行验收，未调用付费模型，未使用 CurseForge 密钥执行真实下载。无限服、截图问答和插件中心的实机待办仍以功能盘点文档为准。

上述结果属于本机检查，不代表 GitHub Actions 已验证。
