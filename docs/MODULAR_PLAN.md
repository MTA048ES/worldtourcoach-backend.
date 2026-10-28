# PLAN DE MODULARIZACIÓN — WTC backend

> Generado por análisis estático del código real (agente `architect`).
> Fecha: 24/10/2026. No se ha modificado ningún archivo de código.
> Verificado: `node --check index.js` → OK.

---

## 0. Punto de partida real (corrige los docs)

| Dato | Valor medido | `docs/ARCHITECTURE.md` dice |
|---|---|---|
| Líneas de `index.js` | **7.901** | 6.683 ❌ |
| Tamaño | 350.071 bytes | — |
| Funciones top-level | **150** | — |
| Comandos `cmd*` | **32** | — |
| Módulos propios requeridos | solo `./motorIntencion` | — |
| Ciclos de `require` hoy | **ninguno** | — |

**Los docs están desactualizados y no deben usarse como fuente de verdad.**
`STABILITY_AUDIT.md` afirma que no hay timeouts (existe `fetchWithTimeout` en 833-851) y que las credenciales Supabase están hardcodeadas (ahora exigen env y hacen `process.exit(1)` en 204-207).

**Hallazgo clave:** el archivo ya está seccionado con ~80 banners `// ═══ TÍTULO ═══`. Las fronteras existen; el trabajo es mover bloques completos, no rediseñar.

### Funciones muertas (0 llamadas) — ensayo en seco ideal

| Función | Líneas | Nota |
|---|---|---|
| `obtenerPotenciaDemostrada` | 1630-1684 | única llamadora de `fetchPowerCurvesGlobal` (1511-1525) |
| `validarFeedback` | 2713-2760 | el learning filter nunca se aplica |
| `registrarReglaTraza` | 2461-2464 | — |
| `registrarAlternativaTraza` | 2475-2478 | — |
| `predecirDesviaciones` | 6636-6691 | feature CEREBRO no cableada |
| `verificarDesviacionTiempoReal` | 6694-6757 | ídem |
| `analizarPatronesTemporales` | 6760-6819 | ídem (`detectarPatronesTemporales` 5528 sí se usa) |
| `POWER_ZONES` (const) | 755-763 | nunca leída |
| `FormData`, `Blob` (imports) | 11-12 | nunca usados |

Además: `motorIntencion` exporta 5 símbolos, `index.js` solo usa 3 (`detectarIntencion`, `adaptarDecisionParaIntencion`, `generarConsejoAdaptativo`).

---

## 1. Mapa de bloques por líneas

### Infraestructura / entrada
| Bloque | Líneas | Contenido |
|---|---|---|
| Requieres + polyfills | 1-12 | express, cors, supabase-js, motorIntencion, dotenv, node-fetch |
| App + middleware | 14-24 | `app`, `PORT`, cors/json/urlencoded |
| **Rutas de prueba** | 26-60 | `GET /` 27-44 · `GET /health` 46-53 · `GET /ping` 55-60 |
| **CONFIG** | 62-163 | objeto `CONFIG` completo |
| performanceReferences | 165-193 | objeto mutable de referencias |
| Logs de arranque | 195-199 | 5 `console.log` |
| Cliente Supabase | 201-208 | env + `process.exit(1)` + `createClient` |

