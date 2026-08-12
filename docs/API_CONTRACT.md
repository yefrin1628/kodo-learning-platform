# Kodo API — contrato (v1, en construcción)

Qué endpoint consume cada parte del frontend. Se actualiza en cada bloque que conectemos — no es spec completa de antemano, es el mapa real de lo que ya existe.

Base URL (dev): `http://localhost:4000`. Todos los endpoints marcados 🔒 requieren `Authorization: Bearer <accessToken>`.

## Auth — `apps/api/src/auth`

| Endpoint | Consume en frontend | Notas |
|---|---|---|
| `POST /auth/register` | `doRegister()` (vista `vAuth`, modo registro) | Body: `{email,password,displayName,username}`. `username` se genera automático desde el nombre (no hay campo visible nuevo), reintenta con sufijo si 409. Devuelve `{user:{id,email,profile},accessToken,refreshToken}`. |
| `POST /auth/login` | `doLogin()` (vista `vAuth`, modo login) | Body: `{email,password}`. Misma forma de respuesta que register. |
| `POST /auth/refresh` | `bootAuth()` al cargar la página | Body: `{refreshToken}`. Rota el refresh token — el nuevo reemplaza al viejo en `localStorage`. |
| `POST /auth/logout` | `doLogout()` | Body: `{refreshToken}`. Revoca el token en servidor. |
| `GET /me` 🔒 | `bootAuth()`, `syncUserFromServer()` | Devuelve `{id,email,userProfile,userStats,streak}`. Fuente de verdad para XP/nivel/gemas/corazones/racha tras login. |

## Cursos y lecciones — `apps/api/src/courses`, `apps/api/src/lessons`

| Endpoint | Consume en frontend | Notas |
|---|---|---|
| `GET /courses` | `hydrateCoursesFromApi()` (tras register/login/bootAuth) | Lista los 7 cursos publicados con conteo de unidades/lecciones. |
| `GET /courses/:slug` | `hydrateCoursesFromApi()` | Curso + unidades + lecciones (sin ejercicios). Se llama una vez por curso tras `GET /courses`. `adaptApiCourse()` convierte la respuesta a la forma legacy de `COURSES` (mismos ids/keys de siempre). |
| `GET /courses/:slug/lessons` | *(pendiente)* | Lista plana de lecciones de un curso, con su unidad. |
| `GET /lessons/:key` | `hydrateLessonFromApi(key)` (dentro de `openLesson()`) | Lección completa: intro + ejercicios + opciones. `key` es el mismo id que ya usa el frontend (`js-1`, `html-p1`, etc.). `adaptApiLesson()`/`adaptApiExercise()` reconstruyen la forma legacy de `LESSONS[key]` para los 13 tipos de ejercicio; fallback silencioso al contenido local si falla. |

## Motor de aprendizaje — `apps/api/src/learning`

| Endpoint | Consume en frontend | Notas |
|---|---|---|
| `POST /learning/exercises/:exerciseId/answer` 🔒 | `lsCheck()` / `matchDone()` / `resolveLang()`, vía `answerPayloadFor()` | Body varía por tipo: `selectedIndex` (choice/tf/fill/bug/listen/predict/convo), `text` (type/translate/order), `code` (run), `pairs` (match), `{}` (speak). Solo se llama cuando el ejercicio actual tiene `id` real (viene de `GET /lessons/:key`); si no, o si falla la llamada, se evalúa localmente igual que antes. El servidor decide correcto/incorrecto, XP y corazones — el cliente nunca envía esos valores. |
| `POST /learning/lessons/:key/complete` 🔒 | *(pendiente)* | Exige haber respondido todos los ejercicios y la lección anterior completada. Devuelve `{success,lesson,rewards,stats,courseProgress,achievementsUnlocked,challengesCompleted}`. |

## Ranking — `apps/api/src/ranking`

| Endpoint | Consume en frontend | Notas |
|---|---|---|
| `GET /ranking?period=weekly\|monthly\|allTime` 🔒 | *(pendiente: paso "Ranking")* | Default `weekly`. Devuelve `{period,entries:[...],me:{rank,xp}}`. `me` siempre presente aunque esté fuera del top 20. |

## Qué controla cada lado

- **Backend (fuente de verdad):** XP, nivel, progreso de curso/lección/ejercicio, corazones, racha, SRS, logros, challenges, ranking.
- **Frontend (experiencia):** animaciones, confeti, sonidos, mascota, transiciones, feedback visual, barras de progreso — todo eso sigue local y no cambia.

## Estado de la migración

- ✅ Auth conectado.
- ✅ Catálogo de cursos conectado: `COURSES` (curso→unidad→claves de lección) viene de Postgres.
- ✅ Carga de lecciones conectada: al abrir una lección, `LESSONS[clave]` se sobrescribe con el contenido real (intro + ejercicios) de `GET /lessons/:key`.
- ✅ Progreso de ejercicios conectado (este bloque): responder cualquiera de los 13 tipos de ejercicio se valida en `POST /learning/exercises/:exerciseId/answer` — XP, corazones y SRS ahora los decide el servidor. Completar una lección (`POST /learning/lessons/:key/complete`) todavía NO está conectado a propósito: el bonus de fin de lección (gemas, XP de módulo/curso, racha) sigue siendo local, así que el XP total local va temporalmente por delante del ledger del servidor hasta el siguiente bloque. Por la misma razón, el multiplicador x2 de XP (Pro/impulso) no aplica todavía sobre respuestas validadas por el servidor.
- ⏳ Dashboard 100%, completar lección, logros, challenges, ranking: siguen leyendo/escribiendo `localStorage` hasta que se conecten uno por uno.
