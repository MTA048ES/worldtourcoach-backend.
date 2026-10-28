# Revisión de la capa `/api/app` — checkpoint

> **Estado:** revisión terminada. **No se ha modificado código.** Los cinco
> hallazgos de abajo siguen abiertos.
> **Fecha:** 24/10/2026 · **Commit base:** `3f774ef` (feat(app): API /api/app…)
> **Entorno:** Node 22 (.nvmrc) probado con v24.18.0 · npm 11.16.0

---

## Resumen ejecutivo

La base es sólida: autenticación fail-closed (503 si falta `APP_API_TOKEN`),
comparación en tiempo constante sobre digests (`lib/security.js`) y todas las
consultas del repositorio filtran por `user_id`. La arquitectura en capas
(router → servicio → repositorio → cliente) se respeta.

Los problemas están en los bordes: **validación de entrada**, **mapeo de
errores a códigos HTTP**, **zonas horarias** y **coste del sync/recompute**.
Cuatro de ellos se reprodujeron contra una instancia real de Express.

**Verificación actual:** `npm test` → 63/63 en verde.

```bash
npm test        # 63 pasan, exit 0
```

---

## Hallazgos, por severidad

### 1. `POST /segments` acepta coordenadas que no están en el recorrido

- **Ficheros:** `lib/appApiRouter.js:25-32` (`validCoordinate`), `lib/appApiRouter.js:177`,
  `lib/segmentsService.js:245-247`
- **Severidad:** alta (datos incorrectos persistidos)

`validCoordinate` usa `Number.isFinite(Number(lat))`, y `Number(null) === 0`,
igual que `Number('')` y `Number(false)`. Por tanto `{lat: null, lon: null}`
pasa la validación y llega al servicio como `{lat: 0, lon: 0}`.

Después, `createManualSegment` llama a `engine.nearestIndexToPoint`, que
devuelve la muestra **más cercana sin límite de distancia**. El error de
distancia existe (`startMatch.distance` / `endMatch.distance`) pero **nunca se
comprueba**, así que cualquier punto del planeta se pega al punto más próximo
del recorrido de referencia.

Reproducido (instancia Express real, servicio real):

| cuerpo enviado | resultado observado |
|---|---|
| `inicio: {lat: null, lon: null}` | **201**; el servicio recibe `{lat: 0, lon: 0}` |
| `inicio: {lat: 90, lon: 180}` | **201** (antípoda, a miles de km de la salida) |
| `inicio: {lat: 'no-es-numero', lon: -5}` | 400 (este sí funciona, es el caso que cubre el test) |

Consecuencia: se crea un segmento con geometría arbitraria y se recalcula todo
el historial contra él (`recomputeSegment`).

**Arreglo propuesto**

1. En `validCoordinate`, rechazar `null`, `undefined`, `''`, booleanos y
   no-finitos *antes* de convertir:
   ```js
   const toNumber = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);
   ```
   y validar el resultado con `Number.isFinite` + rangos.
2. En `createManualSegment`, tras `nearestIndexToPoint`:
   ```js
   const MAX_SNAP_M = 300;
   if (!Number.isFinite(startMatch.distance) || startMatch.distance > MAX_SNAP_M) {
     throw new SegmentInputError('El punto de salida no está sobre el recorrido');
   }
   ```
   ídem para `endMatch`.
3. Tests: `lat: null`, `lat: ''`, `lat: true`, punto lejano → 400.

---

### 2. Los errores de negocio salen como HTTP 500 con el mensaje crudo

- **Fichero:** `lib/appApiRouter.js:57-64` (`handle`)
- **Severidad:** alta (la app no puede distinguir error de usuario de fallo real)

`handle` convierte cualquier `throw` en `500` + `error.message`. Reproducido:

| petición | observado | esperado |
|---|---|---|
| `POST /segments` con `actividad_id: "nope"` | **500** `"Actividad de referencia no encontrada"` | 404 |
| `POST /segments` nombre de 1 carácter | 400 (lo valida el router) | 400 ✔ |
| `POST /segments` tramo de 20 m | **500** `"El tramo elegido es demasiado corto"` | 422 |
| `POST /segments` actividad sin GPS | **500** `"La actividad no tiene recorrido GPS"` | 422 |

Además se filtra el mensaje interno al cliente en todos los 500, incluidos los
que vienen de PostgREST/Intervals.

