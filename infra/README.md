# infra

Local infrastructure for development (CLAUDE.md D7). Terraform for AWS arrives in Phase 6.

## Redis 7 (Docker Compose)

`docker-compose.yml` runs Redis 7 on `127.0.0.1:6379` with no password and no persistence. It
carries live ticks from `apps/api` to `apps/realtime` over pub/sub (ADR 0004 §4).

Requires Docker with the Compose plugin.

```bash
npm run infra:up      # start Redis and wait until its health check passes
docker compose -f infra/docker-compose.yml exec redis redis-cli ping   # → PONG
npm run infra:down    # stop and remove the container
```

`npm run dev:api` runs `infra:up` for you before starting apps/api, apps/realtime and the web app
in api mode.

The port is bound to loopback only. Do not expose it: this Redis has no authentication and is for
local development only. Cloud environments use managed Redis with auth and TLS (Phase 6).