### Datos
| Bloque | Líneas | Funciones |
|---|---|---|
| **Supabase persistencia** | 210-722 | `guardarEntrenoSupabase` 215-251 · `obtenerHistorialSupabase` 254-326 · `obtenerHistorial` 328-341 · `cargarHistorialCompleto` 344-493 · `obtenerHistorialAsync` 496-517 · `guardarActividadSupabase` 519-551 · `obtenerActividadSupabase` 554-570 · `sincronizarActividadesSupabase` 573-613 · `obtenerActividadesReales` 643-721 |
| **Estado en memoria** | 724-752 | `scriptProperties` 725 · `getProperty` 730-732 · `setProperty` 734-736 · `deleteProperty` 738-740 · `getUserProperty` 742-744 · `setUserProperty` 746-748 · `deleteUserProperty` 750-752 |
| Constantes | 754-766 | `POWER_ZONES` (muerta) · `FEEDBACK_KEY` · `API_BASE` |
| **Utils** | 768-851 | `safeNum` 772-775 · `sanitizeNum` 781-787 · `esActividadCiclista` 799-804 · `formatDate` 806-811 · `addDays` 813-817 · `sleep` 819-821 · `TIMEOUTS` 826-831 · `fetchWithTimeout` 833-851 |
| **Intervals.icu** | 1368-1526 | `fetchIntervals` 1372-1406 · `postIntervals` 1408-1442 · `fetchIntervalsActivity` 1445-1475 · `fetchWellness` 1477-1481 · `fetchActivities` 1483-1487 · `fetchPowerCurve` 1490-1504 · `fetchPowerCurvesGlobal` 1511-1525 |
| **Performance refs** | 1528-1714 | `extraerBestEffortsPowerCurve` 1540-1623 · `obtenerPotenciaDemostrada` 1630-1684 · `getFTPOperativo` 1689-1691 · `geteFTPIntervals` 1693-1695 · `getPotenciaDemostrada` 1697-1699 · `getFTPPropioEstimado` 1701-1703 · `getPerformanceReferences` 1705-1714 |
| **Weather + calor** | 1716-1777, 993-1021 | `fetchWeather` 1717-1728 · `safeWeatherData` 1730-1765 · `fetchWeatherSafe` 1775-1777 · `calcularHeatIndex` 997-1012 · `getDiasAclimatados` 1014-1017 · `estaAclimatado` 1019-1021 |
| **Garmin (vía Supabase)** | 1779-1933 | `obtenerDatosGarminSupabase` 1780-1933 |
| **Frescura + datos** | 1935-2139 | `fetchActivitiesSafe` 1935-1937 · `calcularFrescura` 1949-1967 · `obtenerDiasDesde` 1969-1975 · `obtenerDatosCompletos` 1977-2139 |
| **Estado del sistema** | 2141-2438 | `calcularEstadoSistema` 2141-2413 · `calcularACWR` 2415-2438 |

### Lógica deportiva
| Bloque | Líneas | Funciones |
|---|---|---|
| **Periodización** | 853-923 | `getFaseActual` 857 · `getSemanaActual` 861 · `getTssObjetivoSemanal` 865 · `getMaxSesionesCalidad` 870 · `getSemanasFase` 875 · `getNombreFase` 879 · `contarSesionesCalidadSemana` 889-910 · `puedeHacerCalidad` 912-923 |
| **FTP / proyección** | 925-968 | `calcularFTPEstimado` 929-948 · `calcularProyeccionObjetivo` 950-968 |
| **Recuperación** | 970-991 | `calcularHorasRecuperacion` 974-981 · `calcularSiguienteEntreno` 983-991 |
| **Traza** | 2440-2503 | `crearTraza` 2444 · `registrarInputTraza` 2456 · `registrarReglaTraza` 2461 · `registrarConflictoTraza` 2466 · `registrarDecisionTraza` 2471 · `registrarAlternativaTraza` 2475 · `guardarTraza` 2480 · `obtenerUltimaTraza` 2494 |
| **Conflict resolver** | 2505-2707 | `resolverConflictos` 2509-2707 |
| **Learning filter** | 2709-2809 | `validarFeedback` 2713 · `guardarFeedbackContextual` 2766 · `analizarAprendizajeContextual` 2785 |
| **Restricciones** | 2811-2949 | `getMasterAgeModifiers` 2815-2863 · `aplicarRestriccionesGlobales` 2865-2949 |
| **Decisión** | 2951-3213 | `decidirEntrenamiento` 2955-3213 |
| **Workout (SSOT)** | 3215-3428 | `generateWorkout` 3219-3288 · `generarBloques` 3290-3359 · `calcularMetricas` 3361-3393 · `createFallbackWorkout` 3395-3428 |
| **Nutrición** | 3430-3632 | `calcularNutricionUnificada` 3434-3632 |
| **Fuerza** | 3634-3778, 7462-7493 | `calcularFuerzaUnificada` 3638-3778 · `calcularMovilidadAdaptativa` 7462-7493 |
| **Consejos** | 3780-3825 | `generarConsejoUnificado` 3784-3825 |

