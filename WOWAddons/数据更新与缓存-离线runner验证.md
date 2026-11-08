# 数据更新与缓存：离线更新 runner 验证

本记录只覆盖第 3 项的本地导出与受管快照后端；查询缓存、页面、模型工具和桌面完整构建由总验证文档记录。

## 已实现

- 启动与每 5 分钟只读检查已配置根目录的 `.build.info`，唯一 `Active=1 / Product=wow` 才可接受。已知选中数据库来源优先用于比较版本；新导出完成但尚未切换时，旧库差异仍保留。未配置时不创建目录、不启动 Python 或导出器。
- 游戏根与 CASC 工具根只能通过主进程原生目录选择器设置，renderer 不能传命令、SQL、输出目录或数据库路径。本地路径不进入模型。
- 手动启动立即返回检查中状态，依次持有并等待 `dotnet` 导出器、Python CSV→SQLite、Python 校验直接子进程；未知总量不生成百分比。取消等待真实进程退出后才处理自己的半成品。
- 先校验本地离线构建记录，默认不下载、不 Git、不 restore、不更新 definitions、不联网热修、不修复游戏。缺依赖明确报错。CASC 缺本地索引的 CDN 回退已被统一 guard 拒绝，本地 build/CDN 配置明确以只读权限打开。
- 验证 manifest、目标 build、zhCN、wow、未热修标记、行数、原始文件 SHA-256、SQLite integrity，以及支持查询的八张表签名；返回码 0 不能替代上述证据。导出前后还核对构建、工具、定义、配置和索引内容，以及数据档案的大小/mtime/ctime 代次。
- 每次 UUID 新暂存目录；验证成功后生成可审查快照，用户显式点击后才切换。最多保留两个受管快照，当前选中快照优先占一个名额。清理与选库共用主进程租约，不能并发删除刚被另一窗口选中的数据库；持续切换时可暂缓清理。
- 删除与移动前核对固定 appData 物理根、每级目录非链接、直接子目录命名、所有权 marker、真实路径和整树非链接。暂存目录转为快照，以及失败／取消清理，也必须持有选库租约；用户若从另一个页面手动选中暂存库，保留其路径和文件，不移动或删除，转换显示 busy。外部数据库、无 marker 历史导出、其他用户目录不参与清理。

## 定向验证

在本机已安装的 Python、.NET 与既有依赖下完成：

- `Prepare-Offline.ps1` 使用 `--no-restore --disable-build-servers` 离线重编成功；工作负载清单后台下载被环境变量禁用，未打开游戏存储。日志：[离线构建](logs/data-update-offline-build.log)。
- 本地 C# 反射安全检查 4 项通过：选中唯一活动正式服、零活动拒绝、多活动拒绝、下载入口在网络前拒绝。日志：[CASC 安全](logs/data-update-casc-safety.log)。
- 更新 runner 11 项与正式服查询 service 11 项串行真实 Node 集成共 22 项通过。使用临时目录和真实 Python/SQLite/CSV/原始哈希/查询端点，仅将读取真实游戏的导出进程替换为小型夹具进程。覆盖取消、busy、构建/定义/数据档案变化、哈希错误、缺必需表、显式切换、保留两个、回滚、目录 junction、选库租约、手动选中暂存库后转换／取消均不移动或删除，以及原数据库字节不变。另在真实旧配置临时文件已写入、等待原子提交时暂停一次 fsync，复现后台检测与换根交错：换根必须等待旧检查，后续检查串行，最终磁盘配置和构建基线均属于新根。日志：[Node 集成](logs/data-update-node-integration.log)。
- 新增 runner、共享契约、事件和相关测试的定向 ESLint 通过：[lint](logs/data-update-node-lint.log)。桌面 types 与完整构建结果以总验证记录为准。

复现 Node 集成：

```powershell
Set-Location 'I:\GameTools\airi'
$env:pnpm_config_verify_deps_before_run='false'
$env:AIRI_WOW_RUNTIME_TEST_PYTHON=(Get-Command python).Source
$env:AIRI_WOW_RETAIL_TEST_BRIDGE_DIR='I:/GameTools/WOWAddons/WoWCompanionBridge'
$env:AIRI_WOW_UPDATE_TEST_TOOLS_DIR='I:/GameTools/CASCExplorer'
pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project node --no-file-parallelism src/main/services/airi/wow-data-update-service.test.ts src/main/services/airi/wow-retail-database-service.test.ts
```

## 尚未验收

没有执行完整真实游戏导出、战网更新同时写入安装目录的实测、真实个人模型、语音或游戏链路验收。大档案只比较文件代次，不计算整个安装目录的内容散列，也没有系统级卷快照；正式导出期间应暂停战网更新。旧 Windows 安装包尚未重打包，本轮没有部署插件、更新依赖、GitHub push 或关机。

离线工具的本地准备步骤见 `I:\GameTools\CASCExplorer\DB2Export\README-offline.md`。Python 校验脚本最低兼容 3.10；本轮实际使用已安装的 Python 3.13，不声称已在真实 Python 3.10 解释器运行。
