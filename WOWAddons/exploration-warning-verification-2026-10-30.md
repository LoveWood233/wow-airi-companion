# 无限服区域探索等级提醒 · 1.13.0

实现位于 `WoWForeverCompanion/ExplorationWarning.lua`，由现有每秒采样及区域变更重试调用。
两个 TOC 均加载新模块，版本更新为 1.13.0。

- 角色进入新地图，且等级低于地图探索等级下限时检查领地状态。
- 使用 `UnitFactionGroup` 的角色真实阵营及 `C_PvP.GetZonePVPInfo` 的当前领地状态。
- 仅争夺、敌对和战斗区域允许提醒。本方领地与圣域豁免。
- 提醒同时显示在游戏屏幕提示区与聊天栏，采用用户指定原文。聊天栏附等级范围及来源链接。
- 登录、切换角色仅建立基线。室内与子区域变更不重复提醒。离开地图后重新进入可再次提醒。
- 地图边界后至少等待 0.25 秒，未知领地最多重试 5 秒。离线清除待处理提醒。
- 未知地图等级、未知阵营、死亡及副本不提醒。本功能不调用模型。

## 数据

真实调用无限图鉴 MCP `atlas({kind:"区域",limit:200})`，取得全部 44 张区域地图。
42 张有探索等级，海加尔山与辛德拉没有等级资料，省略。
由 `tools/update_exploration_levels.py` 生成离线 Lua 表，运行时无需联网。
脚本已实际连接服务器并成功生成 42 张地图数据。

希尔斯布莱德丘陵地图探索等级 20–31，塔伦米尔子区域探索等级 20。
塔伦米尔属于部落据点，部落角色在那里被客户端判为本方领地时不提醒。
该示例在进入希尔斯布莱德争夺区域时触发。

来源：[无限图鉴 wuxianwow.com · 希尔斯布莱德丘陵](https://wuxianwow.com/atlas/1424)。
领地 API：[无限图鉴客户端 API 手册](https://wuxianwow.com/api/?q=C_PvP.GetZonePVPInfo#api)。

## 验证与交付

- `python WoWForeverCompanion/tools/update_exploration_levels.py`：成功生成 42 张地图。
- `python -m unittest discover -s WoWForeverCompanion/tests -v`：185 项通过，含 10 项新增测试。
- 日志：`logs/exploration-warning-addon-tests.log`。
- 交付：`WoWForeverCompanion-1.13.0.zip`。
- 更新后完整退出并重新启动游戏，加载新增 Lua 模块。未自动安装到游戏目录。
- 尚未进行无限客户端实机验收。
