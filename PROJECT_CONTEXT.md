# 🤖 PROJECT CONTEXT — WORLD TOUR COACH v9.5 (contexto para agentes IA)

> **Propósito:** contexto técnico compacto para sesiones de Freebuff. Leer PRIMERO en cada tarea.
> **Última revisión:** 05/09/2026 (auditoría documental contra HEAD `97f5fc5`). Lo marcado ✅ está verificado contra el código: F2 (gate + Training Need + Substitution Engine) **conectado al pipeline**, P1/P2 (persistencia + orquestación), **P2B (plan previsto diario: generación + lazy-ensure)** y **F2 indoor/calor** implementados y verificados — **130/130 tests verdes (11 suites)**. Rama `freebuff-prueba` **ahead de origin por 2 commits** (`f4e8048`, `97f5fc5`).
> **Nota:** este archivo es para agentes. La documentación humana/oficial vive en `docs/PROJECT_CONTEXT.md` y `PROJECT_MAP.md`. El estado de la v10 vive en `CHECKPOINT_V10.md` (actualizado con la auditoría P2B).

---

## 1. IDENTIDAD DEL PROYECTO

- **WORLD TOUR COACH v9.5**: entrenador personal de ciclismo con IA vía bot de Telegram, para un atleta Master 40+ (Manu). Backend puro (sin frontend).
- **Stack** ✅: Node.js 22 (`.nvmrc`), Express 4, `@supabase/supabase-js`, `dotenv`, `cors`, `node-fetch@2`, `form-data`. Sin framework de tests. `package.json` sin script `test` (version dice 9.3.0 vs banner v9.5 — discrepancia cosmética, por verificar).
- **Integraciones** ✅: Telegram Bot API (webhook, no polling), Supabase (persistencia), Garmin (scripts Python `garmin_to_supabase.py` / `sync_garmin.py`), Intervals.icu (CTL/ATL/TSB), clima con Heat Index (proveedor exacto: por verificar). **Despliegue real: Render** (proceso Node persistente; `RENDER_EXTERNAL_URL` en index.js:8513). `railway.json` es configuración heredada NO vigente.

## 2. ARQUITECTURA ACTUAL

- **`index.js` (~8.603 líneas) es un monolito** ✅: servidor Express + bot Telegram + cerebro del entrenador + cliente Supabase + clima + chat IA, todo en un archivo. Punto de entrada único (`app.listen` al final, línea 8556). ⚠️ **El archivo está en CRLF** (salto de línea Windows); los tests que extraen patrones multi-línea del fuente deben normalizar a LF.
- ⚠️ **Consecuencia crítica: `index.js` NO es importable** (arranca el servidor al hacer `require`). Los tests no pueden requerirlo; ver §9.
- **Módulos auxiliares** ✅ (todos con `module.exports` al final, funciones puras, sin efectos al importar):
  - `motorIntencion.js` (382 l.): contexto humano. Exporta `detectarIntencion`, `adaptarDecisionParaIntencion`, `calcularEquivalenciaEntreno`, `generarConsejoAdaptativo`, `EQUIVALENCIAS`. Requerido por `index.js`.
  - `seguridad.js`: gate final. Exporta `validarSeguridad(decision, estado, restricciones)`. Requerido por `index.js`.
  - `trainingNeed.js`: capa de diagnóstico puro. Exporta `calcularTrainingNeed` y constantes. Sin dependencias. Requerido por `index.js` (capa informativa, integrado 03/09/2026).
  - `substitutionEngine.js`: evaluador puro de sustituciones. Exporta `evaluarSustitucion` y constantes. Requiere `EQUIVALENCIAS` de `motorIntencion.js`. Requerido por `index.js` (integrado 03/09/2026, adapter `evaluarSustitucionPipeline` + orquestador `ejecutarSustitucionP2`).
  - `persistenciaPlan.js` (~297 l.): **única capa de acceso a Supabase para `plan_previsto_diario` / `registro_sustituciones`** (C7/R19). Exporta `getPlanPrevistoDia`, `getPlanesPrevistosFechas` (consulta `.in()` por fechas; usada por `analizarCumplimientoPlan`), `congelarPlanPrevisto` (upsert `ignoreDuplicates`), `getSustitucionesSemana` (COUNT real; error → null), `registrarSustitucion` (solo aceptadas, idempotente), `fechaSemanaDe`, `__setCliente`/`__resetCliente` (inyección para tests). Reglas C1–C10; NO crea tablas (C10). Requerido por `index.js` (P2/P2B y cumplimiento, 03-05/09/2026).

