# 大肥鱼 × 经典八职业 v0.4.0 修复候选版

可重建的 AIRI 大肥鱼动作资产源包。范围为八职业各 114 个原版动作名对应的换装重制和 6 个新增动作，共 960 段 **640×360、60 fps、透明 VP9 WebM**。原动作名和 AIRI 大肥鱼资源包接口保持不变。

**v0.4.0 是全量修复候选版，尚未通过全量视觉验收。** 本轮修订装备图源、扩展固定母版运动，并将其它动作的默认补间改为 RIFE 4.26 预乘 RGBA。实际编码后的视频仍发现舞狮、堆雪人、落叶遮挡、小憩和跑步接缝等残影或关节重叠；不能据此声称 960 段装备不再漂移、关节完全连贯或已经达到最终交付质量。

本轮修订 **78 张姿态图集**，候选完整导出 **960 段、557,760 帧、2,810,234,552 字节**。全帧技术解码、文件哈希和原生导入分别记录于 `verification/v040/`；这些结果不等于视觉验收。v0.3.2 是历史交付，可从同一 GitHub Release 下载。

[八职业蹦跳预览](preview/eight-class-fixed-jump-v040.mp4) · [五种情绪合览](preview/eight-class-emotions-v040.mp4) · [猎人点击动作前后对照](preview/hunter-before-after-v040.mp4) · [导入说明](IMPORT.txt) · [来源与许可](ATTRIBUTION.txt) · [v0.3.2 战士单段修复预览（历史）](preview/happy-jump.mp4) · [v0.3.1 插帧对比（历史）](preview/continuity-comparison.mp4)

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

本目录保存 144 张姿态图集、128 张基础关键帧、表情参考与配置、提示词、八份 manifest 和制作工具。本轮已替换部分姿态 PNG，并记录新旧来源及哈希；不再沿用“原有 PNG 全部不变”的描述。完整 WebM 以 GitHub Release 附件分发。模型权重由重建工具按固定来源下载。`manifests/` 只有配置，不能单独作为完整角色包导入。

## v0.4.0 制作方法与未通过项

图源修订依据各职业 `source/base-keyframes/<职业>/frame-00.png` 母版，重点修复武器缺失、挂点换侧和装备形状变化，同时保留原图集的动作与道具。正面左右挂点必须随角色视角变化，侧面和卧姿允许合理遮挡；源姿态复核不等于插帧视频复核，也不能证明不同绘图之间的每条细纹完全相同。

80 条职业/动作组合使用固定母版纹理：

- 八职业的 `待机呼吸休闲`、`碎碎念-对屏碎碎念`、`工作状态-雀跃庆祝`，共 24 条。
- 八职业的 `开心蹦跳` 和 `点击回应-开心跃动`，共 16 条。点击回应保留独立的 10 秒三次跃动编排；开心蹦跳仍为 8 秒。
- 八职业的 `害怕`、`害羞`、`难过（眼睛饱含泪水）`、`想去玩（期待星星眼）`、`大哭`，共 40 条；保留不同表情与害怕颤抖、害羞内收、难过低垂、期待前倾和大哭肩部起伏。只从情绪图源提取脸内区域，来源及嘴部配准登记在 `source/expressions/class-emotion-face-sources.json`。
- 其中 79 条由 `tools/class-identity-motion.py` 处理，战士 `开心蹦跳` 保留 v0.3.2 的 `tools/identity-motion.py` 分支。装备始终采样母版纹理，武器随配置挂点刚性运动，脸内区域使用已登记的表情来源；小幅关节运动是连续二维变形，不是完整三维骨骼绑定。

固定母版 80 段的实际视频已有 1,340 帧人工样本复核，样本中装备与双臂保持一致；表情切换短暂叠影仍未消除，不能标记为整段视觉通过。记录分为 `verification/v040/fixed40-review.json` 和 `emotion40-review.json`。

其余 880 条默认使用 `tools/neural-motion.py` 的 RIFE 4.26 对应关系与可见性预测，对预乘 RGB 和 alpha 一起重采样，并在端点连续收敛。它不调用生成图像服务补画装备，仍可能把两个不匹配的姿态混成重复手臂、重叠道具或改变轮廓。提高帧率和更换插帧模型都不能单独解决错误对应关系。`原地小憩沉眠` 已改用完整起卧桥接姿态并保留 10 秒，但实际中间帧仍有手部残影，属于待修复候选。

当前实际视频复核发现的未通过类型包括：舞狮头道具重复，堆雪人与落叶动作新旧手臂并存，小憩起卧时手部叠影，跑步过渡或循环接缝局部跳变，以及复杂动作进入/退出时的重叠。部分源姿态的胸甲、腰带或武器细纹仍存在绘图差异。自动连续性指标无异常、全帧解码成功或源图姿态通过，都不能替代这些视觉问题的修复与复核。

