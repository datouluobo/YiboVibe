# YiboFlow 账号权限与密码提示规格

更新时间：2026-04-30

## 1. 背景与约束

YiboFlow 采用 E2EE 架构：`用户密码 + KdfSalt → Argon2id → 主密钥(MK)`。

- 密码丢失 = 同步数据不可恢复，这是加密设计的固有代价，任何服务端手段无法绕过
- 不引入邮箱/短信等外部系统
- 产品面向个人及小范围用户，权限模型保持最简

## 2. 角色定义

| 角色 | 标识 | 说明 |
|------|------|------|
| 管理员 | `admin` | 全部功能 + 用户管理 + 设备管理 |
| 普通用户 | `user` | 标准功能（注册后默认） |

### 2.1 管理员产生规则

- **新系统**：第一个注册的用户自动成为 `admin`
- **已有系统迁移**：服务端启动时检测，若不存在 `admin`，将 `created_at` 最早的用户自动提升为 `admin`

## 3. 数据模型变更

### 3.1 User 表新增字段

```go
// 新增字段（追加到现有 model.User）
Role          string `gorm:"type:varchar(20);not null;default:'user'" json:"role"`            // "admin" | "user"
Status        string `gorm:"type:varchar(20);not null;default:'active'" json:"status"`        // "active" | "disabled"
PasswordHint  string `gorm:"type:varchar(200);not null;default:''" json:"-"`                   // 密码提示，JSON 不返回
```

字段说明：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `role` | varchar(20) | `'user'` | 角色标识，GORM AutoMigrate 自动填充已有行 |
| `status` | varchar(20) | `'active'` | 账号状态，`disabled` 时禁止登录 |
| `password_hint` | varchar(20) | `''` | 密码提示，JSON 响应中不返回（`json:"-"`) |

### 3.2 不变的表

- `Device` 表无变更
- 不新增表（无需 Permission、Role 等 RBAC 表）

## 4. JWT Claims 扩展

```go
type CustomClaims struct {
    UID      uint   `json:"uid"`
    DeviceID uint   `json:"device_id"`
    Role     string `json:"role"`    // 新增
    Status   string `json:"status"`  // 新增
    jwt.RegisteredClaims
}
```

中间件在解析 Token 后，将 `Role` 和 `Status` 写入 `gin.Context`。

## 5. 密码提示系统

### 5.1 注册时

- `password_hint` 为可选字段，最长 200 字符
- 前端提示：「请勿在提示中直接包含密码」

### 5.2 登录失败计数

使用 Redis 存储登录失败次数：

```
Key:    login_fail:{username}
Value:  失败次数 (int)
TTL:    30 分钟（每次失败刷新）
```

### 5.3 登录响应逻辑

```
密码正确  → 清除计数，返回 token
密码错误（< 3 次）→ INCR 计数，返回普通 401
密码错误（>= 3 次）→ INCR 计数，返回 401 + password_hint（如有）
用户不存在 → INCR 计数（防枚举），返回普通 401
```

密码错误 >= 3 次且存在 hint 时的响应：

```json
{
    "code": 401,
    "msg": "Username or password incorrect",
    "data": {
        "password_hint": "我家狗的名字+生日"
    }
}
```

### 5.4 hint 可修改

用户改密码时，`password_hint` 必须同步更新：

```
PUT /api/v1/user/password
{
    "old_password": "...",
    "new_password": "...",
    "new_password_hint": "..."
}
```

逻辑：验证旧密码 → 更新 hash → 更新 hint → 清除其他设备会话（强制重新登录）

## 6. API 设计

### 6.1 公开接口（无需认证）

| 方法 | 路径 | 说明 | 变更 |
|------|------|------|------|
| POST | `/api/v1/user/register` | 注册 | 请求体新增 `password_hint`（可选） |
| POST | `/api/v1/user/login` | 登录 | 失败 >= 3 次时响应新增 `password_hint` |

**注册请求变更**：

```go
type RegisterRequest struct {
    Username     string `json:"username" binding:"required,min=3,max=50"`
    Password     string `json:"password" binding:"required,min=8"`
    KdfSalt      string `json:"kdf_salt" binding:"required"`
    PasswordHint string `json:"password_hint"` // 新增，可选，最长 200
}
```

**登录响应变更**：

```go
type LoginData struct {
    UID           uint   `json:"uid"`
    DeviceID      uint   `json:"device_id"`
    Username      string `json:"username"`
    KdfSalt       string `json:"kdf_salt"`
    AccessToken   string `json:"access_token"`
    RefreshToken  string `json:"refresh_token"`
}
```

失败时（条件返回 hint）：

```go
type LoginFailData struct {
    PasswordHint string `json:"password_hint,omitempty"`
    Attempts     int    `json:"attempts"`
}
```

### 6.2 用户自助接口（需 JWT）

| 方法 | 路径 | 说明 | 变更类型 |
|------|------|------|----------|
| GET | `/api/v1/user/me` | 个人信息 | 修改（返回 role/status） |
| PUT | `/api/v1/user/password` | 自己改密码 | **新增** |
| GET | `/api/v1/sync/devices` | 自己的设备列表 | 不变 |
| DELETE | `/api/v1/sync/devices/:id` | 踢掉自己的某台设备 | 不变 |

