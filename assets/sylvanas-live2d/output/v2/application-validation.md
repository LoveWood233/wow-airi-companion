# v2 应用动作驱动检查

日期：2026-11-04。

新模型的视线绑定可直接使用现有鼠标跟随驱动。模型自带眨眼与哈欠曲线时，选择“自动”眨眼模式即可保留这些动作。

“强制”眨眼模式需要本轮应用修复，才能同时保留哈欠眼部曲线。更新模型 ZIP 本身不会更新已安装应用的代码。

本轮还修正应用的焦点归中。旧驱动能移动视线，但在模型中心仍会得到满幅方向；平滑归中需要更新应用代码。

## 修复范围

原强制眨眼在表情系统关闭时，用静态眼睛开度替换 Idle 动作的眼部曲线。哈欠动作即使写入闭眼参数，最终也会被改回睁眼。

眨眼状态机现由 [eye-blink.ts](../../../../airi/packages/stage-ui-live2d/src/composables/live2d/eye-blink.ts) 管理。原 `motion-manager` 公共出口继续导出同一函数。

当前 Cubism 4 动作存在眼部曲线时，强制眨眼将计时器因子与本帧动作开度相乘。没有眼部曲线时，仍以用户静态开度为基准，避免重复乘上上一帧闭眼值。

表情系统开启时，存在眼部曲线的动作也使用当前形状。这样眨眼结束后不会恢复成哈欠开始前的旧形状。

现有口型同步在静音时会交还嘴部参数。说话结束后保留约 700 毫秒的释放和闭嘴交接，不需要增加新的嘴部覆盖逻辑。

实际鼠标输入原先经过 `Model.vue → Live2DModel.focus()`。SDK 0.4.0 使用 `atan2`、`cos` 和 `sin` 把所有指针位置投影到单位圆，模型中心也会得到满幅视线。

[model-focus.ts](../../../../airi/packages/stage-ui-live2d/src/utils/model-focus.ts) 现在使用容器和模型布局的逆变换，再保留指针到中心的归一化距离。精确中心对应 `(0, 0)`，近中心移动保持小幅度，越界位置按轴限制在 `[-1, 1]`。生产 `Model.vue` 已调用这一适配器，没有修改 SDK 或依赖。

## 定向回归

[eye-blink.test.ts](../../../../airi/packages/stage-ui-live2d/src/composables/live2d/eye-blink.test.ts) 共 5 项通过：

- 保留 Idle 动作的左右眼曲线，并允许自动眨眼在其上闭合。
- 没有眼部曲线时，眨眼后双眼能恢复，避免反馈衰减。
- 表情系统开启时，眨眼结束后使用动作当前的眼部形状。
- 左右眼分别保留用户开度倍率。
- 非 Idle 动作继续拥有自己的眼部曲线。

先将原状态机移入新模块并运行新增断言，两项动作曲线断言失败。补上表情系统路径的断言后，又复现旧形状恢复错误。修复后的最终 5 项均通过。

定向测试使用真实生产模块。它没有模拟 Pinia，也没有模拟缺失的工作区包。SDK 模型参数接口使用测试替身，不代表完整桌面应用或实际模型的渲染验收。

[model-focus.test.ts](../../../../airi/packages/stage-ui-live2d/src/utils/model-focus.test.ts) 另有 8 项通过，覆盖中心、近中心、四个轴向、越界限制，以及容器缩放和模型布局变换。两组定向测试合计 13 项通过。

## 实际命令与结果

以下命令在 `airi` 目录执行。未安装依赖，未更改 TypeScript 或 Vitest 配置。

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-ui-live2d exec vitest run --project node src/utils/model-focus.test.ts src/composables/live2d/eye-blink.test.ts` | 退出码 0，13 项通过 | [定向回归](application-checks/targeted-motion-tests.txt) |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/motion-manager.test.ts` | 退出码 1，缺失工作区驱动包，0 项执行 | [关联回归](application-checks/motion-manager-tests.txt) |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-ui-live2d typecheck` | 退出码 127，缺少 `vue-tsc` | [包类型检查](application-checks/package-typecheck.txt) |
| `pnpm --config.verify-deps-before-run=false typecheck` | 退出码 127，缺少 `turbo` | [根类型检查](application-checks/root-typecheck.txt) |
| `pnpm --config.verify-deps-before-run=false lint` | 退出码 127，缺少 `moeru-lint` | [格式检查](application-checks/root-lint.txt) |

关联回归的导入错误为缺失 `@proj-airi/model-driver-magic-live2d`。该包的公共入口指向构建产物，当前工作区未提供可用的安装或构建结果。

定向回归通过不能替代受阻的关联回归、类型检查或格式检查。真实模型的 Core、动作播放和浏览器截图需另看对应模型报告。
