# 📐 SPEC F1 — EVOLUCIÓN DE WORLD TOUR COACH v9.5

> Estado: **F1 CERRADO Y VALIDADO — F2 + P1/P2 + P2B + F2 indoor/calor IMPLEMENTADOS Y VERIFICADOS (130/130 tests, HEAD `97f5fc5`, 05/09/2026)**
> Fecha original: 29/08/2026 · Base: v9.5 · **Revisado el 05/09/2026** para alinear encabezado, §1.2/G-1, §3.2, §3.3, §5, §6, §13 y §18.1 con el estado real del código.
> ⚠️ Las decisiones de producto cerradas (checkpoint §3 y este §18.2-18.5) NO cambian con esta revisión; solo se actualiza documentación obsoleta y coherencia cruzada.
> Principio rector: **Construir sobre lo que existe. No reinventar. No crear un proyecto nuevo.**

---

## 0. ALCANCE DE ESTE DOCUMENTO

Este spec define la **siguiente evolución funcional** de WORLD TOUR COACH v9.5 (en adelante "la evolución"), cuyo objetivo es que el sistema se comporte como **un entrenador, no como un sistema de registro**:

> Una sustitución (`sesión A → sesión B`) debe ser una **decisión** basada en el estado del atleta, sus necesidades de entrenamiento y el contexto del plan, y debe tener **consecuencias explícitas sobre el entrenamiento posterior**.

Todo lo definido aquí se apoya en el código v9.5 existente (`index.js`, `motorIntencion.js`, Supabase, Intervals, Garmin). No hay arquitectura paralela.

---

## 1. ESTADO ACTUAL v9.5 (diagnóstico validado)

### 1.1 Lo que existe y funciona (se conserva)

| Componente | Función | Estado |
|---|---|---|
| `getAthleteState()` (index.js:3857) | Orquestador: datos → estado → restricciones → decisión → conflictos → workout | ✅ Conservado intacto |
| `decidirEntrenamiento()` (2981) | Decide sesión por TSB/fase/TSS semanal/clima/sueño | ✅ Conservar: es el "cerebro de fatiga" |
| `resolverConflictos()` (2516) | Jerarquía Seguridad > Clima > Fatiga > Plan > Objetivo | ✅ Conservar: es la autoridad de seguridad. ⚠️ Desde `f4e8048` incluye la rama **HI>40 + indoor → Z2 máx 45/IF 0.70** (~2567) |
| `generateWorkout()` (3245) | Single Source of Truth del workout (bloques, TSS/IF esperado) | ✅ Conservar |
| `motorIntencion.js` + `EQUIVALENCIAS` | Detección de intención, equivalencias grupeta/rodillo/salida | ✅ Conservar: embrión de la equivalencia de sustitución. ⚠️ Desde `f4e8048` su señal `'rodillo'` alimenta `estado.indoor` (HI>40) |
| `ajustarPlanAutomaticamente()` (6900) | Ajusta decisión por patrones históricos de desviación | ⚠️ Evolucionar (§9); ya NO muta la entrada (trabaja sobre copia, tests M1-M5) |
| `analizarCumplimientoPlan()` (7608) + `procesarRespuestaDesviacion()` (7788) | Detección y clasificación reactiva de desviaciones | ⚠️ **Reescrito en `f4e8048`:** compara lo REALIZADO contra `plan_previsto_diario` (no contra sí mismo). Evolución §9 pendiente (escritura en `registro_sustituciones` + `aplicarConsecuencias`) |
| `predecirDesviaciones()` (6714) | Predicción de desviación por tipo | ⚠️ Evolucionar (§9) |
| `obtenerActividadesReales()` (650) | Fuente única de sesiones reales (Supabase/Intervals) | ✅ Conservar |
| `obtenerHistorialSupabase()` / `guardarEntrenoSupabase()` | Persistencia `historial_entrenos` | ✅ Conservar |
| `calcularEstadoSistema()` (2148) + `dataQuality` | Estado fisiológico y calidad de datos | ✅ Conservar |
| Feedback 7 pasos (`procesarMensajeFeedback` 7906) | Registro de sesión realizada con RPE/contexto | ✅ Conservar |
| Supabase, Garmin/Intervals, clima, Telegram | Infraestructura | ✅ Conservar |

### 1.2 Gaps estructurales detectados (motivo de la evolución)

1. 🔴 **El plan previsto no se persistía.** ~~`analizarCumplimientoPlan()` (7030-7037) buscaba el "plan" del día en `historial_entrenos` y comparaba la sesión realizada consigo misma~~ → **RESUELTO en código (f4e8048/05-09):** `analizarCumplimientoPlan()` (7608) compara ahora contra `plan_previsto_diario` vía `persistenciaPlan.getPlanesPrevistosFechas()`; la persistencia del plan (P2B) y la de sustituciones (P1/P2) están implementadas en `persistenciaPlan.js`. **Pendiente solo de infra:** crear las tablas en Supabase (C10).
2. 🔴 **Tres mecanismos paralelos adaptan la decisión sin coordinarse** ni dejar registro unificado del porqué: `motorIntencion.adaptarDecisionParaIntencion()`, `ajustarPlanAutomaticamente()` y el aprendizaje de desviaciones.
3. 🔴 **La jerarquía de seguridad puede ser pisada** después de `resolverConflictos()` (análisis exacto en §10).
4. 🟠 **No existe "Training Need"**: la necesidad de entrenamiento es implícita y volátil (solo el tipo que sale de decidirEntrenamiento en el momento).
5. 🟠 **Las sustituciones no tienen consecuencias**: `ajustarPlanAutomaticamente` muta durMin y se olvida; no actualiza objetivo semanal, sesiones posteriores ni necesidades pendientes.
6. 🟡 **`CONFIG.PERIODO` estático**: fase/semana fijas en CONFIG, no derivan del calendario.
7. 🟡 **`scriptProperties` es memoria pura** (index.js:730-736): `historial_trazas`, `historial_entrenos` en memoria y `aprendizaje_desviaciones` se pierden en cada reinicio. La nueva persistencia debe ir a Supabase.

---

## 2. ARQUITECTURA OBJETIVO (evolución de v9.5)

```
                    ┌────────────────────────────────────────────┐
                    │        PIPELINE v9.5 (intacto)             │
  Datos → estado →  │ aplicarRestriccionesGlobales               │
                    │   → decidirEntrenamiento                   │
                    │   → resolverConflictos  (AUTORIDAD SEGURID)│
                    │   → generateWorkout                        │
                    └──────────────┬─────────────────────────────┘
                                   ▼
              ┌────────────────────────────────────────────────┐
              │   CAPA DE ENTRENADOR (nueva, F2)               │
              │  calcularTrainingNeed()          ← NUEVO       │
              │  PUNTO ÚNICO DE DECISIÓN:                      │
              │   intenciones (motorIntencion)                 │
              │   + ajustes históricos (ajustarPlan)           │
              │   + declaración del atleta (sustitución)       │
              │   → decisión consolidada →                     │
              │   → validarSeguridad()  ← GATE OBLIGATORIO     │
              │  registrarSustitucion() + aplicarConsecuencias │
              └──────────────┬─────────────────────────────────┘
                             ▼
              ┌────────────────────────────────────────────────┐
              │   PERSISTENCIA NUEVA (Supabase)                │
              │   plan_previsto_diario · registro_sustituciones│
              └────────────────────────────────────────────────┘
```

**Regla de convivencia:** el pipeline v9.5 nunca lee de la capa nueva. La capa nueva solo lee del pipeline y de Supabase. Esto permite la transición incremental de §9 sin big-bang.

---

## 3. PLAN PREVISTO vs SESIÓN REALIZADA

### 3.1 Conceptos

| Concepto | Definición | Fuente v9.5 | Cambio |
|---|---|---|---|
| **Plan previsto** | Sesión concreta propuesta por el entrenador para una fecha, congelada una vez | No existe (se recalcula en cada /hoy) | 🆕 `plan_previsto_diario` |
| **Decisión actual** | Lo que el sistema mostraría hoy si recalcula | `getAthleteStateConAjuste()` | Ya existe; deja de ser referencia histórica |
| **Sesión realizada** | Lo que el atleta hizo de verdad | `actividades_guardadas` (Intervals) + `historial_entrenos` (feedback) | Ya existe; sin cambios |
| **Sustitución** | Realizada ≠ prevista, con decisión del entrenador documentada | Detectada a posteriori sin consecuencias | 🆕 `registro_sustituciones` |

### 3.2 🔴 CUÁNDO SE PERSISTE EL PLAN PREVISTO (requisito explícito)

**Problema:** si el atleta no consulta `/hoy` un día, debe existir igualmente un plan previsto persistido con el que comparar la sesión real posterior.

**Opciones evaluadas:**

| Opción | Descripción | Veredicto |
|---|---|---|
| **A. Persistir en la primera `/hoy`** | Se congela al calcular | ❌ Depende de que el atleta consulte. Incumple el requisito |
| **B. Cron/proceso programado independiente** | El sistema calcula y congela solo, cada día | ✅ Recomendada (dos variantes técnicas abajo) |
| **C. Reconstruir a posteriori al registrar la actividad** | Se deduce el plan "de aquel día" después | ❌ No es plan previsto, es reconstrucción. Anula la comparación honesta y viola "nunca inventar datos" |
| **D. Persistir en la sync de datos ya existente** | Aprovecha proceso existente | 🟡 Válida como disparador secundario, no como único (la sync puede fallar o llegar tarde) |

