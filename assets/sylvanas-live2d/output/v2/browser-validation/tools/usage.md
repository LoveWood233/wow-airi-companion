# v2 运行模型验收工具

本工具编译当前仓库的模型校验器、ZIP 加载器、静态预览与真实强制眨眼插件。
它通过真实 Cubism Core、Pixi 和 Chromium 检查模型，没有模拟模型或网格。

本工具不覆盖完整 AIRI 设置页、模型持久化、操作系统全局鼠标桥接或语音时序。
鼠标检查使用 Chromium 的实际鼠标事件，并调用当前生产 `focusLive2DModelAt`。
检查包含九方向与两组近中心位置，要求中心恢复零、近中心保留小幅度。
模型的视线参数默认值必须为零，视线移动时双眼网格边界顶点必须保持不动。
动作检查使用真实共享 ticker 播放单次 Yawn 与一个完整的 48 秒 Idle 循环。

## 执行

在仓库根目录执行。三个环境变量分别指向现有 Core 脚本、验证工具依赖和 Chromium 程序。
依赖目录必须包含 `rolldown` 与 `playwright`，工具不会下载或安装依赖。

```powershell
$validation = 'assets/sylvanas-live2d/output/v2/browser-validation'
node "$validation/tools/validate-zip-browser.mjs" `
  --repo (Get-Location).Path `
  --core $env:LIVE2D_CORE_SCRIPT `
  --toolchain $env:LIVE2D_VALIDATION_NODE_MODULES `
  --browser $env:LIVE2D_CHROMIUM_EXECUTABLE `
  --zip 'assets/sylvanas-live2d/output/sylvanas-chibi-v2.live2d.zip' `
  --states "$validation/states.json" `
  --expect-effect ParamEyeLOpen --expect-effect ParamEyeROpen `
  --expect-effect ParamMouthOpenY --expect-effect ParamBreath `
  --expect-effect ParamEyeBallX --expect-effect ParamEyeBallY `
  --preview-repeat 1 --animation-probe --out $validation

node "$validation/tools/render-v2-evidence.mjs" `
  $validation $env:LIVE2D_VALIDATION_NODE_MODULES $env:LIVE2D_CHROMIUM_EXECUTABLE
```

`--prepare-only` 只检查 Core、WebGL 与工具导入，不能证明模型通过。
准备检查不需要 `--zip`、`--states` 或 `--expect-effect`。

`--diagnostic --short-probe` 仅检查鼠标参数与单次哈欠归零，省略 Idle 与视线几何验收。
短诊断不能作为最终模型通过的依据。

## 输出

- `report.json`：模型校验、六项参数、九方向鼠标事件、Yawn 和 Idle 的结果及来源哈希。
- `runtime-default.png`：默认模型的真实渲染。
- `state-*.png`：指定参数组合、鼠标位置和实际动作时间点的渲染截图。
- `gaze-and-yawn.webm`：实际浏览器画布录制，先展示九方向视线，再展示一次哈欠。
- `motion-preview.html`：视频与九方向、哈欠截图的查看页。
- `gaze-comparison.png`：实际鼠标九方向截图对照。

Yawn 检查要求嘴部实际变形、双眼闭合、动作结束后嘴部恢复，并确认动作队列结束。
Idle 检查关闭 SDK 自带呼吸，确认 Body 变形、35–40.2 秒哈欠与结束后闭嘴。
Idle 同时运行当前生产强制眨眼插件，检查它没有抹去已制作的哈欠闭眼曲线。

原始截图与视频来自运行模型，未修改原画。
几何检查要求顶点有限、三角形保持正面积，截图仍需目视检查。
