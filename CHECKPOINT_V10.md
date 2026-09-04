# ⚙️ CHECKPOINT DE REANUDACIÓN — WORLD TOUR COACH V10

> **ÚLTIMA POSICIÓN:** **F2 + P1/P2 + P2B IMPLEMENTADOS Y VERIFICADOS — AUDITORÍA P2B COMPLETADA (PASS)**
>
> **NO MODIFICAR CÓDIGO HASTA NUEVA AUTORIZACIÓN.**
>
> ⛔ Este documento es SOLO para reanudar contexto. No implica permiso de implementación.
> Fecha: checkpoint tras la auditoría final de P2B (plan previsto diario: generación + lazy-ensure). Batería completa: 103/103 tests verdes.

---

## 1. ESTADO ACTUAL

| Fase/entregable | Estado |
|---|---|
| **F1 (spec V10)** | ✅ Terminada y validada por Manu. Documento: `docs/SPEC_V10_F1.md` |
| **validarSeguridad()** (F2, gate) | ✅ Implementado y **conectado** al pipeline (gate final en `getAthleteStateConAjuste`). Módulo `seguridad.js` |
| **Training Need** | ✅ Implementado, verificado y **conectado** como capa informativa post-gate. Módulo `trainingNeed.js` + adapter `calcularTrainingNeedInformativo` (index.js) |
| **Substitution Engine** (F2) | ✅ Implementado y **conectado** (adapter `evaluarSustitucionPipeline` + orquestador `ejecutarSustitucionP2`). Módulo `substitutionEngine.js` |
| **Persistencia plan previsto / sustituciones** (P1) | ✅ Implementado. Módulo `persistenciaPlan.js` — única capa de acceso a `plan_previsto_diario` / `registro_sustituciones` (C7/R19) |
| **Orquestación sustituciones con persistencia** (P2) | ✅ Implementado. Orden canónico en `getAthleteStateConAjuste`: gate → TN → **lazy-ensure P2B** → SE con persistencia |
| **Plan previsto diario: generación + lazy-ensure** (P2B) | ✅ Implementado. `generarPlanPrevistoDia` (fuente 'cron') + `ensurePlanPrevistoDia` (fuente 'hoy', read-or-freeze) + endpoint `POST /api/cron/plan-diario` con `X-Cron-Secret` |
| **Baseline PRE-INTENCIÓN** (P2B) | ✅ Decisión Manu P2B: se congela `state.decision` (tras resolverConflictos + gate + workout + TN snapshot), SIN motorIntencion/cerebro/SE (P2B-16) |
| **Regla SIN_DATOS** (P2B) | ✅ Nunca se crea una fila artificial `SIN_DATOS`; `congelarPlanPrevisto` la rechaza (C5). Sin datos → simplemente no hay plan (P2B-7) |
| **Tests completos** | ✅ **103/103** (9 suites): validarSeguridad 9 · trainingNeed 13 · integracionTN 7 · substitutionEngine 10 · integracionSE 8 · ajustarPlanAutomaticamente 5 · persistenciaPlan 18 · integracionP2 16 · **integracionP2B 17** |
| **Sintaxis (`node --check`)** | ✅ Verificada en `index.js` y los módulos v10 |
| **Tablas Supabase (`plan_previsto_diario`, `registro_sustituciones`)** | ❌ Pendiente de crear (C10: las crea Manu en Supabase; no hay migración incluida). Sin tablas el módulo degrada (lecturas null, escrituras rechazadas) |
| **Scheduler real (disparador diario)** | ❌ Endpoint cron listo y protegido; falta decidir variante (§18.1): cron externo apuntando a `/api/cron/plan-diario` (listo) o `setInterval` interno (NO implementado) |
| **`CRON_SECRET` en el entorno** | ❌ Pendiente de configurar (sin él el endpoint responde 401) |
| **`aplicarConsecuencias` (§8)** | ❌ NO implementado (fuera de P2B; pendiente de autorización) |
| **Flujo conversacional "no me apetece" (§7.3.a)** | ❌ Preparado (adapter genérico) pero SIN implementar |
| **Commit / push / deploy** | ❌ Nada committeado. `git log -1` sigue en `598b802` (commit previo a todo el trabajo V10/F2/P1/P2/P2B) |

