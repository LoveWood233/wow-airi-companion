# WoW 攻略情报接口

供桌面伴侣或其他本地程序调用的 HTTP JSON API。使用 Python 3.10+ 标准库，无第三方依赖、无账号或 API Key 要求。

这是**游戏外部服务**，不要放入 AddOns 文件夹。WoW Lua 插件无法直接调用 HTTP；桌面伴侣可以接收玩家导出的职业/专精数据后调用此服务。

## 当前能力

- 最新资讯：从 Wowhead RSS 读取 `Live` 正式服条目，排除 PTR、Classic、Forever 等分支。
- 副本/团本：实时读取攻略目录，按来源更新时间排序，返回玩法攻略和奖励攻略的入口。
- 装备/天赋/手法：按职业和专精检索对应分类攻略。
- 攻略详情：返回简介、作者、发布时间、更新时间和章节索引，完整内容通过原文链接阅读。
- 数据溯源：每项附带 URL、语言和来源；来源获取失败时明确返回 502，或标记为过期缓存。

**本版不复制整篇攻略，不自动生成天赋导入码、技能优先级或针对你角色的配装结论，也不接入大模型。** 个别攻略的推荐取决于页面里的天赋、场景等交互选项，应到原文确认。

当前接入 Wowhead 一个第三方来源，内容为英文；中文接口说明不等于中文攻略。Icy Veins 在开发环境中返回 403，未接入也未绕过访问限制。国服赛季与补丁进度需要另行核对。

## 启动

在 PowerShell 中运行：

```powershell
cd I:\GameTools\WOWAddons\WoWIntelAPI
python server.py
```

打开 <http://127.0.0.1:8765/>，可点击示例查询。按 Ctrl+C 停止。
也可运行 `start.ps1`。端口被占用时使用 `python server.py --port 8766`。
服务仅监听 `127.0.0.1`，未开放跨域访问或公网服务，也不会自动随系统启动。

若服务由开发助手在后台启动，可运行 `stop.ps1` 停止；它会检查 `server.pid` 对应的进程确实在运行本目录的服务脚本，再停止该进程。后台运行日志为 `server.stdout.log` 和 `server.stderr.log`。

## 接口

| 方法与路径 | 用途 |
| --- | --- |
| `GET /health` | 仅检查本地服务，不代表上游可用 |
| `GET /api/v1/sources` | 来源及缓存策略 |
| `GET /api/v1/specs` | 职业与专精参数列表 |
| `GET /api/v1/news` | 最新正式服资讯 |
| `GET /api/v1/guides` | 分类攻略目录 |
| `GET /api/v1/guide?url=...` | 指定攻略的简介和章节索引 |

### 1. 最新资讯

```text
GET /api/v1/news?topic=all&days=30&limit=10
GET /api/v1/news?topic=dungeon&days=7
GET /api/v1/news?q=mage&days=30
```

- `topic`：`all / overview / gear / talents / rotation / dungeon / raid`。
- 支持中文分类：`全部 / 概览 / 装备 / 天赋 / 手法 / 副本 / 团本`。
- `days`：1–365，默认 30。仅筛选 RSS 当前窗口，不会回溯抓取历史新闻。
- `q`：英文原文中的连续关键词，不进行语义搜索或自动翻译。
- `limit`：1–50，默认 10。
- 新闻类别由关键词匹配推断，可能漏检或误分类。

### 2. 职业攻略

```text
GET /api/v1/guides?class=mage&spec=frost&topic=gear
GET /api/v1/guides?class=mage&spec=frost&topic=talents
GET /api/v1/guides?class=mage&spec=frost&topic=rotation
GET /api/v1/guides?class=paladin&spec=holy&topic=overview
```

- `class`、`spec`：有效组合见 `/api/v1/specs`。职业也支持完整中文名称，例如 `法师`。
- `topic=all`：该专精目录内全部攻略，包括赛季提示等其他主题。
- `gear` 包含 BiS、属性优先级、附魔宝石相关攻略。
- `q`：标题或 URL 的子串筛选，例如 `season-2`，不自动映射中文副本名。
- `patch`：可选的来源数字版本标签，例如 `120105`。**这只是来源标签；旧资料片文章也可能被标注为新版本，不能视作版本适配证明。**
- `limit`：1–50，默认 10。

### 3. 副本、团本玩法

```text
GET /api/v1/guides?topic=dungeon&limit=10
GET /api/v1/guides?topic=raid&limit=10
GET /api/v1/guides?topic=dungeon&q=mythic
```

不接受 `class` / `spec`，避免静默忽略角色筛选。目录可能含历史内容，须结合标题、赛季和日期判断适用性。

### 4. 攻略详情

先从攻略目录取得 `url`，URL 编码后传入：

```python
import json
from urllib.parse import urlencode
from urllib.request import urlopen

base = "http://127.0.0.1:8765"
params = urlencode({"class": "mage", "spec": "frost", "topic": "talents"})
with urlopen(base + "/api/v1/guides?" + params) as response:
    catalog = json.load(response)

if catalog["items"]:
    query = urlencode({"url": catalog["items"][0]["url"]})
    with urlopen(base + "/api/v1/guide?" + query) as response:
        detail = json.load(response)
    print(json.dumps(detail, ensure_ascii=False, indent=2))
```

详情接口只允许 `https://www.wowhead.com/guide/` 下的地址，不允许任意网址或任意端口。不会执行远端 JavaScript。章节信息来自可见 HTML / noscript，动态页面可能提供不完整的标题。

## 返回字段与“最新”的含义

| 字段 | 含义 |
| --- | --- |
| `request_at` | 当前 API 响应时间（UTC） |
| `source_status.fetched_at` | 上次成功下载并解析来源的时间 |
| `source_status.cache` | `miss` 本次抓取；`hit` 缓存命中；`stale` 上游失败后的旧缓存 |
| `source_status.stale` | 是否使用过期缓存 |
| `published_at` | 来源明确提供且含时区的发布时间，否则 null |
| `updated_at` | 来源明确提供且含时区的更新时间，否则 null |
| `source_date_raw` | 目录中的原始日期，便于审计无时区或不可解析的时间 |
| `source_patch_tag` | 来源目录的版本标签，不作兼容性承诺 |
| `compatibility` | `unverified`，未针对当前客户端/角色验证 |
| `sections` | 详情中的章节标题列表，不是自动生成的建议 |

“最新”指当前可访问来源中按已知日期排序的内容，不代表全网最新或已获官方认可。缓存有效期 10 分钟；抓取失败时最多返回 24 小时内的缓存，并附上警告。重启服务会清空内存缓存。冷启动时上游失败返回 502，不使用伪造或预置内容填充。

## 错误码

- `400`：参数非法、职业专精不匹配、URL 不在允许范围。
- `404`：接口不存在。
- `414`：请求 URL 太长。
- `502`：来源拒绝访问、超时或结构无法解析，且无可用缓存。
- `500`：内部处理失败。
- `200` 且 `items=[]`：来源成功返回，但筛选条件没有匹配项。

## 验证

```powershell
python -m unittest -v
```

包含日期处理、正式服过滤、HTML/JSON 提取、错误响应、缓存降级及 URL 允许范围测试。在线来源会更新，离线测试使用小型合成数据而不是完整攻略副本。

维护时若站点结构或服务策略变化，应调整解析器或停用该来源；不要用浏览器身份伪装、登录绕过等方式规避站点访问控制。
