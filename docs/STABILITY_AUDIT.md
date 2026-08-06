# 🛡️ WORLD TOUR COACH — AUDITORÍA DE ESTABILIDAD Y FIABILIDAD

> **Fase 1 — Solo análisis**
> Última actualización: 06/08/2026
> Versión: v9.5

---

## RESUMEN EJECUTIVO

**Estado general:** El sistema es funcional y está en producción, pero presenta **riesgos significativos de estabilidad** que pueden provocar caídas del bot, pérdida de datos o respuestas incorrectas.

**Hallazgos principales:**
- **30+ comandos sin try/catch** — Un error en cualquier comando puede tumbar el webhook completo
- **APIs externas sin timeout** — Intervals.icu y OpenWeatherMap pueden colgar el servidor indefinidamente
- **Datos sensibles hardcodeados** — Credenciales de Supabase en el código
- **Sin validación de datos** — Entradas de usuario y datos de APIs no se validan consistentemente
- **Cola de mensajes en memoria** — Se pierde si el servidor se reinicia

---

## RIESGOS ENCONTRADOS

---

### 🔴 CRÍTICO

---

#### RIESGO 1: Comandos sin try/catch

**Descripción:** La mayoría de los comandos (`cmdStart`, `cmdPlan`, `cmdEstado`, `cmdFatiga`, `cmdRecuperacion`, `cmdAlerta`, `cmdTendencias`, `cmdSemana`, `cmdObjetivo`, `cmdAprender`, `cmdAprenderValidar`, `cmdZwo`, `cmdExportar`, `cmdDensidad`, `cmdDebug`, `cmdClima`, `cmdNutricion`, `cmdFuerza`, `cmdMovilidad`, `cmdConsejo`, `cmdResumen`, `cmdAjuste`, `cmdProgreso`, `cmdPrediccion`) **no tienen try/catch**.

**Causa:** No se envolvieron en try/catch al crearlos.

**Impacto:** Si cualquiera de estos comandos lanza una excepción (API caída, dato null, error de lógica), la excepción se propaga al `procesarWebhook`, que la captura y devuelve 500. El usuario no recibe respuesta y el bot parece "muerto".

**Probabilidad:** Alta — cualquier API externa caída o dato inesperado lo provoca.

**Archivos afectados:** `index.js` — todos los comandos listados.

**Recomendación:** Envolver todos los comandos en try/catch con mensaje de error al usuario.

---

#### RIESGO 2: APIs externas sin timeout

**Descripción:** `fetchIntervals()`, `fetchIntervalsActivity()`, `fetchWeather()` y `fetch()` de Telegram **no tienen timeout**. Si Intervals.icu, OpenWeatherMap o Telegram no responden, la promesa queda pendiente indefinidamente.

**Causa:** No se usa `Promise.race` con timeout (solo `chatConIA` lo tiene).

**Impacto:** El webhook se queda colgado esperando respuesta. La cola de mensajes se bloquea. El bot deja de responder.

**Probabilidad:** Media — depende de la disponibilidad de las APIs.

**Archivos afectados:** `index.js` — `fetchIntervals`, `fetchIntervalsActivity`, `fetchWeather`, `sendTelegram`.

**Recomendación:** Añadir timeout de 10-15 segundos a todas las llamadas fetch.

---

#### RIESGO 3: Credenciales hardcodeadas

**Descripción:** En `index.js` línea ~130:
```javascript
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qhtwueashkqbqytfwpwi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_mPhJsgW-V7n6TJs6-RLoWQ_Qk68d5qQ';
```

**Causa:** Fallback hardcodeado con credenciales reales.

**Impacto:** Si el repositorio se hace público, las credenciales quedan expuestas. Cualquiera podría acceder a la base de datos.

**Probabilidad:** Alta si el repo se hace público.

**Archivos afectados:** `index.js`.

**Recomendación:** Eliminar los fallbacks hardcodeados. Requerir variables de entorno obligatorias.

---

#### RIESGO 4: `procesarMensajeFeedback` sin try/catch completo

**Descripción:** El flujo de feedback de 7 pasos no está envuelto en try/catch. Si `obtenerDatosCompletos()` falla en el paso 7, la excepción se propaga.

**Causa:** No se envolvió el switch completo en try/catch.

**Impacto:** El usuario pierde el feedback y el estado queda corrupto.

**Probabilidad:** Media.

**Archivos afectados:** `index.js` — `procesarMensajeFeedback`.

**Recomendación:** Envolver todo el flujo en try/catch con limpieza de estado.

---

### 🟠 IMPORTANTE

