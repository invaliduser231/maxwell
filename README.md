# Maxwell

A bot for Fluxer communities: moderation with cases, an inbox for reports and appeals, AutoMod, security checks, logs, backups, welcome cards, levels, tickets and more. Settings live in a web dashboard; in chat you only use commands like `m!ban` or `m!rank`.

## Self-hosting with Docker

You need Docker with Compose and a Fluxer application with a bot token.

```sh
git clone <repository url> maxwell
cd maxwell
cp .env.example .env
```

Fill in at least `FLUXER_TOKEN`, `FLUXER_CLIENT_ID`, `FLUXER_CLIENT_SECRET`, `POSTGRES_PASSWORD`, `SESSION_SECRET` (32 characters or more), `DASHBOARD_URL` and `OWNER_IDS`. In the Fluxer application settings, add `<DASHBOARD_URL>/auth/callback` as a redirect URI.

```sh
docker compose up -d --build
```

The dashboard listens on `127.0.0.1:3000`. Put a reverse proxy with TLS in front of it and point `DASHBOARD_URL` at the public address.

Backups run every day at `BACKUP_TIME` (UTC) into `./backups` and are kept for `BACKUP_KEEP_DAYS` days. If a public GPG key (`*.asc`) is in `./backup-key`, backups are encrypted with it. To restore:

```sh
gpg --decrypt backups/maxwell-<date>.dump.gpg | docker compose exec -T postgres pg_restore --clean -U maxwell -d maxwell
```

Stop the bot before restoring (`docker compose stop bot`).

Run one bot per database. A second bot started against the same database waits until the first one stops.

## Self-hosting without Docker

With your own Postgres 18 and Node 24:

```sh
npx pnpm@12.14.0 install --frozen-lockfile
npx pnpm@12.14.0 build
pm2 start ecosystem.config.cjs
```

## Development

```sh
npx pnpm@12.14.0 install
npx pnpm@12.14.0 db
npx pnpm@12.14.0 dev
npx pnpm@12.14.0 --filter @maxwell/dashboard dev
```

`pnpm db` starts a local Postgres from `compose.dev.yaml`. Integration tests need `TEST_DATABASE_URL` pointing at a separate database, for example `postgres://maxwell:maxwell@127.0.0.1:5432/maxwell_test`. Create it once with `docker compose -f compose.dev.yaml exec postgres createdb -U maxwell maxwell_test`.