**Decisión: Opción B — variante EXTERNA implementada (P2B-15); la variante interna sigue pendiente de decisión (§18.1).**

- **Disparador implementado (P2B, `f4e8048`):** cron externo (GitHub Actions / cron-job.org) → `POST /api/cron/plan-diario` con cabecera `X-Cron-Secret` == `CONFIG.CRON_SECRET` (sin secret → 401). El endpoint invoca SOLO `generarPlanPrevistoDia` (nunca `getAthleteStateConAjuste`). Idempotente: si el plan del día ya existe, no se sobrescribe. Despliegue real: **Render** (proceso Node persistente; `RENDER_EXTERNAL_URL` en index.js:8513) y `/ping` existe como keep-alive. ⚠️ **NO hay scheduler interno operativo:** el `setInterval` en el monolito NO está implementado (decisión §18.1 abierta). ⚠️ **Nota de auditoría:** el repo contiene configuración desactualizada de Railway (`railway.json` en raíz, README.md:149 "Despliegue en Railway", PROJECT_CONTEXT.md, DECISIONS.md DECISIÓN 7) que NO refleja la plataforma real; `PROJECT_MAP.md:276 y 432` ya advertían de esta discrepancia.
- **Fallback 1 (lazy-ensure, implementado P2B):** si el plan del día no existe, `ensurePlanPrevistoDia` (fuente `'hoy'`) lo congela reutilizando el state YA calculado en `/hoy` (read-or-freeze, sin re-ejecutar `getAthleteState`).
- **Fallback 2 (P2B, decisión Manu 12):** si al congelar `dataQuality === 'NO_DISPONIBLE'` (o no hay decisión válida) → **NO se congela nada** ("nunca inventar datos"). **NO se crea fila artificial `estado='sin_datos'`** (`congelarPlanPrevisto` la rechaza, C5); las comparaciones de ese día se omiten porque no hay plan. *(Refina el texto literal original de este Fallback 2.)*

**Reglas de congelación (cerradas):**

| Pregunta | Regla |
|---|---|
| Momento de creación | Primera decisión válida del día con dataQuality ≠ NO_DISPONIBLE (disparador real: cron externo → `/api/cron/plan-diario`; el scheduler interno 06:30 NO está implementado, §18.1) |
| Identificador | `fecha` (DATE calendario en `Europe/Madrid`) + `user_id`. UNIQUE por día |
| Qué se congela | **Baseline PRE-INTENCIÓN (decisión Manu P2B-11):** `state.decision` tras `resolverConflictos` + `validarSeguridad` + `generateWorkout` + Training Need snapshot. **NO participan** motorIntencion, ajuste automático ni Substitution Engine. *(Refina el texto literal original "tras la capa de contexto".)* Con su `workout` completo (tipo, reps, durMin, recSec, intensidad, tssEsperado, ifEsperado, vatios, motivo) y su Training Need (§4) |
| Datos almacenados | `decision` (JSONB), `workout` (JSONB), `training_need` (JSONB), `congelado_en` (timestamptz), `fuente` ('scheduler'/'hoy'/'sync'/'cron'), `estado` |
| `/hoy` varias veces | Solo la primera congela (upsert `ON CONFLICT DO NOTHING`). Siguientes `/hoy` muestran la decisión del momento; **el plan previsto no se toca** |
| Estado cambia durante el día | Plan previsto inmutable; decisión actual se recalcula libremente. La validez de una sustitución se valida contra el estado del momento (§7, §10) |
| Plan existe y se recalcula una decisión | La nueva decisión solo va a trazas/pantalla; nunca sobrescribe el congelado. Excepción única: plan `sin_datos` → primera decisión válida posterior lo completa |
| Fuente de verdad | **Supabase, tabla `plan_previsto_diario`**. Memoria y trazas = caché/auditoría |

### 3.3 Estados del plan previsto

```
VIGENTE ──(sustitución aceptada)──▶ SUSTITUIDO ──(actividad real registrada)──▶ COMPLETADO
VIGENTE ──(actividad real sin sustitución)──▶ COMPLETADO
VIGENTE ──(23:59 sin actividad ni sustitución)──▶ EXPIRADO
(cualquiera) ──(sin datos fisiológicos todo el día)──▶ SIN_DATOS
```

> ⚠️ **ESTADO REAL (05/09/2026): NO implementado.** El código (`persistenciaPlan.js`) solo escribe `estado='VIGENTE'` (valor por defecto) y **rechaza** `SIN_DATOS` (C5); las transiciones a `SUSTITUIDO`/`COMPLETADO`/`EXPIRADO` **no existen** en el código. Esta máquina de estados queda pendiente (relacionada con `aplicarConsecuencias`, §8). No asumir que está operativa.

---

## 4. TRAINING NEED — definición completa

**Concepto:** el `Training Need` (TN) es el objeto que captura **qué necesita el atleta hoy y con qué margen de maniobra cuenta el entrenador**. Es la única información que el Substitution Engine (F2) puede usar para decidir si una sustitución es válida y qué consecuencias tiene.

**Regla de diseño:** cada campo existe porque interviene en al menos una decisión concreta del entrenador (tabla de "decisión que justifica el campo"). No hay campos "por si acaso".

**Origen:** `calcularTrainingNeed()` (F2) **deriva** todos los valores del pipeline v9.5 existente. No introduce cálculos nuevos de fisiología: reutiliza `calcularEstadoSistema`, `aplicarRestriccionesGlobales`, `decidirEntrenamiento`, `resolverConflictos`, `getTssObjetivoSemanal`, `contarSesionesCalidadSemana`, `obtenerHistorial` y `dataQuality`.

**Cuándo se calcula y se actualiza:**

| Momento | Versión generada | Consumidor |
|---|---|---|
| Congelación del plan previsto (§3.2) | TN **congelado** del plan | Comparaciones de sustitución, casos límite, auditoría |
| Al pedir una sustitución ("no me apetece", intención grupeta…) | TN **fresco** del momento (estado actual) | Decisión de sustitución en tiempo real |
| Al registrar la sesión realizada | TN congelado + real → consecuencias | `aplicarConsecuencias` |

El TN fresco nunca sobrescribe el TN congelado: ambos se guardan en el registro de sustitución (§5).

### 4.1 Bloque A — Identidad y sesión solicitada

| Campo | Tipo | Obl. | Significado | Origen · quién lo calcula · cuándo | Consumidor | Rango válido | Ejemplo |
|---|---|---|---|---|---|---|---|
| `fecha` | date | ✅ | Día calendario al que aplica la necesidad | Derivado de la congelación (scheduler) | Todos | fecha válida TZ Madrid | `2026-09-01` |
| `tipo_solicitado` | enum | ✅ | Tipo de sesión que el plan pide hoy | `decidirEntrenamiento`+contexto, en congelación | Substitution Engine: define la clase de equivalencia aceptable | z1,z2,z3,sweetspot,ftp,vo2,descanso | `sweetspot` |
| `intensidad_solicitada_if` | float | ✅ | IF objetivo de la sesión (estímulo de intensidad) | `decision.intensidad` congelada | Comparar IF real/sustituto vs objetivo | 0.40–1.20 | `0.88` |
| `duracion_solicitada_min` | int | ✅ | Duración prevista | `decision.durMin` congelada | Calcular TSS del sustituto, impacto semanal | 0–300 | `75` |
| `tss_objetivo` | int | ✅ | TSS esperado de la sesión prevista | `workout.tssEsperado` congelado | Impacto en TSS semanal; clasificar sustitución como cubierta/parcial | 0–400 | `92` |
| `objetivo_sesion` | enum | ✅ | Propósito fisiológico de la sesión | Derivado: calidad si tipo∈{sweetspot,ftp,vo2}; recuperación si z1/tsb<-10; resistencia si z2 largo; base resto | Decidir qué tipos son sustitutos válidos (§7.2) | base, calidad, recuperacion, resistencia | `calidad` |
| `es_sesion_calidad` | bool | ✅ | ¿Cuenta para el límite de sesiones de calidad semanal? | `objetivo_sesion==='calidad'` | Regla maxSesionesCalidad al aceptar sustituciones | true/false | `true` |

**Decisión que justifica el bloque A:** *"¿Es la sesión B un sustituto válido de la sesión A?"* — solo se responde comparando tipo/objetivo/estímulo previsto vs propuesto.

### 4.2 Bloque B — Contexto semanal (carga y calidad)

| Campo | Tipo | Obl. | Significado | Origen · cuándo | Consumidor | Rango | Ejemplo |
|---|---|---|---|---|---|---|---|
| `tss_semanal_actual` | int | ✅ | TSS acumulado de la semana en curso | `estado.weeklyTss` | Impacto de la sustitución sobre el objetivo semanal | 0–1500 | `310` |
| `tss_semanal_objetivo` | int | ✅ | Objetivo TSS de la fase | `getTssObjetivoSemanal()` | Ídem | 200–800 | `550` |
| `tss_semanal_restante` | int | ✅ | Objetivo − actual − previsto hoy | Derivado | ¿La sustitución deja la semana por debajo? ¿recuperar cuándo? | −400–800 | `148` |
| `calidad_realizadas_semana` | int | ✅ | Sesiones de calidad ya hechas esta semana | `contarSesionesCalidadSemana()` + sustituciones aceptadas como calidad | ¿Queda hueco para una calidad? | 0–7 | `1` |
| `calidad_max_semana` | int | ✅ | Límite de calidad de la fase | `getMaxSesionesCalidad()` | No aceptar sustituto de calidad si ya se llegó al límite | 0–2 | `2` |
| `calidad_pendiente_semana` | int | ✅ | Cuántas calidades faltan aún por hacer/programar | Derivado: max − realizadas − programadas restantes | Decidir si un rechazo de calidad se reprograma o se asume | 0–2 | `1` |