**修改密码请求**：

```go
type ChangePasswordRequest struct {
    OldPassword     string `json:"old_password" binding:"required"`
    NewPassword     string `json:"new_password" binding:"required,min=8"`
    NewPasswordHint string `json:"new_password_hint"` // 必填（可为空字符串）
}
```

### 6.3 管理员接口（需 JWT + admin 角色）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/admin/users` | 用户列表（含角色、状态、设备数） |
| PUT | `/api/v1/admin/users/:uid/status` | 启停用户（enable/disable） |
| DELETE | `/api/v1/admin/users/:uid` | 删除用户及其全部设备和 Vault 数据 |
| POST | `/api/v1/admin/users/:uid/reset-password` | 重置密码（附带 E2EE 数据丢失警告） |
| GET | `/api/v1/admin/devices` | 全局设备列表 |
| DELETE | `/api/v1/admin/devices/:id` | 踢掉指定设备 |

**重置密码请求**：

```go
type AdminResetPasswordRequest struct {
    NewPassword     string `json:"new_password" binding:"required,min=8"`
    NewPasswordHint string `json:"new_password_hint"` // 可选
}
```

重置密码逻辑：
1. 更新密码 hash
2. 更新 hint（如提供）
3. 删除该用户所有设备会话
4. 响应中告知「同步数据已不可恢复，需客户端重新配置」

## 7. 中间件

### 7.1 现有 `JWTAuth` 扩展

解析 Token 后，额外将 `Role` 和 `Status` 写入 Context，并检查 `Status`：

```go
// 现有逻辑之后追加
c.Set(CtxRoleKey, claims.Role)
c.Set(CtxStatusKey, claims.Status)

if claims.Status == "disabled" {
    c.AbortWithStatusJSON(403, gin.H{"code": 403, "msg": "Account is disabled"})
    return
}
```

### 7.2 新增 `RequireAdmin`

```go
func RequireAdmin() gin.HandlerFunc {
    return func(c *gin.Context) {
        role, exists := c.Get(CtxRoleKey)
        if !exists || role.(string) != "admin" {
            c.AbortWithStatusJSON(403, gin.H{"code": 403, "msg": "Admin access required"})
            return
        }
        c.Next()
    }
}
```

使用方式：

```go
adminGrp := api.Group("/admin")
adminGrp.Use(middleware.JWTAuth(), middleware.RequireAdmin())
```

## 8. 迁移与启动流程

### 8.1 DB 迁移

GORM `AutoMigrate` 会自动为已有行填充 `default` 值：

- `role` → `'user'`
- `status` → `'active'`
- `password_hint` → `''`

无需手动 SQL 迁移脚本。

### 8.2 管理员自动认领

在 `main.go` 中，AutoMigrate 之后执行：

```go
func bootstrapAdmin() {
    var count int64
    config.DB.Model(&model.User{}).Where("role = ?", "admin").Count(&count)
    if count == 0 {
        var oldest model.User
        config.DB.Order("created_at asc").First(&oldest)
        config.DB.Model(&oldest).Update("role", "admin")
        log.Printf("Auto-promoted user '%s' (UID=%d) to admin", oldest.Username, oldest.UID)
    }
}
```

## 9. 管理员自救机制

当管理员忘记密码时，通过命令行/环境变量强制重置：

```bash
# 方式一：命令行参数
docker exec yiboflow-server ./yiboflow --reset-admin --uid=1 --new-pass=xxx

# 方式二：环境变量
docker exec -e ADMIN_RESET_UID=1 -e ADMIN_RESET_PASS=xxx yiboflow-server ./yiboflow
```

重置逻辑：
1. 更新密码 hash
2. 删除该用户所有设备会话（强制重新登录）
3. 输出日志后退出（不启动正常服务）

## 10. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `server/internal/model/user.go` | 修改 | 新增 Role、Status、PasswordHint 字段 |
| `server/internal/pkg/utils/jwt.go` | 修改 | CustomClaims 新增 Role、Status |
| `server/internal/api/middleware/auth_middleware.go` | 修改 | JWTAuth 扩展 + 新增 RequireAdmin |
| `server/internal/service/auth_service.go` | 修改 | 注册支持 hint、登录失败计数、改密码 |
| `server/internal/api/handler/auth_handler.go` | 修改 | 注册/登录请求体变更、新增改密码 handler |
| `server/internal/api/handler/admin_handler.go` | **新增** | 管理员接口（用户管理、设备管理） |
| `server/internal/repo/user_repo.go` | 修改 | 新增更新字段、用户列表等查询 |
| `server/cmd/yiboflow/main.go` | 修改 | bootstrapAdmin、管理员自救参数、新路由组 |
| `desktop/src/pages/` | 待定 | 管理页面 UI（后续单独规划） |

## 11. 不做的事

| 不做 | 理由 |
|------|------|
| 邀请制注册 | 当前阶段不需要 |
| 完整 RBAC 权限表 | 过度设计，两个角色足够 |
| 邮箱/短信验证 | 不引入外部系统 |
| 服务端密码找回 | E2EE 约束，无法绕过 |
| 图形验证码 | 个人工具，Redis 计数足够 |
| 管理页面 UI | 后续独立迭代，先做 API |
