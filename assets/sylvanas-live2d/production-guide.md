# 希尔瓦娜斯 Live2D 制作说明

更新：2026-11-04。

## v2 与源文件

用户已确定：经典黑暗游侠、紫色兜帽、银发、灰蓝肤色、红瞳，约 2.5 头身，冷傲中带一点傲娇。

本机使用 Cubism Editor 5.3.04，路径为 `D:\Program Files\Live2D Cubism 5.3`。v2 已通过 SDK 5.0 输出设置真实导出，六项 Core 参数与浏览器动作检查通过。

交付文件：

- [v2 AIRI 运行 ZIP](output/sylvanas-chibi-v2.live2d.zip)。
- [v2 Cubism 源工程](source/sylvanas-layers-v2.cmo3)与复用的[七层 PSD](source/sylvanas-layers-v1.psd)。
- [v2 运行预览](output/v2/preview.png)、[视线与哈欠视频](output/v2/browser-validation/gaze-and-yawn.webm)与[全身视觉参考](source/concept-v2.png)。

运行包包含 7 个 Drawable、一张 2048 × 2048 贴图、模型设置、CDI、48 秒 Idle 与 5.2 秒 Yawn 动作。当前实际绑定 6 个参数：左右眼开闭、嘴开闭、呼吸及水平与垂直视线。保留的其余默认参数没有实际变形。

v1 源工程与历史输出保留不变。v2 的源工程、原始导出、运行副本和验收报告分别独立保存，新功能以 v2 报告为准。

## 形象基准

- 保留银发与红瞳，头发不可改成金发。
- 兜帽、耳朵、发梢、披风、手与靴子全部保留在画布内。
- 使用正面站姿，双臂与身体略微分开，便于后续变形。
- 常态保持轻微挑眉与克制的笑意，避免始终皱眉或敌视用户。
- 保留紫黑轻甲、银色饰边与红色宝石，保持小尺寸下的可辨识度。
- 初始视觉稿不持武器，以保留清晰的面部与身体轮廓。

变更服装、比例、武器、表情方向或新增互动动作前，先与用户确认。

## 当前拆层与绑定

基础七层为 `CapeBack`、`Body`、`Head`、`EyeL`、`EyeR`、`MouthClosed`、`MouthOpen`。PSD 的张嘴层默认隐藏。

PSD 封装脚本保留原始 PNG 像素。重建命令见 `python tools/pack-psd.py --help`，依赖见 `tools/requirements-psd.txt`。

头发与兜帽合在 `Head`，四肢合在 `Body`。本版没有独立的眼白、虹膜、上下眼线或上下嘴唇。

| 参数 ID | 范围与默认值 | 已制作的关键形 |
| --- | --- | --- |
| `ParamEyeLOpen` | 0–1，默认 1 | 左眼原图网格垂直压细至闭眼，1 时正常睁眼 |
| `ParamEyeROpen` | 0–1，默认 1 | 右眼独立控制，使用同类闭眼形变 |
| `ParamEyeBallX` | -1–1，默认 0 | 双眼内部区域的水平局部形变 |
| `ParamEyeBallY` | -1–1，默认 0 | 双眼内部区域的垂直局部形变，与 X 合成四角方向 |
| `ParamMouthOpenY` | 0–1，默认 0 | 闭嘴与张嘴两层切换，最大开口改窄并增高，供哈欠与说话使用 |
| `ParamBreath` | 0–1，默认 0 | 1 时身体网格放大至 101% |

眼睛的闭合来自原眼睛网格压缩，并非重画的闭眼眼线。闭眼关键形已压薄并缩窄，双眼间保留鼻梁间隙；精细眼部拆层仍属后续目标。

视线绑定通过 EyeL/EyeR 内部网格点的小幅局部位移完成，并合成水平与垂直参数的四角关键形。它没有新增独立虹膜或眼白图层，也不驱动头部转动。

浏览器目视检查未见明显错位、拉裂或越界，上视时两眼位移幅度略有差异。当前七层网格方案的精度有限，改进独立虹膜与眼睑需进一步拆层。

### 嘴开闭的关键形

| `ParamMouthOpenY` | 闭嘴层 | 张嘴层 |
| --- | --- | --- |
| 0 | 不透明度 100%，显示闭嘴线 | 不透明度 0%，网格为扁平形 |
| 0.01 | 不透明度 0% | 不透明度 100%，略上移的扁平形 |
| 0.01–1 | 保持隐藏 | 网格逐渐张开，至 1 为完整张嘴形 |

0–0.01 的小区间用于两层透明度交接。开口的主要变化来自 0.01–1 的几何形变，避免仅切换整张张嘴图。

### 运行参数组与待机

运行模型设置的 `Groups` 已包含：

- `EyeBlink`：`ParamEyeLOpen`、`ParamEyeROpen`。
- `LipSync`：`ParamMouthOpenY`。

`FileReferences.Motions.Idle` 引用 `motions/airi-idle-companion.motion3.json`。该动作持续 48 秒，保持四秒呼吸周期，包含普通眨眼与一次哈欠。

