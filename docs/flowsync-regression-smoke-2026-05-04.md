## FlowSync Regression Smoke - 2026-05-04

### Scope

- Verify `go build ./cmd/yiboflow`
- Verify local server startup against PostgreSQL + Redis
- Verify `NAS staging -> share link -> public download` regression path

### Fix Applied During Regression

- `server/internal/model/staging.go`
  - Change `StagedObject.ManifestJSON` from `gorm:"type:longtext"` to `gorm:"type:text"`
  - Reason: local PostgreSQL startup failed with `ERROR: type "longtext" does not exist (SQLSTATE 42704)`

### Local Regression Environment

- Server: `http://127.0.0.1:18080`
- PostgreSQL: Docker `postgres:15-alpine`
- Redis: Docker `redis:7-alpine`
- Staging dir: `C:\tmp\yiboflow-regress-staging`

### Executed Checks

1. `go build ./cmd/yiboflow`
2. Start local server and confirm `/api/v1/ping`
3. Register first user `regress_admin`
4. Restart server and confirm admin bootstrap promoted earliest user
5. Login and confirm `role=admin`
6. Enable `external_links_enabled`
7. Create staged object
8. Upload one chunk
9. Complete staged object
10. Create share link with `max_downloads=1`
11. Download once and verify payload bytes
12. Download a second time and verify `409` with `limit_reached`

### Result

- `go build ./cmd/yiboflow`: passed
- Server startup: passed
- `NAS staging -> share link -> download`: passed
- Share-link download limit enforcement: passed

### Coverage Note

- This smoke test exercised the server/API chain directly.
- Desktop `FlowSync` UI compilation had already passed earlier via `cargo check -p yiboflow-core`, `cargo check -p tauri-app`, and `cd desktop && npm run build`.
- This run did not drive the live desktop UI through a real multi-device upload interaction.