**Decisión que justifica el bloque B:** *"¿Qué consecuencias tiene aceptar/rechazar esta sustitución sobre el objetivo semanal y el resto de la semana?"*

### 4.3 Bloque C — Estado fisiológico y seguridad (snapshot del momento)

| Campo | Tipo | Obl. | Significado | Origen · cuándo | Consumidor | Rango | Ejemplo |
|---|---|---|---|---|---|---|---|
| `tsb` | float | ✅ | Forma del día | `calcularEstadoSistema` | ¿Puede un sustituto más duro? ¿debe ser más suave? | −60–40 | `−8.2` |
| `ctl` / `atl` | float | ✅ | Carga crónica/aguda | Ídem | Contexto de entrenador en la decisión y mensajes | 0–200 | `58 / 64` |
| `acwr` | float | ✅ | Ratio carga aguda/crónica | Ídem | Bloquear sustitutos intensos si >1.3/1.5 | 0.3–2.5 | `1.12` |
| `readiness` | int | ✅ | Readiness del día | Ídem | Igual que TSB | 0–100 | `72` |
| `hrv` | int | ⭕ | HRV del día (null si no hay dato) | Garmin/Supabase | Restricción de intensidad (HRV<40 en v9.5) | 20–120 o null | `56` |
| `sleep_quality` | int | ⭕ | 1=malo 2=normal 3=bueno (null si no hay) | Garmin/Supabase | Reducción de intensidad | 1–3 o null | `2` |
| `restricciones_activas` | string[] | ✅ | Flags de seguridad vigentes (de `aplicarRestriccionesGlobales` y `resolverConflictos`) | Snapshot al calcular el TN | **Todo sustituto debe respetarlas** (§10) | lista controlada | `["forzarZ2","intensidadMax:0.75"]` |
| `data_quality` | enum | ✅ | Frescura de los datos del TN | `estado.dataQuality` | Si NO_DISPONIBLE → no se decide nada, solo descanso/conservador | FRESH,STALE,FALLBACK,NO_DISPONIBLE | `FRESH` |

**Decisión que justifica el bloque C:** *"¿Este sustituto es seguro HOY y respeta las restricciones que ya impuso la jerarquía de seguridad?"*

### 4.4 Bloque D — Historial de sustituciones y necesidades pendientes

| Campo | Tipo | Obl. | Significado | Origen · cuándo | Consumidor | Rango | Ejemplo |
|---|---|---|---|---|---|---|---|
| `sustituciones_semana_total` | int | ✅ | Sustituciones aceptadas esta semana | `registro_sustituciones` (COUNT semana en curso) | Detectar patrón de incumplimiento estructural | 0–7 | `3` |
| `sustituciones_semana_calidad` | int | ✅ | Sustituciones que eliminaron/pospusieron calidad | Ídem con filtro | Regla: máximo 1 reprogramación de calidad por semana | 0–7 | `1` |
| `rechazos_consecutivos_similares` | int | ✅ | Días consecutivos rechazando sesiones del mismo `objetivo_sesion` | Ídem (racha) | Caso "rechaza la intensidad dos días seguidos" → cambiar el plan, no insistir | 0–7 | `2` |
| `necesidades_pendientes` | array | ✅ | Necesidades de días anteriores no cubiertas: `[{fecha_origen, tipo, es_calidad, reprogramaciones}]` | `plan_previsto_diario` + `registro_sustituciones` (días previos de la semana) | Reprogramar con límite; heredar al decidir hoy | máx 1 reprogramación por necesidad | `[{fecha_origen:"2026-08-31",tipo:"vo2",es_calidad:true,reprogramaciones:1}]` |

**Decisión que justifica el bloque D:** *"¿Estoy ante un episodio aislado o ante un patrón que obliga a cambiar el plan, no solo el día?"* — este bloque es el que convierte la filosofía v9.5 (aprendizaje de desviaciones) en dato estructurado.

### 4.5 Resumen: cada bloque → cada pregunta del entrenador

| Pregunta del entrenador | Bloque del TN que la responde |
|---|---|
| ¿Qué necesito hoy y por qué? | A |
| ¿Qué pasa con la semana si cambio esto? | B |
| ¿Es seguro y está permitido? | C |
| ¿Es un episodio aislado o un patrón? ¿Qué arrastro de días previos? | D |

---

## 5. PERSISTENCIA Y FUENTE DE VERDAD

| Dato | Fuente de verdad | Medio | Cambio |
|---|---|---|---|
| Plan previsto del día | `plan_previsto_diario` (Supabase) | 🆕 Tabla | Nuevo |
| Training Need congelado | Columna `training_need` de `plan_previsto_diario` | 🆕 | Nuevo |
| Registro de sustituciones y sus consecuencias | `registro_sustituciones` (Supabase) | 🆕 Tabla | Nuevo |
| Sesión realizada | `actividades_guardadas` + `historial_entrenos` | Existente | Sin cambios (se separa semánticamente: esas tablas son SOLO lo realizado) |
| Estado fisiológico | Garmin + Intervals vía Supabase | Existente | Sin cambios |
| Aprendizaje de motivos | `aprendizaje_desviaciones` | Existente (memoria hoy) | 🟡 Evolucionar: misma clasificación de categorías, escritura en `registro_sustituciones` |
| Trazas de decisión | `historial_trazas` (memoria, máx 100) | Existente | Sin cambios (auditoría, no fuente de verdad) |

**Esquema propuesto (a crear en F2, no antes):**

```sql
plan_previsto_diario (
  user_id text, fecha date, decision jsonb, workout jsonb, training_need jsonb,
  congelado_en timestamptz, fuente text, estado text,
  PRIMARY KEY (user_id, fecha)
)
registro_sustituciones (
  id bigint identity, user_id text, fecha date,
  sesion_original jsonb, sesion_propuesta jsonb, training_need_congelado jsonb,
  training_need_fresco jsonb, categoria text, decision text,
  consecuencias jsonb, creado_en timestamptz
)
```

`categoria` reutiliza las categorías ya existentes en `procesarRespuestaDesviacion` (grupeta, cambio_voluntario, imposibilidad, lesion, otro). `decision` ∈ {aceptada, rechazada, parcial}. `consecuencias` = salida de `aplicarConsecuencias` (§8) — **pendiente de implementar**.

> ⚠️ **ALINEACIÓN CON EL CÓDIGO REAL (05/09/2026):** el payload que escribe `persistenciaPlan.js` difiere de este esquema propuesto y es el que debe crearse en Supabase (C10):
>
> - `plan_previsto_diario`: PK `(user_id, fecha)`; columnas `decision`/`workout`/`training_need` JSONB, `tipo_previsto`, `duracion_prevista_min`, `tss_previsto`, `intensidad_prevista`, `es_calidad`, `fuente`, `estado` (`congelado_en` depende del DEFAULT de la columna en Supabase; no se envía explícito).
> - `registro_sustituciones`: columnas `user_id`, `fecha`, `prevista_tipo`, `prevista_tss`, `prevista_duracion_min`, `prevista_es_calidad`, `sustituta_tipo`, `sustituta_tss`, `sustituta_duracion_min`, `sustituta_es_calidad`, `tss_real`, `categoria`, `decision` (solo `'aceptada'`), `motivo`, `training_need_congelado`; índice único parcial `(user_id, fecha) WHERE decision='aceptada'` (idempotencia). **No** se escriben `sesion_original`/`sesion_propuesta`/`training_need_fresco`/`consecuencias`/`creado_en` (reservados para F2/F3 con `aplicarConsecuencias`).

---

## 6. FLUJO DE DECISIÓN (orden canónico)

> ✅ **Orden real implementado en `getAthleteStateConAjuste()` (index.js:7003, verificado 05/09/2026):**

1. `obtenerDatosCompletos()` (1984) → `calcularEstadoSistema()` (2148) → estado + `dataQuality` (+ señal `estado.indoor` desde f4e8048, ~3891).
2. `aplicarRestriccionesGlobales()` (2891) → restricciones.
3. `decidirEntrenamiento()` (2981) → decisión base.
4. `resolverConflictos()` (2516) → **decisión validada en seguridad** (autoridad máxima).
5. **Capa de contexto** (motor de intención ~7013 + ajustes históricos ~7022, §9): consolida intención/ajustes.
6. **`validarSeguridad()`** (~7030) → gate obligatorio (seguridad.js): revalida NIVEL 1-2 (incl. HI>40 con/sin indoor) y las restricciones activas. *(Prerequisito de seguridad, §10.)*
7. **`calcularTrainingNeedInformativo()`** (~7036) → TN (capa informativa, NO muta nada).
8. **Lazy-ensure P2B** `ensurePlanPrevistoDia` (~7045): congela el baseline PRE-intención (P2B-11) solo si no existe plan.
9. **Substitution Engine P2** `ejecutarSustitucionP2` (~7055): candidato = intención detectada; comparado contra el plan congelado; re-gate + registro solo si se aplica.
10. Si hubo intención/ajuste → `generateWorkout()` regenera el workout (~7091); si no, se usa el del pipeline.
11. Mostrar al atleta (`/hoy` etc.).

