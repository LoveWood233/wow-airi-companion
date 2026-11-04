# 希尔瓦娜斯 Q 版 Live2D 桌宠基础模型 v1

基础 v1 已由 Cubism Editor 真实导出，并组装为 AIRI 导入 ZIP。已绑定独立双眼开闭、口型和身体呼吸，通过真实 Core 与仓库模块的浏览器检查。

[下载 Live2D 运行包](output/sylvanas-chibi-v1.live2d.zip) · [Cubism 源工程](source/sylvanas-layers-v1.cmo3) · [分层 PSD](source/sylvanas-layers-v1.psd) · [模型预览](output/preview.png)

![基础模型预览](output/preview.png)

## 导入 AIRI

1. 下载 `output/sylvanas-chibi-v1.live2d.zip`，保持 ZIP 完整。
2. 打开“设置 → 模型 → 选择模型 → 导入 → Live2D”，选择 ZIP。
3. 点击新增模型卡片应用，启用待机动画和“启用眨眼”，将“眨眼模式”设为“强制”。
4. 待机动作选择本包的 `Idle`，观察 4 秒循环呼吸。

说话口型使用 `ParamMouthOpenY`。本轮未执行实际语音时序、完整桌面应用的设置页导入或重启持久化测试，覆盖范围见下方验收记录。

## 当前模型能力

| 参数 | 实际绑定 |
| --- | --- |
| `ParamEyeLOpen` / `ParamEyeROpen` | 0–1，分别控制左右眼。0 时将原眼睛网格垂直压细，1 时睁眼 |
| `ParamMouthOpenY` | 0–1，闭嘴层与张嘴层切换，张嘴网格随参数渐开 |
| `ParamBreath` | 0–1，1 时身体网格放大至 101%，由 4 秒 `Idle` 动作循环驱动 |

模型采用 SDK 5.0 导出设置，包含 7 个 Drawable 和一张 2048 × 2048 贴图。模型设置已配置 `EyeBlink` 与 `LipSync` 参数组。

本包的 `Idle` 只控制呼吸。AIRI 的强制眨眼计时器可在呼吸动作播放时驱动双眼；仅依赖 SDK 内置眨眼时，循环 Idle 会占用其更新流程。

口型为基础两层方案：0 时闭嘴层不透明度为 100%、张嘴层为 0%。从 0.01 起，闭嘴层隐藏，张嘴层显示；张嘴层在 0.01 为略上移的扁平形，至 1 逐渐张开。

默认的 27 个参数仍保留，但本版只有上述 4 个参数绑定了实际变化。转头、视线、头发与披风物理、独立眉毛和额外表情尚未制作。

头发与兜帽仍合在 `Head`，四肢仍合在 `Body`。本版提供基础眨眼与口型，精细眼部拆层和更自然的闭眼轮廓属于后续制作目标。

## 已确认设定

- 角色：希尔瓦娜斯，经典黑暗游侠造型。
- 外观：紫色兜帽、银发、灰蓝肤色、红瞳。
- 比例：约 2.5 头身。
- 气质：冷傲中带一点傲娇，适合日常桌面陪伴。
- 最终格式：Live2D，保留可编辑源文件，交付 AIRI 可导入的模型包。

## 文件与制作来源

视觉参考为[第二版透明全身原画](source/concept-v2.png)。七层 PSD 分别保存后披风、身体、头部、左右眼、闭嘴和张嘴，张嘴层默认隐藏。

| 文件 | 内容 |
| --- | --- |
| [output/sylvanas-chibi-v1.live2d.zip](output/sylvanas-chibi-v1.live2d.zip) | AIRI 导入包，包含真实 MOC3、贴图、模型设置与呼吸动作 |
| [output/preview.png](output/preview.png) | 运行模型预览 |
| `source/concept-v2.png` | 当前全身视觉参考，1143 × 1376，RGBA 透明背景 |
| `source/concept-v1.png` | 首版参考，保留用于比较 |
| `source/prompt-concept-v1.txt` | 内置 image_gen 的首版生成提示词 |
| `source/prompt-concept-v2.txt` | 内置 image_gen 的构图修正提示词 |
| [source/layers/README.md](source/layers/README.md) | 内置 image_gen 制作的七张独立透明部件及完整提示词 |
| [source/sylvanas-layers-v1.psd](source/sylvanas-layers-v1.psd) | 七层可编辑 PSD，张嘴层默认隐藏 |
| [source/sylvanas-layers-v1.cmo3](source/sylvanas-layers-v1.cmo3) | Cubism Editor 5.3.04 保存的基础绑定源工程 |
| `source/sylvanas-layers-v1.validation.json` | PSD 读回后的图层、可见性与逐字节像素验证 |
| `tools/pack-psd.py` | 只封装 PSD 容器，保留全部源 PNG 像素 |
| [tools/assemble-runtime-usage.md](tools/assemble-runtime-usage.md) | 从真实 Editor 导出文件组装运行包 |
| [tools/validate-runtime-usage.md](tools/validate-runtime-usage.md) | 使用显式传入的 Cubism Core 检查模型与参数 |
| [production-guide.md](production-guide.md) | 拆层、建模、导出与项目导入说明 |
| [editor-worklog.md](editor-worklog.md) | 本机编辑器操作与导出链路记录 |
| [image-validation.json](image-validation.json) | PNG 尺寸、透明通道、内容边界和 SHA-256 |

本次图像均由内置 image_gen 制作。PSD 工具只封装文件容器，没有裁切、缩放或重绘源 PNG。网格、关键形和 `.moc3` 来自真实 Cubism Editor 工程与导出。

组装工具保留 Editor 导出的 MOC3、贴图和 CDI 原始字节，只调整运行副本的模型设置并新增合法的呼吸动作 JSON。该动作使用脚本编写的曲线，不替代网格、关键形或 MOC3 导出。

## 验收记录

当前状态：基础 v1 已导出，Core 与仓库模块的浏览器检查通过。

| 记录 | 范围 |
| --- | --- |
| [组装报告](output/assembly-report.json) | 包内引用、ZIP 完整性及 Editor 原始资源的字节保留 |
| [Core 检查](output/core-validation.json) | 实际 Core 版本、MOC 解析及指定参数的绘制数据变化 |
| [浏览器检查](output/browser-validation/report.json) | 仓库校验器、ZIP 加载器、三次预览、四项参数、Idle 呼吸及原生眨眼对照通过，浏览器错误为空 |
| [预览修复与项目检查](output/preview-fix-validation.md) | 异步清理故障的复现与回归，以及受缺失依赖阻碍的 typecheck、Vitest 和 lint 结果 |
| [PSD 校验](source/sylvanas-layers-v1.validation.json) | 图层名称、顺序、位置、可见性与 RGBA 像素读回 |
| [图像校验](image-validation.json) | 原画透明通道、内容边界与文件 SHA-256 |

检查使用 Core 5.0.0 与真实浏览器渲染，覆盖范围以对应报告为准。项目 typecheck、Vitest 和 lint 未通过，缺失工具与依赖记录在预览修复说明中。本轮没有完成完整 AIRI 桌面应用或实际语音时序验收。

## 后续制作

精细拆分眼部、头发、兜帽和四肢后，再制作转头、视线、物理摆动与额外表情。当前版本不包含这些高级绑定。

需要变更服装、比例、武器或新增互动动作时，先与用户确认。

希尔瓦娜斯与 Warcraft 为原权利方的角色和标识。本目录为同人创作，未使用提取的游戏模型或贴图。
