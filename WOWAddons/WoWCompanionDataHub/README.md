# 魔兽陪伴精灵数据中台

独立的 Docker 服务，用于查看匿名安装数量、近期活跃安装数量，以及客户端上报的模型 Token 用量。当前版本：`1.0.0`。不需要部署 AIRI 或游戏客户端，不读取用户的聊天、角色、截图、API Key、服务商名称或模型名称。

客户端首次运行时告知收集范围，告知页面默认勾选开启；用户可以关闭。已有用户升级后先显示告知，未完成告知前不发送。服务器地址尚未配置时不会发送；在陪伴精灵的统计设置中填入部署后的服务根地址，例如 `https://stats.example.com`。不需要给客户端填写管理员密钥。

## 统计口径

- **安装数量**：服务端成功登记的随机安装 ID 数量，不等于自然人数。未启用上报的安装不计入；卸载不能自动从累计数量中扣除；清除本机安装身份后会产生新 ID。
- **活跃安装**：最近 5 分钟／24 小时内登记或通过认证上传过心跳的安装。客户端运行时每 300 秒发送累计计数，即使没有新增用量也发送；重复注册不会刷新活跃时间。
- **用量记录数**：SDK 捕获的用量记录次数，包含拿到用量和未拿到用量的记录，不是 HTTP 请求次数。工具调用或流式返回可能只有部分记录提供用量。
- **Token**：只累计服务商实际返回的输入、输出和总 Token 字段；缺失字段保持未知，不按字数估算，也不把音频时长或字符数当 Token。各字段分别提供覆盖记录数；总 Token 保留服务商原始口径，不强制等于输入加输出。
- **每日趋势**：按服务器 UTC 接收日期分配新增量。离线后补报记在接收日，不能恢复原始发生日期。时间范围只影响每日趋势，累计总量和安装总数仍为全部时间。

这是匿名客户端自报统计，可以被修改客户端或伪造上传，不能作为付费结算、扣费、反作弊或完整账单的依据。安装 ID 是随机设备安装标识，不收集姓名或账号；网络服务器和反向代理仍能在连接时看到来源 IP，本应用只在有上限的内存限流表中临时使用 IP，不将它写入 SQLite。

## 使用 Docker 部署

服务器需安装 Docker Engine 和 Docker Compose 插件。下面的命令在本目录执行；示例域名必须替换为自己的域名。

```sh
python3 setup.py
docker compose config
docker compose up -d --build
docker compose ps
```

`setup.py` 生成 `secrets/admin-key.txt` 和 `.env`，已有文件不会覆盖，控制台不会打印密钥。初次本机评估可打开 `http://127.0.0.1:8080`，用本机文本编辑器打开密钥文件，将其内容粘贴到管理页面。登录会话有效一小时，退出会清除会话；密钥不存入浏览器 localStorage。

远程服务器的初次查看可使用 SSH 隧道，在自己的电脑执行 `ssh -L 8080:127.0.0.1:8080 user@server`，随后访问上述本机地址。对外提供上报前，先配置域名和 HTTPS 反向代理。

### HTTPS 生产配置

编辑 `.env`：

```dotenv
DATAHUB_ALLOWED_HOSTS=stats.example.com,localhost,127.0.0.1,[::1]
DATAHUB_PUBLIC_ORIGIN=https://stats.example.com
DATAHUB_COOKIE_SECURE=1
```

保留回环地址供容器健康检查使用。修改后执行 `docker compose up -d --force-recreate`。Compose 只把端口映射到宿主机 `127.0.0.1:8080`，由反向代理对外终止 TLS。不要把这个映射改成所有网卡来替代 HTTPS。

以下 Nginx 配置放入自己的站点配置，证书路径使用实际有效证书。生产环境必须保留请求缓冲和读取超时设置，防止慢客户端占满应用线程。

```nginx
server {
    listen 80;
    server_name stats.example.com;
    return 301 https://stats.example.com$request_uri;
}

server {
    listen 443 ssl;
    server_name stats.example.com;
    ssl_certificate /etc/letsencrypt/live/stats.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/stats.example.com/privkey.pem;

    client_max_body_size 32k;
    client_header_timeout 10s;
    client_body_timeout 10s;
    keepalive_timeout 10s;
    access_log off;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Connection "";
        proxy_request_buffering on;
        proxy_connect_timeout 5s;
        proxy_send_timeout 30s;
        proxy_read_timeout 35s;
    }
}
```

先执行 `sudo nginx -t`，再按服务器的服务管理方式重载 Nginx。不要在代理日志格式中记录 Authorization、Cookie 或请求体。示例关闭访问日志；Nginx、云负载均衡、防火墙的错误日志或安全日志可能仍包含 IP，应按自己的保留策略管理，不能把“应用数据库不记录 IP”理解为整个网络链路完全无日志。

### 密钥与容器权限

