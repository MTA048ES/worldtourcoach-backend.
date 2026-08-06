# 🏗️ WORLD TOUR COACH — ARQUITECTURA

> Última actualización: 06/08/2026
> Versión: v9.5

---

## 1. VISIÓN GENERAL

World Tour Coach es un **monolito Node.js/Express** que actúa como bot de Telegram. Todo el sistema vive en `index.js` (6683 líneas) con un módulo auxiliar `motorIntencion.js`.

---

## 2. CAPAS DEL SISTEMA

```
┌─────────────────────────────────────────────────────────────┐
│  CAPA 1: INTERFAZ (Telegram)                                │
│  - Webhook POST /webhook                                    │
│  - Cola de mensajes con deduplicación                       │
│  - Procesador de comandos                                   │
├─────────────────────────────────────────────────────────────┤
│  CAPA 2: ORQUESTACIÓN                                       │
│  - getAthleteState()                                        │
│  - getAthleteStateConAjuste()                               │
│  - analizarCumplimientoPlan()                               │
├─────────────────────────────────────────────────────────────┤
│  CAPA 3: LÓGICA DEPORTIVA                                   │
│  - decidirEntrenamiento() (periodización)                   │
│  - resolverConflictos() (seguridad > clima > fatiga)        │
│  - calcularReadinessConTendencia()                          │
│  - calcularFTPEstimado()                                    │
│  - calcularHorasRecuperacion()                              │
├─────────────────────────────────────────────────────────────┤
│  CAPA 4: CONTEXTO HUMANO                                    │
│  - motorIntencion.js (grupeta, rodillo, salida tranquila)   │
│  - ajustarPlanAutomaticamente() (aprendizaje)               │
├─────────────────────────────────────────────────────────────┤
│  CAPA 5: GENERACIÓN                                         │
│  - generateWorkout() (Single Source of Truth)               │
│  - generarBloques()                                         │
│  - calcularMetricas()                                       │
│  - calcularNutricionUnificada()                             │
│  - calcularFuerzaUnificada()                                │
│  - generarConsejoUnificado()                                │
├─────────────────────────────────────────────────────────────┤
│  CAPA 6: DATOS                                              │
│  - Supabase (persistencia)                                  │
│  - Intervals.icu (entrenamiento)                            │
│  - Garmin via Supabase (salud)                              │
│  - OpenWeatherMap (clima)                                   │
│  - OpenRouter (IA)                                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. FLUJO DE UN COMANDO (DETALLADO)

### Ejemplo: `/hoy`

1. **Telegram** envía webhook con `update_id`, `message`, `chat_id`
2. **encolarMensaje()**:
   - Verifica si `update_id` ya se procesó (deduplicación)
   - Añade a `colaMensajes`
   - Inicia `procesarSiguienteMensaje()` si no hay nada procesando
3. **procesarWebhook()**:
   - Extrae `chatId` y verifica que sea `CONFIG.CHAT_ID`
   - Comprueba `esperando_respuesta_desviacion` (flujo de desviaciones)
   - Comprueba `procesarMensajeFeedback` (flujo de feedback 7 pasos)
   - Parsea `cmd` y `args`
   - Si `cmd === '/hoy'` y no hay args → `cmdHoy(chatId)`
4. **cmdHoy()**:
   - Llama a `getAthleteStateConAjuste()`
   - Construye mensaje con: fase, estado, Garmin, objetivo, recuperación, entreno, clima, nutrición, fuerza, movilidad, probabilidad, decisión, consejos
   - Envía con `sendTelegramLong()`
5. **getAthleteStateConAjuste()**:
   - Llama a `getAthleteState()`
   - Aplica `motorIntencion.detectarIntencion()`
   - Aplica `motorIntencion.adaptarDecisionParaIntencion()`
   - Si no hay intención, aplica `ajustarPlanAutomaticamente()`
   - Genera consejo adaptativo
   - Si la decisión cambió, regenera workout
6. **getAthleteState()**:
   - `obtenerDatosCompletos()` → Garmin + Intervals + clima
   - `calcularEstadoSistema()` → CTL, ATL, TSB, readiness, ACWR
   - `aplicarRestriccionesGlobales()` → edad, calor, fatiga
   - `decidirEntrenamiento()` → tipo de entreno
   - `resolverConflictos()` → prioridades
   - `generateWorkout()` → bloques, vatios, TSS, IF, KJ
   - `calcularNutricionUnificada()` → macros
   - `calcularFuerzaUnificada()` → ejercicios
   - `generarConsejoUnificado()` → consejos
   - `guardarTraza()` → Decision Trace

---

## 4. SISTEMA DE COLA Y DEDUPLICACIÓN

```javascript
let procesandoMensaje = false;
let colaMensajes = [];
let updateIdProcesando = null;
```

- **Propósito**: Evitar procesamiento concurrente de webhooks
- **Deduplicación**: Si `update_id` ya se está procesando, se ignora
- **Cola FIFO**: Los mensajes se procesan en orden
- **Limitación**: En memoria — se pierde si el servidor se reinicia

---

## 5. MOTOR DE INTENCIÓN (motorIntencion.js)

### Filosofía
"No cambies el cerebro de fatiga. Añade una capa de contexto humano encima."

### Equivalencias de entrenamiento
| Tipo real | TSS | Zonas | Equivalencia plan | Factor carga |
|---|---|---|---|---|
| Grupeta | 110-160 | Z2, Z3, VO2 | z2, sweetspot, tempo | 1.1 |
| Rodillo | 40-120 | Z2, Z3, SS | z2, sweetspot, ftp, vo2 | 1.0 |
| Salida tranquila | 30-80 | Z1, Z2 | z1, z2 | 0.8 |
| Descanso | 0 | - | descanso | 0 |

### Detección de intención
1. **Día de la semana**: Domingo → grupeta (75% probabilidad)
2. **Historial**: Patrones de grupeta/rodillo por día
3. **Clima**: Calor extremo → rodillo
4. **Estado**: Fatiga alta → salida tranquila

---

## 6. CONFLICT RESOLVER (Prioridades)

```
NIVEL 1: SEGURIDAD (TSB < -30, readiness < 30, ACWR > 1.5)
NIVEL 2: CLIMA (Heat Index > 40, 38, 35, 32)
NIVEL 3: FATIGA AGUDA (TSB < -20, HRV < 40, sueño malo)
NIVEL 4: PLAN ESTRUCTURAL (CTL < 50, ACWR > 1.3)
NIVEL 5: OBJETIVO 296W (ventana de calidad)
```

---

## 7. GENERADOR DE WORKOUT

**Single Source of Truth**: `generateWorkout()`

### Bloques generados
1. **Warmup**: 10 min, 45-55% FTP
2. **Main**: reps × durMin, según tipo
3. **Recovery** (si reps > 1): recSec/60 min, 40-50% FTP
4. **Cooldown**: 10 min, 35-45% FTP

### Tipos de entreno
| Tipo | % FTP | Cadencia |
|---|---|---|
| Z1 | 40-55% | 75-85 rpm |
| Z2 | 60-70% | 80-90 rpm |
| Z3 | 75-87% | 85-95 rpm |
| SweetSpot | 88-93% | 85-95 rpm |
| FTP | 95-100% | 90-100 rpm |
| VO2 | 110-120% | 100-110 rpm |

### Métricas calculadas
- **TSS**: `(durSeg/3600) * IF² * 100`
- **IF**: `potenciaMedia / FTP`
- **KJ**: `(wAvg * durSeg) / 1000`
- **CH**: Basado en kcal totales y % de carbohidratos

---

## 8. PERSISTENCIA

### En memoria (scriptProperties)
- `historial_entrenos` — Historial en memoria
- `ultima_traza` — Última decisión
- `historial_trazas` — Historial de decisiones
- `dias_calor` — Días de aclimatación
- `tasa_sudor` — Tasa de sudor aprendida
- `analisis_desviaciones` — Análisis de desviaciones
- `aprendizaje_desviaciones` — Aprendizaje de desviaciones

### En Supabase
- `historial_entrenos` — Persistencia de entrenos
- `actividades_guardadas` — Actividades de Intervals
- `garmin_wellness` — Salud Garmin
- `garmin_hrv` — HRV
- `garmin_sleep` — Sueño
- `aprendizaje_desviaciones` — Aprendizaje

---

## 9. API ENDPOINTS

| Endpoint | Método | Función |
|---|---|---|
| `/` | GET | Info del servidor |
| `/health` | GET | Estado de salud |
| `/ping` | GET | Mantener activo |
| `/webhook` | POST | Webhook Telegram |
| `/api/estado` | GET | Estado del atleta |
| `/api/comando` | POST | Ejecutar comandos |
| `/api/config` | GET | Configuración |

---

## 10. VARIABLES DE ENTORNO

| Variable | Uso | Obligatoria |
|---|---|---|
| `TELEGRAM_TOKEN` | Token del bot | ✅ |
| `CHAT_ID` | ID del chat autorizado | ✅ |
| `INTERVALS_API_KEY` | API de Intervals.icu | ✅ |
| `ATHLETE_ID` | ID del atleta en Intervals | ✅ |
| `WEATHER_API_KEY` | API de OpenWeatherMap | ✅ |
| `SUPABASE_URL` | URL de Supabase | ✅ |
| `SUPABASE_ANON_KEY` | Key anónima de Supabase | ✅ |
| `OPENROUTER_API_KEY` | API de OpenRouter | ❌ (opcional) |
| `FTP` | FTP actual | ❌ (default 240) |
| `WEIGHT_KG` | Peso | ❌ (default 64) |
| `AGE_YEARS` | Edad | ❌ (default 43) |
| `HEIGHT_CM` | Altura | ❌ (default 173) |
| `PORT` | Puerto del servidor | ❌ (default 3000) |