---

## 2. ARCHIVOS RELEVANTES

| Archivo | Estado | Para qué sirve |
|---|---|---|
| `seguridad.js` | 🆕 Nuevo | Único dueño de las reglas fisiológicas (ACWR/TSB/readiness/HRV/sueño/calor/intensidadMax/forzarDescanso/forzarZ2). `validarSeguridad(decision, estado, restricciones)` = gate final. Se ejecuta en el bloque P2B **antes** de congelar |
| `trainingNeed.js` | 🆕 Nuevo | Capa **pura de información/diagnóstico** (TN1–TN13). Adapter `calcularTrainingNeedInformativo` en index.js usado por el pipeline y por la congelación del plan (TN snapshot del baseline) |
| `substitutionEngine.js` | 🆕 Nuevo | Motor **puro de evaluación** (S1–S10): equivalencia, ±30% TSS, límite 3/semana, grupeta-como-calidad, excepción descanso. NO aplica seguridad (la aplica el caller) |
| `persistenciaPlan.js` | 🆕 Nuevo (~271 líneas) | **Única capa de acceso** a `plan_previsto_diario` / `registro_sustituciones` (C7/R19): `getPlanPrevistoDia`, `congelarPlanPrevisto` (upsert `ignoreDuplicates`), `getSustitucionesSemana` (COUNT real; error → null), `registrarSustitucion` (solo aceptadas, idempotente). Reglas C1–C10. No crea tablas (C10) |
| `index.js` | ⚠️ Modificado (+570/−4 vs `598b802`) | CONFIG.CRON_SECRET; gate + TN + **P2B lazy-ensure** + SE con persistencia en `getAthleteStateConAjuste` (~6951); bloque P2 (`ejecutarSustitucionP2` ~7220); bloque P2B (`construirFilaPlanPrevisto`, `generarPlanPrevistoDia`, `ensurePlanPrevistoDia` ~7382-7500); endpoint `POST /api/cron/plan-diario` (~8324) |
| `tests/test_validarSeguridad.js` | 🆕 Nuevo | A0/B0/R1–R7 (9/9) |
| `tests/test_trainingNeed.js` | 🆕 Nuevo | TN1–TN13 (13/13) |
| `tests/test_integracionTN.js` | 🆕 Nuevo | I1–I7 (7/7): orden canónico gate→TN en el fuente |
| `tests/test_substitutionEngine.js` | 🆕 Nuevo | S1–S10 (10/10) |
| `tests/test_integracionSE.js` | 🆕 Nuevo | SU1–SU8 (8/8): adapter del pipeline + orden gate→TN→SE |
| `tests/test_ajustarPlanAutomaticamente.js` | 🆕 Nuevo | M1–M5 (5/5): no-mutación del ajuste automático |
| `tests/test_persistenciaPlan.js` | 🆕 Nuevo | 18/18: contrato real de persistenciaPlan (validaciones, C1–C10, idempotencia, modo degradado) |
| `tests/test_integracionP2.js` | 🆕 Nuevo | 16/16: orquestación P2 (gate→TN→ensure→SE, registro solo si aplicada, degradación) |
| `tests/test_integracionP2B.js` | 🆕 Nuevo | **P2B-1…P2B-17 (17/17)**: read-or-freeze, baseline pre-intención, gate antes de congelar, degradación segura, idempotencia cron/hoy, no-recursión, endpoint cron, compatibilidad total con las 8 suites previas (P2B-15) |
| `docs/SPEC_V10_F1.md` | 🆕 Nuevo | Spec V10 completo (F1 cerrado). ⚠️ Su encabezado ("pendiente de validación antes de F2") y el esquema §5 quedaron obsoletos tras F2/P1/P2/P2B; el texto §3.2 literal ("tras la capa de contexto", "estado='sin_datos'") fue refinado por decisiones P2B (ver §3). Revisión del SPEC pendiente (no autorizada) |
| `motorIntencion.js` | Existente (v9.5, sin cambios) | Lo consume `substitutionEngine.js` vía `EQUIVALENCIAS`. No se toca |