**Arreglo propuesto**

- Introducir una clase de error de dominio, p. ej. `lib/errors.js`:
  `AppError { status, code, message }`, y subclases o helpers
  `notFound()`, `unprocessable()`, `conflict()`.
- `handle` mapea `error.status` si existe; si no, 500 genérico
  (`"Error interno"`) y el mensaje real solo al `logger`.
- Cambiar los `throw new Error(...)` de `segmentsService` por errores con
  status (404 actividad/segmento, 422 tramo corto / sin GPS / nombre).
- Test HTTP por cada caso.

---

### 3. `fecha` se guarda en la zona horaria equivocada

- **Fichero:** `lib/intervalsClient.js:130-136` (`normalizeActivity`)
- **Severidad:** alta (corrompe datos y filtros)

```js
const fecha = raw.start_date_local ?? raw.start_date ?? null;
```

`start_date_local` es hora local de reloj **sin offset** (`"2026-05-01T08:00:00"`).
Se escribe tal cual en la columna `timestamptz`, Postgres la interpreta como
UTC: una salida a las 08:00 CEST se guarda como 08:00Z y se muestra a las
10:00. También desplaza los filtros `desde`/`hasta` de `GET /activities` en ±2 h.

**Arreglo propuesto**

- Guardar `raw.start_date` (UTC con `Z`). Si no viene, normalizar
  `start_date_local` como UTC explícito y documentarlo.
- Mantener el valor local aparte si la app lo necesita para mostrar
  (`fecha_local`), pero que la columna de orden/filtro sea UTC.
- Test unitario de `normalizeActivity` con un `start_date_local` sin offset.

---

### 4. El sync hace una ida y vuelta a la BD por cada (actividad × segmento)

- **Ficheros:** `lib/segmentsService.js:71-120`, `lib/segmentsService.js:126-181`
- **Severidad:** alta (rendimiento; `/sync` queda bloqueado)

```js
for (const row of trackRows) {
  const actividad = await repository.getActivity(row.actividad_id);   // 1 por actividad
  for (const segment of segments) {
    await repository.deleteEffort(...) | await repository.upsertEffort(...);  // 1 por par
  }
}
```

Con `MAX_NUEVAS_POR_SYNC = 300` y ~50 segmentos son ~15 000 llamadas PostgREST
**en serie**; decenas de minutos. Durante ese tiempo `/sync` responde 409 a
cualquier otra llamada porque `isRunning()` sigue en `true`.

`recomputeSegment` tiene la misma forma sobre **todo** el historial, sin tope.

Además `lib/activitiesSync.js:174` hace `segmentos = await repository.listSegments()`
dentro del bucle de actividades (1 consulta extra por actividad).

**Arreglo propuesto**

- Traer `fecha` junto con la traza (`getTrackRows` puede hacer join o devolver
  `fecha`), eliminando `getActivity` por actividad.
- Acumular filas y hacer `upsertEffort` en lote (el repositorio ya tiene
  `chunk()`), y agrupar los `deleteEffort` por segmento o por lista de ids.
- Sacar `listSegments()` fuera del bucle y refrescar solo cuando `storeAutoSegments`
  haya creado alguno (`auto.creados > 0`).
- Añadir `logger` de progreso cada N actividades para que el estado sea visible.
- Medir antes/después con un doble de repositorio que cuente llamadas.

---

### 5. El sync no tiene marca de agua

- **Ficheros:** `lib/activitiesSync.js:20` (`FECHA_INICIO_HISTORIAL`), `:87-88`, `:106-113`
- **Severidad:** media (coste innecesario por sync)

Sin `desde`, el rango por defecto es `2014-01-01` → hoy. En ventanas de 120 días
son ~35-40 llamadas a Intervals **en cada** `POST /sync`, solo para descubrir que
no hay nada nuevo. No se guarda en ningún sitio la última fecha sincronizada.

**Arreglo propuesto**

- Persistir un watermark por usuario (columna `ultima_sync` en config de
  usuario, o una tabla `sync_state`) y usarlo como `desde` por defecto,
  con solape de 7-14 días para recoger actividades editadas.
- Si no existe watermark, primera ejecución con `FECHA_INICIO_HISTORIAL`.
- Devolver `desde`/`hasta` efectivos en `GET /sync` para depurar.

---

## Observaciones menores (no bloquean)