| 时序 | 内容 |
| --- | --- |
| 每四秒 | `ParamBreath` 平滑完成 0 → 1 → 0 |
| 4.6、11、17.8、24.1、30.7、44.7 秒 | 普通眨眼，75 毫秒闭眼、50 毫秒停留、180 毫秒睁眼 |
| 35–40.2 秒 | 缓慢闭眼、张嘴停留、闭嘴和睁眼，构成一次哈欠 |
| 48 秒结束 | 恢复循环起点的参数值 |

`FileReferences.Motions.Yawn` 另有 `motions/airi-yawn.motion3.json`，持续 5.2 秒，文件本身不循环。它在 4.8 秒恢复睁眼、闭嘴和静息呼吸，并保持至结束，覆盖 SDK 的 0.3 秒淡出。

常态空闲动作选择 `Idle`。AIRI 的空闲动画选择器会重启所选动作，因此选 `Yawn` 会反复打哈欠，不能把非循环文件当作选择器只播放一次的保证。

v2 选择“自动”眨眼模式。普通眨眼已写在动作中，可以在已有安装版保留哈欠闭眼。旧应用的“强制”模式会覆盖动作眼值，本轮代码修复后才支持正确叠加。

动作没有写 `ParamEyeBallX/Y`，视线由鼠标实时控制。旧应用有粗略的 SDK 方向跟随，本轮应用适配器进一步修复模型中心与近中心归中。平滑归中需要更新应用，模型 ZIP 不会更新已安装程序代码。

这些动作使用 Editor 中已绑定的关键形。脚本只编写合法曲线，不能创建 MOC3、网格或关键形。

## 导出与组装

先完成纹理图集，通过 Cubism Editor 的 `File → Export Embedded File → Export as MOC3` 导出，并使用 SDK 5.0 输出设置。