> ⚠️ **Artefactos preexistentes de sesiones IA anteriores (NO tocarlos):** `PROJECT_MAP.md`, `_chk.js`, `_chk2.js`, `pc_validate.json`, `index.js.bak_pre_ciclismo`. No pertenecen a V10.

---

## 3. DECISIONES DE PRODUCTO YA CERRADAS

(Reglas V10 aprobadas por Manu — ninguna cambia sin nueva autorización)

1. **±30% TSS** (D-18.2): umbral de carga, **inclusivo** (exacto ±30% = válido). Fuera de rango → `no_valida`, sin redondeos silenciosos.
2. **4.ª sustitución semanal** (D-18.3): **rechazada SIEMPRE**, incluido descanso espontáneo y grupeta. `LIMITE_SUSTITUCIONES_SEMANA = 3`.
3. **Descanso espontáneo** (D-18.5): usa el **MISMO flujo** de sustitución (no camino paralelo), con **excepción explícita**: no se le aplica ±30% TSS **ni equivalencia de carga** (TSS=0 lo haría imposible). Sí respeta el límite semanal y debe pasar por `validarSeguridad()`.
4. **Equivalencia plan→plan**: por **`objetivo_sesion`** como clase funcional: `calidad = sweetspot/ftp/vo2` · `base = z2/z3` · `recuperacion = z1` · `descanso = descanso`. Se conservan las `EQUIVALENCIAS[].equivalenciaPlan` para intenciones. No se inventan otras equivalencias.
5. **Grupeta = calidad** con **IF ≥ 0.80** (D-18.4). El legacy `>0.85` de `contarSesionesCalidadSemana` (index.js:905-906) es distinto y NO se reutiliza; quedará unificado en la transición §9/F3.
6. **Seguridad:** NO se duplica dentro del motor ni se modifica `validarSeguridad()`. Flujo: `sustitución → validarSeguridad() (caller) → generateWorkout()`.
7. **Training Need es información/diagnóstico**, NO decisión: nunca muta `decision`, no acepta/rechaza/reprograma/sustituye.
8. **No reconstruir histórico inexistente:** no se inventan decisiones/planes pasados ni contadores. Si falta el dato → estado explícito (`datos_insuficientes`, `dependencia_persistencia`).
9. **Sin persistencia todavía → SUPERADA por P1/P2/P2B:** el contador semanal y el plan previsto ya viven en Supabase vía `persistenciaPlan.js`. Sin tablas creadas en Supabase, el módulo degrada de forma segura (lecturas null, escrituras rechazadas; el SE queda en `dependencia_persistencia`).
10. **Fuera de F2/P2B:** HRSS/eFTP/zonas de Intervals.icu, IA conversacional, replanificación multi-día (F3).
11. **Baseline PRE-INTENCIÓN (decisión Manu P2B):** el plan congelado es determinista: `decidirEntrenamiento → resolverConflictos → validarSeguridad → generateWorkout → Training Need → congelar`. NO participan motorIntencion, ajuste automático ni SE. Queda el modelo A/B: A = plan congelado (referencia), B = intención actual; el SE decide después si B sustituye a A. *(Refina el texto literal de SPEC §3.2 "tras la capa de contexto".)*
12. **SIN_DATOS sin fila artificial (decisión Manu P2B):** si `dataQuality` es NO_DISPONIBLE o no hay decisión válida, **no se congela nada** (nunca se crea una fila `SIN_DATOS`); `congelarPlanPrevisto` la rechaza (C5). Las comparaciones de ese día se omiten porque no hay plan. *(Refina el texto literal de SPEC §3.2 Fallback 2 "el plan queda estado='sin_datos'".)*
13. **R19 (P2):** `index.js` ORQUESTA; las únicas consultas a `plan_previsto_diario` / `registro_sustituciones` viven en `persistenciaPlan.js`. Sin plan congelado → no se evalúa ni registra sustitución (nada inventado).
14. **Registro de sustituciones (P2):** SOLO se registran las **aceptadas** (`decision='aceptada'`) y tras el re-gate de `validarSeguridad` (reglas 13-16); idempotente por `(user_id, fecha)`. Contador semanal = COUNT real de `registro_sustituciones`; error Supabase → null (nunca 0, C2).
15. **Endpoint cron externo (P2B):** `POST /api/cron/plan-diario` exige `X-Cron-Secret == CONFIG.CRON_SECRET` (sin secret configurado → 401). Invoca SOLO `generarPlanPrevistoDia` (nunca `getAthleteStateConAjuste`). Es la variante externa de SPEC §3.2; la variante interna (`setInterval`) sigue pendiente de decisión (§18.1).