## 3. FLUJO PRINCIPAL DE DECISIÓN ✅ (verificado en código, líneas de sept-2026)

```
getAthleteState()  (index.js:3857)
 ├─ obtenerDatosCompletos()        (1984) → datos crudos Supabase/Intervals/Garmin
 ├─ calcularEstadoSistema(datos)   (2148) → estado {tsb, ctl, atl, acwr, readiness, heatIndex...}
 ├─ [F2 indoor] estado.indoor      (~3891) → señal rodillo/indoor (motorIntencion 'rodillo') para HI>40
 ├─ aplicarRestriccionesGlobales   (2891) → restricciones
 ├─ decidirEntrenamiento(estado, restricciones)   (2981) → decisión base
 ├─ resolverConflictos(estado, restricciones, decision, traza)  (2516) → decisión validada en seguridad
 ├─ generateWorkout(estado, restricciones, decision, traza)     (3245) → workout
 └─ return { estado, decision, restricciones, traza, workout, ... }

getAthleteStateConAjuste()  (index.js:7003)  ← usada por ~20 comandos/rutas
 ├─ state = await getAthleteState()
 ├─ intencion = motorIntencion.detectarIntencion(estado, historial)   (siempre devuelve objeto, incluso en error)
 ├─ decisionAjustada = adaptarDecisionParaIntencion(decision, intencion, estado)  (CLONA en ramas normales)
 ├─ if (!decisionAjustada.esIntencion) decisionAjustada = ajustarPlanAutomaticamente(decisionAjustada)
 │    · desde 03/09/2026: trabaja sobre COPIA, no muta la original; salidas sin ajuste devuelven el objeto recibido
 ├─ decisionAjustada = validarSeguridad(decisionAjustada, estado, restricciones)  ← GATE FINAL (seguridad.js, ~7030)
 ├─ trainingNeed = calcularTrainingNeedInformativo(decisionAjustada, state)  ← CAPA INFORMATIVA (post-gate, no muta nada, ~7036)
 ├─ planPrevistoEnsure = ensurePlanPrevistoDia({ userId: CONFIG.ATHLETE_USER_ID, fecha: formatDate(new Date()), state })  (~7045)
 │    ← P2B LAZY-ENSURE (read-or-freeze): reutiliza el state YA calculado (NUNCA re-ejecuta getAthleteState ni ConAjuste);
 │      congela el baseline PRE-INTENCIÓN (state.decision → validarSeguridad → generateWorkout → TN snapshot) solo si no existe plan;
 │      fallo Supabase → { plan:null } y /hoy continúa
 ├─ resultadoSustitucion = ejecutarSustitucionP2({ state, decisionAjustada, trainingNeed, userId, fecha })  ← SE CON PERSISTENCIA (P2, ~7055; función en 7291)
 │    · candidato: SOLO la intención detectada (decisionAjustada.esIntencion); sin candidato → sin_candidato
 │    · lecturas de persistencia (plan + contador semanal) SOLO si hay candidato; error → null (nunca se desbloquea)
 │    · sin plan congelado → sin_plan_previsto (no se evalúa ni registra; nada inventado)
 │    · si aplicada → re-gate con validarSeguridad; se registra SOLO si la revalidación mantiene la sustitución aplicable
 │    · decisionAjustada SOLO se reasigna si resultadoSustitucion.decisionFinalUsada
 └─ if (esIntencion || ajusteAutomatico) → regenerateWorkout con decisión ajustada
```

