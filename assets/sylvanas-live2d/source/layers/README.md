# 基础部件与生成提示词

以下七张部件由内置 image_gen 根据 `../concept-v2.png` 制作，背景为 RGBA 透明通道。

| 部件 | 图像 | 提示词 |
| --- | --- | --- |
| 后披风 | [cape-back-v1.png](cape-back-v1.png) | [prompt-cape-back-v1.txt](prompt-cape-back-v1.txt) |
| 身体与四肢 | [body-base-v1.png](body-base-v1.png) | [prompt-body-base-v1.txt](prompt-body-base-v1.txt) |
| 头部、兜帽与头发 | [head-base-v1.png](head-base-v1.png) | [prompt-head-base-v1.txt](prompt-head-base-v1.txt) |
| 左眼，角色自身左侧 | [eye-left-open-v1.png](eye-left-open-v1.png) | [prompt-eye-left-open-v1.txt](prompt-eye-left-open-v1.txt) |
| 右眼，角色自身右侧 | [eye-right-open-v1.png](eye-right-open-v1.png) | [prompt-eye-right-open-v1.txt](prompt-eye-right-open-v1.txt) |
| 闭嘴 | [mouth-closed-v1.png](mouth-closed-v1.png) | [prompt-mouth-closed-v1.txt](prompt-mouth-closed-v1.txt) |
| 张嘴 | [mouth-open-v1.png](mouth-open-v1.png) | [prompt-mouth-open-v1.txt](prompt-mouth-open-v1.txt) |

所有部件为 1143 × 1376。PSD 封装保留整张画布及全部原始 RGBA 像素，校验报告位于上级目录。

这是一版基础拆层素材。网格、关键形和运行时行为需要在 Cubism 中制作，PNG 本身不包含绑定或动作。

原始透明边缘含很淡的杂点。Cubism 自动网格采用 Alpha 阈值 16。闭嘴线过细，曾生成空网格，后单独恢复为四点矩形并自动连接；重新关联原图、保存重开后已确认嘴线恢复。该层目前保留整画布网格，后续可在编辑器中进一步收紧范围。
