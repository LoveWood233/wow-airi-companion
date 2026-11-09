# 大肥鱼 × 经典八职业 v0.3.1

可重建的 AIRI 大肥鱼动作资产源包。八职业各有 114 个原版动作名对应的换装重制和 6 个新增动作，共 960 段 **640×360、60 fps、透明 VP9 WebM**。

[开心蹦跳动态预览](preview/happy-jump.mp4) · [插帧修复对比](preview/continuity-comparison.mp4) · [导入说明](IMPORT.txt) · [来源与许可](ATTRIBUTION.txt)

![八职业开心蹦跳](preview/happy-jump.png)

| 目录 | 职业 | 经典装备外观参考 |
| --- | --- | --- |
| `warrior` | 战士 | 愤怒 |
| `hunter` | 猎人 | 巨龙追猎者 |
| `mage` | 法师 | 灵风 |
| `rogue` | 盗贼 | 血牙 |
| `paladin` | 圣骑士 | 审判 |
| `warlock` | 术士 | 复仇 |
| `priest` | 牧师 | 卓越 |
| `druid` | 德鲁伊 | 怒风 |

本目录提交 144 张最终姿态图集、128 张基础关键帧、生成提示词、八份 manifest 和制作工具。完整 960 段视频约 2.43 GB，由工具生成到忽略的 `build/` 目录，不随 Git 提交。`manifests/` 只有配置，不能单独作为完整角色包导入。

## 本版动作与修复

新增动作是 `害怕`、`害羞`、`难过（眼睛饱含泪水）`、`想去玩（期待星星眼）`、`大哭`、`开心蹦跳`，均进入已有 `categories.情绪` 接口。新增的转圈动作已被开心蹦跳替换。原 114 个动作名、权重、事件和移动参数保留，包括原版 `小幅度原地360度旋转展示`；没有修改 AIRI 的自动 emotion 路由或应用运行设置。

- 插帧移除过渡中点的硬端点切换，使用连续的运动补偿和预乘透明度权重。
- 开心蹦跳使用 16 个正面姿态和连续升降轨迹；战士的一个手臂过渡另用人工图像对应点引导。
- 两种侧跑在移动窗口结束前保持最后步态，再回到站姿，避免不足两帧的强制换步。
- 鸽子、蓝鲸和小幽灵的跨形态变化使用透明叠化，避免把人物面部拉伸成另一种形态。

这是关键姿态与图像补间重制，不是原 114 段视频的逐帧换装，也不是骨骼绑定动画。局部手臂、腿部、脸部和头发仍可能有重影、软化或形变。有限抽检及帧差指标不能证明全部 960 段关节都自然；未在用户当前 AIRI Electron 窗口做实播验收。

## 安装与重建

需要 Python 3.13、Node.js 24+，以及 PATH 中带 `libvpx-vp9` 的 FFmpeg 和 ffprobe。PNG 已提交，重编码不调用 image_gen，也不需要图像生成 API 密钥。以下命令在本目录运行；Python 虚拟环境激活方式按系统选择。

```sh
python3 -m venv .venv
# macOS / Linux: source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r tools/requirements.txt
npm ci --ignore-scripts
python tools/verify-source.py
npm test
python -m unittest discover -s tools -p test_package.py
```

先重建两个关键动作进行制作链检查：

```sh
python tools/render.py --class warrior --action 开心蹦跳 --action 原地左转奔跑 --output build/smoke --workers 2
```

该命令只生成两段视频，不能作为完整包导入。完整重建：

```sh
python tools/render.py --workers 2
npm run validate -- --packs build/packs
npm run smoke:import -- --packs build/packs
python tools/package.py --packs build/packs --output dist
```

也可使用 `--class warrior` 只重建一个职业；`--output` 可指定独立输出目录。完整职业成功后才会写入 `pack.json`。渲染会复用源图、参数和工具指纹均匹配的已有结果，依赖或来源改变时重新生成。全量编码需要较长时间，并需预留源文件、约 2.43 GB 媒体及打包副本的磁盘空间。

打包工具只读输入，写同目录临时 ZIP、检查 CRC 后原子发布。已有输出默认拒绝覆盖，需显式传 `--overwrite`；它不会删除任何旧交付包。可先运行 `--verify-only`，或用 `--class warrior` 只打包一个职业。

## 导入

完整重建后可直接在 AIRI 大肥鱼资源包入口选择 `build/packs/<职业>`。若使用 ZIP，先解压，再选择其中含 `pack.json` 和 120 个 WebM 的职业目录。目标是本仓库的大肥鱼导入器，不是 Spine / Live2D 的 ZIP loader。

## 验证与可复建边界

`tools/upstream/` 保存提交 `e3ddb35f8bf692c4fe3f8284caae9f4e4d526790` 的六个未修改接口文件与许可证，验证前先核对其 SHA256。Node 工具不依赖整个 AIRI 应用的安装或本机用户 profile。

- `verify-source.py`：144 张图集和 128 张关键帧的哈希、路径与八份配置完整性。
- `npm test`：schema、原 114 动作契约、六个新增动作，以及路径/写入边界测试。
- `npm run validate`：完整文件集、大小限制、VP9、60 fps、尺寸和 alpha 元数据。
- `npm run smoke:import`：原生导入器实际复制、960 个文件哈希、选择持久化、未列出资源拒绝和临时 profile 清理。
- 渲染器：每段实际解码帧数和 alpha 抽样，记录时序及连续性诊断。

记录的原交付哈希见 `source/media-index.json`。对照原交付可在验证、原生导入或打包时追加 `--release-hashes`。重建的 WebM 容器可能有不同 TrackUID，FFmpeg 或平台版本也可能改变编码结果，因此普通重建不要求文件哈希逐字节等同。两条移植检查采用相同环境比较完整 RGBA 帧序列，结果见 [可移植渲染检查](verification/portable-render-smoke.json)。

[完整媒体检查](verification/media.json) · [原生导入记录](verification/native.json) · [原交付范围与限制](verification/original-release-summary.json)

## 文件来源

原始角色来源、署名和许可范围见 [ATTRIBUTION.txt](ATTRIBUTION.txt)。关键姿态由内置 image_gen 生成，原提示词保存在 `source/prompts/`，图源记录在 `source/provenance/`。原 PNG 保持不变；提帧边界修正在 `source/extraction-crops.json` 中记录。Warcraft 装备为同人视觉参考，没有导出游戏模型或贴图。

“可重建”指使用已提交 PNG 重编码；不表示重新调用图像生成服务能得到同一图像。
