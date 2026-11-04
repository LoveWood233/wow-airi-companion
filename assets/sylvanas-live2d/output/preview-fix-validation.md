# 预览清理修复与真实模型回归

本次浏览器检查通过。输入 ZIP SHA-256：`fb7dbae27c1cd59d332e27ff801c2b0066fbc030a251ea3d5bbbd6c12b6c6db5`。

这是当前仓库模块的真实浏览器检查，没有启动 AIRI 完整应用。未覆盖 Electron 导入、模型存储、选择或重启持久化。

## 修复与证据

含 Idle 的 ZIP 在旧预览函数中触发异步动作启动，模型先被清理，随后出现 `undefined.stopAllMotions`。

[预览函数](../../../airi/packages/stage-ui-live2d/src/utils/live2d-preview.ts) 现在关闭自动更新和动作预加载。构造、加载和绘制位于同一资源作用域，`finally` 释放模型、纹理、应用和画布。文件直接包装为 `File`，不再创建额外对象 URL。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 修复前原始复现 | 预览阶段出现销毁后的 Idle 异步异常 | [原始报告](browser-validation/preview-regression/before-report.json) |
| 修复后相同旧候选 | 预览、四参数正常，浏览器错误为空 | [首次通过报告](browser-validation/preview-regression/after-initial-report.json) |
| 最新 ZIP 连续预览三次 | 均有实际像素，画布、共享 ticker、纹理缓存计数恢复，浏览器错误为空 | [最终报告](browser-validation/report.json) |
| 非法 ZIP 输入 | 返回 `undefined`，上述资源计数恢复，无 `pageerror` | [失败清理报告](browser-validation/preview-regression/invalid-input-cleanup-report.json) |

非法输入报告保留预期的 JSZip `console.error`，顶层 `ok` 因此为 `false`。其中 `result.resourcesRestored` 和 `result.ok` 均为 `true`，没有隐藏该错误。

## 模型实际覆盖

- 当前 ZIP 的仓库校验结果为 `VALID`，无问题记录。
- 左眼、右眼、口型、呼吸均改变实际绘制数据和渲染像素。
- 已保存双眼闭合、口型 `0/0.005/0.01/0.25/0.5/1`、呼吸 `0/1` 的截图。
- 闭眼横向缩窄后，鼻梁间隙清晰。眼线仍是浅红直线，尚非独立弧形眼睑。
- 口型 `0.25/0.5/1` 的双嘴重影已消除。`0.005` 的极窄过渡区仍能看到贴近的两条浅线。
- 实际 Idle 播放超过四秒，已按项目实现删除 SDK 默认 `breath`。`ParamBreath` 覆盖 `0→1`，Body 顶点最大变化约 `0.003547`。
- 停止 Idle 的八秒控制阶段中，呼吸保持 `0`、Body 顶点不变，Groups 对应的原生眨眼实际覆盖 `0→1`。

原生 SDK 在 Idle 更新成功时跳过自动眨眼，因此 Idle 采样中没有原生眨眼。AIRI 默认开启的 Force Auto Blink 插件能补充这一过程，依据是项目源码。本工具没有运行完整应用的插件组合或用户持久化设置，不能据此声称完成应用内同时播放验证。

[默认交付预览](preview.png) · [脸部对照](browser-validation/face-comparison.png) · [Idle 采样查看页](browser-validation/idle-sampling.html)

## 可复现步骤

在仓库根目录运行。设置以下环境变量，分别指向现有 Core 脚本、验证工具的 `node_modules` 和可用 Chromium：

- `LIVE2D_CORE_SCRIPT`
- `LIVE2D_VALIDATION_NODE_MODULES`，包含 `rolldown` 和 `playwright`
- `LIVE2D_CHROMIUM_EXECUTABLE`

```powershell
$validation = 'assets/sylvanas-live2d/output/browser-validation'
node "$validation/tools/validate-zip-browser.mjs" `
  --repo (Get-Location).Path `
  --core $env:LIVE2D_CORE_SCRIPT `
  --toolchain $env:LIVE2D_VALIDATION_NODE_MODULES `
  --browser $env:LIVE2D_CHROMIUM_EXECUTABLE `
  --zip 'assets/sylvanas-live2d/output/sylvanas-chibi-v1.live2d.zip' `
  --states "$validation/states.json" `
  --expect-effect ParamEyeLOpen --expect-effect ParamEyeROpen `
  --expect-effect ParamMouthOpenY --expect-effect ParamBreath `
  --preview-repeat 3 --animation-probe --out $validation

node "$validation/tools/render-candidate-evidence.mjs" `
  $validation $env:LIVE2D_VALIDATION_NODE_MODULES $env:LIVE2D_CHROMIUM_EXECUTABLE
Copy-Item "$validation/runtime-default.png" 'assets/sylvanas-live2d/output/preview.png'
```

工具直接编译当前仓库的校验器、ZIP 加载器和预览函数，使用真实 Core 与浏览器包。报告保留源码、依赖和 ZIP 哈希。它不下载运行时或安装工作区。

本轮使用 Node.js 24.14.0、Core 5.0.0、Pixi 6.5.10、pixi-live2d-display 0.4.0、JSZip 3.10.1 和 Chromium 156.0.8078.4。浏览器采用软件 WebGL，不代表用户显卡性能。

失败清理可通过同一命令增加以下参数复跑，并将输出改为单独目录：

```powershell
--entry "$validation/tools/preview-failure-entry.mjs" --diagnostic
```

此负向检查有意传入非法 ZIP，并保留预期错误，因此命令退出码为 `1`。资源回收结论位于报告的 `result` 字段。

## 要求的项目检查

以下命令均在 `airi` 目录、修复后的源码上实际执行。没有自动安装或修复依赖。

| 命令 | 退出码与实际结果 |
| --- | --- |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-ui-live2d typecheck` | `127`，缺少 `vue-tsc` |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-ui-live2d exec vitest run` | `1`，37 通过、2 失败，另有依赖导入和 Chromium 启动失败 |
| `pnpm --config.verify-deps-before-run=false typecheck` | `127`，缺少 `turbo` |
| `pnpm --config.verify-deps-before-run=false lint` | `127`，缺少 `moeru-lint` |

Vitest 缺少 `jszip`、`@pixi/*`、工作区模型驱动等依赖，配置指定的 Chromium 1234 也不存在。真实浏览器回归使用另一个现有 Chromium 1248 目录，没有修改 Vitest 配置。

[检查汇总](browser-validation/preview-regression/checks/checks-summary.json) · [Vitest 日志](browser-validation/preview-regression/checks/package-vitest.log)

项目 typecheck、Vitest 和 lint 未通过。上述模块浏览器回归不能替代这些检查，也不能替代完整应用导入验证。
