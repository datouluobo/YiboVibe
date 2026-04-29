# 群晖 SSH 免密登录配置步骤

更新时间：2026-04-29

## 1. 目标

本文档用于在 Windows 本机与群晖 NAS 之间建立 SSH 密钥登录。

配置完成后的目标效果是：

```bash
ssh datouluobo@192.168.1.88
```

执行后直接登录，不再提示输入密码。

## 2. 适用前提

开始前请确认：

1. 群晖已开启 SSH 服务。
2. 你知道 NAS 的：
   - IP 地址
   - SSH 端口
   - 登录账号
3. Windows 本机可用：
   - `ssh`
   - `scp`
4. 当前登录账号对自身家目录有正常写权限。

## 3. 当前环境示例

按当前项目已有信息，示例参数是：

- NAS IP：`192.168.1.88`
- SSH 端口：`22`
- 登录账号：`datouluobo`

如果你的实际环境不同，请替换成自己的值。

## 4. 第一步：检查本机 SSH 工具

在 Windows PowerShell 中执行：

```powershell
ssh -V
scp -V
```

如果 `scp -V` 不支持显示版本，至少确认命令存在即可：

```powershell
Get-Command ssh
Get-Command scp
```

## 5. 第二步：生成 SSH 密钥

如果本机还没有可用密钥，执行：

```powershell
ssh-keygen -t ed25519 -C "yiboflow-nas"
```

建议直接按默认路径保存，一般会生成：

- 私钥：`C:\Users\<你的用户名>\.ssh\id_ed25519`
- 公钥：`C:\Users\<你的用户名>\.ssh\id_ed25519.pub`

如果系统不支持 `ed25519`，也可以使用：

```powershell
ssh-keygen -t rsa -b 4096 -C "yiboflow-nas"
```

## 6. 第三步：确认本机公钥内容

查看公钥：

```powershell
Get-Content $HOME\.ssh\id_ed25519.pub
```

如果你使用的是 RSA，则改为：

```powershell
Get-Content $HOME\.ssh\id_rsa.pub
```

复制整行公钥内容，后面要写入 NAS。

## 7. 第四步：登录群晖并准备 `.ssh`

先使用密码登录一次 NAS：

```bash
ssh datouluobo@192.168.1.88
```

登录后执行：

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

这一步是为当前账号准备 SSH 公钥授权文件。

## 8. 第五步：把公钥加入 `authorized_keys`

有两种常见方式，任选一种。

### 方式 A：手动粘贴

在 NAS 终端执行：

```bash
vi ~/.ssh/authorized_keys
```

然后把刚才复制的整行公钥粘贴进去，保存退出。

如果你不习惯 `vi`，也可以用群晖支持的其它文本编辑方式。

### 方式 B：用 PowerShell 直接追加

在 Windows PowerShell 中执行：

```powershell
type $HOME\.ssh\id_ed25519.pub | ssh datouluobo@192.168.1.88 "cat >> ~/.ssh/authorized_keys"
```

如果使用 RSA，则改为：

```powershell
type $HOME\.ssh\id_rsa.pub | ssh datouluobo@192.168.1.88 "cat >> ~/.ssh/authorized_keys"
```

执行这一步时，通常仍需要输入一次 NAS 密码。

## 9. 第六步：修正权限

在 NAS 上再次执行：

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

有些系统对权限比较严格，权限不对会导致密钥登录失败。

## 10. 第七步：首次免密测试

回到 Windows PowerShell，执行：

```powershell
ssh datouluobo@192.168.1.88
```

预期结果：

- 不再要求输入密码
- 直接进入 NAS shell

## 11. 第八步：补充主机指纹

如果首次连接提示主机指纹确认，可以接受并写入本机 `known_hosts`。

也可以手动执行：

```powershell
ssh-keyscan -H 192.168.1.88 >> $HOME\.ssh\known_hosts
```

这样后续工具调用时不会因为主机指纹缺失而阻塞。

## 12. 第九步：验证自动化可用性

建议再执行这两条命令：

```powershell
ssh datouluobo@192.168.1.88 "echo ok"
ssh datouluobo@192.168.1.88 "cd /volume1/docker/yiboflow/server && docker compose ps"
```

如果都能返回结果，说明后续自动化部署所需的最小 SSH 能力已经具备。

## 13. 常见问题

### 13.1 仍然提示输入密码

先检查：

- 公钥是否真的写入了 `~/.ssh/authorized_keys`
- `~/.ssh` 是否是 `700`
- `authorized_keys` 是否是 `600`
- 登录时是否用了正确账号
- 是否连接到了正确的 NAS IP 和端口

### 13.2 提示 `Host key verification failed`

说明本机还没有正确记录 NAS 主机指纹。

执行：

```powershell
ssh-keyscan -H 192.168.1.88 >> $HOME\.ssh\known_hosts
```

然后再试一次。

### 13.3 提示 `Permission denied (publickey,password)`

这通常表示：

- 公钥未生效
- `authorized_keys` 内容不完整
- 权限不正确
- 登录账号不对

建议重新检查：

```bash
ls -ld ~/.ssh
ls -l ~/.ssh/authorized_keys
cat ~/.ssh/authorized_keys
```

### 13.4 `docker compose ps` 在 SSH 下不能执行

说明当前登录账号权限不足，或 Docker 环境不可用。

先在 NAS 上检查：

```bash
docker --version
docker compose version
```

再确认该账号对部署目录有访问权限。

## 14. 配置完成后的建议

完成 SSH 免密后，建议继续检查以下事项：

1. 部署目录固定为：

```bash
/volume1/docker/yiboflow/server
```

2. NAS 上的部署文件与仓库一致：

- [server/docker-compose.yml](/F:/Download/GitHub/YiboFlow/server/docker-compose.yml)
- [server/Caddyfile](/F:/Download/GitHub/YiboFlow/server/Caddyfile)

3. API 镜像使用固定标签而不是长期只用 `latest`

4. 每次更新前先备份：

- `.env`
- `docker-compose.yml`
- `Caddyfile`

配套准备清单可参考：

- [docs/nas-automation-prep-checklist.md](/F:/Download/GitHub/YiboFlow/docs/nas-automation-prep-checklist.md)