管理员密钥优先通过 `ADMIN_KEY_FILE` 读取，Compose 将 `secrets/admin-key.txt` 挂载到 `/run/secrets/admin_key`。容器用 UID/GID `10001` 运行，根文件系统只读，数据库写入命名卷 `statistics`。

Linux 下初始化脚本将 `secrets` 目录设为 `0700`、单个密钥文件设为 `0444`。这是为了兼容 Compose 本地文件 secret 保留宿主文件权限的行为，让非 root 容器能读取挂载后的单文件；宿主机上由私有父目录阻止其他普通用户读取。不要把该文件复制到公开目录。Windows Docker Desktop 使用其文件共享机制；不要提交或公开整个 `secrets` 目录。

`.env`、`secrets/`、数据库和备份都已列入 `.gitignore` 与 `.dockerignore`。生产环境不要把密钥直接写进 Compose 文件、镜像、Git 仓库或聊天中。轮换密钥时停止服务，在本机生成新密钥替换 secret 文件，再重新创建容器；进程内管理员会话也会失效。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `ADMIN_KEY_FILE` | 管理员密钥文件路径，优先于 `ADMIN_KEY`；文件不存在时启动失败，不降级读取环境变量。 |
| `ADMIN_KEY` | 测试或开发用的密钥，至少 32 字节；生产优先使用 Docker secret。 |
| `DATAHUB_DATABASE` | SQLite 路径，容器默认 `/data/statistics.sqlite`。 |
| `DATAHUB_ALLOWED_HOSTS` | 逗号分隔的可信 Host，默认仅本机；生产加入实际域名。 |
| `DATAHUB_PUBLIC_ORIGIN` | 生产 HTTPS 来源，如 `https://stats.example.com`；不能包含路径、用户信息、查询或片段。 |
| `DATAHUB_COOKIE_SECURE` | `1` 启用 Secure Cookie；配置公开 HTTPS 来源后也会强制启用。 |

## API 协议

所有 POST 数据为 `application/json`，请求体最多 32 KiB。字段严格校验，未知字段、重复 JSON 键、负数、不安全整数和非法计数关系会被拒绝。这里的凭据均为占位符，不是可用密钥。

### 登记安装

`POST /api/v1/installations`

```json
{
  "protocol": 1,
  "installationId": "客户端生成的规范小写 UUIDv4",
  "installationSecret": "客户端生成的32随机字节的43字符无填充base64url",
  "clientVersion": "1.0.0",
  "platform": "win32"
}
```

平台限 `win32`、`darwin`、`linux`。第一次返回 201；同 ID 同 secret 返回 200 并更新版本和平台，不重复增加安装数、不刷新活跃时间；同 ID 不同 secret 返回 409。服务端只保存 secret 的 SHA-256，不保存原文。

### 累计用量与心跳

`POST /api/v1/usage`，认证头 `Authorization: Bearer <installationId>.<installationSecret>`。

```json
{
  "protocol": 1,
  "sequence": 1,
  "counters": {
    "requests": 1,
    "requestsWithUsage": 1,
    "requestsWithoutUsage": 0,
    "inputTokens": 100,
    "outputTokens": 20,
    "totalTokens": 120,
    "inputReportedRequests": 1,
    "outputReportedRequests": 1,
    "totalReportedRequests": 1
  }
}
```

sequence 必须是正安全整数，客户端持久化后递增；九个计数为从本安装统计起点累计的非负安全整数。`requests = requestsWithUsage + requestsWithoutUsage`。三个 `*ReportedRequests` 分别是提供相应字段的记录数，不能超过 `requestsWithUsage`；有用量的记录至少提供一个字段；未提供的字段不能虚增 Token。

同 sequence、同 counters 返回 `status: duplicate`，不重复计数；更旧 sequence 返回 `stale` 并忽略；新 sequence 返回 `accepted`，只累计相对于上一检查点的增量。相同 sequence 内容不同或新 sequence 的计数下降返回 409，不修改检查点和日增量。所有合法认证心跳刷新活跃时间。丢失回复后，可以重发原检查点，也可以用更大 sequence 发送相同累计计数；不能因重试再次增加本地累计用量。

### 管理与健康检查

- `GET /health`：公开的最小健康状态和软件版本，不包含统计或凭据。
- `POST /api/v1/admin/session`：`{"key":"管理员密钥"}`。成功返回 201 并设置 HttpOnly、SameSite=Strict Cookie，一小时有效。
- `POST /api/v1/admin/logout`：带会话 Cookie，空 body 或 `{}` 均可；成功清除该会话。
- `GET /api/v1/admin/stats?days=7`：必须使用会话 Cookie，或命令行工具使用 `Authorization: Bearer <管理员密钥>`。`days` 可取 1–90。

统计响应包含 `generatedAt`、`periodDays`、`totalInstallations`、`activeInstallations5m`、`activeInstallations24h`、`totals`、`daily` 和 `versions`。`totals` 包含九个累计计数，`daily` 的每行包含 UTC `day` 和九个计数，`versions` 包含 `version` 和 `installations`。不返回安装 ID、安装 secret 或管理员密钥。

