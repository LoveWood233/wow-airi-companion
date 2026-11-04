# Live2D 运行数据检查

`validate-runtime.mjs` 使用显式传入的 Cubism Core 脚本解析真实 `.moc3`。工具不下载或捆绑 Core，也不修改模型输入。

已用 Node.js 24.14.0 与 Core 5.0.0 检查静态诊断模型。其他 Core 文件需实际执行后才能确认结果。

从仓库根目录运行，并替换三个文件路径：

```powershell
node assets/sylvanas-live2d/tools/validate-runtime.mjs `
  --core "D:\path\live2dcubismcore.min.js" `
  --model "E:\path\sylvanas.model3.json" `
  --report "E:\path\runtime-validation.json" `
  --expect-effect ParamEyeLOpen `
  --expect-effect ParamEyeROpen `
  --expect-effect ParamMouthOpenY `
  --expect-effect ParamBreath
```

只检查实际已绑定的参数时，保留对应的 `--expect-effect`。不传该选项时，静态模型也能通过解析检查。

可选 `--core-source-url URL` 将来源说明写入报告。该值由调用者提供，工具不会验证下载来源。

## 检查内容

- 模型设置为 Version 3，包内文件引用存在，路径不越出模型目录。
- PNG 签名和尺寸、引用文件 SHA-256、`MOC3` 文件头及 Core 一致性检查。
- 实际加载的 Core 版本和脚本 SHA-256、MOC 版本、参数、Drawable 与顶点统计。
- 每次只改变一个参数，测试其最小值和最大值，其他参数保持默认。
- 检查顶点、透明度、绘制顺序、乘算色和屏幕色变化，列出受影响的 Drawable ID。
- 检查默认状态、参数极值和恢复默认值后的绘制数据均为有限数值。
- 指定参数缺失或未观察到绘制变化时，检查失败并记录原因。

浮点比较容差为 `1e-7`。报告中的 `expectedEffects` 给出每个指定参数的结果与受影响的 Drawable。

## 退出码与边界

| 退出码 | 含义 |
| --- | --- |
| `0` | Core 解析及所有指定参数效果检查通过 |
| `1` | 模型检查失败，或指定参数没有可观察到的绘制效果 |
| `2` | 命令参数或报告写入失败 |

兼容性结论仅适用于报告中实际加载的 Core 脚本及其 SHA-256。工具不会把外部下载的 Core 当成本地应用已安装的资源。

该检查不覆盖中间关键形、参数组合、AIRI 导入与渲染、动作播放、物理或语音时序。参数能改变原始绘制数据，不代表可见动作已经合格。
