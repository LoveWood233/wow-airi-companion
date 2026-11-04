# Live2D 运行包组装

`assemble-runtime.py` 使用 Python 3.10+ 标准库，将 Cubism Editor 真实导出的资源组装成 AIRI 导入 ZIP。

工具保留 `.moc3`、贴图及其余引用资源的原始字节。它仅改写输出副本的模型设置，并新增呼吸动作。

从仓库根目录执行，三个输出路径必须尚不存在：

```powershell
python assets/sylvanas-live2d/tools/assemble-runtime.py `
  --model "assets/sylvanas-live2d/output/editor-export/sylvanas-chibi-v1.model3.json" `
  --output-dir "assets/sylvanas-live2d/output/runtime" `
  --zip "assets/sylvanas-live2d/output/sylvanas-chibi-v1.live2d.zip" `
  --report "assets/sylvanas-live2d/output/assembly-report.json"
```

`--model` 是输入文件。其余三个选项是输出位置，不覆盖已存在的文件或目录，不写入原始导出目录。

## 输出内容

- 原始 `.moc3`、PNG 和模型设置引用的其他资源。
- 输出模型设置中的 `Groups`：`EyeBlink` 对应 `ParamEyeLOpen`、`ParamEyeROpen`，`LipSync` 对应 `ParamMouthOpenY`。
- `motions/airi-idle-breath.motion3.json`：4 秒循环，`ParamBreath` 在 0 → 1 → 0 之间平滑变化。
- `FileReferences.Motions.Idle` 对应新增动作。动作不控制眼睛或嘴，避免影响自动眨眼和说话口型。
- 组装报告：输入与输出资源 SHA-256、ZIP 哈希和逐字节保留检查结果。

输入已经定义 `Idle` 时，脚本会报错。先检查已有待机动作，避免无意替换或重复驱动。

## 为什么添加呼吸动作

当前 AIRI 在模型加载后关闭 SDK 内置呼吸控制，自己的手动呼吸控制默认未启用。

因此，这个基础模型用 `Idle` 动作驱动已绑定的 `ParamBreath`。AIRI 的待机动画开关必须开启。

模型的 `ParamBreath` 必须已在 Cubism 中绑定 0–1 的可见变形。脚本不能创建网格、关键形或模型二进制。

## 验证与导入

组装成功仅说明资源引用、基础文件签名、ZIP 完整性和字节保留检查通过。

随后用 [validate-runtime.mjs](validate-runtime.mjs) 检查实际 Core 解析与参数效果，命令见 [运行数据检查](validate-runtime-usage.md)。

在 AIRI 中打开“设置 → 模型 → 选择模型 → 导入 → Live2D”，选择完整 ZIP，再点击新增模型卡片应用。

保留待机动画和自动眨眼开启。若曾将其他模型动作设为待机，重新选择本包的 `Idle` 呼吸动作。

最后在实际应用中检查透明背景、全身构图、双眼开闭、说话口型、循环呼吸和停止说话后的闭嘴状态。

此脚本不验证实际渲染、动画播放或语音时序，不捆绑 Cubism Core。
