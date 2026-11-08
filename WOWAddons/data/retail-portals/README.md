# 魔兽世界正式服传送门本地数据库

本目录保存正式服传送门的地图坐标、来往地区、阵营、解锁条件和来源。核对日期为 **2026-10-29**。

双击 `index.html` 即可离线查看。可按起点地图、目的地区域和阵营筛选，无需 API Key。

## 已整理的数据

- 主数据：Mapzeroth **2.0.5 Modern**，固定提交 `905f1d89adcf0551dedcd4277cce2cc1cde914be`。
- 242 个端点、203 条原始门户连接，按来源的双向规则展开为 **263 条有向路线**。
- 其他资料放入独立观测表，包括主城资料和苏拉玛传送网络，不重复累加为主路线数量。
- 只导入 `Data/Modern` 的 `method="portal"`，排除无限服、飞行点、船、飞艇、步行和玩家随身传送技能。
- 当前数据不是游戏世界的完整实时普查。任务临时门、职业门、赛季门及新补丁连接仍可能缺漏。

主要来源为 [Mapzeroth](https://github.com/tr0tsky0/Mapzeroth/tree/2.0.5)，发布页标注正式服 12.1.5。
独立资料来源包括 [Warcraft Wiki](https://warcraft.wiki.gg/) 和 Kemayo 的苏拉玛传送数据。
逐条来源、章节、固定提交、文件行号和校验值均保留在 JSON 和数据库中。

## 文件

| 文件 | 用途 |
| --- | --- |
| `retail-portals.sqlite3` | SQLite 主数据库，可供其他本机程序只读查询 |
| `index.html` | 不需要启动服务的离线查询页面 |
| `portals.json` | 规范化数据、来源、端点和独立观测的完整导出 |
| `portals.csv` | 主数据路线，UTF-8 BOM 编码，供表格软件查看 |
| `mapzeroth.json` | 固定提交中的门户原始端点与有向边 |
| `hubs.json` / `regions.json` | 独立来源的观测值，保留未知坐标和未核实条件 |
| `maps.json` | 地图 ID、中英文名称和已知来源疑点 |
| `manifest.json` | 记录数量和主要文件的 SHA256 |
| `import_mapzeroth.py` | 只解析字面量的提取器，不执行第三方 Lua |
| `catalog.py` | 使用 Python 标准库建库、导出和查询 |
| `THIRD-PARTY-NOTICES.txt` | 数据归属与来源许可 |

## 坐标与方向

数据库显示坐标采用 **0～100 的地图比例值**，例如 `12.34, 56.78`。
与插件传输快照对应的换算为 `x = px / 100`、`y = py / 100`。

每个坐标都要结合 `source_map_id` 使用。地图名称相同也可能属于不同楼层或时代。
例如诺森德达拉然与破碎群岛达拉然、旧银月城与至暗之夜银月城分别保存，不能混用坐标。
`source_container` 只是上游的分区标识，不作为实测楼层。

每行是一条 **起点 → 目的地** 的路线。回程只有在来源明确记录时才建立。
`reverse_from_bidirectional=true` 表示来源明确双向且没有单独回程边，按该规则生成反向。
同图、同名或坐标接近都不会自行产生回程。

`destination_anchor_x/y` 是上游图的目的节点，可能只是区域参考点。
它们不等于实测传送落点。主路线的 `arrival_x/y` 均为空，只有独立来源明确给出落点时才在观测中保留。
未知值使用 `null`，不会用 `0,0` 填充。

## 条件与资料差异

- `requirements` 保留阵营、职业、种族、最低等级、任务、节日和声望等原始条件。
- `in_phase` 保留时间线或相位条件。没有读取当前角色的任务进度，因此不能直接判断该角色是否可用。
- `faction=Unknown` 表示来源没注明阵营，不保证双方都能使用。
- `validation_status=source_only` 表示已核对来源结构，尚未逐门在游戏中实测。
- 已知地图归属疑点标为 `availability=uncertain`，默认查询隐藏，原记录仍然入库。
- `portal_observations` 单独保存其他资料。坐标不一致时同时保留，不覆盖、不取平均。
- 观测的候选匹配按起点地图、目的地图和阵营筛选，不证明是相同门户或相同楼层。
- 坐标差小于或等于 1.5 仅标为 `nearby`，不是世界距离，也不是门位置通过实测的结论。
- 未注明精确坐标的观测仅作方向核对，不用于位置推荐。

国服与其他地区的更新节奏、剧情相位可能不同，实际可见门户以当前游戏为准。
此数据库当前**没有自动接入魔兽陪伴精灵聊天或路径导航**，没有修改插件、模型或登录配置。

## 命令行查询

在 `I:\GameTools\WOWAddons` 打开 PowerShell，使用 Python 3.10 或更高版本。

```powershell
python -X utf8 .\data\retail-portals\catalog.py query --from 暴风城 --faction Alliance
python -X utf8 .\data\retail-portals\catalog.py query --to 银月城
python -X utf8 .\data\retail-portals\catalog.py query --map-id 85 --x 55 --y 90 --limit 5
python -X utf8 .\data\retail-portals\catalog.py query --include-uncertain --limit 1000
```

位置排序只在同一个地图 ID 内比较地图比例差，不计算码数，不判断楼层或道路可通行。
查询只读数据库，不请求网络。输入参数通过 SQL 参数绑定，不拼接成 SQL 代码。

## 直接读取 SQLite

```python
import sqlite3
from pathlib import Path

path = Path(r"I:\GameTools\WOWAddons\data\retail-portals\retail-portals.sqlite3")
with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as database:
    rows = database.execute("""
        SELECT source_map_name_zh, source_map_id, source_x, source_y,
               destination_name_zh, destination_map_id, faction, requirements_zh
        FROM portal_routes
        WHERE source_map_id = ? AND availability != 'uncertain'
        ORDER BY destination_map_id
    """, (84,)).fetchall()
    for row in rows:
        print(row)
```

表：`portal_routes`、`nodes`、`maps`、`sources`、`route_sources`、`portal_observations`、`observation_sources`、`coordinate_checks`、`metadata`。
`portal_routes.data_json` 保留全部规范化字段，`nodes.data_json` 保留原节点字段及来源行号。
`coordinate_checks` 只表示其他观测的候选方向匹配，不是路线可用认证。

## 重建与更新

仅使用现有 JSON 重建，不连接网络：

```powershell
python -X utf8 .\data\retail-portals\catalog.py build
```

重建先写入临时数据库，完成完整性与外键检查后替换。
已有数据库会先复制为带时间戳的 `.bak` 文件，本目录不存用户账号或游戏存档。

重新提取固定来源时，先准备源码，再运行：

```powershell
git clone --depth 1 --branch 2.0.5 https://github.com/tr0tsky0/Mapzeroth.git .\research\portal-sources\Mapzeroth
python -X utf8 .\data\retail-portals\import_mapzeroth.py --source .\research\portal-sources\Mapzeroth
```

若本机已保存该固定提交的源码，不重复下载。完整提取器回归需要这份源仓库。
提取器固定校验上述提交，只读取经过校验的源文件。
要升级来源版本，应先审核新的端点、方向、条件及来源许可，再修改固定提交和测试。
不能直接用源仓库 `main` 覆盖，因为其 TOC 仍带开发版标识，且不一定等于发布标签。

完整验证命令：

```powershell
cd .\data\retail-portals
python -X utf8 -m unittest -v test_import_mapzeroth test_catalog
```

覆盖受限解析、来源提交和哈希、方向规则、坐标范围、引用完整性、中文查询、输入绑定与重建备份。
测试不表示所有门户已在当前客户端逐一实测。

本次检查：**28 项自动化测试通过**，SQLite 完整性和外键检查通过，导出哈希一致。
离线网页已检查 JavaScript 语法、唯一元素标识和本地文件链接；浏览器渲染未验收。