### Orquestación
| Bloque | Líneas | Funciones |
|---|---|---|
| **Orquestador** | 3827-3975 | `getAthleteState` 3831-3975 |
| **Estadísticas** | 3977-4100 | `getEstadisticasAgregadas` 3981 · `calcularProbabilidadAvanzada` 4017 · `guardarEntrenoHistorial` 4042 · `calcularResultadoFeedback` 4086 |
| **IA** | 1023-1271 | `cacheIA`/`CACHE_TTL` 1028-1029 · `chatConIA` 1031-1222 · `cmdIA` 1225-1271 |
| **Telegram envío** | 1273-1366 | `sendTelegram` 1277-1337 · `sendTelegramLong` 1339-1366 |

### Comandos (4101-6633 + dispersos)
32 funciones `cmd*` + helpers (`buildAnalisisEntrenoManu` 4383, `detectarPatronesTemporales` 5528, `generarRecomendacionesInteligentes` 5612).

### CEREBRO + feedback + readiness
| Bloque | Líneas | Funciones |
|---|---|---|
| **Desviaciones** | 6635-7223 | `predecirDesviaciones` 6636 · `verificarDesviacionTiempoReal` 6694 · `analizarPatronesTemporales` 6760 · `ajustarPlanAutomaticamente` 6822 · `getAthleteStateConAjuste` 6920 · `analizarCumplimientoPlan` 6995 · `procesarRespuestaDesviacion` 7110 · `guardarAprendizajeDesviacion` 7193 |
| **Feedback 7 pasos** | 7224-7349 | `procesarMensajeFeedback` 7228-7349 |
| **Readiness helpers** | 7351-7535 | `calcularReadiness` 7356 · `calcularFatigaOculta` 7375 · `calcularZonaRecomendada` 7387 · `buildExplicacionStaff` 7397 · `buildTextoStress` 7410 · `buildTextoSleep` 7417 · `getSemaforo` 7424 · `compararUltimasSesiones` 7433 · `calcularReadinessConTendencia` 7496-7535 |

### Entrada HTTP
| Bloque | Líneas | Contenido |
|---|---|---|
| **Cola** | 7542-7592 | `procesandoMensaje`/`colaMensajes`/`updateIdProcesando` 7545-7547 · `procesarSiguienteMensaje` 7549 · `encolarMensaje` 7572 |
| Ruta webhook | 7594-7612 | `app.post('/webhook')` |
| **Dispatcher** | 7614-7724 | `procesarWebhook` (switch 30 comandos) |
| **Rutas API** | 7726-7773 | `/api/estado` 7727 · `/api/comando` 7737 · `/api/config` 7759 |
| Fallbacks | 7775-7799 | 404 7776-7791 · error handler 7793-7799 |
| Registro + listen | 7801-7901 | `registrarWebhookTelegram` 7802-7851 · `app.listen` 7854 |

### `motorIntencion.js` (382 líneas)
| Elemento | Líneas |
|---|---|
| `EQUIVALENCIAS` | 19-56 |
| `detectarIntencion` | 61-169 |
| `adaptarDecisionParaIntencion` | 175-249 |
| `calcularEquivalenciaEntreno` | 254-305 (nadie la usa) |
| `generarConsejoAdaptativo` | 310-373 |

**Veredicto: `motorIntencion.js` ya está bien modularizado.** Puro, exports explícitos, try/catch con fallback. Es el modelo a imitar: funciones que reciben `estado`/`historial`/`decision` por parámetro y no tocan globals.

---

## 2. Grafo de dependencias

