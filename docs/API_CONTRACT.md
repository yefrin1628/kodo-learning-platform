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
| `GET /me` 🔒 | `bootAuth()`, `doLogin()`, `doRegister()`, `go('profile')` → `syncUserFromServer()` | Devuelve `{id,email,userProfile,userStats,streak,courseProgress,lessonProgress,xpToday,xpWeek,exercisesAnswered,exercisesToday,accuracy,achievements,challengesClaimedToday}`. `courseProgress`/`lessonProgress` (solo lecciones `completed:true`, con `lesson.key`) son lo que `syncUserFromServer()` usa para reconstruir `U.done` por completo — así `isUnlocked()`/`coursePct()`/`getNext()` ven el progreso real en cualquier dispositivo, no solo en el navegador donde se completó; también se usa para reconstruir `U.day.lessons`/`U.day.perfect` (lecciones/perfectas de hoy). `xpToday`/`xpWeek`/`exercisesToday` son sumas/conteos en vivo (mismo criterio que `ranking.service.ts` y `challenges.service.ts`'s `measure()`), nunca un contador que el cliente incremente por su cuenta. `exercisesAnswered`/`accuracy` vienen de un `aggregate` sobre `ExerciseProgress` (histórico, no solo hoy). `achievements` solo trae `achievement.key` por cada `UserAchievement`; `challengesClaimedToday` solo la `challenge.key` de cada `UserChallengeProgress` reclamado hoy — ambos catálogos completos (nombre/icono/descripción) ya viven local (`ACHS`/`CHALLENGES`), seeded del mismo contenido, así que no viajan dos veces. `go('profile')` pide `/me` fresco cada vez que se entra al perfil, no solo en login. |

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
| `POST /learning/lessons/:key/complete` 🔒 | `lsFinish()` → `applyLessonCompletion()` | Exige haber respondido todos los ejercicios y la lección anterior completada (400/403 si no). Devuelve `{success,lesson,rewards:{xp,gems},stats:{xp,level,streak},courseProgress,achievementsUnlocked,challengesCompleted}`. `U.xp`/`U.streak` se fijan de forma absoluta desde `stats` (nunca se incrementan localmente) — así el bonus de lección jamás puede volver a pagar el XP que ya se pagó por ejercicio individual. Si falla, no se inventa recompensa local: `LS.completeError` se muestra con botón "Reintentar" (`retryCompleteLesson()`). `achievementsUnlocked` (25 condiciones reales en `achievements.service.ts`) ya no se descarta: `applyServerAchievements()` actualiza `U.ach` y encola el modal de celebración (icono/nombre/descripción/XP) por cada logro nuevo. `challengesCompleted` (4 condiciones reales en `challenges.service.ts`) tampoco: `applyServerChallenges()` marca `U.day.claimed` y muestra el mismo toast que el `checkChallenges()` local ya usaba — el servidor decide qué se desbloqueó en ambos casos, el cliente solo lo muestra y nunca vuelve a otorgar el XP/gemas ya incluidos en `rewards`. |

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
- ✅ Progreso de ejercicios conectado: responder cualquiera de los 13 tipos de ejercicio se valida en `POST /learning/exercises/:exerciseId/answer` — XP, corazones y SRS los decide el servidor. El multiplicador x2 de XP (Pro/impulso) no aplica todavía sobre respuestas validadas por el servidor (suscripciones no está conectado).
- ✅ Completar lección conectada: `POST /learning/lessons/:key/complete` paga el bonus de fin de lección, gemas, racha, XP de módulo/curso y logros/challenges — todo server-side. El núcleo de aprendizaje (cursos → lecciones → ejercicios → completar lección) ya corre realmente contra Postgres, no solo la interfaz.
- ✅ Dashboard 100% servidor conectado: `U.done` (desbloqueos, % por curso, "Continúa en...") y el XP diario/semanal ya no dependen de `localStorage` — se reconstruyen desde `GET /me` en cada login/reload. Corregidos dos bugs reales: login/registro no traían el `/me` completo (un dispositivo nuevo veía todo bloqueado pese al progreso real), y `rollover()` podía resetear la racha localmente incluso después de que el servidor ya hubiera confirmado el valor correcto.
- ✅ Perfil + estadísticas conectado: ejercicios respondidos, precisión, cursos iniciados/completados, logros desbloqueados y actividad reciente en `vProfile()` leen todos de `GET /me` — `U.ach` ya no es estado local, es la lista real de `UserAchievement`. `U.code.xp`/`U.lang.xp`/`U.code.seconds`/`U.lang.seconds`/`U.lang.words` siguen local a propósito (sin agregado server-side de XP por categoría ni de tiempo estudiado; palabras es del bloque SRS/vocabulario).
- ✅ Logros reales conectado: el evento de desbloqueo en vivo (`achievementsUnlocked` de `POST /learning/lessons/:key/complete`) ya dispara el modal de celebración con datos del servidor, no de `checkAch()` local. `checkAch()` sigue activo solo para triggers sin equivalente server-side todavía (correr código en el editor, modo práctica/repaso) — ambos sistemas escriben en el mismo `U.ach`, así que no hay duplicados.
- ✅ Challenges reales conectado (este bloque): de los 4 challenges del backend, 2 (`ch-lessons3`/`ch-xp100`) ya tenían equivalente local (`ch-l3`/`ch-xp`, distinto key) y ahora dependen de `challengesCompleted`; los otros 2 (`ch-exercises20`, `ch-streak`) no existían en el widget local y se agregaron. Los 2 challenges sin representación server-side (`ch-perf`, `ch-code`) siguen resolviéndose y pagándose en el cliente vía `checkChallenges()`, que ahora ignora los 4 server-backed. `U.day.lessons`/`U.day.perfect`/`U.day.ex` se reconstruyen desde `GET /me` para que las barras de progreso no arranquen en 0 en un dispositivo nuevo.
- ⏳ Ranking, SRS/vocabulario, shop/compras (los "shields" de racha comprados en la tienda quedaron sin efecto — no hay concepto de shield en el backend todavía): siguen con su propia capa local hasta que se conecten uno por uno.