En v9.5 los pasos 5-6 no existían como gate; en F2 se introdujeron sin tocar los pasos 1-4. El orden canónico completo gate → TN → ensure P2B → SE P2 está verificado por los tests (I7, P2B-14).

---

## 7. SUSTITUCIÓN

### 7.1 Distinguir dos operaciones (regla del diseño)

| Operación | Qué hace | Dónde vive |
|---|---|---|
| **Registrar una sustitución** | Guardar el hecho: sesión A prevista → sesión B propuesta/realizada, motivo, categoría, TN congelado + TN fresco | `registro_sustituciones` |
| **Actualizar el estado de entrenamiento** | Recalcular lo que la sustitución cambia hacia delante: objetivo semanal, necesidades pendientes, sesión siguiente | `aplicarConsecuencias` (§8) + TN del día siguiente |

Ninguna implementación futura puede limitarse a registrar `Tempo → Grupeta` y terminar ahí: el registro sin consecuencias está explícitamente fuera del DoD de F2.

### 7.2 Reglas de decisión del entrenador para sustituciones (v1, F2)

1. **Equivalencia de estímulo:** la sesión B es sustituto válido de A si `objetivo_sesion(B)` cubre `objetivo_sesion(A)` según las clases de equivalencia ya existentes en `motorIntencion.EQUIVALENCIAS[].equivalenciaPlan` (reutilización directa; se corrige la duplicidad del clasificador por NP de `analizarCumplimientoPlan` usando estas clases también ahí). **Clases funcionales plan→plan (APROBADO en revisión F2):** `calidad={sweetspot,ftp,vo2}`, `base={z2,z3}`, `recuperación={z1}`, `descanso={descanso}`; tipos de la misma clase son equivalentes entre sí. Para candidatos provenientes de intención (grupeta/rodillo/salida_tranquila/descanso) la equivalencia la da `EQUIVALENCIAS[].equivalenciaPlan` tal cual, sin ampliarla. No se inventan equivalencias fuera de estas clases.
2. **Carga:** el TSS estimado de B debe estar dentro de **±30% del `tss_objetivo` de A, rango estricto (APROBADO en revisión F2)**: fuera del rango → NO VÁLIDO, sin redondeos. **Única excepción (§18.5): candidato `tipo='descanso'`**, al que no se aplica el chequeo de carga (TSS=0 haría imposible sustituir cualquier sesión con carga). Si B es menor (dentro del rango), la sustitución es "parcial" y `tss_semanal_restante` absorbe la diferencia (no se "persigue" el TSS perdido al día siguiente si `tsb` < −10).
3. **Calidad semanal:** un sustituto con `es_sesion_calidad=true` solo se acepta si `calidad_realizadas_semana < calidad_max_semana`. Si se sustituye una calidad por algo no equivalente y `calidad_pendiente_semana > 0`, la necesidad se marca `REPROGRAMADA` (máximo 1 vez, §4.4); a la segunda, `CANCELADA` y el objetivo semanal se asume degradado (filosofía: adherencia > perfección).
4. **Seguridad primero (§10):** si `restricciones_activas` no está vacía, el sustituto debe cumplirlas. Un sustituto propuesto por el atleta que las viole se rechaza explicando el motivo (tono de entrenador, no bloqueo seco).
5. **Contexto posterior:** toda sustitución aceptada o parcial genera consecuencias (§8) y actualiza el TN del día siguiente.

### 7.3 Entradas que disparan una sustitución

| Disparador | Origen v9.5 | Flujo |
|---|---|---|
| "No me apetece" / rechazo declarado | Nuevo comando/respuesta conversacional (reutiliza patrón `esperando_respuesta_desviacion`) | TN fresco → reglas 7.2 → registro → consecuencias |
| Intención grupeta/rodillo/salida detectada | `motorIntencion.detectarIntencion` (ya existe) | Misma vía: la intención se convierte en propuesta de sustitución con TN fresco |
| Desviación detectada a posteriori | `analizarCumplimientoPlan` / `verificarDesviacionTiempoReal` (ya existen) | Clasificación → registro → consecuencias (hoy solo clasifica) |

---

## 8. CONSECUENCIAS SOBRE EL CONTEXTO FUTURO

`aplicarConsecuencias(sustitucion)` determina, cuando corresponde:

| Consecuencia | Regla v1 | Dónde impacta |
|---|---|---|
| **Objetivo semanal** | `tss_semanal_restante' = restante − (tss(B) − tss(A))`. Si B > A (grupeta dura), el exceso NO se recorta después, se marca la semana "por encima" y el TN de mañana baja intensidad (`objetivo_sesion=recuperacion`) | TN siguiente |
| **Sesiones posteriores** | Si B dejó fatiga extra (TSS real > 130% del previsto o IF real > 1.0), el TN del día siguiente fuerza `restricciones_activas` con `forzarZ2`/z1. Si B fue parcial (TSS < 70%), NO se añade calidad extra; solo se ofrece z2 opcional | TN del día siguiente |
| **Necesidades pendientes** | La necesidad no cubierta entra en `necesidades_pendientes` con `reprogramaciones++`. Máx 1 reprogramación; a la 2ª, CANCELADA | TN siguiente |
| **Contexto de las siguientes decisiones** | Los contadores del bloque D (`sustituciones_semana_*`, `rechazos_consecutivos_similares`) se recalculan siempre desde `registro_sustituciones` | Todos los TN futuros de la semana |
| **Aprendizaje** | El motivo de la sustitución se escribe en el mismo formato de categorías que el aprendizaje v9.5 | `registro_sustituciones` + (transición) `aprendizaje_desviaciones` |

**Regla explícita:** una sustitución aceptada **sí** actualiza el estado de entrenamiento; una rechazada (el atleta hace lo previsto) solo se registra si hubo propuesta intermedia. Nunca se duplican contadores (una sola escritura por sustitución, idempotente por `(user_id, fecha)`).

---

## 9. EVOLUCIÓN INCREMENTAL DE LOS TRES MECANISMOS (sin big-bang)

**Principio:** no borrar tres sistemas para crear uno nuevo; hacer evolucionar los tres hasta que alimenten una decisión única y coherente.

### 9.1 Papel actual, papel en transición y destino

| Mecanismo | Hoy (v9.5) | Papel durante la transición (F2) | Qué aporta a la capa única | Destino final |
|---|---|---|---|---|
| `motorIntencion.adaptarDecisionParaIntencion()` | Muta la decisión post-conflictos (p.ej. grupeta 120min/0.85) sin revalidar | Se conserva **como generador de propuestas**: su salida deja de ser "la decisión" y pasa a ser "sesión B propuesta" con TN fresco. EQUIVALENCIAS y consejos intactos | Propuesta de sustitución + clases de equivalencia + tono de entrenador | Proveedor de propuestas; su mutación directa se retira en F3 cuando F2 esté estable |
| `ajustarPlanAutomaticamente()` | Muta la decisión por patrones históricos (>60% desviación) | Se conserva como **señal**: calcula tasa/categoría pero deja de mutar; emite "recomendación de ajuste" que la capa única evalúa y registra | Detección de patrones estructurales → alimenta bloque D del TN | Se fusiona con el cálculo del bloque D; desaparece como mutador |
| Aprendizaje/desviaciones (`procesarRespuestaDesviacion`, `predecirDesviaciones`, `analizarCumplimientoPlan`) | Detecta/clasifica a posteriori; escribe `aprendizaje_desviaciones` (memoria) | Se conserva el **flujo conversacional y las categorías**; su escritura pasa a `registro_sustituciones` y pasa a ejecutar `aplicarConsecuencias` | Registro con motivo/categoría + contadores del bloque D | Única vía de registro de sustituciones (no se duplica con el flujo "no me apetece") |

### 9.2 Cómo se evita que dos mecanismos decidan cosas contradictorias

1. **Un solo punto de consolidación:** la Capa de Entrenador (§2) es el único lugar donde convergen intención + ajuste histórico + declaración del atleta, y produce una única "decisión consolidada".
2. **Un solo gate a continuación:** `validarSeguridad()` (§10) revalida la decisión consolidada. Ningún mecanismo escribe después del gate.
3. **Orden determinista:** intención → ajustes históricos → declaración del atleta (la declaración es la última entrada: los patrones históricos informan, nunca pisan una declaración explícita del día).
4. **Un solo registro:** todo cambio respecto al plan congelado se escribe en `registro_sustituciones` con su TN; no hay canales paralelos.

### 9.3 Qué NO se elimina todavía

- `motorIntencion.js` completo — sigue en producción tal cual.
- `ajustarPlanAutomaticamente` y `predecirDesviaciones` — siguen tal cual hasta que F2 esté validado; su retirada progresiva es de F3.
- Flujo de desviaciones y `aprendizaje_desviaciones` — se conserva; se añade escritura espejo en Supabase.
- `index.js` no se parte en módulos en F2 (deuda previa del roadmap v9.5; no mezclar frentes).

---

## 10. 🔴 JERARQUÍA DE SEGURIDAD — PREREQUISITO PARA F2

### 10.1 Análisis exacto de v9.5 (verificado con evidencia directa)

**Qué puede imponer `resolverConflictos()` (2516-2700):**