```
N0  config (CONFIG, TIMEOUTS)   utils (puros)   state/store   routes/health
 ├──────────────┬───────────────┴──────────────┬──────────────┘
 ▼              ▼                              ▼
N1  telegram/sender            services/weather (fetchWeather, heatIndex)
 ▼
N2  services/intervals         services/supabase
 ▼
N3  services/history   services/sync   services/garmin
 ▼
N4  services/readiness   services/state (obtenerDatosCompletos + ACWR)
 ▼
N5  services/periodization   services/ftp   services/recovery
 ▼
N6  services/workout   services/nutrition   services/strength   services/advice
 ▼
N7  services/traza   services/restrictions   services/decision
 ▼
N8  services/orchestrator   services/performance   services/ai
 ▼
N9  services/learning + services/deviation
 ▼
N10 telegram/commands/<dominio>/*
 ▼
N11 telegram/queue, telegram/webhook, routes/api, routes/webhook, routes/fallbacks, main
```

### Aristas peligrosas (no obvias)
| Arista | Por qué importa |
|---|---|
| `decidirEntrenamiento` → `puedeHacerCalidad` → `contarSesionesCalidadSemana` → `obtenerHistorial` → `getProperty` | La decisión "pura" depende del store. No es pura. |
| `calcularNutricionUnificada` → `getProperty('tasa_sudor')` (3526) | Nutrición lee estado aprendido |
| `calcularEstadoSistema` → `obtenerActividadesReales` (2249) → Supabase | Cálculo con I/O a base de datos |
| `calcularEstadoSistema` → `setProperty('dias_calor')` (2367) | **Efecto secundario de escritura** dentro de un cálculo |
| `chatConIA` → `getAthleteState` (1057) | IA depende del orquestador completo |
| `sincronizarActividadesSupabase` (573) | Única función que cruza Supabase ↔ Intervals |
| `procesarWebhook` → 30 `cmd*` | Nodo de fan-out máximo |

### Estado global compartido (el obstáculo real)
| Estado | Línea | Escritores | Lectores | Impacto |
|---|---|---|---|---|
| `CONFIG` | 65 | 1 (`CONFIG.OPENROUTER.ENABLED = true` en 1051) | 148 | Fácil: exportar por referencia |
| `scriptProperties` | 725 | `setProperty` (8) / `setUserProperty` (2) | 16 | **Hub crítico.** Dos instancias = historial partido en dos, sin errores |
| `performanceReferences` | 177 | solo init | 4 | Mover con sus getters, no clonar |
| `cacheIA` (Map) | 1028 | `chatConIA` | `chatConIA` | Singleton, mover junto |
| `supabase` | 208 | — | 89 | Un solo cliente, nunca `createClient` dos veces |
| `procesandoMensaje`, `colaMensajes`, `updateIdProcesando` | 7545-7547 | cola | cola | Exportar por valor congela el estado |
| `API_BASE` | 766 | const congelada al cargar | intervals | Recalcular en el módulo con mismo `CONFIG.ATHLETE_ID` |

---

## 3. Las 3 primeras extracciones

| # | Módulo | Líneas | Deps | Estado global | Fan-in | Riesgo |
|---|---|---|---|---|---|---|
| **1** | `routes/health.js` | 35 | 0 | 0 | 3 rutas | **≈0** |
| **2** | `config/index.js` | ~105 | `process.env` | 0 (solo lectura) | 148, **0 cambios de call-site** | **Bajo** |
| **3** | `utils/` | ~55 | `node-fetch` | 0 | ~150, **0 cambios de call-site** | **Bajo+** |

Independientes entre sí. Cada una deja el sistema arrancable y verificable. Ninguna toca `scriptProperties`, `supabase` ni la cola.

**Por qué este orden:**
- `routes/health` primero: cero dependencias, validación trivial por HTTP → valida el *pipeline* con blast radius nulo.
- `config` después: son datos, no lógica. Fan-in máximo pero sin cambios de nombres → riesgo de orden de inicialización, no de lógica.
- `utils` tercero: primer bloque con comportamiento. Desbloquea `telegram/sender` y `services/weather` (necesitan `fetchWithTimeout`).

> **Siguiente obligatorio: `state/store.js` (724-752)**. Trivial, pero prerrequisito de `history`, `traza`, `learning`, `weather` y `state`. Fase 4.

---

## 4. Detalle de las 3 extracciones

### #1 — `routes/health.js`

Mover literal: `app.get('/')` 27-44 · `app.get('/health')` 46-53 · `app.get('/ping')` 55-60.

