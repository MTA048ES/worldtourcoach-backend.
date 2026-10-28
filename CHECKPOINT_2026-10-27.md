# CHECKPOINT — 27/10/2026

> Estado al cerrar la sesión. Retomar por el apartado **1**.
> Regla vigente: no imprimir claves, no dropear el stash, no mergear
> `freebuff-prueba` completo sobre `main`.

---

## 1. Cómo retomar mañana

```powershell
cd "C:\Users\mtroy\Desktop\worldtourcoach-backend.-main"
git status
npm test          # debe dar 68/68
```

Luego seguir el plan del apartado **6** (P0).

---

## 2. Estado del repositorio (verificado hoy)

| Línea | HEAD | vs origin | Tests | Notas |
|---|---|---|---|---|
| `main` | `40338ae` | sincronizada | 68/68 ✅ | producción, seguridad, `/api/app`, `lib/` |
| `freebuff-prueba` | `83537f2` | sincronizada | 130/130 ✅ | V10; **borra `lib/` y `test/`**, sin seguridad |
| `refs/stash` | `d4c89f6` | — | ~207 checks ✅ | **el trabajo más nuevo**, no está en ninguna rama |

- Base común: `fee4407`.
- `main` tiene 4 commits que freebuff no tiene (`f47d575`, `3f774ef`, `e3fd235`, `40338ae`).
- freebuff tiene 5 que main no tiene (`a69746a`, `e2b5074`, `4b41af0`, `ba9e4c4`, `83537f2`).
- `CHECKPOINT_V10.md` está desactualizado (hashes inexistentes, "ahead by 2" falso).
- Worktrees temporales aún en `C:\Users\mtroy\AppData\Local\Temp\opencode\wtc-freebuff` y `wtc-stash`.
  Se pueden borrar con `git worktree remove --force`, **sin tocar el stash**.

---

## 3. Cambios hechos HOY (autorizados por el usuario)

Sin commit todavía. `git status` → 3 modificados + 1 nuevo:

| Archivo | Cambio |
|---|---|
| `index.js` | Usa `SUPABASE_SECRET_KEY` y cae a `SUPABASE_ANON_KEY`. Aviso si falta la secret key. |
| `garmin_to_supabase.py` | Misma prioridad de claves. Nuevo `_supabase_headers()`: `Authorization: Bearer` solo si la clave empieza por `eyJ` (las `sb_*` no son JWT y daban 401). |
| `.github/workflows/garmin-sync.yml` | Pasa `SUPABASE_SECRET_KEY` desde secrets (fallback a la anon). |
| `aplicar_rls_supabase.sql` | **Nuevo.** Revoca `anon`/`authenticated`, activa RLS, grants a `service_role`, permisos por defecto para tablas futuras, verificación, rollback y plantilla. |

Verificación: `node --check index.js` OK · `python -m py_compile` OK · `npm test` **68/68**.
Los tests de Python no se pudieron ejecutar (faltan `garminconnect`/`dotenv` en local). No bloqueante.

---

## 4. Hallazgos de seguridad (sin valores)

1. `docs/STABILITY_AUDIT.md:67` contiene la **URL y la publishable key reales**. Commiteada desde `db6665b` (06/08/2026): borrarla del HEAD no la quita del historial.
2. `crear_tablas_actividades_segmentos.sql` desactiva RLS a propósito ("el bot escribe con anon key").
3. La clave quedó visible sin enmascarar en una salida de herramienta de esta sesión → **tratarla como comprometida**.
4. `main`: `/api/estado`, `/api/comando`, `/api/config` sin auth y CORS `*` (solo `/api/app` tiene token).
5. `bootstrap-session.yml` acepta tokens Garmin en base64 y los sube como artifact.

---

## 5. Datos de Supabase (verificados en docs oficiales)

- **30/10/2026 (en 3 días)**: las tablas **nuevas** de `public` dejan de exponerse automáticamente a la Data API, también en proyectos existentes. Las actuales no se rompen. Error típico: `42501 permission denied for table`.
- Publishable key = pública, limitada por RLS. Secret key (`sb_secret_...`) = backend, **salta RLS**, bloqueada en navegador.
- Las claves legacy `anon`/`service_role` se deprecan a finales de 2026.
- Claude/ChatGPT pueden conectarse por el **MCP oficial** (`mcp.supabase.com/mcp`, OAuth). Usa la Management API, **no** la anon key: RLS y rotación no le afectan. Solo entra si el usuario lo autoriza.
- Desde 06/10/2026 hay PATs acotados (permisos + caducidad) para dar acceso a agentes.
- Cambio de ciphers TLS: 10/11/2026. No afecta a este proyecto.