| Nivel | Disparador | Efecto |
|---|---|---|
| 1 SEGURIDAD | TSB<−30 / readiness<30 | `descanso` override |
| 1 SEGURIDAD | ACWR>1.5 | z2, 25min, IF 0.60 |
| 2 CLIMA | HI>40 | `descanso` override (o Z2 máx 45/IF 0.70 si `estado.indoor`, desde f4e8048) |
| 2 CLIMA | HI>38/35/32 | durMin ×0.80-0.95, tipo→z2 |
| 3 FATIGA | TSB<−20 | vo2/ftp→sweetspot, durMin≤45, IF 0.85 |
| 3 FATIGA | HRV<40 | intensidad ×0.80, vo2/ftp→sweetspot |
| 3 FATIGA | sleep=1 | intensidad ×0.85 |

**Orden real de ejecución (números de línea actualizados a HEAD `97f5fc5`):**

1. `getAthleteStateConAjuste()` (7003) → línea **7005**: `await getAthleteState()` → dentro, línea **3932**: `resolverConflictos(estado, restricciones, decision, traza)` → **aquí se establece la decisión validada en seguridad**.
2. Línea **7013-7018**: `motorIntencion.adaptarDecisionParaIntencion(state.decision, intencion, state.estado)` — muta la decisión ya validada sin revalidación (lo corrige el gate del paso 6).
3. Línea **7021-7024**: si `!decisionAjustada.esIntencion` → `ajustarPlanAutomaticamente(decisionAjustada)` (7022) — segunda mutación, tampoco revalida. (Cuando la intención actuó en el paso 2, este paso NO corre.)
4. Línea **7030**: **`validarSeguridad(decisionAjustada, state.estado, state.restricciones)` — GATE (implementado, seguridad.js)**. A continuación: TN (7036), lazy-ensure P2B (7045), SE P2 (7055).
5. Línea **7091**: si hubo mutación, `generateWorkout(state.estado, state.restricciones, decisionAjustada, ...)` regenera el workout desde la decisión ya pasada por el gate.

**Fragmento 1 — `resolverConflictos()`, rama ACWR>1.5 (index.js:2548-2558):**

```javascript
if (estado.acwr > 1.5) {                       // 2548
  ...
  resultado.durMin = Math.min(resultado.durMin || 30, 25);   // 2551
  resultado.tipo = 'z2';                       // 2553
  resultado.intensidad = 0.60;                 // 2554
  resultado.reps = 1;                          // 2555
  ...
}
```

**Fragmento 2 — `ajustarPlanAutomaticamente()`, caso que impone IF 0.88 (index.js:6957-6966):**

```javascript
} else if (categoriaPrincipal === 'cambio_voluntario') {     // 6957
  if (tipo === 'vo2' || tipo === 'ftp') {                    // 6959  ← GUARD
    decision.tipo = 'sweetspot';                             // 6960
    decision.intensidad = 0.88;                              // 6961
```

**Fragmento 3 — `aplicarRestriccionesGlobales()`, origen de `intensidadMax` (index.js:2926-2928):**

```javascript
if (estado.flags.estaFatigado && estado.readiness < 60) {    // 2926
  restricciones.forzarZ2 = true;                             // 2927
  restricciones.intensidadMax = 0.75;                        // 2928
```

### Resultado de la reverificación (con atribución corregida)

| # | Contradicción | Veredicto |
|---|---|---|
| **A** | **CONFIRMADA (la grave).** `adaptarDecisionParaIntencion` rama grupeta (motorIntencion.js:183-204, verificado: sobrescribe `tipo='grupeta'`, `durMin=120`, `intensidad=0.85`, con 0.75 si `tsb<-10` en 199-201) corre en el paso 2 y `detectarIntencion` NO evalúa ACWR, HRV ni sueño → con ACWR>1.5 pisa `z2/25min/0.60` y deja `grupeta/120min/0.85` (o `120min/0.75` si TSB<−10; en ambos casos IF > 0.60 y durMin > 25: pisoteo confirmado, test A0). Lo mismo aplica a cualquier reducción de NIVEL 2-3 (p.ej. HRV<40 → IF≈0.52 en 2632) | ✅ Bug real, atribuido al **motor de intención** |
| **B** | **NEGADA la variante "ajustarPlanAutomaticamente impone IF 0.88 tras ACWR>1.5".** El IF 0.88 está dentro del guard `tipo === 'vo2' || tipo === 'ftp'` (6959): tras un override ACWR>1.5 el tipo ya es `'z2'` (2553), por lo que el 0.88 es **inalcanzable** en ese escenario. Tras un ACWR>1.5, `ajustarPlanAutomaticamente` solo puede aplicar el caso grupeta-histórica (6942-6949): sube IF 0.60→0.65 — pisoteo residual menor, también sin revalidación | ⚠️ Corregido: esta variante no procede |
| **C** | El IF 0.88 de `ajustarPlanAutomaticamente` SÍ es una contradicción real, pero contra `restricciones.intensidadMax` (0.75 fatiga acumulada / 0.90 calor) y **solo cuando no hubo trigger NIVEL 1-3** y el tipo sigue siendo vo2/ftp. Verificación menor pendiente en F2: si `decidirEntrenamiento` ya clampea contra `intensidadMax` al decidir, este caso podría no llegar a materializarse; el gate del §10.2 lo cubre en cualquier caso | ✅ Bug real (condicionado) |
| **D** | `adaptarDecisionParaIntencion` salida_tranquila (motorIntencion.js:217-228, verificado: `durMin=60` en línea 220) pisa el cap `durMin=45` de TSB<−20 (index.js:2621-2624) | ✅ Bug real |

**Dónde se produce:** `getAthleteStateConAjuste()`, pasos 2-4 (líneas 6930-6955): la decisión ya resuelta por seguridad se muta sin volver a pasar por la jerarquía. **El objetivo primario del gate del §10.2 es la mutación del motor de intención (caso A), que es la de mayor magnitud y la que corre siempre.**

<!-- La tabla de niveles de resolverConflictos se movió al inicio de §10.1. -->

### 10.2 PREREQUISITO DE SEGURIDAD PARA F2 (bloqueante)

> **Ninguna capa posterior puede invalidar una restricción de seguridad establecida por `resolverConflictos()` sin pasar nuevamente por la jerarquía de seguridad.**

- **Prioridad definitiva:** Seguridad (`resolverConflictos`) > decisión consolidada de la Capa de Entrenador > preferencia del atleta.
- **Cambio mínimo necesario (en F2, no antes):** extraer `validarSeguridad(decision, estado, restricciones)` que re-ejecute los chequeos NIVEL 1-2 y clampee contra `restricciones.intensidadMax`, `volumenMax`, `zonasPermitidas`, `forzarZ2`, `forzarDescanso`; invocarlo al final de `getAthleteStateConAjuste` y en cada aceptación de sustitución. Es un refactor de extracción (reutiliza la lógica existente), sin tocar los pasos 1-4 del pipeline.
- **Estado:** BLOQUEANTE. F2 no se considera implementable sin este gate funcionando y verificado con tests.

> **📌 DECISIÓN F2 — CIERRE DEL GATE (29/08/2026):** Se detectaron 5 caminos formales sin gate hacia `generateWorkout()` (fallback `catch` de `getAthleteStateConAjuste()` en 7132, `chatConIA()` en 1038, `analizarCumplimientoPlan()` en 7608, `GET /api/estado` en 8405 y `POST /api/comando` en 8415), todos seguros por construcción: en ninguno de ellos se ejecutan las capas mutadoras y las decisiones llegan directamente desde `resolverConflictos()`. Se decide NO cerrarlos estructuralmente y confiar en la regla arquitectónica de que **ninguna capa mutadora puede ejecutarse después de `validarSeguridad()`**. Cualquier capa mutadora, incluido el Substitution Engine, debe ejecutarse antes del gate y respetar explícitamente este invariante. Las capas puramente informativas/diagnósticas (p. ej. Training Need) no son mutadoras y no quedan sujetas a esta restricción de colocación. *(Líneas actualizadas a HEAD `97f5fc5`.)*

---

## 11. ALCANCE F2 — Substitution Engine v1 (estado de implementación, 05/09/2026)

1. **`validarSeguridad()`** — gate del §10.2 → ✅ **IMPLEMENTADO** (`seguridad.js`, conectado en `getAthleteStateConAjuste` ~7030 y en el re-gate del SE; suite 9/9).
2. **`calcularTrainingNeed()`** — TN según §4 → ✅ **IMPLEMENTADO** (`trainingNeed.js` + adapter `calcularTrainingNeedInformativo`, capa informativa post-gate; suites 13/13 + integración 7/7).
3. **Congelación del plan previsto** — ✅ **IMPLEMENTADO** (P2B): cron externo (`POST /api/cron/plan-diario`, fuente `'cron'`) + lazy-ensure en `/hoy` (fuente `'hoy'`, `ensurePlanPrevistoDia` 7545), upsert idempotente en `plan_previsto_diario`; regla **sin fila `sin_datos`** (P2B-12). ⚠️ El **scheduler interno** (`setInterval`) NO está implementado (decisión §18.1 abierta).
4. **Tablas nuevas** — `plan_previsto_diario` y `registro_sustituciones` → ❌ **PENDIENTE** (C10: las crea Manu en Supabase; `persistenciaPlan.js` no crea tablas). Esquema alineado en §5.
5. **Registro de sustituciones** — ⚠️ **PARCIAL:** la conexión de la intención del motor de intención como entrada de sustitución está implementada (P2, `ejecutarSustitucionP2` 7291, solo aceptadas); las desviaciones detectadas (`analizarCumplimientoPlan`) ya leen el plan congelado pero **NO escriben** `registro_sustituciones` todavía; el flujo conversacional **"no me apetece" NO está implementado** (patrón `esperando_respuesta_desviacion` preparado).
6. **Reglas de decisión v1** — ✅ **IMPLEMENTADAS** en `substitutionEngine.js` (S1-S10): equivalencia, carga ±30% (excepción descanso), límite 3/semana, seguridad (la aplica el caller), grupeta-como-calidad. ⚠️ La regla 5 (contexto posterior → `aplicarConsecuencias`) queda pendiente (item 7).
7. **`aplicarConsecuencias()`** — §8 → ❌ **NO IMPLEMENTADO** (pendiente de autorización).
8. **Transición §9** — ❌ **NO implementada**: `motorIntencion.adaptarDecisionParaIntencion` y `ajustarPlanAutomaticamente` siguen siendo mutadores (este último ya sin mutar la entrada, copia). Las desviaciones aún no escriben en `registro_sustituciones`.
9. **Tests unitarios** con mocks → ✅ **IMPLEMENTADOS**: 130/130 (11 suites) con mocks de Supabase (`__setCliente`) y extracción de fuente para el monolito.