## 保留的 v0.3.2 单段结论

v0.3.1 的战士蹦跳将带剑盾的基准站姿与装备细节不同的跳跃图集混合，导致盾牌消失、长剑缩短、肩甲和胸裙甲换形；部分补间还有护腕残影。此前的文件、导入和流畅度检查遗漏了装备一致性。

v0.3.2 实际只替换战士 `开心蹦跳` 这一段，其余 959 段沿用上一版。该段使用 `source/base-keyframes/warrior/frame-00.png` 的固定身体与装备纹理，以连续二维运动表现蓄力、起跳和落地；新增 `source/expressions/warrior/happy-face.png` 只在限定的脸内区域参与合成。旧跳跃图集保留作来源追溯，不代表通过装备验收。

当时的专项范围与结论仍保存在 [v0.3.2 装备一致性记录](verification/equipment-identity-v032.json)。它仅证明该历史单段的检查结果，不能外推为 v0.4.0 全量验收。`preview/happy-jump.mp4` 和对应 PNG 也仍是这一历史单段的预览。

## 动作接口

新增动作是 `害怕`、`害羞`、`难过（眼睛饱含泪水）`、`想去玩（期待星星眼）`、`大哭`、`开心蹦跳`，均进入已有 `categories.情绪` 接口。原 114 个动作名、权重、事件和移动参数保留，包括原版 `小幅度原地360度旋转展示`；没有修改 AIRI 自动 emotion 路由或应用运行设置。manifest 严格 schema 仍为 `version: 1`，与资源包的 v0.4.0 标识分开。

本资源依据动作语义重制，未声称对原版 114 段视频逐帧等同换装。60 fps 是输出采样率，包含保持帧、算法中间帧和网格采样帧，不表示每秒 60 张独立绘画。

## 下载与导入