保存 `.cmo3` 与 `.model3.json`，v2 的 Editor 原始导出目录为 `output/v2/editor-export/`。[官方导出说明](https://docs.live2d.com/en/cubism-editor-manual/export-moc3-motion3-files/)

运行包实际结构为：

```text
sylvanas-chibi-v2.live2d.zip
  sylvanas-chibi-v2.model3.json
  sylvanas-chibi-v2.moc3
  sylvanas-chibi-v2.cdi3.json
  sylvanas-chibi-v2.2048/
    texture_00.png
  motions/
    airi-idle-companion.motion3.json
    airi-yawn.motion3.json
```

本版没有物理设置和独立表情文件。模型设置仅引用实际存在的包内资源。

使用 [assemble-runtime.py](tools/assemble-runtime.py) 的 `--profile companion-v2` 组装运行副本，完整命令和输出规则见[组装说明](tools/assemble-runtime-usage.md)。工具不覆盖已有输出，重新导出时使用新的输出路径。

组装工具只调整运行副本的模型设置并新增动作，保留原始 `.moc3`、PNG 贴图和 CDI 字节。运行副本为 `output/v2/runtime/`，哈希记录见[v2 组装报告](output/v2/assembly-report.json)。

`.cmo3`、PSD 和部件 PNG 属于制作源文件，与运行 ZIP 分开保存。本次没有制作 `.can3` 时间轴工程。

## AIRI 导入与验收

1. 打开“设置 → 模型 → 选择模型 → 导入 → Live2D”。
2. 选择完整的 `sylvanas-chibi-v2.live2d.zip`，点击新增 v2 模型卡片应用。
3. 开启鼠标跟踪和眨眼，将“眨眼模式”设为“自动”，待机动画选择本包的 `Idle`。
4. 检查全身显示、透明背景、图层顺序和鼠标视线方向。
5. 分别检查双眼开闭、视线九方向与闭眼组合，以及口型 0、0.01、中间值和 1。
6. 播放完整 Idle，检查普通眨眼、循环呼吸、第 35 秒哈欠及动作结束后的闭嘴。
7. 实际播放语音，检查嘴部动作和结束后的闭嘴状态。
8. 缩小到桌宠尺寸并重启 AIRI，检查显示与资源重新加载。

桌面入口引用 `CubismSdkForWeb-5-r.3`，实际兼容性以运行时加载的 Core 版本和哈希为准。

相关项目实现：

- [桌面渲染入口](../../airi/apps/stage-tamagotchi/src/renderer/index.html)。
- [ZIP loader](../../airi/packages/stage-ui-live2d/src/utils/live2d-zip-loader.ts)与[模型校验器](../../airi/packages/stage-ui-live2d/src/utils/live2d-validator.ts)。
- [模型组件](../../airi/packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue)、[参数动画](../../airi/packages/stage-ui-live2d/src/composables/live2d/animation.ts)和[动作管理](../../airi/packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts)。
- [焦点适配器](../../airi/packages/stage-ui-live2d/src/utils/model-focus.ts)和[眨眼驱动](../../airi/packages/stage-ui-live2d/src/composables/live2d/eye-blink.ts)。

当前状态：v2 已真实导出，六项 Core 参数与浏览器动作检查通过。

| 报告 | 检查范围 |
| --- | --- |
| [v2 assembly-report.json](output/v2/assembly-report.json) | 资源引用、ZIP 与原始导出资源字节保留通过 |
| [v2 core-validation.json](output/v2/core-validation.json) | Core 解析、模型一致性与六个参数的绘制变化通过 |
| [v2 浏览器报告](output/v2/browser-validation/report.json) | 六参数、28 个参数组合、11 个指针位置、哈欠精确闭嘴与完整 48 秒 Idle 通过，浏览器错误为空 |
| [v2 应用驱动检查](output/v2/application-validation.md) | 焦点归中与强制眨眼修复、定向回归和其余检查的环境阻碍 |

Core 工具的命令见[运行数据检查](tools/validate-runtime-usage.md)，浏览器复跑步骤见[v2 检查工具说明](output/v2/browser-validation/tools/usage.md)。实际 Idle 播放约 48.97 秒，包含普通眨眼、哈欠与生产强制眨眼插件；哈欠结束后嘴参数为 0、闭嘴层不透明度为 1、张嘴层为 0。

浏览器验收范围以 v2 报告为准，本轮未运行完整 Electron 应用的设置导入、全局鼠标输入、语音时序或重启持久化。类型检查、关联回归和 lint 的环境阻碍见应用驱动检查。

历史 [v1 运行包](output/sylvanas-chibi-v1.live2d.zip)、[源工程](source/sylvanas-layers-v1.cmo3)、[原导出](output/editor-export/sylvanas-chibi-v1.model3.json)和[原验收记录](output/preview-fix-validation.md)保持不变。

## 后续精细拆层与高级绑定

本版保留默认的 27 个参数，6 个实际绑定。基础视线已经制作，转头、头发与披风物理、眉毛和额外表情尚未制作。

以下是后续精细拆层清单，不是本版已交付的独立部件。角色左右仍按自身方向命名 `L`、`R`。

| 分组 | 建议独立部件 | 制作要求 |
| --- | --- | --- |
| 面部底图 | 脸、左右耳、颈部 | 补全刘海、眼睛与嘴覆盖的皮肤 |
| 左右眼 | 眼白、虹膜、瞳孔与高光、上下眼线 | 左右分开，能独立闭合，眼球移动不穿出眼眶 |
| 眉毛 | 左眉、右眉 | 能轻挑眉，保留傲娇气质 |
| 嘴 | 口腔、上下嘴线，必要时牙齿 | 支持张合，闭嘴时不露黑缝 |
| 表情细节 | 左右腮红 | 独立透明层，便于控制强度 |
| 头发 | 后发、左右侧发、至少三束前发 | 补全交叠根部，保持银发颜色一致 |
| 兜帽 | 后罩、前缘、前额饰物 | 小幅转头时不能露出空洞 |
| 身体 | 胸甲、腰带、裙甲与颈部连接 | 呼吸与转体时接缝保持覆盖 |
| 手臂 | 左右上臂、前臂、手掌 | 预留关节覆盖区，避免弯曲时断开 |
| 腿部 | 左右腿、护膝与靴子 | 初版保持站姿，轻微重心变化不脱节 |
| 披风 | 左片、右片、后片 | 与头发分开，便于轻摆 |

不要直接擦除遮挡物后留下透明洞。脸部、发根、肩部和关节后方需补画完整内容。

拆层后先在 Cubism 中合成检查，确认与第二版视觉参考一致，再开始网格与变形器制作。

### 后续参数目标

下表仅列出后续目标，需要实际制作关键形后才能驱动。

| 参数 ID | 建议范围 | 用途 |
| --- | --- | --- |
| `ParamAngleX` / `ParamAngleY` / `ParamAngleZ` | -30 至 30，默认 0 | 头部轻转、俯仰与倾斜 |
| `ParamMouthForm` | -1 至 1，默认 0 | 嘴角与表情变化 |
| `ParamBodyAngleX` / `ParamBodyAngleY` / `ParamBodyAngleZ` | -10 至 10，默认 0 | 身体小幅转动 |

参数必须绑定实际变形关键形，仅创建同名空参数无法实现动作。头部正负极值是参数刻度，实际视觉只需自然的小幅转动。

头发和披风轻摆需另做参数与物理设置。挥手、战斗动作和额外情绪包留待用户确认。

如果后续确认制作情绪动作，使用项目已有分组 `Happy`、`Sad`、`Angry`、`Think`、`Surprise`、`Awkward`、`Question`、`Curious`。
在 `FileReferences.Motions` 显式配置分组。未分组的动作文件不会自动获得对应的情绪映射。

独立 `.exp3.json` 表情也可按后续需求制作，但项目表情系统默认关闭，需在接入时单独验证。
待机与表情避免持续强制张嘴，以免与说话时的口型驱动冲突。
