# 第一阶段：编译引擎 (Builder Stage)
FROM golang:alpine AS builder

# 配置工作目录
WORKDIR /app

# 安装必要的系统依赖 (如时区数据和 SSL 根证书)
RUN apk update && apk add --no-cache git ca-certificates tzdata

# 预先拷贝并下载 Go 依赖项 (利用 Docker 缓存加速后续层构建)
COPY go.mod go.sum ./
ENV GOPROXY=https://goproxy.cn,direct
RUN go mod download

# 拷贝所有后端源码
COPY . .

# 编译为静态链接的超轻量级二进制文件 (剔除调试信息以极限压缩体积)
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o yiboflow_server ./cmd/yiboflow/main.go

# 第二阶段：生产环境运行容器 (Production Stage)
# 采用纯净的 Alpine 极简镜像，摒弃所有编译工具，确保绝对安全与几兆大小的体积
FROM alpine:3.18

WORKDIR /root/

# 从第一阶段提取关键文件
# 1. 编译好的核心引擎
COPY --from=builder /app/yiboflow_server .
# 2. SSL/HTTPS 请求所需的根证书
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
# 3. 完整的全局时区包
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo

# 默认安全环境变量
ENV TZ=Asia/Shanghai
ENV GIN_MODE=release

# 暴露唯一的对公 API 端口 (数据库等均不上浮)
EXPOSE 8080

# 运行引擎
CMD ["./yiboflow_server"]