---

## 4. HISTÓRICO — SITUACIÓN DE F2 EN SU CIERRE (antes de P1/P2/P2B)

> Sección conservada a efectos de trazabilidad. **SUPERADA** por el estado actual (§1): el motor ya está conectado al pipeline y la persistencia existe en código.

### 4.1 Flujo implementado entonces (lógica pura, no integrada en pipeline)

```
sesión prevista (plan del día, hoy = decidirEntrenamiento+resolverConflictos)
      ↓
candidato (intención detectada / declaración del atleta / desviación)
      ↓
evaluarSustitucion({ sesionPrevista, candidato, sustitucionesSemana })
      ├─ contador no disponible (null/undefined) → dependencia_persistencia
      ├─ sustitucionesSemana >= 3 (4ª)           → rechazada (incl. descanso)
      ├─ candidato tipo='descanso'               → aceptada + excepción carga (D-18.5)
      ├─ sin equivalencia (clase funcional)      → rechazada
      ├─ fuera de ±30% TSS                       → no_valida
      └─ OK                                      → aceptada → decision_sustituta (objeto NUEVO)
      ↓
validarSeguridad(decision_sustituta, estado, restricciones)   ← lo ejecuta el CALLER
      ↓
generateWorkout()
```

### 4.2 Qué NO hacía F2 en aquel cierre (hoy implementado en P1/P2/P2B)

- ❌ NO registraba la sustitución en ninguna tabla → ✅ `persistenciaPlan.registrarSustitucion` (P2, solo aceptadas).
- ❌ NO conectaba con el pipeline → ✅ `evaluarSustitucionPipeline` + `ejecutarSustitucionP2` en `getAthleteStateConAjuste` (orden gate→TN→ensure→SE).
- ❌ NO persistía plan previsto ni contador semanal → ✅ `getPlanPrevistoDia` / `congelarPlanPrevisto` / `getSustitucionesSemana`.
- ❌ NO había scheduler que congelara el plan del día → ✅ endpoint `POST /api/cron/plan-diario` (disparador externo listo; scheduler real pendiente de configuración).
- ❌ NO actualizaba consecuencias futuras (`aplicarConsecuencias` §8) → sigue pendiente (no autorizado).

---

## 5. PENDIENTE INMEDIATO

**El siguiente paso NO es programar más lógica.** Es:

### 5.1 Auditoría P2B — RESULTADO: ✅ PASS (realizada; ver informe de la sesión)

