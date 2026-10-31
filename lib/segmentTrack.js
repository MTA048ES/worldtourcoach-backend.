'use strict';

// ═══════════════════════════════════════════════════════════════
// ✂️ RECORTE DE UN SEGMENTO EN LA TRAZA DE REFERENCIA
// ═══════════════════════════════════════════════════════════════
// Los segmentos no guardan su propia polilínea: solo el punto de salida
// y el de llegada. Para dibujar el mapa y el perfil de altitud se busca
// el tramo correspondiente dentro de la actividad que les sirvió de
// referencia. La elección del punto final prima la distancia real del
// segmento, para no cortar antes en repechos cortos.
// ═══════════════════════════════════════════════════════════════

const engine = require('./segmentEngine');

function coordenadaValida(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}

/**
 * Índices [from, to] del tramo que recorre el segmento.
 * Devuelve null si no se puede situar.
 */
function rangoDelSegmento(track, segment) {
  if (!track || !track.hasGps) return null;

  const startPoint = { lat: Number(segment.inicio_lat), lon: Number(segment.inicio_lon) };
  const endPoint = { lat: Number(segment.fin_lat), lon: Number(segment.fin_lon) };
  if (!coordenadaValida(startPoint.lat, startPoint.lon) || !coordenadaValida(endPoint.lat, endPoint.lon)) {
    return null;
  }

  const start = engine.nearestIndexToPoint(track, startPoint);
  if (start.index < 0) return null;

  const radius = Math.max(60, Number(segment.radio_m) || 0);
  const esperado = Number(segment.distancia_m) || 0;
  const minima = Math.max(30, esperado * 0.3);
  const limite = Math.max(esperado * 2.5, 1000);

  let mejor = null;
  for (let i = start.index + 1; i < track.t.length; i += 1) {
    if (track.lat[i] === null || track.lon[i] === null) continue;
    const avanzado = track.d[i] - track.d[start.index];
    if (avanzado > limite) break;
    if (avanzado < minima) continue;
    const distance = engine.haversineM({ lat: track.lat[i], lon: track.lon[i] }, endPoint);
    if (distance > radius) continue;
    if (!mejor || Math.abs(avanzado - esperado) < Math.abs(mejor.avanzado - esperado)) {
      mejor = { index: i, avanzado };
    }
  }
  if (mejor) return { from: start.index, to: mejor.index };

  // Sin coincidencia dentro del radio (ruta repetida): punto más cercano.
  const end = engine.nearestIndexToPoint(track, endPoint);
  return end.index > start.index ? { from: start.index, to: end.index } : null;
}

/** Series del tramo con tiempo y distancia relativos al inicio. */
function trazaDelTramo(track, from, to) {
  const t0 = track.t[from];
  const d0 = track.d[from];
  const cortar = (serie) => serie.slice(from, to + 1);
  return {
    t: cortar(track.t).map((value) => value - t0),
    d: cortar(track.d).map((value) => Math.max(0, value - d0)),
    ele: cortar(track.ele),
    p: cortar(track.p),
    hr: cortar(track.hr),
    cad: cortar(track.cad),
    lat: cortar(track.lat),
    lon: cortar(track.lon),
  };
}

module.exports = { rangoDelSegmento, trazaDelTramo };
