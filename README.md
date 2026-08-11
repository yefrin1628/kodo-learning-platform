# Kodo

Kodo es una plataforma de aprendizaje gamificada para aprender programación e idiomas.

La experiencia combina:

- Programación con una metodología práctica inspirada en plataformas como Mimo.
- Idiomas con una experiencia gamificada inspirada en Duolingo.
- XP
- Rachas
- Corazones
- Niveles
- Logros
- SRS (repetición espaciada)
- Cursos y lecciones
- Progreso personalizado

## Stack

### Frontend
- HTML/CSS/JavaScript actualmente (`index.html`, SPA autocontenida)
- Próxima evolución: Next.js

### Backend
- NestJS
- TypeScript
- Prisma
- PostgreSQL

### Monorepo
- pnpm

## Estructura

```
apps/
  api/            # NestJS — API real (auth, cursos, progreso...)

packages/
  database/       # Prisma schema, migraciones, cliente compartido

index.html        # Prototipo SPA actual (localStorage) — en migración
index_backup_*.html  # Snapshots de fases anteriores (ignorados por git)

package.json
pnpm-workspace.yaml
pnpm-lock.yaml
```

## Requisitos previos

- Node.js 20+
- pnpm (`npm i -g pnpm`)
- PostgreSQL 16 corriendo localmente (o accesible por red)

## Desarrollo

Instalar dependencias:

```bash
pnpm install
```

### Base de datos

Kodo usa una base de datos y un rol de PostgreSQL **dedicados**, aislados de cualquier otra base que ya tengas en tu Postgres local.

1. Crea el rol y la base (una sola vez, con un superusuario):

   ```sql
   CREATE ROLE kodo_dev WITH LOGIN PASSWORD 'tu_password_local';
   ALTER ROLE kodo_dev CREATEDB; -- necesario para el shadow DB de Prisma Migrate
   CREATE DATABASE kodo_dev OWNER kodo_dev;
   ```

2. Copia las plantillas de entorno y completa `DATABASE_URL`:

   ```bash
   cp packages/database/.env.example packages/database/.env
   cp apps/api/.env.example apps/api/.env
   ```

   ```
   DATABASE_URL="postgresql://kodo_dev:tu_password_local@127.0.0.1:5432/kodo_dev?schema=public"
   ```

3. Aplica las migraciones y genera el cliente:

   ```bash
   pnpm db:migrate
   pnpm db:generate
   ```

Las variables sensibles deben mantenerse en `.env` y **nunca** deben subirse a Git (ya están en `.gitignore`).

### Levantar la API

```bash
pnpm dev:api
```

La API queda disponible en:

```
http://localhost:4000
```

## Autenticación

Actualmente implementada en `apps/api`:

- Registro (`POST /auth/register`)
- Login (`POST /auth/login`)
- Access token (JWT de corta duración)
- Refresh token con rotación y revocación (`POST /auth/refresh`, `POST /auth/logout`)
- Perfil autenticado (`GET /me`)

Contraseñas con `bcrypt` (nunca en texto plano). Refresh tokens de alta entropía, guardados hasheados en la base de datos.

## Estado del proyecto

```
Kodo
├── PostgreSQL              ✅
├── Prisma                  ✅
├── NestJS API               ✅
├── Auth real                ✅
├── Git + GitHub             ✅
├── Usuarios (modelo)        ⏳
├── Cursos/Unidades/Lecciones ⏳
├── Progreso                 ⏳
├── XP / rachas / logros server-side ⏳
├── SRS en backend           ⏳
├── Frontend conectado       ⏳
└── Kodo Pro / pagos         ⏳
```