```js
// routes/health.js
module.exports = function registrarHealthRoutes(app) {
  app.get('/', (req, res) => { /* líneas 28-43 literales */ });
  app.get('/health', (req, res) => { /* líneas 47-52 literales */ });
  app.get('/ping', (req, res) => { /* líneas 56-59 literales */ });
};
```

En `index.js`, en el mismo punto (después de línea 24):
```js
require('./routes/health')(app);
```

No mover los strings `'v9.5'` de los handlers.

### #2 — `config/index.js`

Mover: `CONFIG` 65-163 · `TIMEOUTS` 826-831.
NO mover: `dotenv` (línea 5 se queda), `performanceReferences` (165-193), logs (195-199), Supabase (201-208).

```js
// config/index.js
require('dotenv').config({ path: 'ENV' }); // idempotente
const CONFIG = { /* 66-162 literales */ };
const TIMEOUTS = { /* 827-830 literales */ };
module.exports = { CONFIG, TIMEOUTS };
```

En `index.js`, insertar **antes de la línea 177**:
```js
const { CONFIG, TIMEOUTS } = require('./config');
```

**Restricción dura:** el require debe ir antes de 177. `performanceReferences` lee `CONFIG.FTP` en tiempo de carga → si va debajo, `ReferenceError` por TDZ.

### #3 — `utils/`

| Archivo | Contenido |
|---|---|
| `utils/numbers.js` | `safeNum` 772-775 · `sanitizeNum` 781-787 |
| `utils/dates.js` | `formatDate` 806-811 · `addDays` 813-817 |
| `utils/sport.js` | `esActividadCiclista` 799-804 |
| `utils/http.js` | `sleep` 819-821 · `fetchWithTimeout` 833-851 · `require('node-fetch')` |
| `utils/index.js` | barrel que re-exporta los cuatro |

En `index.js` (cabecera):
```js
const {
  safeNum, sanitizeNum, formatDate, addDays,
  esActividadCiclista, sleep, fetchWithTimeout
} = require('./utils');
```
Borrar: 772-775, 781-787, 799-804, 806-811, 813-817, 819-821, 833-851.

Cero cambios en los ~150 call-sites. El `const fetch = require('node-fetch')` de la línea 10 queda sin uso; dejarlo (eliminarlo es cosmético).

---

## 5. Riesgos por extracción

### #1 routes/health
- **R1.1** Require en la cabecera antes de `app` → `ReferenceError` al arrancar.
- **R1.2** No borrar las rutas originales → handlers duplicados, **fallo silencioso**.
- **R1.3** Mover la llamada al final → el catch-all 404 (7776) captura `/`, `/health`, `/ping`.
- **R1.4** Usar `express.Router()` en vez de recibir `app` cambia el matcheo. No hacerlo en este paso.

### #2 config
- **R2.1 (grave)** dotenv después de CONFIG: `CHAT_ID` undefined → `CONFIG.CHAT_ID.toString()` (7621) lanza TypeError en **cada** webhook → 500 total, y `FTP` cae a 240 en silencio. Mitigación: `require('dotenv').config()` en la primera línea de `config/index.js` + revisar logs de arranque.
- **R2.2** `TIMEOUTS` sin exportar → `fetchWithTimeout(url, opts, undefined)` **no falla**, cae al default 10000 ms. La IA pasa de 45 s a 10 s sin ningún error.
- **R2.3** `Object.freeze(CONFIG)` "para limpiar" rompe la mutación de 1051.
- **R2.4** Cambiar `parseInt` por `Number`: `parseInt('240.7')` → 240, `Number('240.7')` → 240.7. No tocar.
- **R2.5** Mover el chequeo de Supabase (201-208) cambia el orden del `process.exit(1)` y el diagnóstico en Railway.

