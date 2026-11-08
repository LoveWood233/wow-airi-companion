# 自动导入宏调试

先验证插件保存，再验证传输码，最后复现自动输入。

## 手动保存

在游戏中脱战后输入 `/import-marco`，粘贴：

```text
/targetexact 宏导入测试
```

点击“校验并导入”。在 `/macro` 的当前角色页确认 `WCP Import` 正文相同。
关闭导入窗口，再开始自动导入。不要手动修改 `WCP Import` 正文，否则后续覆盖会产生所有权冲突。
手动保存失败时，先处理窗口内的具体错误。
`/import-marco` 没有打开窗口时，先检查 `WoWMacroImport` 是否启用，安装更新后执行 `/reload`。

## 采集一次自动导入

重启陪伴精灵，加载最新桌面构建。开启对应游戏连接，确认角色数据实时更新。
在 PowerShell 执行：

```powershell
& 'I:\GameTools\WOWAddons\Watch-MacroImport.ps1' -Game retail
```

无限服改为 `-Game forever`。
脚本每 250 毫秒读取一次本机桥接状态，默认持续 240 秒。
它不修改游戏、剪贴板或桥接配置，不发送按键，也不切换窗口。
输出文件在 `I:\GameTools\WOWAddons\logs\macro-import-observe-*.jsonl`。

然后向陪伴精灵明确请求：

> 请将 `/targetexact 宏导入测试` 作为正式服宏自动导入，只保存，不执行。

看到准备导入提示后切回游戏，保持前台。首次获取焦点最多等待 12 秒。
导入期间不要点终端、聊天软件或陪伴窗口，也不要手动打开游戏聊天框和导入窗口。
观察：打开聊天 → 输入 `/import-marco` 和请求编号 → 出现文本框 → 粘贴正文 → 提交保存。
结束后查看 `/macro`，并记录聊天中 `wow_import_macro` 工具调用的返回值。
没有工具调用时，检查当前模型是否支持工具，以及宏导入工具是否启用。

## 日志含义

`status=live`、`source=screen`、`online=true` 表示实时游戏来源。
自动流程要求采集年龄不超过 2.5 秒，角色存活，并且有匹配的 `macroImport` 回执。
`waiting`、`stale`、`demo` 或回执为 null 时，先检查游戏画面是否持续渲染、传输码是否可见，以及陪伴连接的采集是否正确。
`combat=true` 时最多等待 90 秒，脱战后继续。输入开始后重新进入战斗则停止。

脚本的 `receipt` 就是桥接中的 `macroImport`：

| 字段 / 状态 | 含义 |
| --- | --- |
| `q` | 回执序号，持续收到有效更新时应递增 |
| `id` | 本次自动导入编号 |
| `st=idle` | 导入器空闲，下一步是打开游戏聊天框 |
| `chat=true` | 游戏聊天输入框获得焦点 |
| `st=ready`、`focus=true` | 导入文本框已打开并获得焦点 |
| `st=edited` | 文本已改变，桌面还会核对长度与摘要 |
| `st=saved`、`r=saved` | 插件已保存并读回正文 |
| `st=error` | 插件拒绝保存，查看 `r` |
| `st=closed` | 导入窗口被关闭 |

`focus` 是游戏内导入文本框焦点，不是 Windows 前台窗口状态。
采样可能错过短暂状态。旧的 `saved` 回执也会保留，必须结合本次 `id` 和工具结果判断。
只有本次工具返回 `ok=true` 且 `code=saved` 才能确认自动流程成功。

## 常见结果

| 工具返回码 | 排查方向 |
| --- | --- |
| `focus-not-acquired` | 12 秒内未获得稳定游戏焦点。重新请求时及时切回游戏 |
| `focus-lost` | 已取得焦点后切到其他窗口，流程停止 |
| `telemetry-unavailable` | 没有新鲜且匹配的游戏数据或宏回执 |
| `receipt-timeout` | 等待某个游戏回执超时。结合最后的 `chat`、`ready`、`edited` 状态定位 |
| `input-busy` | 开始前已有输入框或未结束的导入。关闭后重新请求 |
| `modifier-held` | 输入时 Ctrl、Alt、Shift 或 Windows 键仍按住 |
| `content-mismatch` | 粘贴后的内容与生成宏不一致 |
| `addon-conflict` | `WCP Import` 不属于插件或正文被手动改过。先重命名需要保留的同名宏 |
| `addon-full` | 当前角色宏栏位已满 |
| `game-window-ambiguous-or-missing` | 没有找到对应版本窗口，或同时找到多个 |
| `desktop-import-failed` | 桌面准备、桥接启动或辅助进程异常，当前返回码无法进一步区分 |

目前辅助进程只返回最终结果，桌面也没有保存完整的宏导入阶段日志。
此采集脚本用于补充游戏回执轨迹，不能记录所有 Windows 焦点检查和进程异常。
不要用管道直接运行 `macro_import.py`：它依赖桌面验证的窗口身份，以及保持打开的标准输入生命周期。

代码回归测试可以运行：

```powershell
Set-Location 'I:\GameTools\WOWAddons\WoWCompanionBridge'
python -m unittest test_macro_import -v
```

测试不向真实游戏发送按键，不能代替上述实机复现。