**Orden canónico real en `getAthleteStateConAjuste` (verificado, P2B-14):** `gate (validarSeguridad) → Training Need → lazy-ensure P2B → Substitution Engine (P2)`. El plan congelado es **PRE-INTENCIÓN** (decisión Manu P2B): `state.decision` tras `resolverConflictos` + gate + workout + TN snapshot; NO participan motorIntencion/ajuste automático/SE (P2B-16). El SE compara después la intención (B) contra el plan congelado (A).

Regla arquitectónica del SPEC (§10.2): **ninguna capa mutadora puede ejecutarse después de `validarSeguridad()`**. Las 5 rutas sin gate (fallbacks `catch`, `chatConIA`, `analizarCumplimientoPlan`, `GET /api/estado`, `POST /api/comando`) se declararon seguras por construcción (SPEC §0.1). Training Need es informativo (no mutador) y va post-gate; el lazy-ensure solo lee/escribe persistencia y no muta la decisión.

## 4. MÓDULOS V10

| Módulo | Qué es | Implementado | Testeado | Conectado a `index.js` |
|---|---|---|---|---|
| `seguridad.js` | Gate final de seguridad (ACWR/TSB/readiness/HRV/sueño/calor/intensidadMax/forzarZ2/forzarDescanso) | ✅ | ✅ 9/9 | ✅ Sí (gate en `getAthleteStateConAjuste` y antes de congelar el plan P2B) |
| `motorIntencion.js` | Contexto humano (grupeta/rodillo/salida tranquila/descanso). Preexistente v9.5 | ✅ | ⚠️ Indirecto (tests del gate lo usan) | ✅ Sí |
| `trainingNeed.js` | Diagnóstico puro de necesidad de entrenamiento. NO muta decisión | ✅ | ✅ 13/13 | ✅ Sí (capa informativa post-gate; adapter `calcularTrainingNeedInformativo`; TN snapshot en la congelación P2B) |
| `substitutionEngine.js` | Evaluador puro de sustituciones (±30% TSS, máx 3/semana, IF calidad ≥0.80). NO aplica seguridad (la aplica el caller) | ✅ | ✅ 10/10 | ✅ Sí (adapter `evaluarSustitucionPipeline` + orquestador `ejecutarSustitucionP2`, post-TN y post-ensure P2B) |
| `persistenciaPlan.js` | Única capa de acceso a `plan_previsto_diario` / `registro_sustituciones` (C7/R19) | ✅ | ✅ 18/18 | ✅ Sí (P2 `ejecutarSustitucionP2` + P2B `ensurePlanPrevistoDia`/`generarPlanPrevistoDia`/endpoint cron) |
| `docs/SPEC_V10_F1.md` | Spec completo V10 (arquitectura, plan previsto, jerarquía seguridad §10, decisiones §18) | ✅ validado por Manu | — | ⚠️ Revisado el 05/09/2026 para alinear encabezado/§1.2/G-1/§3.2/§3.3/§5/§6/§13/§18.1 con el estado real (commit `97f5fc5`); las decisiones §3 de CHECKPOINT_V10.md siguen siendo la autoridad |
| `CHECKPOINT_V10.md` | Punto de reanudación V10 (actualizado: F2+P1/P2+P2B verificados). **NO autoriza a modificar código por sí solo** | — | — | — |

Pendiente V10 (confirmado en checkpoint): **tablas Supabase** (`plan_previsto_diario`, `registro_sustituciones` — tarea de Manu, C10), **`CRON_SECRET` en el entorno**, **decisión de scheduler** (cron externo listo vía endpoint `POST /api/cron/plan-diario`; `setInterval` interno por implementar), `aplicarConsecuencias` (§8), disparador conversacional "no me apetece" (§7.3.a, preparado pero sin implementar). Sin tablas, el SE queda en `dependencia_persistencia`.

