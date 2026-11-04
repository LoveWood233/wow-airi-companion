# Live2D 运行包组装

`assemble-runtime.py` 使用 Python 3.10+ 标准库，将 Cubism Editor 真实导出的资源组装成 AIRI 导入 ZIP。

工具保留 `.moc3`、贴图及其余引用资源的原始字节。它仅改写输出副本的模型设置，并按动作方案新增动作 JSON。

从仓库根目录执行，三个输出路径必须尚不存在：

```powershell
python assets/sylvanas-live2d/tools/assemble-runtime.py `
  --model "assets/sylvanas-live2d/output/editor-export/sylvanas-chibi-v1.model3.json" `
  --output-dir "assets/sylvanas-live2d/output/runtime" `
  --zip "assets/sylvanas-live2d/output/sylvanas-chibi-v1.live2d.zip" `
  --report "assets/sylvanas-live2d/output/assembly-report.json"
```

`--model` 是输入文件。其余三个选项是输出位置，不覆盖已存在的文件或目录，不写入原始导出目录。

默认 `--profile basic-v1` 保留原有四秒呼吸方案。旧命令无需新增参数，生成的 ZIP 内容保持一致。

## 陪伴动作方案

新模型使用 `--profile companion-v2`。将输入改为本轮 Editor 导出文件，将三个输出改为新的 v2 路径：

```powershell
python assets/sylvanas-live2d/tools/assemble-runtime.py `
  --profile companion-v2 `
  --model "assets/sylvanas-live2d/output/v2/editor-export/sylvanas-chibi-v2.model3.json" `
  --output-dir "assets/sylvanas-live2d/output/v2/runtime" `
  --zip "assets/sylvanas-live2d/output/sylvanas-chibi-v2.live2d.zip" `
  --report "assets/sylvanas-live2d/output/v2/assembly-report.json"
```

本轮交付已使用以上目录。重建时为运行副本、ZIP 和报告三个输出另选尚不存在的位置，避免覆盖已验收文件。

| 分组 | 文件 | 动作 |
| --- | --- | --- |
| `Idle` | `motions/airi-idle-companion.motion3.json` | 48 秒循环，持续四秒呼吸周期，内置普通眨眼，在第 35–40.2 秒打一次哈欠 |
| `Yawn` | `motions/airi-yawn.motion3.json` | 5.2 秒单次哈欠，缓慢闭眼、张嘴停留、闭嘴和睁眼 |

哈欠控制 `ParamEyeLOpen`、`ParamEyeROpen`、`ParamMouthOpenY` 与 `ParamBreath`。动作首尾恢复睁眼和闭嘴，不会留下张嘴状态。

单次哈欠在第 4.8 秒恢复睁眼、闭嘴和静息呼吸，随后保持至 5.2 秒结束。恢复平台覆盖 SDK 的 0.3 秒淡出，避免在队列结束后残留微张嘴值。

动作文件不写入 `ParamEyeBallX` 或 `ParamEyeBallY`，将这两个参数留给实时鼠标视线驱动。

普通眨眼起点为第 4.6、11、17.8、24.1、30.7、44.7 秒，避开哈欠区间。双眼同步，75 毫秒闭合、50 毫秒停留、180 毫秒睁开。

视线参数必须在 Editor 中绑定实际眼球位移。组装动作 JSON 无法补做眼部拆层、网格或参数关键形。

常态空闲动画选择 `Idle`。`Yawn` 文件自身不循环，但 AIRI 的空闲动画选择器会重新播放所选动作，因此不要将它作为长期空闲动画。

v2 启用“启用眨眼”，将“眨眼模式”设为“自动”，由模型动作控制普通眨眼与哈欠闭眼。该模式也适用于已有安装版应用，无需先重建应用。

旧应用的“强制”眨眼会覆盖动作中的眼睛值。项目本轮修复后，强制眨眼可叠加在动作眼形上；使用它需要更新应用。本包选择“自动”即可使用全部内置动作。

语音口型优先于哈欠嘴部。单独 `Yawn` 不包含普通眨眼，不作为日常待机动作。

## 基础 v1 输出内容

- 原始 `.moc3`、PNG 和模型设置引用的其他资源。
- 输出模型设置中的 `Groups`：`EyeBlink` 对应 `ParamEyeLOpen`、`ParamEyeROpen`，`LipSync` 对应 `ParamMouthOpenY`。
- `motions/airi-idle-breath.motion3.json`：4 秒循环，`ParamBreath` 在 0 → 1 → 0 之间平滑变化。
- `FileReferences.Motions.Idle` 对应新增动作。动作不控制眼睛或嘴，避免影响自动眨眼和说话口型。
- 组装报告：输入与输出资源 SHA-256、ZIP 哈希和逐字节保留检查结果。

输入已经定义本方案的同名分组时，脚本会报错。先检查已有动作，避免无意替换或重复驱动。

## 为什么添加呼吸动作

当前 AIRI 在模型加载后关闭 SDK 内置呼吸控制，自己的手动呼吸控制默认未启用。

因此，这个基础模型用 `Idle` 动作驱动已绑定的 `ParamBreath`。AIRI 的待机动画开关必须开启。

模型的 `ParamBreath` 必须已在 Cubism 中绑定 0–1 的可见变形。脚本不能创建网格、关键形或模型二进制。

## 验证与导入

组装成功仅说明资源引用、基础文件签名、ZIP 完整性和字节保留检查通过。

随后用 [validate-runtime.mjs](validate-runtime.mjs) 检查实际 Core 解析与参数效果，命令见 [运行数据检查](validate-runtime-usage.md)。

在 AIRI 中打开“设置 → 模型 → 选择模型 → 导入 → Live2D”，选择完整 ZIP，再点击新增模型卡片应用。

保留待机动画和眨眼开启。若曾将其他模型动作设为待机，重新选择本包的 `Idle`。v2 的“眨眼模式”选择“自动”，v1 仍按原说明选择“强制”。

封装工具的回归检查命令：

```powershell
python assets/sylvanas-live2d/tools/test-assemble-runtime.py
```

这些检查使用现有真实 v1 导出文件验证组装契约，不能证明 v2 模型已经完成眼球绑定。

最后在实际应用中检查透明背景、全身构图、双眼开闭、说话口型、循环呼吸和停止说话后的闭嘴状态。

此脚本不验证实际渲染、动画播放或语音时序，不捆绑 Cubism Core。