### #3 utils
- **R3.1** Export olvidado → `ReferenceError` solo en la ruta que lo usa. Verificar con `/api/comando {"/hoy"}`.
- **R3.2** `safeNum` y `sanitizeNum` **no son equivalentes**: `safeNum(Infinity,0)` → `Infinity`; `sanitizeNum(Infinity,...)` → fallback. No fusionar.
- **R3.3** `formatDate` a UTC desplaza un día las ventanas semanales en Europe/Madrid → cambian TSS semanal, densidad y ACWR sin error.
- **R3.4** `addDays` mutando el `Date` del llamador. Mantener `new Date(d.getTime())`.
- **R3.5** `esActividadCiclista(null)` → `true` es intencional (compatibilidad con actividades sin `Tipo`).
- **R3.6** Hoisting: hoy son `function` izadas; al pasar a `const` desestructurado sigue funcionando solo porque nada las llama en carga. **Require arriba.**

---

## 6. Verificación (sin suite de tests)

### Protocolo: baseline + diff
Antes de tocar nada, con el servidor actual:
```powershell
$env:PORT=3999; node index.js   # terminal 1
curl.exe -s http://localhost:3999/api/config | Out-File "$env:TEMP\base_config.json" -Encoding utf8
```

Tras cada extracción:
```powershell
node --check index.js
curl.exe -s http://localhost:3999/api/config | Out-File "$env:TEMP\new_config.json" -Encoding utf8
Compare-Object (Get-Content "$env:TEMP\base_config.json") (Get-Content "$env:TEMP\new_config.json")
```
Salida vacía = PASS.

### Tras #1
```powershell
node --check routes\health.js
curl.exe -s http://localhost:3999/health      # status:"ok", version:"v9.5", uptime numérico
curl.exe -s http://localhost:3999/ping        # status:"pong"
curl.exe -s http://localhost:3999/            # objeto con 7 endpoints
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3999/noexiste   # 404
```

### Tras #2
Pre-flight sin arrancar:
```powershell
node -e "const {CONFIG,TIMEOUTS}=require('./config'); console.log(JSON.stringify({ftp:CONFIG.FTP,peso:CONFIG.WEIGHT_KG,edad:CONFIG.AGE_YEARS,ciudad:CONFIG.CITY,fase:CONFIG.PERIODO.fase,chat:CONFIG.CHAT_ID?'OK':'MISSING',token:CONFIG.TELEGRAM_TOKEN?'OK':'MISSING',timeouts:TIMEOUTS},null,2))"
```
Debe dar `peso:64`, `edad:43`, `chat:"OK"`, `token:"OK"`, timeouts `45000/15000/8000/10000`.
Si `chat` sale `MISSING` → **parar y corregir el orden de dotenv**.

Luego arrancar y comprobar los 5 logs de 195-199 con valores reales + `/api/config` idéntico al baseline.

### Tras #3
```powershell
node -e "const u=require('./utils'); const exp=['safeNum','sanitizeNum','formatDate','addDays','esActividadCiclista','sleep','fetchWithTimeout']; const faltan=exp.filter(k=>typeof u[k]!=='function'); console.log(faltan.length?'FALTAN: '+faltan:'OK 7/7')"

node -e "fetch('http://localhost:3999/api/comando',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({comando:'/hoy'})}).then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,2)))"

node -e "fetch('http://localhost:3999/api/estado').then(r=>r.json()).then(j=>console.log(j.success, j.workout&&j.workout.tipo, j.estado&&j.estado.tsb, j.nutricion&&j.nutricion.chTotalDia))"
```
PASS: `OK 7/7`; `success:true` con respuesta válida; sin `undefined` en `workout.tipo` ni `nutricion.chTotalDia`.

Prueba negativa del webhook sin enviar mensajes:
```powershell
node -e "fetch('http://localhost:3999/webhook',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({update_id:999001,message:{chat:{id:0},text:'/hoy'}})}).then(r=>r.json()).then(console.log)"
```
Debe devolver `{ ok: true }` sin log de `[Webhook] Mensaje:`.

### Siempre
```powershell
Remove-Item Env:RAILWAY_PUBLIC_DOMAIN -ErrorAction SilentlyContinue   # evita re-apuntar el webhook real (T16)
```

---

## 7. Trampas específicas (T1-T20)