**Comportamiento exigido al Substitution Engine v1:** ante cualquier propuesta de cambio de sesión, debe responder las tres preguntas con datos, no con intuición: *¿es equivalente? (§7.2.1-2) ¿es seguro y está permitido? (§10 + §7.2.4) ¿qué consecuencias tiene? (§8)* — y dejar ambas decisiones y sus TN registrados.

## 12. ALCANCE F3 — deliberadamente fuera

| Funcionalidad | Por qué queda fuera de F2 |
|---|---|
| Retirada definitiva de `adaptarDecisionParaIntencion`/`ajustarPlanAutomaticamente` como mutadores | Solo cuando la capa única lleve semanas en producción con registros que lo avalen (transición segura, no prisa) |
| Recalculación multi-día del plan completo tras una sustitución (replanificar martes→domingo en cadena) | F2 cubre impacto en el TN del día siguiente; la replanificación en cadena necesita ver F2 funcionando en real para definir sus reglas sin inventar producto |
| IA conversacional (OpenRouter) para motivar/clasificar sustituciones en lenguaje natural | La clasificación por categorías de v9.5 es suficiente para v1; la IA es mejora de UX, no de la lógica |
| Predicción proactiva de sustituciones ("te va a apetecer grupeta, adelanto la calidad") | Depende de datos de `registro_sustituciones` que aún no existen |
| Multiusuario, split de módulos de `index.js`, TypeScript, Strava | Deuda del roadmap v9.5, sin relación con el Substitution Engine |
| Migración de fase/semana desde calendario real | Necesaria a medio plazo (gap G-6 §18) pero independiente; no condiciona F2 |

---

## 13. DEFINITION OF DONE — F2 (estado real, 05/09/2026)

F2 está terminada cuando — **estado actual marcado por item:**

1. Un día sin que el atleta abra `/hoy` deja plan previsto congelado en Supabase (verificable con test del scheduler con reloj simulado). → ⚠️ **PARCIAL:** la congelación por cron externo + lazy-ensure está implementada y testeada (P2B), pero **no hay scheduler interno con reloj simulado** (variante §18.1 abierta) y faltan las tablas (C10) para que funcione en producción.
2. `/hoy` repetido no muta el plan congelado; `dataQuality=NO_DISPONIBLE` impide congelar (regla `sin_datos` probada). → ✅ **CUMPLIDO** (P2B-2/3/4/7: read-or-freeze, no-sobrescritura, sin fila `SIN_DATOS`).
3. El TN congelado y el TN fresco se generan y se almacenan con el esquema §5, y cada campo traza su origen en el pipeline v9.5. → ⚠️ **PARCIAL:** el TN congelado se genera y persiste (P2B); el **TN fresco** en el registro de sustitución y el esquema §5 (alineado en la revisión) dependen de tablas y de `aplicarConsecuencias`.
4. El gate §10.2 existe y hay un test que demuestra que una grupeta propuesta con ACWR>1.5 **no** puede sobrepasar z2/25min/0.60. → ✅ **CUMPLIDO** (seguridad.js + tests A0/B0/R1-R7; además CI1-CI12 para el calor indoor).
5. El flujo `Tempo → "no me apetece" → grupeta` funciona de principio a fin y produce: registro en `registro_sustituciones` (con TN congelado + fresco), decisión explicada, y consecuencias aplicadas. → ❌ **NO CUMPLIDO:** el flujo conversacional "no me apetece" NO está implementado; `aplicarConsecuencias` tampoco.
6. Los 5 casos límite del §15 pasan como tests con los TN del §16. → ⚠️ **PARCIAL:** las reglas del motor están testeadas (S1-S10, TN1-TN13, P2/P2B), pero los 5 casos §15 **no** están testeados de extremo a extremo (flujo conversacional completo pendiente).
7. Ninguna función de v9.5 fue eliminada ni su comportamiento cambió salvo lo especificado en §9. → ✅ **CUMPLIDO** (los comandos existentes responden igual; `ajustarPlanAutomaticamente` ahora no muta la entrada, cambio de seguridad verificado por tests M1-M5).
8. Sin commits de implementación mezclados con otras tareas; migración reversible documentada. → ⚠️ **PARCIAL:** commits limpios en `freebuff-prueba` (`128861f`, `f4e8048`, `97f5fc5`) pero sin migración incluida (tablas C10 a mano) y sin push/deploy.

---

## 14. GATE: FLUJO `Tempo → "no me apetece" → grupeta`

**Flujo completo especificado (F2):**

1. Martes 06:30 — scheduler congela plan previsto: sweetspot 75min, IF 0.88, TSS 92 + TN congelado.
2. 18:10 — el atleta escribe "hoy no me apetece el tempo". El flujo reutiliza el patrón conversacional de desviaciones.
3. El sistema calcula el **TN fresco** (no reusa el congelado para el estado: usa el congelado como "sesión A" y el estado actual para validar).
4. Propuesta por defecto del entrenador: "¿grupeta o rodillo?" (puede venir sugerida por `detectarIntencion`).
5. El atleta elige grupeta → se evalúan las reglas §7.2 contra el TN → decisión → registro → consecuencias → respuesta con tono de entrenador explicando el porqué y el impacto en la semana.
6. Al día siguiente, el TN del miércoles ya incorpora las consecuencias (§8).

**Los 3 requisitos del principio de diseño se cumplen con datos del TN:** por qué es válida (bloque A vs equivalencia), en qué contexto (bloques B-C), qué consecuencias (§8 + bloque D del TN siguiente).

---

## 15. CASOS LÍMITE DEL GATE (los que F2 debe manejar en v1)

