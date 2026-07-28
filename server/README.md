# 繁笼个人终端 API

本目录是个人终端正式后端。游戏数据继续读取/写入机器人使用的 `fanlong.db`；账号、会话、头像映射、收藏、幂等与审计写入独立的 `terminal.db`。

## 本地运行

```bash
cd /Users/mayidan/Desktop/繁笼页面/代码/server
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
export FANLONG_DB_PATH="/Users/mayidan/Desktop/AI生成网页/繁笼机器人/fanlong.db"
export TERMINAL_DB_PATH="$(mktemp -d)/terminal.db"
export TERMINAL_UPLOAD_DIR="$(mktemp -d)"
export TERMINAL_COOKIE_SECURE=0
.venv/bin/python app.py
```

服务仅监听 `127.0.0.1:5002`。正式环境由 Windows Nginx 通过 `https://fanlong-api.huaian.cloud` 反向代理，浏览器经 `terminal.rpg0707.com/api/*` 的 Vercel 服务端代理访问。

## 测试

```bash
.venv/bin/python -m unittest discover -s tests -v
```

测试使用临时数据库，不写真实 `fanlong.db`。

## 游戏库迁移

日常逐条记录和同库幂等需要先执行迁移。脚本会先生成带时间戳的完整数据库备份，并要求人工输入 `MIGRATE`：

```powershell
python run_game_migrations.py
```

只能在机器人停止写入或维护模式下执行；脚本最后必须输出 `integrity_check=ok`。

## 管理员人工重置密码

配置三项路径环境变量后，在服务器本机执行：

```powershell
python admin_reset_password.py 需要重置的QQ号
```

脚本会先显示角色名、UID和QQ，只有输入 `RESET` 后才继续。重置成功后撤销该账号全部旧会话，并要求玩家使用临时密码登录后立即改密。

## 已接入接口

- 健康检查、首次设密、登录、退出、修改密码
- 当前玩家档案与资源、动态档案字段、八维属性
- 背包读取与消耗品使用（含普通道具、自选属性礼包、改名卡规则）
- 服饰读取、单槽位及内饰/配饰多槽位穿戴、替换、卸下与锁定服饰保护
- 日常签到、训练、单抽/十连盲盒真实事务；十连保存10条明细
- 社交赠送虞元/名誉与赠送道具事务、额度校验和实例归属转移
- 商城虞元/名誉购买与合成兑换事务
- 剧情列表、详情、收藏与现有HMAC分享链接
- 社交精确搜索与机器人“档案”口令同字段公开档案
- 玩家头像上传、重新编码和读取

所有写接口都要求会话 Cookie 与 `X-CSRF-Token`；密码使用 Argon2id 哈希。
