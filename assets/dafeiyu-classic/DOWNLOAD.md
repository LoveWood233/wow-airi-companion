# 大肥鱼数字资产下载与导入

本项目的源图、制作工具、署名和验证记录位于此目录。[GitHub Release](https://github.com/LoveWood233/wow-airi-companion/releases/tag/dafeiyu-assets-v0.4.0-candidate) 提供完整媒体、历史交付与离线逐帧预览。

| 交付 | 内容 | 下载形式 |
| --- | --- | --- |
| v0.4.0 当前候选 | 八职业 × 120 段，共 960 WebM。视觉验收未通过 | `dafeiyu-classic-motion-v040-CANDIDATE-NOT-ACCEPTED.zip` 的 3 段 |
| v0.3.2 | 960 段，战士开心蹦跳专项修复 | `dafeiyu-classic-motion-v032-equipment-fixed.zip` 的 3 段 |
| v0.3.1 | 960 段及原版预览、制作记录 | `dafeiyu-classic-motion-v031-happy-jump-continuous-60fps.zip` 的 3 段 |
| v0.2 | 八职业共 24 段，60 fps | `dafeiyu-classic-motion-v02-60fps-import.zip` |
| v0.1 动作 | 八职业共 24 段 | `dafeiyu-classic-motion-v01-import.zip` |
| v0.1 静态 | 八职业透明立绘及预览 | `dafeiyu-classic-v01.zip` |
| v0.4.0 逐帧预览 | 离线预览页面与本地播放脚本 | `dafeiyu-v040-offline-preview.zip` |
| v0.4.0 帧审查 | 实际 WebM 抽帧、全帧解码记录与抽样审阅证据 | `dafeiyu-v040-frame-review.zip` |

## 恢复 ZIP

每个大包的 `.part01`、`.part02`、`.part03` 是按字节切开的三个文件。将同一版本的三段与 Release 附件 `join-release-parts.py`、`release-assets.json` 下载到同一目录。运行下列命令，工具会校验各段和最终 ZIP 的大小、SHA-256。Windows 可用 `py -3.12` 替代 `python3`。输出目录应位于支持硬链接的本地文件系统，例如 APFS、NTFS 或 ext4。

```sh
python3 join-release-parts.py dafeiyu-classic-motion-v040-CANDIDATE-NOT-ACCEPTED.zip --manifest release-assets.json
```

合并旧版本时，将命令中的文件名换成表中的对应名称。普通 ZIP 可直接解压。所有附件校验和列于 Release 的 `SHA256SUMS.txt`。

## 使用

- 导入当前候选时，先解压恢复出的 ZIP，在 AIRI 大肥鱼资源包入口选择其中 `packs/<职业>`。各职业目录直接含 `pack.json` 和 120 个 WebM。
- 查看当前候选时，按 `dafeiyu-v040-offline-preview.zip` 内的 `PREVIEW.txt` 将预览文件放到解压后的候选目录，并启动本地预览。浏览器可按职业和动作逐帧查看。
- 可在 GitHub 浏览[历史 GIF、MP4 和立绘](preview/history/README.md)。使用 GitHub 默认的 Source code ZIP 可下载该提交的源文件，动作媒体位于上表所列的 Release 附件。
- 旧档案中出现的个人目录路径已替换为公开占位符。未改动任何 WebM、PNG、GIF 或 MP4。当前候选与 v0.3.2 ZIP 在合并后与原始档案逐字节一致。

v0.4.0 通过了 960 段媒体的技术解码、哈希检查和八职业原生导入验证。实际抽样仍存在重复手臂、道具和表情叠影等缺陷。详细验收状态见 [assessment.json](verification/v040/assessment.json)。

角色原型「溟月」出自上善无形，DeepSeek 女仆鲸鱼娘版出自 ZipZipPipe。角色形象按 CC BY-NC-SA 4.0 分享。源项目及完整署名见 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 和 [ATTRIBUTION.txt](ATTRIBUTION.txt)。