Verificados contra SPEC §3.2/§6/§10/§13 y los tests P2B-1…P2B-17: generación del plan, baseline PRE-intención, gate antes de congelar, persistencia idempotente (read-or-freeze), lazy-ensure con reutilización del estado ya calculado, ausencia de recursión, degradación segura, endpoint cron protegido con CRON_SECRET, orden canónico gate→TN→ensure→SE. **103/103 tests verdes.**

### 5.2 Infraestructura (lo único que separa P2B de funcionar en producción)

1. **Crear las tablas en Supabase** (C10: tarea de Manu; `persistenciaPlan` no crea tablas): `plan_previsto_diario` (PK `(user_id, fecha)`, columnas `decision`/`workout`/`training_need` JSONB, `tipo_previsto`, `duracion_prevista_min`, `tss_previsto`, `intensidad_prevista`, `es_calidad`, `fuente`, `estado`, `congelado_en`) y `registro_sustituciones` (columnas `prevista_*`, `sustituta_*`, `tss_real`, `categoria`, `decision`, `motivo`, `training_need_congelado`; índice único parcial `(user_id, fecha) WHERE decision='aceptada'`).
2. **Configurar `CRON_SECRET`** en el entorno (sin él el endpoint responde 401).
3. **Decidir la variante de scheduler (§18.1):** cron externo (GitHub Actions / cron-job.org) → `POST /api/cron/plan-diario` (variante lista) o `setInterval` interno en el monolito (por implementar).

### 5.3 Resto de F2 (no autorizado aún)

- `aplicarConsecuencias` (§8): impacto en TSS semanal, TN del día siguiente, necesidades pendientes.
- Flujo conversacional "no me apetece" (§7.3.a) sobre el patrón `esperando_respuesta_desviacion` (preparado pero sin implementar).
- Transición §9: `motorIntencion.adaptarDecisionParaIntencion` / `ajustarPlanAutomaticamente` como proponentes (retirada progresiva, F3).
- Tests de los 5 casos límite §15 de extremo a extremo (los tests actuales cubren las reglas del motor, no el flujo conversacional completo).

### 5.4 F3 — fuera de alcance (deliberadamente)

Replanificación multi-día en cadena, `CONFIG.PERIODO` derivado del calendario (G-6), IA conversacional, retirada definitiva de mutadores, split de `index.js`/TypeScript/multiusuario.

### 5.5 Commit / push / deploy

Nada de V10/F2/P1/P2/P2B está committeado (`git log -1` = `598b802`). Requiere autorización explícita.

---

## 6. REGLA PARA MAÑANA

Cuando se reanude, seguir ESTE orden exacto:

1. Leer `CHECKPOINT_V10.md` (este archivo).
2. Leer `docs/SPEC_V10_F1.md` (⚠️ revisar §3.2/§5 contra las decisiones P2B §3 de este checkpoint; la revisión del SPEC no está autorizada).
3. Leer `persistenciaPlan.js` y el bloque P2B de `index.js` (~7382-7500) si la tarea afecta a P2B.
4. **NO asumir decisiones no documentadas.**
5. **NO empezar F3.**
6. **NO modificar código** (gate, TN, SE, persistencia, P2B) sin autorización.
7. Si la tarea es infraestructura: crear tablas Supabase + `CRON_SECRET` + decidir scheduler (§5.2).
8. Tras cualquier cambio de código, ejecutar la batería completa (`for t in tests/test_*.js; do node $t; done`) y `node --check index.js`.

---

## 7. ÚLTIMA POSICIÓN

```
POSICIÓN DE REANUDACIÓN: F2 + P1/P2 + P2B IMPLEMENTADOS Y VERIFICADOS (103/103 tests)
AUDITORÍA P2B: PASS — SIN DISCREPANCIAS BLOQUEANTES
PENDIENTE OPERATIVO: tablas Supabase + CRON_SECRET + decisión de scheduler (§5.2)
NO MODIFICAR CÓDIGO HASTA NUEVA AUTORIZACIÓN.
```