- `lib/activitiesSync.js:121-124`: `getStreams()` se llama **sin** `types`, así
  que Intervals devuelve todos los streams (incluidos `latlng`, `watts`, `hr`,
  `cadence`, `velocity_smooth`, `altitude`…). Es el comportamiento deseado por
  `readStreams`, pero conviene fijar la lista explícita para no depender del
  envelope ni del tamaño de la respuesta.
- **Sin confirmar (hace falta una llamada real):** la forma exacta de
  `/activity/{id}/streams.json` cuando no se manda `types`. `readStreams`
  soporta `[{type, data}]` y `{watts: [...]}`, pero un único objeto
  `{type: 'time', data: [...]}` daría cero muestras y guardaría actividades sin
  traza **en silencio**. Verificado con la documentación y el foro de
  Intervals.icu que el endpoint existe y devuelve todos los streams; falta
  confirmar el envoltorio con credenciales reales.
- `lib/appApiRouter.js:129`: `downsampleTrack` con `max` entre 100 y 2000;
  correcto, pero el `POST /segments` depende de que la app elija puntos
  *reales* de esa lista reducida — el snap de 300 m del punto 1 lo mitiga, no
  lo resuelve del todo.
- `decodeTrack` devuelve `null` ante gzip/base64 corrupto en vez de lanzar
  (→ 422 en `/track`, correcto).
- `iterateTracks` pagina de forma estable (ordenada por PK): sin riesgo de
  duplicados ni huecos.
- Estado del sync en memoria del proceso (`activitiesSync.js:80`): correcto con
  una sola instancia; con >1 réplica el 409 no se respeta entre procesos.
  Anotarlo en `docs/DECISIONS.md` si Railway escala horizontalmente.
- `GET /health` hace `countActivities()` + `listSegments()` en cada llamada: si
  la app lo usa como ping frecuente, conviene cachear unos segundos.

---

## Cross-check de esquema

Revisado `crear_tablas_actividades_segmentos.sql` contra cada tabla/columna que
toca `lib/activityRepository.js`: **sin desajustes**. Tablas `actividades`,
`actividades_tracks`, `segmentos`, `segmentos_esfuerzos`, con `user_id` en todas.

---

## Plan para la próxima sesión

Orden recomendado (primero lo que corrompe datos, luego lo que cuelga el sync):

1. **Errores de dominio** (`lib/errors.js` + `handle` + throws de
   `segmentsService`) — desbloquea los códigos HTTP correctos para el resto.
2. **Validación de coordenadas** (`validCoordinate` + límite de snap 300 m).
3. **Zona horaria** (`normalizeActivity` → `start_date` UTC).
4. **Lote en esfuerzos** (`computeEffortsForActivities` + `recomputeSegment`).
5. **Watermark de sync** (`activitiesSync`) + `listSegments` fuera del bucle.
6. Tests HTTP/unitarios nuevos por cada punto y `npm test` completo.
7. Confirmar el envelope de `streams.json` con credenciales reales antes de
   tocar `readStreams`.

**Decisión pendiente antes de empezar:** ¿el arreglo de `fecha` necesita
migración de datos existentes? (`UPDATE actividades SET fecha = …` para las
filas ya importadas con hora local). Hay que ver si la app ya está consumiendo
esas fechas.

---

## Cómo reproducir

```bash
npm test                                   # 63/63
node --test test/appApiRouter.test.js      # solo el router

# 500 en vez de 404:
curl -sS -o - -w '\n%{http_code}\n' -X POST http://127.0.0.1:3000/api/app/segments \
  -H "Authorization: Bearer $APP_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"nombre":"Prueba","actividad_id":"nope","inicio":{"lat":40,"lon":-5},"fin":{"lat":40.1,"lon":-5}}'

# lat:null aceptado como 0,0:
curl -sS -o - -w '\n%{http_code}\n' -X POST http://127.0.0.1:3000/api/app/segments \
  -H "Authorization: Bearer $APP_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"nombre":"Prueba","actividad_id":"<id-real>","inicio":{"lat":null,"lon":null},"fin":{"lat":40.1,"lon":-5}}'
```

---

## Estado del árbol de trabajo

```
?? docs/MODULAR_PLAN.md      (sin commit, previo a esta sesión)
?? docs/REVISION_API_APP.md  (este documento)
```

Ningún fichero de código modificado en esta revisión.