---

#### RIESGO 5: `fetchIntervals` sin manejo de errores

**Descripción:** `fetchIntervals()` y `fetchIntervalsActivity()` lanzan error si la API no responde OK, pero no capturan el error. Los llamadores (`fetchWellness`, `fetchActivities`, `fetchPowerCurve`) no siempre lo manejan.

**Causa:** `fetchWellnessSafe` y `fetchActivitiesSafe` capturan, pero `fetchPowerCurve` y `fetchIntervalsActivity` directos no siempre.

**Impacto:** Si Intervals.icu falla, algunos comandos (`/analizar`, `/historial`, `/sync`) pueden fallar sin mensaje claro.

**Probabilidad:** Media.

**Archivos afectados:** `index.js` — `fetchIntervals`, `fetchIntervalsActivity`, `fetchPowerCurve`.

**Recomendación:** Añadir try/catch en todos los llamadores directos.

---

#### RIESGO 6: Sin validación de datos de entrada

**Descripción:** Los comandos no validan argumentos. Por ejemplo, `/analizar abc` intentará buscar una actividad con ID "abc" y fallará. `/hoy --comando-invalido` devuelve mensaje genérico.

**Causa:** No hay validación de entrada en la mayoría de comandos.

**Impacto:** Respuestas incorrectas o errores silenciosos.

**Probabilidad:** Alta — cualquier entrada inesperada.

**Archivos afectados:** `index.js` — todos los comandos con args.

**Recomendación:** Validar argumentos antes de procesar.

---

#### RIESGO 7: Datos de Supabase sin validación

**Descripción:** Las consultas a Supabase no validan que los datos devueltos tengan la estructura esperada. Por ejemplo, `actividades_guardadas` puede devolver filas sin `moving_time` (el bug de /densidad).

**Causa:** No hay validación de esquema en las consultas.

**Impacto:** Cálculos incorrectos o errores en runtime.

**Probabilidad:** Alta — los datos pueden variar.

**Archivos afectados:** `index.js` — `cargarHistorialCompleto`, `obtenerHistorialSupabase`, `cmdHistorial`, `cmdSemanaPasada`.

**Recomendación:** Validar campos críticos con `safeNum` y fallbacks.

---

#### RIESGO 8: Cola de mensajes en memoria

**Descripción:** `colaMensajes` y `procesandoMensaje` son variables en memoria. Si el servidor se reinicia (Railway restart), los mensajes pendientes se pierden.

**Causa:** No hay persistencia de la cola.

**Impacto:** Mensajes perdidos durante reinicios.

**Probabilidad:** Media — Railway reinicia en fallos.

**Archivos afectados:** `index.js` — sistema de cola.

**Recomendación:** Considerar persistencia en Supabase o Redis.

---

#### RIESGO 9: Historial en memoria no persistente

**Descripción:** `scriptProperties` guarda `historial_entrenos`, `ultima_traza`, `dias_calor`, `tasa_sudor` en memoria. Se pierden al reiniciar.

**Causa:** No hay persistencia de estas propiedades.

**Impacto:** El sistema pierde aprendizaje, historial y configuración al reiniciar.

**Probabilidad:** Alta — cada reinicio de Railway.

**Archivos afectados:** `index.js` — `scriptProperties`.

**Recomendación:** Persistir en Supabase.

---

#### RIESGO 10: `sendTelegram` sin timeout

**Descripción:** `sendTelegram` usa `fetch` sin timeout. Si Telegram no responde, la promesa queda pendiente.

**Causa:** No hay timeout en la llamada fetch.

**Impacto:** El webhook se bloquea esperando respuesta de Telegram.

**Probabilidad:** Media.

**Archivos afectados:** `index.js` — `sendTelegram`.

**Recomendación:** Añadir timeout de 10 segundos.

---

### 🟡 MEJORABLE

---

#### RIESGO 11: Fallbacks sin logging

**Descripción:** Cuando `obtenerDatosCompletos()` falla, usa valores por defecto sin logging detallado. El usuario no sabe que los datos son estimados.

**Causa:** Fallbacks silenciosos.

**Impacto:** El usuario recibe datos estimados creyendo que son reales.

**Probabilidad:** Media.

**Archivos afectados:** `index.js` — `getAthleteState`, `obtenerDatosCompletos`.

**Recomendación:** Añadir logging y aviso al usuario cuando se usan fallbacks.

---

#### RIESGO 12: `chatConIA` sin validación de respuesta

**Descripción:** La IA puede devolver respuestas inventadas o incorrectas. No hay validación de que la respuesta sea coherente con los datos reales.

