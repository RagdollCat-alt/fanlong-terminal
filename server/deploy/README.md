# 繁笼个人终端部署落位

## 正式链路

```text
terminal.rpg0707.com
  -> Vercel 静态页面
  -> 浏览器 HTTPS + Bearer 会话
  -> https://fanlong-api.huaian.cloud
  -> Windows 宝塔 Nginx
  -> 127.0.0.1:5002
  -> Waitress + Flask
  -> 机器人 fanlong.db + 独立 terminal.db
```

前端仍放 GitHub + Vercel，不放 Windows 服务器。Windows 服务器只部署 API，这是因为网站静态资源适合 Vercel，而登录、数据库事务、头像上传必须由能访问机器人数据库的服务器处理。

## 建议目录

```text
C:\wwwroot\fanlong-api.huaian.cloud\server    API 代码与 Python 虚拟环境
E:\fanlong_terminal_data\terminal.db          登录、会话、收藏、头像映射
E:\fanlong_terminal_data\uploads\avatars     玩家头像文件
C:\Users\Administrator\Desktop\青果核-py代码\plugin\app\fanlong_core\data\fanlong.db
```

API 固定监听 `127.0.0.1:5002`，不要在腾讯云防火墙中开放 5002。公网只开放 Nginx 的 80/443。

## NSSM 服务

- 服务名：`fanlong-terminal-api`
- Application：`C:\wwwroot\fanlong-api.huaian.cloud\server\.venv\Scripts\python.exe`
- Startup directory：`C:\wwwroot\fanlong-api.huaian.cloud\server`
- Arguments：`app.py`
- Startup type：Automatic

在 NSSM 的 Environment 中配置：

```text
FANLONG_DB_PATH=C:\Users\Administrator\Desktop\青果核-py代码\plugin\app\fanlong_core\data\fanlong.db
TERMINAL_DB_PATH=E:\fanlong_terminal_data\terminal.db
TERMINAL_UPLOAD_DIR=E:\fanlong_terminal_data\uploads\avatars
TERMINAL_COOKIE_SECURE=1
TERMINAL_SESSION_DAYS=7
TERMINAL_COOKIE_DOMAIN=.rpg0707.com
TERMINAL_ALLOWED_ORIGINS=https://terminal.rpg0707.com
```

## 上线前必须完成

1. 先停止 OlivOS 对 `fanlong.db` 的写入，并保留完整备份。
2. 配置上述环境变量后运行 `python run_game_migrations.py`，人工输入 `MIGRATE`。
3. 确认输出 `integrity_check=ok` 后再恢复机器人，并安装/启动 NSSM 服务。
4. 保留 `fanlong-api.huaian.cloud` 的 HTTPS 和到 `127.0.0.1:5002` 的反向代理。
5. `terminal.rpg0707.com` 的 Vercel 项目 Root Directory 指向 `代码`；前端通过 HTTPS 直连后端，并使用 `sessionStorage` 中的 Bearer 会话，避免跨站 Cookie 失效。
6. 验证 `https://fanlong-api.huaian.cloud/api/health` 返回 `ok: true`，再测试首次设密、退出重登、背包、服饰、日常、商城、剧情和社交。

正式执行服务器操作时应逐步进行，每一步核对输出后再继续，避免与正在写数据库的机器人同时迁移。
