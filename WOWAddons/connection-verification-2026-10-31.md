# 连接体验优化验证记录

日期：2026-10-31

桌面项目：`I:\GameTools\airi`

桥接项目：`I:\GameTools\WOWAddons\WoWCompanionBridge`

## 实现结果

第 4.1 节第 4 项已按用户确认实现。入口位于对应游戏的陪伴设置页“连接诊断与接收进度”。

1. Windows 窗口依据进程路径、游戏版本目录、窗口句柄、PID 和进程启动时间验证。同版本首次发现多个窗口时不自动选择。
2. 窗口移动／缩放后尝试局部重新定位，只读取已验证客户区内的局部像素，不扫描整个桌面。
3. 同一角色会话连续三个递增心跳经协议、校验码验证后，才接受并保存新校准。重复冻结帧和普通分片不能凑满验证次数。
4. 重新启动后可复用采样参数，但必须重新确认心跳。新配置、演示、暂停或重试会使旧采集结果和待保存校准失效。
5. 显示已验证的最小化、不可见、多个窗口、窗口变化、访问失败、心跳停更等原因。读不到网格时提示检查插件、遮挡和手动起点，不直接判定插件未加载。
6. 展示完整心跳验证进度，以及获得装备、比较、当前装备、日历的唯一分片数量、完成／超时／错误状态。
7. 重试清除未完成接收并重新建立基线。桌面历史记录与原校准保留；临时当前数据按既有基线规则重新接收。
8. 接收端不能强制插件立即重发，需等待后续广播。按钮仅确认“已请求重新定位”，不会提前声称成功。

## 校准保存

桥接版本更新为 2.15.0。手动配置保持独立，自动校准使用同目录文件：

- 正式服：`bridge-config.json.calibration.json`
- 无限服：`bridge-config-forever.json.calibration.json`

开发模式位于 `I:\GameTools\WOWAddons\WoWCompanionBridge`。
打包模式位于陪伴精灵用户资料目录下的 `wow-companion-bridge`。
仅保存游戏、坐标、窗口尺寸与精确采样参数，不保存图像、角色内容或进程路径。
原子替换失败保留旧文件；手动起点变化后，不套用不匹配的旧校准。
局部搜索不能保证恢复任意大幅修改的 UI 布局，此时需手动更正起点。

## 检查命令

| 工作目录 | 命令 | 结果 |
| --- | --- | --- |
| WOWAddons | `python -m unittest discover -s WoWCompanionBridge -p 'test_*.py'` | 214 项通过 |
| airi | `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project browser wow-connection-status.browser.test.ts wow-companion.browser.test.ts` | 129 项通过 |
| airi | `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project node wow-companion-client.test.ts wow-companion-runtime.test.ts` | 29 项通过，9 项跳过 |
| airi | `pnpm -F @proj-airi/stage-tamagotchi typecheck` | 通过 |
| airi | `pnpm -F @proj-airi/stage-tamagotchi build` | 通过 |
| airi | `pnpm -F @proj-airi/i18n typecheck` | 通过 |
| airi | `pnpm -F @proj-airi/i18n build` | 通过 |
| airi | `pnpm lint` | 0 错误、670 项既有警告 |
| airi | `pnpm typecheck` | 既有 scenarios-stage-tamagotchi-browser 包缺少 vue-tsc，未通过；本次桌面独立检查通过 |

自动检查覆盖移动、缩放、窗口在采集中变化、冻结帧、错误协议、持久化失败、重启重新验证、窗口查询限频、旧校准写入失效、重复分片、超时、重试接口及中文窄屏深色布局。
模型与语音未发起真实请求。窗口测试为合成数据，未实际操作用户游戏或写入用户当前校准文件。
“完成真实链路验收”仍按原要求排除。

## 交付

- [设计记录](/I:/GameTools/airi/docs/ai/adr/wow-companion-connection.md)
- [桥接说明](/I:/GameTools/WOWAddons/WoWCompanionBridge/README.md)
- [窗口绑定与局部捕获](/I:/GameTools/WOWAddons/WoWCompanionBridge/window.py)
- [校准确认与保存](/I:/GameTools/WOWAddons/WoWCompanionBridge/connection.py)
- [连接诊断界面](/I:/GameTools/airi/apps/stage-tamagotchi/src/renderer/components/wow-connection-status.vue)
- 截图：`I:\GameTools\WOWAddons\output\connection`
- 日志：`I:\GameTools\WOWAddons\logs\connection-*.log`

重启本项目构建的陪伴精灵以加载界面及受管理桥接；独立启动的桥接需单独重启。
此次更新了桥接打包输入清单，尚未制作新的安装包。
下一项“配置与记录备份”尚未实施，按用户要求先确认细节。
