'use strict';

// ═══════════════════════════════════════════════════════════════
// 🏔️ SERVICIO DE SEGMENTOS
// ═══════════════════════════════════════════════════════════════
// Une el repositorio (Supabase) con el motor de geometría. Aquí vive
// la regla de negocio:
//   - segmentos automáticos: subidas detectadas en cada actividad
//   - segmentos manuales: salida y llegada elegidas en la app
//   - esfuerzos: tiempo del tramo, potencia media, NP y FC media
// ═══════════════════════════════════════════════════════════════

const engine = require('./segmentEngine');
const codec = require('./trackCodec');
const strava = require('./stravaSegments');

const AUTO_START_RADIUS_M = 60;
const MANUAL_START_RADIUS_M = 45;

function createSegmentsService(options = {}) {
  const { repository, userId, logger = () => {}, now = () => new Date() } = options;
  if (!repository) throw new Error('Falta el repositorio de actividades');
  if (!userId) throw new Error('Falta el user_id');

  function effortRow(segment, activityId, fecha, effort) {
    return {
      segmento_id: segment.id,
      actividad_id: activityId,
      user_id: userId,
      fecha,
      tiempo_s: Math.round(effort.seconds),
      pot_media: effort.avgPower ?? null,
      np: effort.normalizedPower ?? null,
      fc_media: effort.avgHeartRate ?? null,
      velocidad_media: effort.avgSpeedKmh ?? null,
      desnivel_m: effort.gainM ?? null,
      inicio_t: effort.startT ?? null,
      fin_t: effort.endT ?? null,
    };
  }

  function autoName(climb) {
    return `Subida km ${climb.distanceKmAtStart.toFixed(1)} · ${climb.gainM} m`;
  }

  function segmentRowFromClimb(climb, activityId) {
    return {
      user_id: userId,
      nombre: autoName(climb),
      tipo: 'auto',
      deporte: 'Ride',
      distancia_m: climb.lengthM,
      desnivel_m: climb.gainM,
      pendiente_media: climb.avgGrade,
      categoria: climb.category,
      inicio_lat: climb.startPoint.lat,
      inicio_lon: climb.startPoint.lon,
      fin_lat: climb.endPoint.lat,
      fin_lon: climb.endPoint.lon,
      radio_m: AUTO_START_RADIUS_M,
      referencia_actividad: activityId,
      estado: 'listo',
    };
  }

  // ─── CÁLCULO DE ESFUERZOS ────────────────────────────────────

  /**
   * Importa los segmentos de Strava de una actividad tal como los ve
   * Intervals.icu. La geometría sale de nuestra propia traza (índices
   * start_index/end_index), así que no hace falta OAuth de Strava.
   */
  async function importStravaSegments({ activityId, fecha, track, intervals }) {
    if (!track || !track.hasGps) return { creados: 0, esfuerzos: 0 };
    if (!intervals || typeof intervals.getActivitySegments !== 'function') {
      throw new Error('Falta el cliente de Intervals.icu para importar segmentos');
    }

    const efforts = await intervals.getActivitySegments(activityId);
    if (!efforts || efforts.length === 0) return { creados: 0, esfuerzos: 0 };

    let creados = 0;
    let guardados = 0;

    for (const raw of efforts) {
      const range = strava.effortRange(track, raw);
      if (!range) continue;

      const stats = engine.sliceStats(track, range.from, range.to);
      // Tramos absurdos (sin distancia o de un solo punto) no valen.
      if (!stats || !Number.isFinite(stats.meters) || stats.meters < 50) continue;

      const id = strava.stravaSegmentUuid(raw.segment_id);
      let segment = await repository.getSegment(id);

      if (!segment) {
        const row = strava.segmentRowFromEffort({
          id,
          userId,
          effort: raw,
          range,
          stats,
          activityId,
        });
        // La tabla puede tener un CHECK que solo admita auto/manual:
        // en ese caso se guarda como manual y la etiqueta Strava llega
        // cuando se amplíe el CHECK.
        segment = await repository.insertSegment(row).catch((error) => {
          if (!/segmentos_tipo_check/i.test(String(error && error.message))) throw error;
          return repository.insertSegment({ ...row, tipo: 'manual' });
        });
        creados++;
      } else if (segment.tipo !== 'strava') {
        // Segmento importado antes sin la etiqueta: se intenta subir de
        // categoría sin romper nada si el CHECK todavía no lo permite.
        try {
          await repository.updateSegment(segment.id, { tipo: 'strava' });
          segment = { ...segment, tipo: 'strava' };
        } catch (_) {
          // El CHECK aún no admite 'strava'.
        }
      }
      if (!segment) continue;

      await repository.upsertEffort(
        effortRow(segment, activityId, fecha, {
          ...stats,
          startT: track.t[range.from],
          endT: track.t[range.to],
        }),
      );
      guardados++;
    }

    return { creados, esfuerzos: guardados };
  }

  /**
   * Recalcula los esfuerzos de las actividades indicadas contra la
   * lista de segmentos. Devuelve cuántos esfuerzos se han guardado.
   */
  async function computeEffortsForActivities({ activityIds, segments }) {
    if (!activityIds || activityIds.length === 0 || !segments || segments.length === 0) {
      return 0;
    }

    const trackRows = await repository.getTrackRows(activityIds);
    const fechaPorActividad = new Map();
    let guardados = 0;

    for (const row of trackRows) {
      const track = codec.decodeTrack(row.datos);
      if (!track || !track.hasGps) continue;

      const actividad = await repository.getActivity(row.actividad_id);
      if (!actividad) continue;
      fechaPorActividad.set(row.actividad_id, actividad.fecha);

      for (const segment of segments) {
        if (!segment.distancia_m || segment.inicio_lat === undefined) continue;

        const segmentBounds = engine.boundsWithMargin(
          {
            minLat: Math.min(segment.inicio_lat, segment.fin_lat),
            maxLat: Math.max(segment.inicio_lat, segment.fin_lat),
            minLon: Math.min(segment.inicio_lon, segment.fin_lon),
            maxLon: Math.max(segment.inicio_lon, segment.fin_lon),
          },
          (segment.radio_m || MANUAL_START_RADIUS_M) + 150,
        );

        if (!engine.boundsIntersect(track.bounds, segmentBounds)) {
          await repository.deleteEffort(segment.id, row.actividad_id);
          continue;
        }

        const effort = engine.matchEffort(track, segment);
        if (!effort) {
          await repository.deleteEffort(segment.id, row.actividad_id);
          continue;
        }

        await repository.upsertEffort(
          effortRow(segment, row.actividad_id, actividad.fecha, effort),
        );
        guardados++;
      }
    }

    return guardados;
  }

  /**
   * Recalcula un segmento completo recorriendo todas las trazas. Se usa
   * al crear un segmento manual sobre un historial ya importado.
   */
  async function recomputeSegment(segmentId) {
    const segment = await repository.getSegment(segmentId);
    if (!segment) throw new Error('Segmento no encontrado');

    await repository.updateSegment(segmentId, { estado: 'calculando' });

    const matched = new Set();
    let guardados = 0;

    try {
      for await (const rows of repository.iterateTracks()) {
        for (const row of rows) {
          const track = codec.decodeTrack(row.datos);
          if (!track || !track.hasGps) continue;

          const segmentBounds = engine.boundsWithMargin(
            {
              minLat: Math.min(segment.inicio_lat, segment.fin_lat),
              maxLat: Math.max(segment.inicio_lat, segment.fin_lat),
              minLon: Math.min(segment.inicio_lon, segment.fin_lon),
              maxLon: Math.max(segment.inicio_lon, segment.fin_lon),
            },
            (segment.radio_m || MANUAL_START_RADIUS_M) + 150,
          );
          if (!engine.boundsIntersect(track.bounds, segmentBounds)) continue;

          const effort = engine.matchEffort(track, segment);
          if (!effort) continue;

          const actividad = await repository.getActivity(row.actividad_id);
          if (!actividad) continue;

          await repository.upsertEffort(
            effortRow(segment, row.actividad_id, actividad.fecha, effort),
          );
          matched.add(row.actividad_id);
          guardados++;
        }
      }

      // Limpia esfuerzos antiguos que ya no casan.
      const anteriores = await repository.listEffortsForSegment(segmentId);
      for (const effort of anteriores) {
        if (!matched.has(effort.actividad_id)) {
          await repository.deleteEffort(segmentId, effort.actividad_id);
        }
      }

      await repository.updateSegment(segmentId, { estado: 'listo', esfuerzos: guardados });
      return guardados;
    } catch (error) {
      logger(`[segments] error recalculando ${segmentId}: ${error.message}`);
      await repository.updateSegment(segmentId, { estado: 'error' });
      throw error;
    }
  }

  // ─── SEGMENTOS AUTOMÁTICOS ───────────────────────────────────

  /**
   * Detecta las subidas de una actividad, las agrupa con las ya
   * conocidas y guarda los esfuerzos correspondientes.
   */
  async function storeAutoSegments({ activityId, fecha, track, segments }) {
    if (!track || !track.hasGps || !track.hasElevation) return { creados: 0, esfuerzos: 0 };

    const climbs = engine.detectClimbs(track);
    if (climbs.length === 0) return { creados: 0, esfuerzos: 0 };

    const conocidos = (segments || []).filter((segment) => segment.tipo === 'auto');
    let creados = 0;
    let esfuerzos = 0;

    for (const climb of climbs) {
      let segment = conocidos.find((candidate) => engine.isSameClimb(climb, candidate));

      if (!segment) {
        segment = await repository.insertSegment(segmentRowFromClimb(climb, activityId));
        conocidos.push(segment);
        creados++;
      }

      await repository.upsertEffort(
        effortRow(segment, activityId, fecha, {
          seconds: climb.stats.seconds,
          avgPower: climb.stats.avgPower,
          normalizedPower: climb.stats.normalizedPower,
          avgHeartRate: climb.stats.avgHeartRate,
          avgSpeedKmh: climb.stats.avgSpeedKmh,
          gainM: climb.stats.gainM,
          startT: track.t[climb.startIndex],
          endT: track.t[climb.endIndex],
        }),
      );
      esfuerzos++;
    }

    return { creados, esfuerzos };
  }

  // ─── SEGMENTOS MANUALES ──────────────────────────────────────

  /**
   * Crea un segmento a partir de dos puntos elegidos en la app sobre el
   * recorrido de una actividad de referencia.
   */
  async function createManualSegment({ nombre, actividadId, startPoint, endPoint, radioM }) {
    const limpio = typeof nombre === 'string' ? nombre.trim().slice(0, 80) : '';
    if (limpio.length < 2) throw new Error('El nombre del segmento es obligatorio');

    if (!startPoint || !endPoint) throw new Error('Faltan los puntos de salida y llegada');

    const activity = await repository.getActivity(actividadId);
    if (!activity) throw new Error('Actividad de referencia no encontrada');

    const trackRow = await repository.getTrackRow(actividadId);
    const track = trackRow ? codec.decodeTrack(trackRow.datos) : null;
    if (!track || !track.hasGps) throw new Error('La actividad no tiene recorrido GPS');

    const startMatch = engine.nearestIndexToPoint(track, startPoint);
    const endMatch = engine.nearestIndexToPoint(track, endPoint);
    if (startMatch.index < 0 || endMatch.index < 0) throw new Error('No se han podido situar los puntos');

    let from = startMatch.index;
    let to = endMatch.index;
    if (from > to) {
      const swap = from;
      from = to;
      to = swap;
    }

    const stats = engine.sliceStats(track, from, to);
    if (stats.meters < 100) throw new Error('El tramo elegido es demasiado corto');

    const inicio = { lat: track.lat[from], lon: track.lon[from] };
    const fin = { lat: track.lat[to], lon: track.lon[to] };
    const referencia = Math.max(20, Math.min(200, Math.round(Number(radioM) || MANUAL_START_RADIUS_M)));

    const segment = await repository.insertSegment({
      user_id: userId,
      nombre: limpio,
      tipo: 'manual',
      deporte: 'Ride',
      distancia_m: Math.round(stats.meters),
      desnivel_m: stats.gainM,
      pendiente_media: stats.meters > 0 ? Math.round((stats.gainM / stats.meters) * 1000) / 10 : 0,
      categoria: engine.climbCategory(stats.gainM, stats.meters),
      inicio_lat: inicio.lat,
      inicio_lon: inicio.lon,
      fin_lat: fin.lat,
      fin_lon: fin.lon,
      radio_m: referencia,
      referencia_actividad: actividadId,
      estado: 'calculando',
    });

    return { segment, stats };
  }

  // ─── LECTURA PARA LA APP ─────────────────────────────────────

  async function listSegmentsWithBest() {
    const segments = await repository.listSegments();
    if (segments.length === 0) return [];

    const efforts = await repository.listEfforts(segments.map((segment) => segment.id));
    const bySegment = new Map();
    for (const effort of efforts) {
      if (!bySegment.has(effort.segmento_id)) bySegment.set(effort.segmento_id, []);
      bySegment.get(effort.segmento_id).push(effort);
    }

    return segments.map((segment) => {
      const list = (bySegment.get(segment.id) || []).sort((a, b) => a.tiempo_s - b.tiempo_s);
      const best = list[0] || null;
      return {
        ...segment,
        intentos: list.length,
        mejor: best
          ? {
              tiempo_s: best.tiempo_s,
              pot_media: best.pot_media,
              fc_media: best.fc_media,
              fecha: best.fecha,
              actividad_id: best.actividad_id,
            }
          : null,
      };
    });
  }

  async function getSegmentDetail(segmentId) {
    const segment = await repository.getSegment(segmentId);
    if (!segment) return null;

    const efforts = await repository.listEffortsForSegment(segmentId);
    return {
      ...segment,
      intentos: efforts.length,
      clasificacion: efforts.map((effort, index) => ({
        posicion: index + 1,
        actividad_id: effort.actividad_id,
        fecha: effort.fecha,
        tiempo_s: effort.tiempo_s,
        pot_media: effort.pot_media,
        np: effort.np,
        fc_media: effort.fc_media,
        velocidad_media: effort.velocidad_media,
      })),
    };
  }

  /**
   * Segmentos recorridos por una actividad, con el puesto de su esfuerzo en
   * el ranking de cada segmento (la "joya" de Strava: N.º 1, 2, 3…).
   */
  async function listSegmentsForActivity(activityId) {
    const segments = await repository.listSegments();
    if (segments.length === 0) return [];

    const efforts = await repository.listEfforts(segments.map((segment) => segment.id));
    const segmentById = new Map(segments.map((segment) => [segment.id, segment]));
    const porSegmento = new Map();
    for (const effort of efforts) {
      if (!porSegmento.has(effort.segmento_id)) porSegmento.set(effort.segmento_id, []);
      porSegmento.get(effort.segmento_id).push(effort);
    }

    // `listEfforts` entrega cada segmento ordenado por tiempo ascendente:
    // el puesto del intento es su posición dentro de esa lista.
    const resultado = [];
    for (const effort of efforts) {
      if (effort.actividad_id !== activityId) continue;

      const segment = segmentById.get(effort.segmento_id);
      const lista = porSegmento.get(effort.segmento_id) || [];
      const posicion = lista.findIndex((candidato) => candidato.actividad_id === activityId) + 1;

      resultado.push({
        segmento_id: effort.segmento_id,
        nombre: segment ? segment.nombre : '',
        tipo: segment ? segment.tipo : null,
        categoria: segment ? segment.categoria : null,
        distancia_m: segment ? segment.distancia_m : null,
        desnivel_m: segment ? segment.desnivel_m : null,
        pendiente_media: segment ? segment.pendiente_media : null,
        fecha: effort.fecha,
        tiempo_s: effort.tiempo_s,
        pot_media: effort.pot_media,
        np: effort.np,
        fc_media: effort.fc_media,
        velocidad_media: effort.velocidad_media,
        posicion,
        intentos: lista.length,
      });
    }

    resultado.sort((a, b) => a.posicion - b.posicion || b.tiempo_s - a.tiempo_s);
    return resultado;
  }

  return {
    computeEffortsForActivities,
    recomputeSegment,
    storeAutoSegments,
    createManualSegment,
    listSegmentsWithBest,
    getSegmentDetail,
    listSegmentsForActivity,
    importStravaSegments,
  };
}

module.exports = {
  createSegmentsService,
  AUTO_START_RADIUS_M,
  MANUAL_START_RADIUS_M,
};
