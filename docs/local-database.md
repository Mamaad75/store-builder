# Inspecting the local database (Prisma Studio, DBeaver)

For local development only. Nothing here changes the schema, adds a migration, adds an application dependency or touches deployment.

## Prisma Studio (already part of the project, via the `prisma` dev dependency)

Run it from the **repository root** (the folder that contains `package.json` and `prisma/`):

```bash
pnpm db:studio
```

Open **http://localhost:5555**. Stop it with `Ctrl+C`. A different port: `pnpm db:studio -- --port 5556`.

`pnpm db:studio` runs `scripts/db-studio.mjs`, which wraps `prisma studio` with these guards:

* It reads `DATABASE_URL` from the environment, then `.env.local`, then `.env` (the Prisma CLI itself reads only `.env`, so `.env.local` alone also works here). The password is never printed.
* It **refuses to start** unless the database host is `localhost`, `127.0.0.1` or `::1`, so a staging or production URL can never be opened by mistake. It also refuses when `NODE_ENV=production`.
* It always binds to `127.0.0.1` (the loopback interface). The host cannot be changed from the command line; `--hostname` is rejected. Only `--port` and `--browser` are accepted. (Verified: the socket listens on 127.0.0.1 only and the machine's other addresses refuse the connection.)

Prerequisite: the local PostgreSQL must be running (`pnpm db:up`, i.e. `docker compose up -d`) and migrated (`pnpm db:deploy`).

### Browse, inspect, edit

* The left list shows every table (model). Click one to see its rows; the toolbar filters, sorts, picks columns and pages through results.
* Click a relation cell (for example `store` on a `Product`) to jump to the related record; list relations (for example `products` on a `Store`) show a count that opens the related rows.
* To edit local test data, double-click a cell, change it and press **Save changes**; **Add record** inserts a row; the row menu deletes. Studio sends ordinary SQL, so database rules still apply: immutability triggers refuse any update of `StoreVersion`, `StoreVersionProduct` and `PublishedSlug`, deleting a version directly is refused, and `Domain` identity fields cannot be edited. That is expected, not a Studio problem.
* Edit only throw-away local data. Studio bypasses the application's rules (ownership checks, `draftRevision`, rate limits), so rows you create by hand can be inconsistent; reset with `pnpm db:reset` when in doubt.

### Understanding the schema and relationships

* Studio shows the columns and the relations of each model, but **it has no diagram view**: it cannot draw an entity-relationship picture, show indexes, CHECK constraints, triggers or functions.
* For the structure use the source of truth: `prisma/schema.prisma` (models and relations) and `prisma/migrations/*/migration.sql` (indexes, constraints and triggers, for example `20261112090000_phase10_publishing`).
* For a visual diagram and a read-only look at triggers and constraints use a general SQL GUI. Recommended: **DBeaver Community** (free). Install it on your machine only; nothing is added to the project.
  1. New connection → PostgreSQL. Host `localhost`, port `5432`, database `storebuilder`, user `storebuilder`, password `storebuilder` (the local docker-compose values from `.env.example`; never reuse them anywhere else).
  2. Open the database → Schemas → `public` → right-click **Tables** → **View diagram** (or select tables → **ER Diagram**) for the relationship picture.
  3. A table's **Properties** tab lists constraints and indexes; **Triggers** is under the table node. Prefer the *Read-only connection* option (connection settings → General) when you only want to look.
* Never connect any GUI to staging or production with these credentials; connect to those environments only through the approved access path when they exist.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `refused to start: DATABASE_URL is not set` | Copy `.env.example` to `.env.local` (or export `DATABASE_URL`). |
| `points at '<host>', not at this machine` | By design. Use the local database URL. |
| Studio cannot connect | `pnpm db:up`, then `docker compose ps`; check the port in `DATABASE_URL`. |
| Port 5555 in use | `pnpm db:studio -- --port 5556`. |
| Empty list of tables | Run `pnpm db:deploy` (migrations). |