## 5. TESTS

**Estilo** ✅: scripts Node planos con `assert` nativo (sin framework, no hay ninguno instalado). Helper `test(nombre, fn)` con contadores y `process.exit(fallados > 0 ? 1 : 0)`. Se ejecutan desde la raíz: `node tests/test_X.js`. **Batería completa: 130/130 verdes (05/09/2026, 11 suites).** ⚠️ Nota: `index.js` está en CRLF (fix I7 en `97f5fc5`); el test M4 es determinista cualquier día (fixture usa "mañana").

| Test | Cubre |
|---|---|
| `tests/test_validarSeguridad.js` (9) | Gate: A0/B0 reproducen mutaciones de intención y el gate las revierte; R1-R7 reglas NIVEL 1-2 y defensivo |
| `tests/test_trainingNeed.js` (13) | TN1-TN13: estados de cálculo, no-mutación (TN6), umbral IF ≥ 0.80 (TN9), ramas de clasificación y fronteras, restriccionesActivas, TSS negativo |
| `tests/test_integracionTN.js` (7) | I1-I7: builder de contexto semanal, frontera lunes-domingo, adapters `tssEsperado`/`dataQuality`, no-mutación, orden canónico gate→TN en el fuente de index.js |
| `tests/test_substitutionEngine.js` (10) | S1-S10: aceptación ±30% TSS, límite semanal 3, umbral calidad, prioridad del gate ACWR, no-mutación (S8), excepción descanso, `dependencia_persistencia` |
| `tests/test_integracionSE.js` (8) | SU1-SU8: adapter `evaluarSustitucionPipeline` extraído de index.js — ±30%, límite 3, prioridad del gate, no-mutación, sin candidato, `dependencia_persistencia`, orden canónico gate→TN→SE |
| `tests/test_ajustarPlanAutomaticamente.js` (5) | M1-M5: no-mutación de `ajustarPlanAutomaticamente`; extrae la función REAL de `index.js` y la evalúa con stubs (patrón para testear funciones del monolito) |
| `tests/test_persistenciaPlan.js` (18) | Contrato real de `persistenciaPlan.js`: validaciones de filas/registros, C1-C10, idempotencia (PK + ignoreDuplicates), modo degradado sin credenciales, rechazo de `SIN_DATOS` |
| `tests/test_integracionP2.js` (16) | Orquestación P2: orden gate→TN→ensure→SE, registro SOLO si aplicada y revalidada, contador semanal real (null → dependencia_persistencia), degradación segura de lecturas/escrituras, idempotencia |
| `tests/test_integracionP2B.js` (17) | P2B-1…P2B-17: read-or-freeze, no-sobrescritura del congelado, baseline PRE-intención, gate antes de congelar, sin fila artificial SIN_DATOS, degradación segura, idempotencia cron/hoy, concurrencia, no-recursión, orden canónico en el fuente, endpoint cron + X-Cron-Secret, y **P2B-15 compatibilidad total con las suites previas** |
| `tests/test_analizarCumplimientoPlan.js` (15) | Cumplimiento del plan contra `plan_previsto_diario` (f4e8048): fuente única de actividades, emparejado por fecha, estados `sin_actividades`/`sin_plan`/`parcial`/`desviacion`/`ok`/`error`, ±30% TSS y tipo, porcentaje nunca dividido por días sin plan |
| `tests/test_calorIndoor.js` (12) | F2 indoor (f4e8048): CI1-CI12 — HI>40 sin indoor → descanso; con indoor → Z2 máx 45/IF 0.70; ACWR/TSB/readiness mandan sobre el indoor; regresiones de resolverConflictos |

**Áreas importantes SIN tests** ✅: pipeline núcleo (`obtenerDatosCompletos`, `calcularEstadoSistema`, `decidirEntrenamiento`, `resolverConflictos`, `generateWorkout`), orquestación end-to-end de `getAthleteStateConAjuste`, handlers de comandos Telegram, integración Supabase real (requiere credenciales y tablas), flujo conversacional "no me apetece".

