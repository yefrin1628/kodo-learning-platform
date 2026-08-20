# Despliegue y migraciones de producción

Kodo separa **deploy de la aplicación** de **migraciones de base de datos** — un deploy nunca deja la API corriendo contra un esquema desactualizado o roto.

## El flujo

```text
Push a main
   ↓
GitHub Actions (.github/workflows/migrate-and-deploy.yml)
   ↓
prisma migrate deploy (contra Neon producción, conexión directa)
   ↓
¿Migración correcta?
   ├── ❌ → el workflow falla, NO se dispara el deploy de la API
   └── ✅ → llama al Deploy Hook de Vercel → despliega la API
```

El **frontend** (`kodo-learning-platform` en Vercel) sigue con su deploy automático normal por push a Git — no depende de la base de datos, no hay razón para bloquearlo.

La **API** (`kodo-learning-platform-api` en Vercel) tiene el **auto-deploy por Git desactivado** para `main`, vía `git.deploymentEnabled` en `apps/api/vercel.json`:

```json
"git": {
  "deploymentEnabled": {
    "main": false
  }
}
```

Verificado contra la documentación oficial de Vercel antes de aplicarlo: esta es la opción **no deprecada** (reemplaza a `github.enabled`, que si está en `false` sí bloquea también los Deploy Hooks — por eso NO se usa esa). `git.deploymentEnabled` solo desactiva el auto-deploy por push; los Deploy Hooks siguen funcionando sin restricción.

Confirmado con un push de prueba real a `main` (commit `4f907ce`, el mismo que introdujo esta configuración): el deployment resultante en el dashboard de Vercel muestra **Source: Deploy Hook** (no Git) y quedó como el deployment vigente de Production — es decir, no hubo un segundo deploy automático disparado directamente por el push. `git.deploymentEnabled` funciona como se esperaba en este proyecto.

Con esto, la API solo se despliega cuando este workflow llama a su Deploy Hook, y solo después de que la migración haya sido aplicada con éxito.

## Por qué `directUrl` en el schema

Neon (el Postgres de producción, provisto vía la integración nativa de Storage de Vercel) expone dos formas de conexión:

- `DATABASE_URL` — conexión **pooled** (a través de PgBouncer), la que usa la API en runtime para las consultas normales.
- `DATABASE_URL_UNPOOLED` — conexión **directa**, sin pooler.

`prisma migrate deploy` necesita la conexión directa — el modo transacción de PgBouncer no soporta de forma confiable los patrones DDL/prepared-statement que usan las migraciones. Por eso `packages/database/prisma/schema.prisma` declara:

```prisma
datasource db {
  url       = env("DATABASE_URL")           // runtime, pooled
  directUrl = env("DATABASE_URL_UNPOOLED")  // solo migrate/db push
}
```

Prisma usa `directUrl` automáticamente para comandos `migrate`/`db push`, y `url` para todo lo demás (el cliente generado que usa la API). En local, ambas variables apuntan a la misma base — no hay pooler en desarrollo.

## Secrets requeridos (nunca en el repo, nunca en el chat)

Configurados en GitHub → Settings → Secrets and variables → Actions:

| Secret | De dónde sale | Para qué |
|---|---|---|
| `DATABASE_URL_UNPOOLED` | Vercel → `kodo-learning-platform-api` → Environment Variables → revelar valor | Conexión directa para `prisma migrate deploy` |
| `VERCEL_API_DEPLOY_HOOK` | Vercel → `kodo-learning-platform-api` → Settings → Git → Deploy Hooks → crear uno | Dispara el deploy de la API tras una migración exitosa |

Ambos son secretos reales de producción — quien los tenga puede escribir en la base de datos real o disparar un deploy. Solo deben vivir como GitHub Secrets, nunca en `.env` commiteado, nunca pegados en una conversación de chat/IA, nunca en logs.

## Agregar una migración nueva

1. Cambia `packages/database/prisma/schema.prisma`.
2. `npx prisma migrate dev --name algo_descriptivo` (local, contra `kodo_dev`) — esto crea el archivo SQL en `prisma/migrations/` y lo prueba localmente.
3. Prueba el cambio completo en local (API + frontend) antes de commitear — ver la regla de paridad dev/prod del proyecto.
4. Commit + push a `main`. El workflow se encarga del resto: migra producción, y si sale bien, despliega la API automáticamente.