**Causa:** No hay validación post-procesamiento.

**Impacto:** El usuario puede recibir consejos incorrectos.

**Probabilidad:** Media — depende del modelo.

**Archivos afectados:** `index.js` — `chatConIA`.

**Recomendación:** Añadir validación de respuesta o disclaimer.

---

#### RIESGO 13: Sin rate limiting

**Descripción:** No hay límite de peticiones por usuario. Un usuario podría spamear comandos y saturar el sistema.

**Causa:** No hay middleware de rate limiting.

**Impacto:** Posible saturación del servidor.

**Probabilidad:** Baja — solo un usuario autorizado.

**Archivos afectados:** `index.js` — webhook.

**Recomendación:** Añadir rate limiting simple.

---

#### RIESGO 14: `procesarWebhook` sin validación de `message.text`

**Descripción:** Si `message.text` es undefined (por ejemplo, un mensaje con solo foto), `rawText` será vacío y se devuelve OK sin procesar. Correcto, pero no hay logging.

**Causa:** No hay logging de mensajes ignorados.

**Impacto:** Mensajes ignorados sin rastro.

**Probabilidad:** Baja.

**Archivos afectados:** `index.js` — `procesarWebhook`.

**Recomendación:** Añadir logging.

---

### 🟢 BAJO IMPACTO

---

#### RIESGO 15: `cmdGarmin` sin validación de respuesta

**Descripción:** `postIntervals` puede fallar y el error se captura, pero no se verifica que la respuesta sea correcta.

**Causa:** No se valida la respuesta de Intervals.

**Impacto:** Mensaje de éxito aunque el entreno no se subió.

**Probabilidad:** Baja.

**Archivos afectados:** `index.js` — `cmdGarmin`.

**Recomendación:** Validar respuesta.

---

#### RIESGO 16: `cmdExportar` sin límite de tamaño

**Descripción:** Si el historial es muy grande, el JSON puede exceder el límite de Telegram (4096 chars).

**Causa:** No se limita el tamaño del JSON.

**Impacto:** Mensaje truncado o error de Telegram.

**Probabilidad:** Baja — historial limitado a 300.

**Archivos afectados:** `index.js` — `cmdExportar`.

**Recomendación:** Limitar a 10 entrenos (ya lo hace).

---

## INTEGRACIONES EXTERNAS — ANÁLISIS DETALLADO

---

### Telegram

| Aspecto | Estado |
|---|---|
| Timeout | ❌ No tiene |
| Reintento | ✅ Sí (sin Markdown) |
| Manejo de errores | ✅ try/catch |
| Límite de mensajes | ✅ 3800 chars (sendTelegramLong) |
| Riesgo | 🔴 Sin timeout puede bloquear el webhook |

---

### Supabase

| Aspecto | Estado |
|---|---|
| Timeout | ❌ No tiene |
| Manejo de errores | ✅ try/catch en la mayoría |
| Validación de datos | ❌ No valida esquema |
| Credenciales | 🔴 Hardcodeadas como fallback |
| Riesgo | 🟠 Datos inconsistentes posibles |

---

### Garmin (via Supabase)

| Aspecto | Estado |
|---|---|
| Fuente | Supabase (garmin_wellness) |
| Manejo de errores | ✅ try/catch |
| Datos incompletos | 🟡 Posibles (campos null) |
| Riesgo | 🟡 Depende de sincronización externa |

---

### Intervals.icu

| Aspecto | Estado |
|---|---|
| Timeout | ❌ No tiene |
| Manejo de errores | ❌ `fetchIntervals` lanza sin capturar |
| Fallback | ✅ `fetchWellnessSafe`, `fetchActivitiesSafe` |
| Riesgo | 🟠 API caída puede bloquear comandos |

---

### OpenRouter

| Aspecto | Estado |
|---|---|
| Timeout | ✅ 10 segundos |
| Fallback | ✅ Prueba hasta 5 modelos |
| Cache | ✅ 5 minutos |
| Validación | ❌ No valida respuesta |
| Riesgo | 🟡 Respuestas inventadas posibles |

---

### Railway

| Aspecto | Estado |
|---|---|
| Despliegue | ✅ Automático desde GitHub |
| Restart | ✅ ON_FAILURE, 3 reintentos |
| Persistencia | ❌ No hay volumen persistente |
| Riesgo | 🟠 Datos en memoria se pierden |

---

## BASE DE DATOS — ANÁLISIS

### Tablas