[GitHub 数字资产下载](https://github.com/LoveWood233/wow-airi-companion/releases/tag/dafeiyu-assets-v0.4.0-candidate)提供当前 v0.4.0 八职业候选包、历史交付和逐帧证据。当前包共 960 段透明 WebM，每职业 120 段。

1. 下载 `dafeiyu-classic-motion-v040-CANDIDATE-NOT-ACCEPTED.zip.part01`、`.part02`、`.part03`，以及 `join-release-parts.py` 和 `release-assets.json`，放在同一个目录。
2. 在该目录运行以下命令。工具按清单顺序合并文件，并核对每段及完整 ZIP 的 SHA-256。在 Windows 可用 `py -3.12` 替换 `python3`。将输出保存到支持硬链接的文件系统，例如 APFS、NTFS 或 ext4。
3. 解压得到的 ZIP，在 AIRI 大肥鱼资源包入口选择 `packs/<职业>`，该目录内直接包含 `pack.json` 与 120 个 WebM。

```sh
python3 join-release-parts.py dafeiyu-classic-motion-v040-CANDIDATE-NOT-ACCEPTED.zip --manifest release-assets.json
```

也可直接从 GitHub 获取[历史预览](preview/history/README.md)。Release 下载与导入声明见 [DOWNLOAD.md](DOWNLOAD.md)，附件大小及校验和见 Release 中的 `SHA256SUMS.txt`。

## 安装与重建

当前 RIFE 制作环境使用 **Python 3.12**、Node.js 24+，以及 PATH 中带 `libvpx-vp9` 的 FFmpeg 和 ffprobe；已记录的 FFmpeg 环境为 7.1.1。使用 `tools/requirements-rife.txt` 的固定依赖版本，不要与历史 DIS 配置 `tools/requirements.txt` 混装。PNG 已提交，重编码不需要图像生成 API 密钥。以下命令在本目录运行：

```sh
python3.12 -m venv .venv-rife
# macOS / Linux: source .venv-rife/bin/activate
# Windows PowerShell: .venv-rife\Scripts\Activate.ps1
python -m pip install -r tools/requirements-rife.txt
npm ci --ignore-scripts
python tools/download-rife.py
python tools/verify-source.py
npm test
python -m unittest discover -s tools -p 'test_*.py'
```

`download-rife.py` 从 `tools/rife_v426/UPSTREAM.json` 指定的固定上游版本下载权重，分别校验压缩包与 `flownet.pkl` 的 SHA256，再原子写入 `build/models/rife-v4.26/flownet.pkl`。渲染时再次核对权重哈希；可通过 `DAFEIYU_RIFE_MODEL` 指向同哈希的已有模型。默认自动选择可用的 MPS、CUDA 或 CPU。权重仅用于离线制作，AIRI 播放导出的 WebM 不需要 Python 或该模型。

先生成少量候选用于检查固定母版、复杂道具和起卧分支：

```sh
python tools/render.py --class hunter --action 点击回应-开心跃动 --action 三球抛接 --action 原地小憩沉眠 --motion-backend rife --output build/smoke --workers 1
```

该命令只生成三段视频，不能作为完整包导入。完整候选重建与技术检查：

```sh
python tools/render.py --motion-backend rife --workers 2
python tools/audit-frames.py --media-root build --output build/frame-audit --workers 2
npm run validate -- --packs build/packs
npm run smoke:import -- --packs build/packs
python tools/package.py --packs build/packs --output dist
```

这些命令生成媒体和检查记录，**不会自动授予视觉合格状态**。打包出的 v0.4.0 仍须按修复候选使用，检查未通过动作后才能作最终验收。`--motion-backend dis` 仅用于旧算法对照，不是本轮默认制作方法。

也可用 `--class warrior` 只重建一个职业，或以 `--output` 指定独立输出目录。完整职业成功后才会写入 `pack.json`。渲染会复用图源、配置、工具和模型指纹均匹配的结果，输入变化时重新生成。全量编码需要较长时间；请为数 GB 媒体、模型和打包副本预留空间，当前候选媒体约 2.62 GiB，打包另需近似容量。

打包工具只读输入，写临时 ZIP、检查 CRC 后原子发布。已有输出默认拒绝覆盖，需显式传 `--overwrite`；它不会删除旧交付包。可先运行 `--verify-only`，或用 `--class warrior` 只打包一个职业。

## 本地逐帧预览

生成预览页并启动支持视频 Range 请求的本地服务：

```sh
python tools/build-preview.py --media-root build
python tools/serve-preview.py --media-root build --port 8769
```

打开 `http://127.0.0.1:8769/`，可切换八职业、搜索动作、按分类筛选、暂停并前后逐帧查看。页面展示候选未通过状态；固定母版标签仅表示制作方法。Chrome 中已实际检查职业切换、情绪筛选、640×360 视频解码及相邻 1/60 秒步进，没有逐一实播全部 960 段，也未完成 AIRI Electron 窗口验收。

## 导入与验证范围

完整重建后，在 AIRI 大肥鱼资源包入口选择 `build/packs/<职业>`。使用 ZIP 时先解压，再选其中直接包含 `pack.json` 和 120 个 WebM 的职业目录，包名含 `120动作 60fps v0.4.0`。目标是本仓库的大肥鱼导入器，不是 Spine / Live2D 的 ZIP loader。候选能通过接口检查或被导入，不等于动画视觉验收通过；本轮未在用户当前 AIRI Electron 窗口完成实播验收。

`tools/upstream/` 保存提交 `e3ddb35f8bf692c4fe3f8284caae9f4e4d526790` 的六个未修改接口文件与许可证，验证前核对其 SHA256。Node 工具不依赖整个 AIRI 应用安装或本机用户 profile。

- `verify-source.py`：PNG 文件集合、索引、哈希和路径检查。
- Node 与 Python 测试：原 114 动作契约、六个新增动作、八份 manifest、固定母版运动约束、补间边界及打包行为。
- `audit-frames.py`：实际 WebM 全帧解码、透明通道、空帧、边界接触和相邻变化指标；生成抽样与高变化接触页供人工看图。自动检查不是装备识别或关节正确性证明。
- `npm run validate`：完整文件集、大小限制、VP9、60 fps、尺寸和 alpha 元数据。
- `npm run smoke:import`：原生导入器复制、媒体哈希、选择持久化、资源拒绝及临时 profile 清理。
- 视觉记录：必须注明具体职业、动作、视频哈希、实际查看帧号及未通过项，不能把抽样看图写成全帧目检。

本轮记录位于 `verification/v040/media.json`、`native.json`、`frame-audit.json`、`render-records.json` 与 `assessment.json`；它们与 `source/media-index.json` 对应当前文件 SHA。原 `verification/media.json` 和 `verification/native.json` 保留历史版本。验证、导入或打包时追加 `--release-hashes` 可检查本轮候选的精确媒体。重建的容器 TrackUID、FFmpeg 或平台差异可能改变文件字节，不要求普通重建的 WebM 哈希逐字节相同。

[v0.3.1 可移植渲染检查](verification/history/portable-render-smoke-v031.json)、[原始交付摘要](verification/original-release-summary.json) 和 v0.3.2 单段记录保留作历史证据。它们不证明本轮装备与关节视觉正确。

## 文件来源

来源、署名和许可范围见 [ATTRIBUTION.txt](ATTRIBUTION.txt)。关键姿态与装备修订由内置 image_gen 生成，提示词在 `source/prompts/`，图源记录在 `source/provenance/`。当前 PNG 的哈希以 `source/source-index.json` 为准；提帧边界修正在 `source/extraction-crops.json` 记录。Warcraft 装备为同人视觉参考，没有导出游戏模型或贴图。

“可重建”指使用已提交 PNG、配置和固定权重重新编码，不表示重新调用图像生成服务能得到同一图像，也不表示现有候选已完成全量视觉验收。