管理页面与 API 同源，服务端检查 Host 和浏览器 Origin，不开放跨域 CORS。静态文件只允许 `/`、`/index.html`、`/dashboard.js`、`/dashboard.css`；其他路径返回 404。不要将管理面板嵌入第三方网页。

## 数据备份、恢复与升级

数据库使用 SQLite WAL、5 秒 busy timeout 和事务写入。在线备份必须使用 SQLite backup API，不能只复制正在写入的 `.sqlite` 主文件：

```sh
mkdir -p backups
docker compose exec datahub python backup.py /data/backup-2026-11-04.sqlite
docker compose cp datahub:/data/backup-2026-11-04.sqlite ./backups/backup-2026-11-04.sqlite
```

每次使用新的备份文件名，脚本拒绝覆盖。备份包含随机安装标识、secret 哈希和统计，仍应私密保管。取出备份后，可在确认目的文件有效后删除卷内那份备份，以免占满磁盘。

恢复时先停止服务，将备份放回 `/data/statistics.sqlite` 所在命名卷，保证 UID/GID `10001` 可读写；确认原库及对应 `-wal`、`-shm` 已在停止写入后整体移走或妥善归档，再启动服务。不要将恢复后的旧库与原来的 WAL 混用。也可在停止容器后完整备份并恢复整个命名卷。不要执行 `docker compose down -v`，该命令会删除统计卷。

升级前先备份，再在本目录更新代码并执行 `docker compose up -d --build`。当前数据库版本为 1，遇到未知数据库格式会拒绝启动，不能静默覆盖原数据。

## 运行方式与验证

生产镜像固定 `gunicorn==26.2.0`，单 worker、gthread、8 个线程，SQLite 每次操作独立连接。管理会话和限流只保存在有容量上限的进程内存中，重启失效；当前适合单实例部署，不能直接横向扩容并共享一个 SQLite 文件。应监控磁盘空间、备份和实例健康，不把 Token 统计当成收费服务账本。

`--timeout=30` 是 Gunicorn worker 存活检查；应用另外将 Gunicorn socket 的读取超时设为 30 秒。外部请求头、慢速请求体由上面的 Nginx 超时和请求缓冲保护，不能省略代理后把开发服务器放到公网。

本机开发可设置仅供测试的 `ADMIN_KEY` 后执行 `python server.py --dev --port 8080`。这个入口使用标准库 `wsgiref`，仅绑定回环地址，供开发与验证使用；不是生产部署方式。

执行测试：

```sh
python -m unittest discover -s tests -v
python -m py_compile server.py store.py setup.py backup.py
```

测试使用临时数据库、临时静态文件和合成凭据，通过实际本机 HTTP 验证登记、认证、心跳、重试、并发、事务回滚、UTC 日归属、字段覆盖、会话、CSRF、请求限制和备份；不连接真实模型服务。本次开发机器没有 Docker，因此尚未实际构建或启动 Linux 镜像；部署服务器上仍需执行上面的 Compose 检查、构建和健康检查。

相关官方文档：[Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/)、[Gunicorn 26.2.0](https://pypi.org/project/gunicorn/26.2.0/)、[Python sqlite3 backup](https://docs.python.org/3.13/library/sqlite3.html#sqlite3.Connection.backup)。

### 管理面板浏览器验证

静态面板无需第三方前端依赖，提供安装登记、5 分钟活跃、累计已报告 Token、用量未知记录、字段报告覆盖、版本分布、UTC 接收日趋势以及本页聚合 CSV 导出。趋势可选 7/30/90 天；累计卡片不受趋势范围影响。登录后每 60 秒刷新，401 会话失效时立即清除页面中的旧统计。管理员密钥不写入 localStorage 或 sessionStorage，服务端通过 HttpOnly Cookie 管理会话。

界面支持浏览器语言识别与手动切换：简体中文、繁体中文、英语、西班牙语、法语、意大利语、葡萄牙语、日语、韩语、俄语、泰语、越南语。

开发者可复用已有 Playwright 环境执行测试，无需给生产服务器安装 Node.js 或 Playwright。在本目录执行（Windows PowerShell 示例，请替换路径）：

```powershell
$env:DASHBOARD_PLAYWRIGHT_MODULES='I:\GameTools\airi\node_modules'
node --check web/dashboard.js
node --test tests/dashboard.browser.test.mjs
```

该测试启动临时回环 WSGI 服务器和临时 SQLite 数据库，通过真实管理 API 验证登录、Cookie、统计、刷新周期、退出和 401；同时验证 12 种语言、三种趋势范围、CSV 公式防护、DOM 文本渲染、390 像素窄屏布局及 CSP。测试凭据均为合成数据，不读取本机陪伴精灵配置，不调用模型。2026-11-04 此项浏览器测试通过，桌面与手机布局截图保存在系统临时目录的 `wow-datahub-dashboard-desktop.png`、`wow-datahub-dashboard-mobile.png`。