---

## 6. Plan pendiente, en orden

### P0 — mañana (seguridad)

1. Crear **secret key** en Supabase → `Settings → API Keys`.
2. Poner `SUPABASE_SECRET_KEY` en el hosting (Railway/Render).
3. Poner el secret `SUPABASE_SECRET_KEY` en GitHub Actions.
4. Redesplegar y comprobar: arranque del bot + un `/sync` o workflow manual.
5. Ejecutar `aplicar_rls_supabase.sql` en el SQL Editor (bloques 0→4).
6. Rotar/desactivar la publishable key vieja.
7. Quitar la clave de `docs/STABILITY_AUDIT.md` y añadir `.env` al `.gitignore`.
8. Prueba de fuego: con la publishable key, `curl` debe dar `42501`; con la secret key, filas.

### P1 — rescatar trabajo

9. `git branch rescate-v10 refs/stash` + recuperar untracked (`consecuencias.js`, `contextoAtleta.js`, `sustitucionConversacional.js`, `mcp/`, `cron-plan-diario.yml`, `PROJECT_MAP.md`).
10. Integrar V10 **por partes sobre `main`** (`seguridad.js`, `trainingNeed`, `substitutionEngine`, `persistenciaPlan`). **No** mergear freebuff completo: regresaría seguridad y borraría `lib/`/`test/`.
11. Commitear `docs/MODULAR_PLAN.md` y `docs/REVISION_API_APP.md` como checkpoints.

### P2 — higiene

12. `.gitignore`: `backup_actividades_*.json`, `models.json`, `cambios.patch`, `__pycache__/`, `_chk*.js`, `pc_validate.json`, `index.js.bak_*`.
13. Borrar `REVIEW.js` y `fix_end.js` (muertos). Revisar `reimportar_actividades.sql` (sin trackear).
14. Limpiar worktrees temporales.

### P3 — bugs conocidos

15. `/api/app`: errores de dominio → HTTP 500 con `error.message`; `validCoordinate` acepta `null`/`''` como 0; `start_date_local` en columna `timestamptz`; N+1 en efforts/sync; sin watermark.
16. `generateWorkout(state, …)` lee `state.nutricion.*` pero recibe el estado fisiológico → macros siempre en defaults (300/120/60/"2L base").

---

## 7. Decisiones tomadas

- El bot y el sync de Garmin pasan a **secret key**; RLS se cierra para `anon`.
- El SQL deja grants automáticos **solo a `service_role`** para tablas futuras. Si se prefiere el modelo estricto, comentar esos dos bloques y usar la plantilla del final del SQL.
- No se toca `crear_tablas_actividades_segmentos.sql` (ya aplicado); su nota de seguridad queda obsoleta tras ejecutar el nuevo SQL.
- La app móvil sigue sin acceso directo a Supabase: pasa por `/api/app`.

---

## 8. Pendiente de verificar (requiere dashboard, no se hizo)

- Si las tablas del V10 (`plan_previsto_diario`, `registro_sustituciones`) existen ya.
- Estado real de RLS en el proyecto (el bloque 0 del SQL lo muestra).
- Si hay PATs u OAuth apps autorizadas en la cuenta de Supabase (revisar y revocar lo desconocido).
- Variables de entorno reales en Railway/Render.

---

## 9. Archivos clave

- `index.js` — backend monolítico (~7.400 líneas).
- `lib/security.js`, `lib/appApiRouter.js` — seguridad solo en `main`.
- `garmin_to_supabase.py` — sync Garmin (claves y headers tocados hoy).
- `aplicar_rls_supabase.sql` — **nuevo**, cierre de acceso público.
- `docs/STABILITY_AUDIT.md:67` — clave expuesta.
- `docs/MODULAR_PLAN.md`, `docs/REVISION_API_APP.md` — análisis sin commitear.
- `refs/stash` `d4c89f6` — trabajo más nuevo.