> Para cada caso: **caso límite → Training Need concreto (JSON) → valores → decisión → resultado**. ⚠️ Estado real (05/09/2026): las reglas del motor están testeadas, pero **los 5 casos NO están testeados de extremo a extremo** (falta el flujo conversacional "no me apetece" y `aplicarConsecuencias`; ver DoD #6). Se conservan como especificación para completar F2/F3.

### CASO 1 — Rechazo puntual de la calidad: `Tempo → "no me apetece" → grupeta`

- **Situación:** martes, plan congelado = sweetspot 75min/IF 0.88/TSS 92. El atleta declara que no le apetece y propone grupeta. Contexto: semana de desarrollo (550 TSS, 2 calidades), llevaba 1 calidad, 1 grupeta ya hecha el domingo no contó como calidad planificada.
- **Training Need congelado (sesión A):**

```json
{
  "fecha": "2026-09-01",
  "bloque_A": { "tipo_solicitado": "sweetspot", "intensidad_solicitada_if": 0.88,
                "duracion_solicitada_min": 75, "tss_objetivo": 92,
                "objetivo_sesion": "calidad", "es_sesion_calidad": true },
  "bloque_B": { "tss_semanal_actual": 310, "tss_semanal_objetivo": 550,
                "tss_semanal_restante": 148, "calidad_realizadas_semana": 1,
                "calidad_max_semana": 2, "calidad_pendiente_semana": 1 },
  "bloque_C": { "tsb": -8.2, "ctl": 58, "atl": 64, "acwr": 1.12, "readiness": 72,
                "hrv": 56, "sleep_quality": 2, "restricciones_activas": [],
                "data_quality": "FRESH" },
  "bloque_D": { "sustituciones_semana_total": 0, "sustituciones_semana_calidad": 0,
                "rechazos_consecutivos_similares": 0, "necesidades_pendientes": [] }
}
```

- **Qué aporta cada valor a la decisión:** `objetivo_sesion=calidad` + `EQUIVALENCIAS.grupeta.equivalenciaPlan` incluye `sweetspot` → la grupeta es equivalente en tipo; `tss_objetivo=92` cae bajo el rango grupeta 110-160 → la grupeta incluso sobre-cumple carga (regla §7.2.2); `restricciones_activas=[]` y ACWR 1.12 / TSB −8.2 → sin veto de seguridad; `calidad_realizadas(1) < calidad_max(2)` → la grupeta puede computar como la 2ª calidad de la semana; `rechazos_consecutivos=0` y `necesidades_pendientes=[]` → episodio aislado, sin patrón.
- **Decisión esperada:** sustitución **aceptada**. "Vale, grupeta hoy. Cuenta como tu segunda sesión de calidad: aprieta en los repechos pero vuelve entero."
- **Resultado esperado:** registro en `registro_sustituciones` con TN congelado+fresco y `decision='aceptada'`; `calidad_realizadas_semana` → 2, `calidad_pendiente` → 0; plan marcado `SUSTITUIDO`→`COMPLETADO` al registrarse la actividad; TN del miércoles = z2 suave 45-60min (asimilación).

### CASO 2 — Rechazo de sesiones similares dos días consecutivos

- **Situación:** martes rechaza VO2 ("no me apetece"), miércoles vuelve a rechazar VO2. Hoy además duerme mal y ACWR ha subido.
- **Training Need fresco (día 2):**

```json
{
  "fecha": "2026-09-09",
  "bloque_A": { "tipo_solicitado": "vo2", "intensidad_solicitada_if": 1.10,
                "duracion_solicitada_min": 60, "tss_objetivo": 88,
                "objetivo_sesion": "calidad", "es_sesion_calidad": true },
  "bloque_B": { "tss_semanal_actual": 205, "tss_semanal_objetivo": 550,
                "tss_semanal_restante": 257, "calidad_realizadas_semana": 0,
                "calidad_max_semana": 2, "calidad_pendiente_semana": 2 },
  "bloque_C": { "tsb": -11.5, "ctl": 57, "atl": 66, "acwr": 1.31, "readiness": 58,
                "hrv": 47, "sleep_quality": 1,
                "restricciones_activas": ["intensidadMax:0.80", "volumenMax:0.80"],
                "data_quality": "FRESH" },
  "bloque_D": { "sustituciones_semana_total": 1, "sustituciones_semana_calidad": 1,
                "rechazos_consecutivos_similares": 2,
                "necesidades_pendientes": [
                  { "fecha_origen": "2026-09-08", "tipo": "vo2",
                    "es_calidad": true, "reprogramaciones": 1 } ] }
}
```

- **Qué aporta cada valor:** `rechazos_consecutivos_similares=2` → patrón, no capricho: insistir en el mismo estímulo fallaría; `restricciones_activas` (intensidadMax 0.80, sleep=1) → el VO2 ya estaba vetado por seguridad hoy; `necesidades_pendientes[0].reprogramaciones=1` → ya se reprogramó una vez → regla §7.2.3 → CANCELADA; `tss_semanal_restante=257` → la semana quedará corta pero es asumible (adherencia > perfección).
- **Decisión esperada:** rechazo aceptado sin insistir: "Entendido, dos días sin ganas de intensidad es señal. Hoy rodillo/Z2 suave 50min y cierro la semana en volumen. La calidad VO2 de esta semana se cancela; si el finde estás fresco hablamos de una, sin obligación."
- **Resultado esperado:** `decision='rechazada_propuesta_aceptada_z2'` (sustitución a z2 aceptada), necesidad VO2 → `CANCELADA`; TN del jueves y del finde sin calidad forzada; el patrón queda registrado para `ajustarPlanAutomaticamente` (que en transición ya no muta, solo señala).

### CASO 3 — Grupeta significativamente más dura de lo previsto

- **Situación:** domingo, plan congelado = z2 resistencia 90min/TSS 80. Hace grupeta: 190 TSS, IF 0.95. Actividad registrada en Intervals.
- **Training Need congelado + datos reales:**

```json
{
  "fecha": "2026-09-06",
  "training_need_congelado": {
    "bloque_A": { "tipo_solicitado": "z2", "intensidad_solicitada_if": 0.65,
                  "duracion_solicitada_min": 90, "tss_objetivo": 80,
                  "objetivo_sesion": "resistencia", "es_sesion_calidad": false },
    "bloque_B": { "tss_semanal_actual": 340, "tss_semanal_objetivo": 550,
                  "tss_semanal_restante": 130, "calidad_realizadas_semana": 1,
                  "calidad_max_semana": 2, "calidad_pendiente_semana": 1 },
    "bloque_C": { "tsb": -6.0, "acwr": 1.05, "restricciones_activas": [] }
  },
  "sesion_realizada": { "tipo": "grupeta", "tss": 190, "if": 0.95, "duracion_min": 150 },
  "desviacion": { "tss_ratio": 2.38, "if_extra": 0.30, "clasificacion": "exceso_intensidad" }
}
```

- **Qué aporta cada valor:** `tss_ratio=2.38` (>130% umbral §8) y `if_extra=0.30` → estímulo de calidad no previsto, no un z2; `es_sesion_calidad=false` en el plan → consumió capacidad de fatiga de calidad sin estar planificada; `calidad_pendiente_semana=1` + ACWR que subirá con 190 TSS → no cabe añadir la calidad que faltaba sin romper la semana.
- **Decisión esperada:** la grupeta se registra como sesión **válida y de mayor estímulo** (no se penaliza, filosofía del proyecto): "Gran salida. Eso fue más intensidad de lo previsto: mañana Z1/Z2 suave obligatorio y la calidad pendiente queda para el martes solo si estás fresco."
- **Resultado esperado:** `decision='parcial_por_exceso'`; TN del lunes con `restricciones_activas=["forzarZ2"]`; calidad pendiente `REPROGRAMADA` condicionada al TN del martes; `tss_semanal_restante` recalculado (+110 → semana por encima del objetivo, marcada como tal).

### CASO 4 — TSS real muy inferior al esperado (sesión cortada)

- **Situación:** jueves, plan congelado = sweetspot 75min/TSS 92. Corta a los 40min: 55 TSS, IF 0.72.
- **Training Need congelado + real:**

```json
{
  "fecha": "2026-09-10",
  "training_need_congelado": {
    "bloque_A": { "tipo_solicitado": "sweetspot", "tss_objetivo": 92,
                  "objetivo_sesion": "calidad", "es_sesion_calidad": true,
                  "intensidad_solicitada_if": 0.88, "duracion_solicitada_min": 75 },
    "bloque_B": { "tss_semanal_actual": 288, "tss_semanal_objetivo": 550,
                  "tss_semanal_restante": 170, "calidad_realizadas_semana": 1,
                  "calidad_max_semana": 2, "calidad_pendiente_semana": 1 },
    "bloque_C": { "tsb": -9.0, "acwr": 1.15, "restricciones_activas": [] }
  },
  "sesion_realizada": { "tipo": "sweetspot", "tss": 55, "if": 0.72, "duracion_min": 40 },
  "desviacion": { "tss_ratio": 0.60, "clasificacion": "parcial_defecto" }
}
```

- **Qué aporta cada valor:** `tss_ratio=0.60` → parcial (regla §7.2.2): calidad a medias pero del tipo correcto; `calidad_pendiente_semana=1` y quedan 2 días → hueco para reprogramar sin superar el límite; `tsb=-9.0` (no fatigado) → sí puede reintentarlo, a diferencia de un caso con fatiga.
- **Decisión esperada:** "Sesión cortada, no pasa nada. Mañana Z2 normal y el sábado tienes la calidad pendiente en rodillo si te apetece; si no, la semana cierra bien igualmente." — **no** se persigue el TSS perdido al día siguiente.
- **Resultado esperado:** `decision='parcial'`; necesidad calidad → `REPROGRAMADA` (reprogramaciones=1, límite alcanzado); TN del sábado con calidad opcional-ofrecida; deuda de TSS solo via `tss_semanal_restante`.

### CASO 5 — Cambios repetidos de decisión (flip-flop intra-semana)

- **Situación:** 3 sustituciones en la semana (lunes z2→descanso, martes vo2→z2, jueves z2→salida_tranquila) y hoy viernes propone cambiar también el sweetspot. El aprendizaje v9.5 muestra >60% desviación en z2 los viernes.
- **Training Need fresco (viernes):**

```json
{
  "fecha": "2026-09-11",
  "bloque_A": { "tipo_solicitado": "sweetspot", "intensidad_solicitada_if": 0.88,
                "duracion_solicitada_min": 70, "tss_objetivo": 86,
                "objetivo_sesion": "calidad", "es_sesion_calidad": true },
  "bloque_B": { "tss_semanal_actual": 240, "tss_semanal_objetivo": 550,
                "tss_semanal_restante": 224, "calidad_realizadas_semana": 0,
                "calidad_max_semana": 2, "calidad_pendiente_semana": 2 },
  "bloque_C": { "tsb": -12.4, "ctl": 58, "atl": 67, "acwr": 1.22, "readiness": 61,
                "hrv": null, "sleep_quality": 2, "restricciones_activas": [],
                "data_quality": "FRESH" },
  "bloque_D": { "sustituciones_semana_total": 3, "sustituciones_semana_calidad": 2,
                "rechazos_consecutivos_similares": 1,
                "necesidades_pendientes": [
                  { "fecha_origen": "2026-09-07", "tipo": "sweetspot",
                    "es_calidad": true, "reprogramaciones": 1 } ] }
}
```

- **Qué aporta cada valor:** `sustituciones_semana_total=3` en 5 días → el problema no es la sesión de hoy, es el plan de la semana; `sustituciones_semana_calidad=2` con la 3ª petición siendo calidad → se agotó el margen de reprogramación (§7.2.3); `necesidades_pendientes[0].reprogramaciones=1` → esta calidad concreta ya se movió una vez; `tsb=-12.4`, ACWR 1.22 → aún hay margen para una calidad suave (sweetspot, no vo2) si hoy de verdad se hace.
- **Decisión esperada:** el entrenador deja de ser flexible: "Tres cambios esta semana. Hoy toca el sweetspot previsto." Y la semana que viene te propongo la calidad en rodillo, que es donde mejor cumples."
- **Resultado esperado:** sustitución propuesta **rechazada SIEMPRE a la 4.ª (decisión aprobada en revisión F2, §18.3: la antigua excepción "salvo descanso/equivalente" queda SUPERADA)**; la señal se registra y alimenta el ajuste estructural (lo que hoy `ajustarPlanAutomaticamente` hace de forma efímera, ahora persistente y con límites); contadores del bloque D disponibles para el TN de la semana siguiente.

---

## 16. GAPS DEL MODELO DE DATOS (detectados y resolución en F1)

| # | Gap | Resolución adoptada en este spec | Queda abierto |
|---|---|---|---|
| G-1 | El plan previsto no se persistía; `analizarCumplimientoPlan` comparaba lo realizado consigo mismo | §3: tabla `plan_previsto_diario` + scheduler + lazy-ensure. **Estado real:** resuelto en código (f4e8048/05-09): persistencia P2B implementada y `analizarCumplimientoPlan` (7608) compara contra `plan_previsto_diario` vía `getPlanesPrevistosFechas`. Pendiente solo de tablas (C10) y scheduler | No (en código) |
| G-2 | Sin Training Need | §4 completo (4 bloques, cada campo con función de decisión) — **implementado** (`trainingNeed.js`, capa informativa) | No |
| G-3 | Sin registro de sustituciones con motivo y consecuencias | §5 + §7 + §8: `registro_sustituciones` con `training_need_congelado`/`fresco` y `consecuencias` — **parcial:** registro implementado (solo `'aceptada'`, P2); `training_need_fresco` y `consecuencias` pendientes de `aplicarConsecuencias` | No (parcial) |
| G-4 | La seguridad podía pisarse post-conflictos (verificado) | §10: `validarSeguridad()` como prerequisito bloqueante de F2 — **implementado** (`seguridad.js`, gate + re-gate del SE) | No |
| G-5 | Doble clasificador de tipo real (NP vs EQUIVALENCIAS) | §7.2.1: las clases de `EQUIVALENCIAS` pasan a ser las únicas; `analizarCumplimientoPlan` las usa también para NP — ⚠️ **pendiente:** `analizarCumplimientoPlan` sigue usando el clasificador por NP/IF (~7640) y el SE usa `EQUIVALENCIAS`; la unificación queda para la transición §9/F3 | **Sí (pendiente)** |
| G-6 | `CONFIG.PERIODO` estático: fase/semana no derivan del calendario | No bloquea F2 (el TN usa `getTssObjetivoSemanal()` tal cual existe). Migración a calendario real → F3 | **Sí (F3)** |
| G-7 | `scriptProperties` es memoria pura; `aprendizaje_desviaciones` se pierde al reiniciar | §5: escritura espejo en `registro_sustituciones` desde F2 — ⚠️ **pendiente:** el registro P2 existe, pero las desviaciones conversacionales siguen escribiendo en `aprendizaje_desviaciones` (memoria); la escritura espejo no está implementada | **Sí (pendiente)** |
| G-8 | "Calidad realizada" no está definida operativamente para el contador | Definición F1: cuenta si `objetivo_sesion='calidad'` Y (IF real ≥0.80 o sustitución aceptada como calidad) — **implementado** en Training Need (`UMBRAL_IF_CALIDAD=0.80`); contador legacy `contarSesionesCalidadSemana` (IF>0.85) intacto (F3) | No |
| G-9 | Sin definición de "semana" para los contadores del bloque D | Definición F1: semana en curso según `getFaseActual()`/`CONFIG.TIMEZONE` (misma convención que `weeklyTss` v9.5) — **implementado** (`fechaSemanaDe` en `persistenciaPlan.js`) | No |

## 17. PREREQUISITOS PARA AUTORIZAR F2 — ESTADO (05/09/2026)

> Todos cumplidos en su día (F2 fue autorizada e implementada). Se conservan como histórico:

1. ✅ Revisión conjunta de este spec (especialmente §4, §7, §10 y los casos §15).
2. ✅ Decisión del usuario sobre scheduler y reglas §7.2 — **reglas confirmadas e implementadas** (§18.2-18.5); la variante de scheduler quedó abierta y hoy la preparada es el **cron externo** (§18.1).
3. ✅ `validarSeguridad()` (§10.2) entregada como primer entregable de F2 — implementada y conectada.
4. ✅ G-6 (periodo estático) aceptado como limitación conocida durante F2.

## 18. DECISIONES PENDIENTES PARA REVISAR JUNTOS

1. **Scheduler:** ¿interno (`setInterval` en el monolito) o cron externo con endpoint protegido? (§3.2; recomendado: interno por simplicidad, externo si se quiere independencia de reinicios). **Estado real (05/09/2026):** la variante **cron externo** (→ `POST /api/cron/plan-diario` con `X-Cron-Secret`) está **implementada y lista** (P2B-15); el **`setInterval` interno NO está implementado**. Decisión de operar el cron (GitHub Actions / cron-job.org) y `CRON_SECRET` pendientes de infraestructura.
2. **Umbral de carga para sustituciones — RESUELTA (aprobado en revisión F2):** **±30% del TSS de la sesión prevista, rango estricto**, implementado en el Substitution Engine (`TOLERANCIA_CARGA=0.30`). Fuera del rango → NO VÁLIDO, sin redondeos (tolerancia aritmética de coma flotante 1e-9 únicamente). Única excepción: candidato `descanso` (§18.5). Implementado en substitutionEngine.js (tests S1-S4).
3. **Regla de flip-flop — RESUELTA (aprobada en revisión F2):** **máximo 3 sustituciones por semana; la 4.ª se rechaza SIEMPRE, sin excepciones** (incluida grupeta y descanso espontáneo). La antigua formulación del CASO 5 ("salvo descanso/equivalente") queda superada. Implementado en substitutionEngine.js (`LIMITE_SUSTITUCIONES_SEMANA=3`, tests S5). El contador llega como input explícito del caller desde `registro_sustituciones` cuando exista (no hay reconstrucción histórica).
4. **Grupeta como calidad — RESUELTA (aprobada en revisión F2):** una sesión cuenta como calidad realizada con **IF real ≥0.80** (grupeta incluida); no se adopta la variante IF ≥0.75 + duración ≥90min. Implementado en Training Need (`UMBRAL_IF_CALIDAD=0.80`, trainingNeed.js:37; tests TN9). El contador legacy `contarSesionesCalidadSemana()` (index.js:905-906, IF>0.85) responde al mismo concepto con umbral distinto y queda **intacto en v9.5**: se unificará con la transición §9 (retirada de mutadores, F3). (G-8).
5. **Descanso espontáneo — RESUELTA (aprobada en revisión F2):** **usa el mismo flujo de sustitución** (mismo `evaluarSustitucion`, sin camino paralelo). El descanso espontáneo sustituye la sesión prevista del día (la del plan previsto cuando exista). **Excepción explícita: el chequeo ±30% TSS NO se aplica cuando el candidato es `tipo='descanso'`** (TSS=0 lo haría imposible); sí respeta el límite de 3 sustituciones/semana y pasa por `validarSeguridad()` como cualquier sustitución. Implementado en substitutionEngine.js (tests S7).
6. **Retención de datos:** ¿cuánto histórico de `plan_previsto_diario`/`registro_sustituciones` se conserva? (Propuesto: todo; es barato y alimenta F3).

## 19. CRITERIO DE FINALIZACIÓN DE F1 — verificación

1. ¿Qué debe saber el entrenador? → §4.5 (4 preguntas → 4 bloques del TN).
2. ¿Qué datos necesita? → §4 (origen de cada campo, todo del pipeline v9.5).
3. ¿Qué contiene exactamente Training Need? → §4.1-4.4.
4. ¿Cómo se toman las decisiones? → §6 (flujo canónico) + §7.2 (reglas).
5. ¿Qué ocurre cuando una sesión se sustituye? → §7.1 (registrar ≠ actualizar) + §7.3.
6. ¿Cómo afecta la sustitución al futuro del plan? → §8.
7. ¿Qué casos límite debe manejar F2? → §15 (5 casos con JSON).
8. ¿Cada caso se resuelve con un TN concreto e informativo? → Sí, demostrado caso por caso en §15 (campos → decisión → resultado).
9. ¿Qué implementamos exactamente en F2? → §11.
10. ¿Qué dejamos para F3? → §12.

## 🔒 ESTADO FINAL

**F1 CERRADA Y VALIDADA (29/08/2026) · F2 + P1/P2 + P2B + F2 indoor/calor IMPLEMENTADOS Y VERIFICADOS (05/09/2026, 130/130 tests, HEAD `97f5fc5`).**

Estado real resumido: gate `validarSeguridad`, Training Need (informativo), Substitution Engine con persistencia (P2), plan previsto con lazy-ensure y cron externo (P2B), y la regla de calor indoor (HI>40 + rodillo → Z2 máx 45/IF 0.70) están implementados y conectados. **Pendiente:** tablas Supabase `plan_previsto_diario`/`registro_sustituciones` (C10, infra de Manu), `CRON_SECRET` y operación del cron externo (§18.1), `aplicarConsecuencias` (§8), flujo conversacional "no me apetece" (§7.3.a), transición §9, máquina de estados §3.3 y unificación del clasificador G-5. Documento revisado el 05/09/2026 para reflejar este estado; las decisiones de producto cerradas (checkpoint §3, §18.2-18.5) no han cambiado.