FROM golang:1.25-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git ca-certificates tzdata

COPY go.mod go.sum ./
ENV GOPROXY=https://goproxy.cn,direct
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-w -s" -o /out/yiboflow_server ./cmd/yiboflow/main.go

FROM alpine:3.20

WORKDIR /root

COPY --from=builder /out/yiboflow_server ./yiboflow_server
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo

ENV TZ=Asia/Shanghai
ENV GIN_MODE=release
ENV PORT=8080

EXPOSE 8080

CMD ["./yiboflow_server"]