## 6. ESTADO GIT (reglas + estado real)

- **Estado real (05/09/2026):** rama `freebuff-prueba`, HEAD = `97f5fc5`, **ahead de `origin/freebuff-prueba` por 2 commits** (`f4e8048` F2 indoor + cumplimiento, `97f5fc5` fixes de tests). `128861f` trajo P2B + módulos v10 + docs. Nada de esto está en `main` ni pusheado.
- Trabajar en ramas de prueba (ej. `freebuff-prueba`); no operar directamente sobre `main`.
- **PROHIBIDO**: `git reset`, `git clean`, checkout destructivo, borrar cambios locales o archivos no trackeados (módulos v10, tests y docs ya están committeados en `128861f`/`f4e8048`; los artefactos `PROJECT_MAP.md`, `_chk.js`, `_chk2.js`, `pc_validate.json`, `index.js.bak_pre_ciclismo` siguen sin trackear y NO se tocan).
- **NO hacer commit ni push** salvo autorización explícita de Manu.

## 7. REGLAS DE TRABAJO PARA FUTURAS SESIONES

1. Leer primero `PROJECT_CONTEXT.md` (este archivo).
2. Leer `CHECKPOINT_V10.md` si la tarea afecta a V10; leer `docs/SPEC_V10_F1.md` si afecta a F1 (⚠️ revisar §3.2/§5 contra las decisiones P2B del checkpoint).
3. NO volver a analizar todo el repositorio por defecto.
4. Localizar primero la función/módulo directamente relacionado con la tarea (usar grep con anclas específicas).
5. Inspeccionar solo las dependencias necesarias.
6. Antes de modificar código, explicar brevemente qué se va a cambiar.
7. Hacer el cambio mínimo necesario. Sin refactorizaciones no solicitadas.
8. Crear o actualizar tests relacionados con el cambio.
9. Ejecutar los tests relevantes tras el cambio.
10. Comprobar sintaxis (`node --check <archivo>`; obligatorio para `index.js`).
11. Informar de los archivos modificados al terminar.
12. No leer ni mostrar `.env`, `ENV`, tokens, API keys ni credenciales.
13. Sin operaciones Git destructivas (ver §6).

## 8. PROBLEMAS Y RIESGOS CONOCIDOS

**Confirmados ✅:**
- `index.js` no importable (levanta servidor al requerirlo) → tests extraen fuente si hace falta (ver patrón en `tests/test_ajustarPlanAutomaticamente.js` y `tests/test_integracionP2B.js`).
- **`index.js` está en CRLF** (desde `f4e8048`): cualquier patrón multi-línea en tests debe normalizar CRLF→LF antes de buscar (fix I7 en `97f5fc5`).
- [RESUELTO 05/09/2026] M4 (`ajustarPlanAutomaticamente`) era dependiente del día de la semana (fixture con fecha fija que colisionaba con el día real); ahora la fecha es "mañana" → determinista (fix `97f5fc5`).
- [RESUELTO 03/09/2026] `ajustarPlanAutomaticamente` mutaba la decisión recibida; ahora trabaja sobre copia (tests M1-M5).
- `adaptarDecisionParaIntencion` (motorIntencion.js) tiene salidas por referencia (`return decision` en guard inicial y `catch`). Hoy inalcanzables porque `detectarIntencion` siempre devuelve objeto, pero frágil si se llama con `intencion=null` o desde otro sitio.
- Coexisten varios mecanismos de mutación de decisión antes del gate (motor de intención, ajuste automático, resolverConflictos/aplicarRestriccionesGlobales). El gate F2 los cubre; el SPEC §9 planea convertirlos en proponentes (transición F3).
- **Persistencia V10 en código pero SIN tablas en Supabase** → `persistenciaPlan` degrada de forma segura (lecturas null, escrituras rechazadas) y el SE queda en `dependencia_persistencia` hasta que Manu cree `plan_previsto_diario` / `registro_sustituciones` (C10). **Consecuencia extra desde `f4e8048`:** `analizarCumplimientoPlan()` ahora depende de `plan_previsto_diario`; sin tablas devuelve `estado:'error'` en `/aprender` y `/sync` (degradación segura, pero el análisis de cumplimiento queda inoperativo hasta crear las tablas). Pendiente además: `CRON_SECRET` en entorno y decidir/operar el scheduler (cron externo a `/api/cron/plan-diario` es la variante preparada; `setInterval` interno NO implementado). `aplicarConsecuencias` (§8) y el flujo conversacional "no me apetece" no están implementados. Las transiciones de estado VIGENTE→SUSTITUIDO→COMPLETADO→EXPIRADO (SPEC §3.3) **no están implementadas** (el código solo escribe `VIGENTE` y rechaza `SIN_DATOS`).