| # | Trampa |
|---|---|
| **T1** | `dotenv` + `CONFIG` construido en tiempo de require. Invertir el orden → defaults silenciosos (FTP 240, CHAT_ID undefined). |
| **T2** | `CONFIG.CHAT_ID.toString()` sin guarda (7621). Sin env de Telegram no hay error de arranque, pero **cada** webhook lanza TypeError. |
| **T3** | `API_BASE` (766) congelado al cargar. Recalcular en `services/intervals.js` con el mismo `CONFIG.ATHLETE_ID`. |
| **T4** | `scriptProperties` (725) singleton. Si un módulo crea su propio `{data:{}}`, el historial se parte en dos **sin ningún log**. `/historial` vacío, FTP base, `contarSesionesCalidadSemana` = 0. El fallo más caro del refactor. |
| **T5** | Todo son `function` declarations (hoisted). Al pasar a `const` desestructurado, require arriba. |
| **T6** | `decidirEntrenamiento` **muta** `restricciones` (2978-3018) y ese objeto se devuelve en `state.restricciones`. Clonarlo en la frontera rompe los motivos y límites que muestran los comandos. Mover junto con `aplicarRestriccionesGlobales`. |
| **T7** | `generateWorkout` recibe `estado`, no `state`, pero lee `state.nutricion.*` (3260-3263) → **siempre** cae en defaults `300/120/60/'2L base'`. Bug latente. **Preservar comportamiento**, documentar como issue aparte. |
| **T8** | `resolverConflictos` clona con `JSON.parse(JSON.stringify())` (2510). La `decision` debe seguir siendo datos planos. |
| **T9** | `getProperty` devuelve `|| null` (731): un `0` o `''` se lee como `null`. No cambiar a `??`. |
| **T10** | Fechas en hora local (`formatDate` 806). Railway corre en UTC, Madrid +1/+2. Comparaciones de rango semanal son comparaciones de string. |
| **T11** | Columnas Supabase con espacios y mayúsculas: `'Tiempo en movimiento'` (396, 531, 689), `act.Fecha`, `act.Tipo`, `act.Distancia`. No normalizar. |
| **T12** | `calcularEstadoSistema` hace `setProperty('dias_calor')` en 2367. Cálculo con escritura de estado global. |
| **T13** | `let` de la cola (7545-7547). Exportar por valor congela el estado. Exponer `encolar()`/`procesarSiguiente()` y mantener privadas. |
| **T14** | Ciclo latente `queue ⇄ webhook`. Inyectar: `queue.init({ procesar: procesarWebhook })`. |
| **T15** | El 404 (7776) y el error handler (7793) deben registrarse **siempre al final**. Si `routes/api.js` se requiere después, todos los `/api/*` dan 404. |
| **T16** | `registrarWebhookTelegram()` (7802-7851) re-apunta el webhook de producción si `RAILWAY_PUBLIC_DOMAIN` o `PUBLIC_URL` están definidos. En local, borrar esas variables. |
| **T17** | `POST /webhook` ejecuta comandos reales: envía mensajes al móvil y escribe en Supabase. Para pruebas usar `chat.id: 0` o `POST /api/comando`. |
| **T18** | `process.exit(1)` por env de Supabase (204-207). Reordenar convierte un fallo claro en uno opaco. |
| **T19** | `motorIntencion` se requiere antes que dotenv (línea 4 vs 5). Inocuo hoy; mordería si se le inyecta configuración. |
| **T20** | `adaptarDecisionParaIntencion` marca `esIntencion`; `getAthleteStateConAjuste` (6938) lo usa. Perder ese flag hace que el ajuste automático sobrescriba una grupeta con Z2. |

---

## 8. Roadmap completo

