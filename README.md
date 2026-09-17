# BotVault — production-oriented Discord bot hosting control plane

BotVault is a Next.js + PostgreSQL/Prisma control plane for hosting Discord bots on isolated Docker nodes. Vercel should run the web/API control plane; arbitrary bot processes must run on separate Linux nodes.

## Architecture

Browser → Next.js App Router/API → PostgreSQL + S3-compatible object storage → hosting-node agent → isolated Docker container.

The realtime console uses a short-lived signed WebSocket token. The node agent streams Docker stdout/stderr and sends bounded log records back to the control plane.

## Required production services

1. Managed PostgreSQL (TLS enabled).
2. S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, etc.).
3. One or more Linux Docker hosting nodes.
4. A private network/VPN or mTLS/reverse proxy between the control plane and node agents.
5. HTTPS for the web app and WSS for realtime logs.

## Web app setup

```bash
cp .env.example .env.local
# fill every required secret
npm install
npx prisma generate
npx prisma db push
npm run db:seed
npm run dev
```

Production:

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
npm start
```

Set the same environment variables in your deployment platform. Never commit `.env.local`.

## Generate secrets

```bash
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -hex 32      # WS_SECRET
openssl rand -hex 32      # INTERNAL_API_TOKEN
openssl rand -hex 32      # NODE_AGENT_TOKEN
```

`ENCRYPTION_KEY` must decode to exactly 32 bytes. Losing it makes encrypted Discord tokens unrecoverable.

## Hosting node

On a dedicated Linux Docker host:

```bash
cd node-agent
npm install
NODE_AGENT_TOKEN='...' \
WS_SECRET='...' \
CONTROL_PLANE_URL='https://your-app.example.com' \
INTERNAL_API_TOKEN='...' \
S3_BUCKET='...' S3_REGION='...' S3_ACCESS_KEY_ID='...' S3_SECRET_ACCESS_KEY='...' \
NODE_NAME='node-1' npm start
```

Expose the agent only through a private network or authenticated reverse proxy. Do **not** expose the Docker socket or agent to the public internet.

The agent provisions containers with:
- memory and CPU limits
- PID limits
- `no-new-privileges`
- all Linux capabilities dropped
- per-bot directories
- Docker network isolation boundary
- automatic process restart handled by the control plane/node lifecycle design

For stronger isolation at scale, use dedicated VMs/microVMs or a hardened container runtime.

## Database

Models cover users, sessions, bots, files, encrypted environment variables, deployments, nodes, plans, subscriptions, metrics, logs and audit logs. Run Prisma migrations in production instead of `db push`.

## Authentication

Passwords are bcrypt-hashed. Sessions are opaque random tokens stored as SHA-256 hashes and delivered through Secure/HttpOnly/SameSite cookies. API routes perform server-side ownership checks; admin routes require the database role `ADMIN`.

Email verification, password-reset email delivery and Discord OAuth are represented as integration points and should be connected to a transactional email/OAuth provider before enabling them in production.

## File storage

Bot files are stored in S3-compatible object storage under `bots/<botId>/<path>`. The API validates paths and checks bot ownership before every operation. Never store uploads on Vercel's ephemeral filesystem for production.

## Secrets

Discord tokens and environment values are encrypted using AES-256-GCM before database storage. They are decrypted only on the server during deployment. They are never returned by environment-variable GET endpoints.

Use a cloud KMS/secret manager for the master encryption key in a larger production deployment.

## Deployment flow

1. User creates a bot.
2. API validates plan capacity and stores the bot.
3. Token is encrypted into the environment-variable table.
4. Files are uploaded to object storage.
5. Deploy endpoint collects metadata and decrypts secrets server-side.
6. Node agent downloads the exact object keys and creates an isolated container.
7. Container output is streamed over WebSocket and bounded logs are persisted.
8. Metrics can be sampled into `UsageMetric` at a fixed interval rather than every process tick.

## Security checklist

- Put PostgreSQL behind TLS/private networking.
- Restrict node-agent access to the control plane.
- Rotate node/internal tokens periodically.
- Put WSS behind TLS.
- Add a distributed rate limiter (Redis/Upstash) instead of the in-memory development limiter.
- Add CSRF protection for cookie-authenticated state-changing requests if your deployment topology requires it.
- Add object-storage lifecycle rules and antivirus scanning for untrusted uploads.
- Use a queue (Redis/SQS/etc.) for deployments so API requests do not block on image pulls/builds.
- Add per-plan CPU/RAM/storage quotas and scheduler capacity checks before provisioning.
- Never log environment values or Discord tokens.
- Add centralized monitoring and alerting.
- Run containers as non-root where compatible and consider read-only root filesystems.
- Back up PostgreSQL and test restoration.

## Billing

Stripe is intentionally modular. Do not mark a subscription paid from a browser callback. Create a checkout session server-side and update subscription state only from verified Stripe webhooks.

## Tests and verification

Run:

```bash
npm run lint
npm test
npm run build
```

Before production, additionally test cross-user authorization, expired sessions, malformed upload paths, oversized uploads, secret redaction, node-agent authentication, container limits, failed deployments and WebSocket token expiry.
