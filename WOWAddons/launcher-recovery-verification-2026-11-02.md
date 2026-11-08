# 启动误报修复记录

日期：2026-11-02

## 原因

旧脚本按 Electron 可执行文件路径判断程序是否运行，然后提前返回。这会把共享 Electron 运行时、无界面的加载失败进程也视为正常实例。

本机发现 PID 52116，自 2026-11-01 20:06:32 残留，无主窗口、无子进程。对应旧源码日志记录 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`，程序未完成加载。

## 修复

- 删除启动脚本中的进程路径提前返回。每次启动交给 Electron 的配置目录锁和单实例事件处理，已有实例会显示主窗口。
- 打印程序源码目录和数据目录，方便识别不同入口。
- 检查早期进程退出、非零退出码和主进程加载失败，失败时显示错误日志路径。
- 在等待之前保留进程句柄，修复 Windows PowerShell 5.1 快速退出时 `ExitCode` 为空的情况。
- 启动脚本不会自动终止其他 Electron 进程。

## 本机恢复

再次核对 PID、命令行、启动时间、窗口句柄和子进程后，已单独清理确认失败的 PID 52116。

`I:/GameTools/WOWAddons/Start-WoWCompanion.cmd` 及其快捷方式已转向 `I:/GameTools/wow-airi-companion/WOWAddons/Start-WoWCompanion.cmd`，使用最近更新的构建。

本机入口的原始文件备份在：`I:/GameTools/WOWAddons/backups/launcher-fix-20261102-005004-266`。

配置继续使用 `C:/Users/10413/.airi-wow-companion`，未迁移或合并配置数据。

## 验证

- 用旧脚本运行新增隔离测试，预期失败：按进程路径提前返回的回归已复现。
- Windows PowerShell 5.1 和 PowerShell 7：`tests/test-start-wow-companion.ps1` 的 12 个隔离场景和 AST 语法检查通过。
- 场景覆盖路径覆盖规则、环境恢复、启动错误、快速退出句柄、重复启动及桥接模式，不访问实际用户配置。
- `pnpm --config.verify-deps-before-run=false exec vitest run --project=node single-instance.test.ts window.test.ts`：11 项通过。
- 实际使用 Windows PowerShell 启动已更新程序：主进程 PID 63420，标题“魔兽陪伴精灵”，窗口可见，未最小化。
- 再次启动成功转交现有实例，主进程保持不变，窗口继续可见。没有出现旧版主进程加载错误。
- `git diff --check` 通过。未修改 AIRI 的 TypeScript 生产代码，无需重新构建。

隔离测试日志：`I:/GameTools/WOWAddons/logs/launcher-tests-final-ps51.log`。

实际启动日志：`WOWAddons/logs/airi-20261102-005049-177.log` 及对应错误日志。

本次未提交或推送 GitHub。