**Posible / por verificar ⚠️:**
- Proveedor exacto del clima; versión en `package.json` (9.3.0) vs banner v9.5.
- Comportamiento de `decision.motivo` si llega `undefined` en `ajustarPlanAutomaticamente` (TypeError atrapado por su `catch` — preexistente, sin test específico).
- Cobertura de rutas API y comandos (no auditada en profundidad).
- `congelado_en` no se envía explícitamente en la fila del plan (depende del DEFAULT de la columna en Supabase).

## 9. CONVENCIONES

- **Tests**: sin framework; `assert` nativo; script por módulo en `tests/`; ejecutar con `node tests/test_X.js` desde la raíz. Patrón para funciones de `index.js`: extraer el fragmento de fuente y `new Function(...)` con stubs inyectados.
- **Módulos auxiliares**: funciones puras, sin I/O, `module.exports` al final, identificadores en español, `console.log('[modulo] ...')` para errores. Reciben dependencias como argumentos (no leen secretos). `persistenciaPlan.js` es la excepción con I/O (única capa Supabase de la memoria V10) e inyecta cliente vía `__setCliente` para tests.
- **Peculiaridades de `index.js`** ✅:
  - Carga secretos con `require('dotenv').config({ path: 'ENV' })` (fichero `ENV`, no `.env`) — **no leer su contenido nunca**.
  - `generateWorkout()` es la "single source of truth" del workout.
  - `getAthleteStateConAjuste` en 7003 (gate `validarSeguridad` ~7030 → TN ~7036 → ensure P2B ~7045 → SE P2 ~7055); `ejecutarSustitucionP2` en 7291; bloque P2B: `construirFilaPlanPrevisto` 7482, `generarPlanPrevistoDia` 7513, `ensurePlanPrevistoDia` 7545; `analizarCumplimientoPlan` reescrito en 7608; `POST /api/cron/plan-diario` en 8460 (X-Cron-Secret). Señal `estado.indoor` en `getAthleteState` ~3891; bloque calor indoor en `resolverConflictos` ~2567. Posiciones verificadas 05/09/2026; re-verificar con grep si el archivo crece.
  - Artefactos heredados de sesiones IA anteriores que NO hay que tocar ni borrar: `PROJECT_MAP.md`, `_chk.js`, `_chk2.js`, `pc_validate.json`, `index.js.bak_pre_ciclismo`.
  - Los tests del proyecto ya documentan el motivo por el que `index.js` no se importa (comentario en `tests/test_validarSeguridad.js`).

## 10. PRINCIPIO FUNDAMENTAL

> **REGLA DE ORO: No redescubrir todo el proyecto en cada tarea. Usar este documento como contexto inicial y analizar únicamente el código necesario para resolver la tarea actual.**

---

*Mantenimiento: actualizar este documento cuando cambie la arquitectura, se conecten módulos V10 o cambien las reglas de trabajo. Marcar con ✅ solo lo verificado contra código.*