| Fase | Módulo | Líneas | Prerreq. | Riesgo | Verificación |
|---|---|---|---|---|---|
| 1 | `routes/health.js` | 27-60 | — | ≈0 | curl `/`, `/health`, `/ping`, 404 |
| 2 | `config/index.js` | 65-163, 826-831 | — | Bajo | pre-flight require + logs + `/api/config` |
| 3 | `utils/` | 772-851 | 2 | Bajo+ | `OK 7/7` + `/api/comando` + `/api/estado` |
| 4 | `state/store.js` | 724-752 | — | Bajo | `setProperty` + `/api/estado` |
| 5 | `telegram/sender.js` | 1273-1366 | 2,3 | Bajo (fan-in 149) | logs + `/api/comando` |
| 6 | `services/weather.js` | 993-1021, 1716-1777 | 3,4 | Bajo | `/api/estado` → `heatIndex` numérico |
| 7 | `services/intervals.js` | 766, 1368-1684 | 2,3 | Bajo-Medio | `/api/estado` |
| 8 | `services/supabase.js` | 201-208, 215-570 | 4 | Medio | `/api/estado` lee `actividades_guardadas` |
| 9 | `services/history.js` + `sync.js` | 328-517, 573-613 | 7,8 | Medio | `/api/estado`, `/historial` |
| 10 | `services/garmin.js` | 1780-1933 | 4,8 | Bajo | `estado.hrv`, `recuperacionFisiologica` |
| 11 | `services/readiness.js` + `state.js` | 7356-7535, 1949-2438 | 6-10 | **Medio-Alto** | tsb / readiness / acwr |
| 12 | `periodization.js` + `ftp.js` + `recovery.js` | 853-991 | 9 | Bajo | `/api/config` fase/semana |
| 13 | `services/workout.js` | 3215-3428 | 12 | Medio (SSOT) | `workout.tipo`, `tssEsperado` |
| 14 | `nutrition.js` + `strength.js` + `advice.js` | 3430-3825, 7462-7493 | 12,13 | Bajo | `nutricion.chTotalDia` |
| 15 | `traza.js` + `restrictions.js` + `decision.js` | 2440-2707, 2811-3213 | 4,6,12 | **Alto** (mutación T6) | `decision.tipo` vs baseline |
| 16 | `orchestrator.js` + `performance.js` | 3827-4100, 1686-1714 | todas | **Alto** | `/api/estado` completo |
| 17 | `services/ai.js` | 1027-1222 | 16 | Bajo | `/api/estado` |
| 18 | `learning.js` + `deviation.js` | 5432-5733, 6635-7223 | 9,15,16,5 | Medio | `/api/comando`, `/aprender` |
| 19 | `telegram/feedback.js` + `commands/*` | 7228-7349, 4101-6633 | 18 | Medio | un comando por dominio |
| 20 | `queue` + `webhook` + `routes/api` + `routes/webhook` + `fallbacks` + `main` | 7542-7901 | 19 | **Alto** (orden) | webhook con `chat.id:0` + `/api/*` |

**Reglas de oro:**
1. Un commit = un módulo. Nunca dos.
2. Nunca mover lógica y cambiar comportamiento en el mismo commit (T6, T7, T12 son las tentaciones).
3. Si algo falla: `git checkout -- .` (el repo está limpio).

---

## 9. Lo que NO se pudo verificar

1. No se ejecutó el servidor ni se hicieron peticiones reales a Supabase, Intervals, OpenWeatherMap, OpenRouter ni Telegram. Todo es análisis estático + `node --check`.
2. No se sabe si existe un frontend u otro consumidor de `/api/estado`, `/api/comando` o `/api/config`. El contrato de respuesta sería un requisito duro no auditable.
3. No se sabe qué variables define Railway (`RAILWAY_PUBLIC_DOMAIN`, `PUBLIC_URL`) → afecta a T16.
4. No se sabe qué comandos se usan realmente en producción; el orden propuesto es por dominio, no por tráfico.
5. `STABILITY_AUDIT.md` afirma "30+ comandos sin try/catch" pero el documento está desactualizado en otros puntos; no se da por cierto.
6. `REVIEW.js` (39 KB) y `cambios.patch` (vacío) no se requieren desde `index.js`; no analizados.
7. El número real de *llamadas* a `sendTelegram` es algo menor que las 149 apariciones (incluye plantillas de ayuda).
8. No se puede garantizar que `motorIntencion.js` no tenga consumidores externos.

---

## 10. Hallazgo de seguridad

El archivo `ENV` (640 bytes) **está dentro del repositorio** y contiene credenciales. Revisar con `security-reviewer` y, si ya está en el historial de git, considerar rotar las claves.
