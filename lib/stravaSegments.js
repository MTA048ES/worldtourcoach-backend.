'use strict';

// ═══════════════════════════════════════════════════════════════
// 🧲 SEGMENTOS DE STRAVA VÍA INTERVALS.ICU
// ═══════════════════════════════════════════════════════════════
// Intervals.icu devuelve, para cada actividad, los esfuerzos de
// segmento de Strava con los índices `start_index`/`end_index` dentro
// de los streams. Como guardamos esos mismos streams, podemos sacar
// la geometría (inicio/fin), la distancia y el desnivel sin pedir
// nada a la API de Strava ni configurar OAuth.
//
// El id del segmento es un UUID determinista derivado del id de
// Strava, así reimportar no duplica nada y no hace falta migrar la
// tabla `segmentos`.
// ═══════════════════════════════════════════════════════════════

const crypto = require('crypto');

/**
 * UUID v5-like estable a partir del id numérico de Strava.
 * Mismo `segment_id` → mismo UUID en cualquier ejecución.
 */
function stravaSegmentUuid(segmentId) {
  const hex = crypto.createHash('sha1').update(`strava:${String(segmentId)}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Convierte un esfuerzo de Intervals en índices válidos de la traza.
 * Devuelve null si el tramo no encaja (actividad sin GPS, índices malos).
 */
function effortRange(track, effort) {
  if (!track || !track.hasGps) return null;

  const from = Number(effort && effort.start_index);
  const to = Number(effort && effort.end_index);
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  if (from < 0 || to <= from || to >= track.t.length) return null;

  const startLat = track.lat[from];
  const startLon = track.lon[from];
  const endLat = track.lat[to];
  const endLon = track.lon[to];
  if (!Number.isFinite(startLat) || !Number.isFinite(startLon)) return null;
  if (!Number.isFinite(endLat) || !Number.isFinite(endLon)) return null;

  return { from, to, start: { lat: startLat, lon: startLon }, end: { lat: endLat, lon: endLon } };
}

/** Fila para `segmentos` a partir del esfuerzo y de las estadísticas del tramo. */
function segmentRowFromEffort({ id, userId, effort, range, stats, activityId }) {
  const meters = Math.max(1, Math.round(stats.meters));
  const grade = (stats.gainM / meters) * 100;
  return {
    id,
    user_id: userId,
    nombre: String((effort && effort.name) || 'Segmento de Strava').slice(0, 120),
    tipo: 'strava',
    deporte: 'Ride',
    distancia_m: meters,
    desnivel_m: stats.gainM,
    pendiente_media: Math.round(grade * 10) / 10,
    categoria: null,
    inicio_lat: range.start.lat,
    inicio_lon: range.start.lon,
    fin_lat: range.end.lat,
    fin_lon: range.end.lon,
    // El radio se usa si algún día se recalcula por proximidad.
    radio_m: 45,
    referencia_actividad: activityId,
    estado: 'listo',
  };
}

module.exports = {
  stravaSegmentUuid,
  effortRange,
  segmentRowFromEffort,
};