| Tabla | Riesgo | Detalle |
|---|---|---|
| `historial_entrenos` | 🟠 | Sin validación de duplicados, sin índice en user_id |
| `actividades_guardadas` | 🟡 | Upsert en actividad_id, pero sin validación de campos |
| `garmin_wellness` | 🟡 | Sin validación de campos null |
| `garmin_hrv` | 🟡 | Sin validación |
| `garmin_sleep` | 🟡 | Sin validación |
| `aprendizaje_desviaciones` | 🟡 | Sin validación |

### Riesgos de datos

1. **Duplicados**: `historial_entrenos` no tiene constraint de unicidad
2. **Inconsistencia**: `actividades_guardadas` puede tener `moving_time` null (bug /densidad)
3. **Pérdida**: Sin backup automático visible

---

## SISTEMA DE IA — ANÁLISIS

### Construcción de prompts

- ✅ Contexto real del sistema (TSB, CTL, readiness, nutrición, clima)
- ✅ Perfil del atleta (edad, peso, FTP, objetivo)
- ✅ Instrucciones claras (español, conciso, práctico)

### Riesgos

1. **Respuestas inventadas**: La IA puede inventar datos si no tiene contexto suficiente
2. **Falta de validación**: No se verifica que la respuesta sea coherente
3. **Modelos gratuitos**: Pueden estar saturados o dar respuestas de baja calidad

### Recomendación

- Añadir disclaimer en respuestas IA
- Validar que la respuesta no contradiga datos reales

---

## FLUJO DE COMANDOS — ANÁLISIS

### Comandos con try/catch

✅ `cmdHoy`, `cmdAnalizar`, `cmdTraza`, `cmdSemanaPasada`, `cmdHistorial`, `cmdSync`, `cmdIA`, `cmdGarmin` (parcial)

### Comandos sin try/catch

❌ `cmdStart`, `cmdPlan`, `cmdEstado`, `cmdFatiga`, `cmdRecuperacion`, `cmdAlerta`, `cmdTendencias`, `cmdSemana`, `cmdObjetivo`, `cmdAprender`, `cmdAprenderValidar`, `cmdZwo`, `cmdExportar`, `cmdDensidad`, `cmdDebug`, `cmdClima`, `cmdNutricion`, `cmdFuerza`, `cmdMovilidad`, `cmdConsejo`, `cmdResumen`, `cmdAjuste`, `cmdProgreso`, `cmdPrediccion`

### Riesgo

Un error en cualquiera de estos comandos tumba el webhook completo.

---

## VARIABLES DE ENTORNO — ANÁLISIS

| Variable | Obligatoria | Riesgo |
|---|---|---|
| `TELEGRAM_TOKEN` | ✅ | 🔴 Si falta, el bot no funciona |
| `CHAT_ID` | ✅ | 🔴 Si falta, el bot no funciona |
| `INTERVALS_API_KEY` | ✅ | 🟠 Si falta, datos de entrenamiento no disponibles |
| `ATHLETE_ID` | ✅ | 🟠 Si falta, API_BASE incorrecta |
| `WEATHER_API_KEY` | ✅ | 🟡 Si falta, clima no disponible |
| `SUPABASE_URL` | ✅ | 🔴 Hardcodeada como fallback |
| `SUPABASE_ANON_KEY` | ✅ | 🔴 Hardcodeada como fallback |
| `OPENROUTER_API_KEY` | ❌ | 🟡 IA no disponible |
| `FTP` | ❌ | 🟡 Default 240 |
| `WEIGHT_KG` | ❌ | 🟡 Default 64 |
| `AGE_YEARS` | ❌ | 🟡 Default 43 |
| `HEIGHT_CM` | ❌ | 🟡 Default 173 |
| `PORT` | ❌ | 🟢 Default 3000 |

---

## CONCLUSIONES

### Prioridades de corrección (para Fase 2)

1. 🔴 **Añadir try/catch a todos los comandos** — Impacto inmediato en estabilidad
2. 🔴 **Añadir timeout a todas las llamadas fetch** — Evita bloqueos
3. 🔴 **Eliminar credenciales hardcodeadas** — Seguridad
4. 🟠 **Validar datos de entrada** — Evita errores silenciosos
5. 🟠 **Persistir historial y cola en Supabase** — Evita pérdida de datos
6. 🟡 **Añadir logging a fallbacks** — Transparencia
7. 🟡 **Validar respuestas IA** — Fiabilidad

---

## NOTA

Este documento es **solo análisis**. No se ha modificado ningún código. Las recomendaciones están pendientes de revisión por el creador antes de implementar cualquier cambio.