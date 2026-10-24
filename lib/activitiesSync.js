'use strict';

// ═══════════════════════════════════════════════════════════════
// 🔄 SINCRONIZACIÓN DE ACTIVIDADES (INTERVALS → SUPABASE)
// ═══════════════════════════════════════════════════════════════
// Descarga el historial por ventanas de fechas, guarda resumen y traza
// comprimida, y deja los segmentos automáticos calculados.
//
// Es incremental: las actividades ya guardadas no se vuelven a bajar.
// El estado vive en memoria del proceso (igual que el resto del bot) y
// se expone a la app mientras el sync corre en segundo plano.
// ═══════════════════════════════════════════════════════════════

const engine = require('./segmentEngine');
const codec = require('./trackCodec');
const { normalizeActivity } = require('./intervalsClient');

const VENTANA_DIAS = 120;
const MAX_NUEVAS_POR_SYNC = 300;
const FECHA_INICIO_HISTORIAL = '2014-01-01';

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

// Parte el rango en ventanas para no depender de paginación.
function buildWindows(desde, hasta, dias = VENTANA_DIAS) {
  const windows = [];
  let start = desde;
  while (start <= hasta) {
    const end = addDays(start, dias - 1);
    const realEnd = end > hasta ? hasta : end;
    windows.push({ oldest: formatDate(start), newest: formatDate(realEnd) });
    start = addDays(realEnd, 1);
  }
  return windows;
}

function createActivitiesSync(options = {}) {
  const {
    repository,
    segmentsService,
    intervals,
    userId,
    logger = () => {},
    maxNuevas = MAX_NUEVAS_POR_SYNC,
    now = () => new Date(),
  } = options;

  if (!repository) throw new Error('Falta el repositorio');
  if (!segmentsService) throw new Error('Falta el servicio de segmentos');
  if (!intervals) throw new Error('Falta el cliente de Intervals.icu');
  if (!userId) throw new Error('Falta el user_id');

  let estado = {
    estado: 'inactivo',
    iniciado: null,
    terminado: null,
    nuevas: 0,
    existentes: 0,
    errores: 0,
    segmentos_creados: 0,
    esfuerzos: 0,
    mensaje: null,
    // true cuando quedan actividades por descargar tras esta tanda.
    hay_mas: false,
  };

  let enCurso = null;

  function getStatus() {
    return { ...estado };
  }

  async function run({ desde, hasta, limite } = {}) {
    const start = toDate(desde) || new Date(`${FECHA_INICIO_HISTORIAL}T00:00:00Z`);
    const end = toDate(hasta) || now();
    const tope = Number(limite) > 0 ? Math.min(Number(limite), 1000) : maxNuevas;

    if (start > end) throw new Error('El rango de fechas no es válido');

    estado = {
      estado: 'ejecutando',
      iniciado: now().toISOString(),
      terminado: null,
      nuevas: 0,
      existentes: 0,
      errores: 0,
      segmentos_creados: 0,
      esfuerzos: 0,
      mensaje: 'Listando actividades de Intervals.icu',
      hay_mas: false,
    };

    try {
      // 1. Actividades del rango, por ventanas.
      const ventanas = buildWindows(start, end);
      const crudas = [];
      for (const ventana of ventanas) {
        const lote = await intervals.listActivities(ventana);
        for (const item of lote) crudas.push(item);
      }

      const vistas = new Set();
      const actividades = [];
      for (const cruda of crudas) {
        const normalizada = normalizeActivity(cruda);
        if (!normalizada || vistas.has(normalizada.actividad_id)) continue;
        vistas.add(normalizada.actividad_id);
        actividades.push(normalizada);
      }

      actividades.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

      // 2. Solo las que no están guardadas.
      const existentes = await repository.existingActivityIds(actividades.map((a) => a.actividad_id));
      const nuevas = actividades.filter((a) => !existentes.has(a.actividad_id));
      estado.existentes = existentes.size;

      const lote = nuevas.slice(0, tope);
      estado.mensaje = `Descargando ${lote.length} actividades nuevas`;

      let segmentos = await repository.listSegments();
      const conTraza = [];

      for (const actividad of lote) {
        try {
          const streams = await intervals.getStreams(actividad.actividad_id);
          const track = engine.streamsToTrack(streams);

          const row = {
            ...actividad,
            user_id: userId,
            origen: 'intervals',
            muestras: track ? track.t.length : 0,
            tiene_gps: Boolean(track && track.hasGps),
            sincronizado_en: now().toISOString(),
          };

          await repository.upsertActivity(row);

          if (track) {
            const encoded = codec.encodeTrack(track);
            await repository.upsertTrack({
              actividad_id: actividad.actividad_id,
              user_id: userId,
              datos: encoded.datos,
              muestras: encoded.muestras,
              bytes: encoded.bytes,
              bounds_min_lat: track.bounds ? track.bounds.minLat : null,
              bounds_max_lat: track.bounds ? track.bounds.maxLat : null,
              bounds_min_lon: track.bounds ? track.bounds.minLon : null,
              bounds_max_lon: track.bounds ? track.bounds.maxLon : null,
            });
            conTraza.push(actividad);

            const auto = await segmentsService.storeAutoSegments({
              activityId: actividad.actividad_id,
              fecha: actividad.fecha,
              track,
              segments: segmentos,
            });
            segmentos = await repository.listSegments();
            estado.segmentos_creados += auto.creados;
          }

          estado.nuevas++;
        } catch (error) {
          estado.errores++;
          logger(`[activitiesSync] actividad ${actividad.actividad_id}: ${error.message}`);
        }
      }

      // 3. Esfuerzos homogéneos en todos los segmentos para lo descargado.
      if (conTraza.length > 0 && segmentos.length > 0) {
        estado.mensaje = 'Calculando esfuerzos en los segmentos';
        estado.esfuerzos = await segmentsService.computeEffortsForActivities({
          activityIds: conTraza.map((actividad) => actividad.actividad_id),
          segments: segmentos,
        });
      }

      estado.hay_mas = nuevas.length > lote.length;
      estado.estado = 'listo';
      estado.terminado = now().toISOString();
      estado.mensaje =
        estado.nuevas > 0
          ? `Sincronizadas ${estado.nuevas} actividades nuevas`
          : 'No hay actividades nuevas';
      return getStatus();
    } catch (error) {
      estado.estado = 'error';
      estado.terminado = now().toISOString();
      estado.mensaje = error.message;
      logger(`[activitiesSync] error: ${error.message}`);
      throw error;
    }
  }

  // Evita dos sincronizaciones simultáneas sobre las mismas tablas.
  function startSync(params) {
    if (enCurso) {
      return { iniciado: false, motivo: 'ya_en_curso', estado: getStatus() };
    }
    enCurso = run(params)
      .catch(() => {})
      .finally(() => {
        enCurso = null;
      });
    return { iniciado: true, estado: getStatus() };
  }

  function isRunning() {
    return Boolean(enCurso);
  }

  return { run, startSync, getStatus, isRunning };
}

module.exports = {
  createActivitiesSync,
  buildWindows,
  VENTANA_DIAS,
};
