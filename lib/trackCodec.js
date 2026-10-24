'use strict';

// ═══════════════════════════════════════════════════════════════
// 🗜️ CÓDEC DE TRAZAS
// ═══════════════════════════════════════════════════════════════
// Las trazas por segundo se guardan comprimidas en Supabase para no
// inflar la base de datos: JSON → gzip → base64 en una columna text.
// Una salida de 3 h ocupa unas decenas de KB en lugar de cientos.
// ═══════════════════════════════════════════════════════════════

const zlib = require('zlib');

const VERSION = 1;

function compact(series) {
  return series && series.some((value) => value !== null) ? series : undefined;
}

/**
 * Comprime una traza normalizada. Devuelve el texto para la columna
 * `datos` y el número de muestras.
 */
function encodeTrack(track) {
  if (!track || !Array.isArray(track.t) || track.t.length < 2) {
    throw new Error('Traza vacía: no se puede comprimir');
  }

  const payload = {
    v: VERSION,
    t: track.t,
    d: track.d,
    e: compact(track.ele),
    p: compact(track.p),
    h: compact(track.hr),
    c: compact(track.cad),
    a: compact(track.lat),
    o: compact(track.lon),
  };

  const json = JSON.stringify(payload);
  const gzip = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 });

  return {
    datos: gzip.toString('base64'),
    muestras: track.t.length,
    bytes: Buffer.byteLength(json, 'utf8'),
  };
}

/**
 * Descomprime una traza guardada y la devuelve con la misma forma que
 * `streamsToTrack`, para poder reutilizar el motor sin conversiones.
 */
function decodeTrack(datos) {
  if (typeof datos !== 'string' || datos.length === 0) return null;

  let payload;
  try {
    payload = JSON.parse(zlib.gunzipSync(Buffer.from(datos, 'base64')).toString('utf8'));
  } catch (_) {
    return null;
  }

  if (!payload || !Array.isArray(payload.t) || payload.t.length < 2) return null;

  const length = payload.t.length;
  const pad = (series) => (Array.isArray(series) ? series : new Array(length).fill(null));

  const track = {
    t: payload.t,
    d: Array.isArray(payload.d) ? payload.d : new Array(length).fill(0),
    ele: pad(payload.e),
    p: pad(payload.p),
    hr: pad(payload.h),
    cad: pad(payload.c),
    lat: pad(payload.a),
    lon: pad(payload.o),
  };

  track.hasGps = track.lat.some((value) => value !== null);
  track.hasElevation = track.ele.some((value) => value !== null);
  track.hasPower = track.p.some((value) => value !== null && value > 0);
  track.hasHeartRate = track.hr.some((value) => value !== null);

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (let i = 0; i < length; i++) {
    const latitude = track.lat[i];
    const longitude = track.lon[i];
    if (latitude === null || longitude === null) continue;
    if (latitude < minLat) minLat = latitude;
    if (latitude > maxLat) maxLat = latitude;
    if (longitude < minLon) minLon = longitude;
    if (longitude > maxLon) maxLon = longitude;
  }
  track.bounds = Number.isFinite(minLat) ? { minLat, maxLat, minLon, maxLon } : null;

  return track;
}

/**
 * Reduce la traza a `maxPoints` para dibujar el recorrido en la app sin
 * enviar la serie completa. Mantiene el orden y siempre incluye el final.
 */
function downsampleTrack(track, maxPoints = 500) {
  if (!track || !track.t.length) return [];

  const step = Math.max(1, Math.ceil(track.t.length / maxPoints));
  const points = [];

  for (let i = 0; i < track.t.length; i += step) {
    const latitude = track.lat[i];
    const longitude = track.lon[i];
    if (latitude === null || longitude === null) continue;
    points.push({
      lat: latitude,
      lon: longitude,
      d: track.d[i],
      t: track.t[i],
      ele: track.ele[i],
      p: track.p[i],
      h: track.hr[i],
      c: track.cad[i],
    });
  }

  const last = track.t.length - 1;
  if (track.lat[last] !== null && track.lon[last] !== null) {
    const already = points[points.length - 1];
    if (!already || already.t !== track.t[last]) {
      points.push({
        lat: track.lat[last],
        lon: track.lon[last],
        d: track.d[last],
        t: track.t[last],
        ele: track.ele[last],
        p: track.p[last],
        h: track.hr[last],
        c: track.cad[last],
      });
    }
  }

  return points;
}

module.exports = {
  encodeTrack,
  decodeTrack,
  downsampleTrack,
};
