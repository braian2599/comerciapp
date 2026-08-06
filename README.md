# Comerciapp

Gestor de ventas para comercios (POS, inventario, clientes, reportes). Next.js 16 + Prisma + PostgreSQL + NextAuth.

## Deploy en Vercel

### 1. Variables de entorno (Project Settings → Environment Variables)

Configurar estas 4 variables para **Production**, **Preview** y **Development**:

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | URL pooled de Neon (con `-pooler` en hostname). Ej: `postgresql://...?sslmode=require&pgbouncer=true&connect_timeout=15` |
| `DIRECT_DATABASE_URL` | URL directa de Neon (sin `-pooler`). Usada solo para migraciones. |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | URL pública de la app (ej: `https://comerciapp.vercel.app`) |
| `SEED_TOKEN` | (Opcional) `openssl rand -hex 32`. Si se setea, habilita `/api/seed` en producción. |

### 2. Base de datos (Neon)

- Crear proyecto en https://neon.tech
- Copiar **Pooled connection** → `DATABASE_URL`
- Copiar **Direct connection** → `DIRECT_DATABASE_URL`
- Ejecutar migraciones locales con `DIRECT_DATABASE_URL` antes del primer deploy:
  ```bash
  npx prisma migrate deploy
  ```

### 3. Deploy

- Importar repo en https://vercel.com/new
- Vercel detecta Next.js automáticamente.
- Build command: `npm run build` (incluye `prisma generate`).
- Output: `.next/`
- Región: `sfo1` (configurable en `vercel.json`)

### 4. Post-deploy

- Crear tienda demo (opcional):
  ```bash
  curl -X POST https://TU-DOMINIO.vercel.app/api/seed \
       -H "x-seed-token: $SEED_TOKEN"
  ```

## Desarrollo local

```bash
npm install
cp .env.example .env  # completar valores
npx prisma migrate dev
npx prisma db seed   # opcional: crear tienda demo en dev
npm run dev
```

## Scripts

| Script | Acción |
|---|---|
| `npm run dev` | Servidor de desarrollo en http://localhost:3000 |
| `npm run build` | `prisma generate` + `next build` |
| `npm run start` | Servidor de producción local |
| `npm run db:push` | Sincroniza schema a DB (sin migraciones) |
| `npm run db:migrate` | Crea y aplica migración nueva |
| `npm run db:migrate:deploy` | Aplica migraciones pendientes (producción) |
| `npm run db:studio` | Abre Prisma Studio |
