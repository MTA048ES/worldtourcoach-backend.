'use strict';

// ═══════════════════════════════════════════════════════════════
// 🧭 MOTOR DE SEGMENTOS — GEOMETRÍA Y ESFUERZOS
// ═══════════════════════════════════════════════════════════════
// Sin dependencias externas (igual que lib/security.js) para poder
// probarlo aislado con `node --test`, sin arrancar el servidor.
//
// Recibe trazas normalizadas desde los streams de Intervals.icu y
// devuelve:
//   - subidas detectadas (segmentos automáticos tipo ClimbPro)
//   - esfuerzos dentro de un segmento (tiempo, potencia, FC)
//
// Todas las distancias van en metros y los tiempos en segundos.
// ═══════════════════════════════════════════════════════════════

const EARTH_RADIUS_M = 6371008.8;
const DEG = Math.PI / 180;

// ─── GEOMETRÍA ─────────────────────────────────────────────────

function haversineM(a, b) {
  if (!a || !b) return Infinity;
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Dirección de avance en grados (0 = norte). Sirve para rechazar
// esfuerzos hechos en sentido contrario.
function bearingDeg(a, b) {
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

function angleDiff(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// ─── STREAMS → TRAZA ───────────────────────────────────────────

const STREAM_ALIASES = {
  time: ['time'],
  distance: ['distance'],
  altitude: ['altitude'],
  watts: ['watts', 'power'],
  heartrate: ['heartrate', 'heart_rate', 'hr'],
  cadence: ['cadence'],
  latlng: ['latlng', 'latlngs'],
  velocity: ['velocity_smooth', 'velocity'],
};

// Intervals.icu devuelve los streams como array [{type, data}] en unas
// versiones y como objeto {watts: [...]} en otras. Se aceptan ambas.
//
// `latlng` es especial: Intervals lo parte en dos series paralelas, `data`
// con las latitudes y `data2` con las longitudes. Aquí se recomponen en
// pares [lat, lon] para que el resto del motor trabaje igual que siempre.
function readStreams(raw) {
  const map = {};
  if (!raw) return map;

  function guardarStream(type, data, secondary) {
    if (typeof type !== 'string' || !Array.isArray(data) || data.length === 0) return;
    if (STREAM_ALIASES.latlng.includes(type) && Array.isArray(secondary)) {
      map[type] = data.map((value, index) => [value, secondary[index]]);
      return;
    }
    map[type] = data;
  }

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const type = item.type ?? item.name;
      const data = Array.isArray(item.data) ? item.data : Array.isArray(item.values) ? item.values : null;
      const secondary = Array.isArray(item.data2) ? item.data2 : null;
      guardarStream(type, data, secondary);
    }
    return map;
  }

  if (typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      if (Array.isArray(value) || ArrayBuffer.isView(value)) {
        map[key] = Array.from(value);
        continue;
      }
      // Forma { latlng: { data: [...latitudes], data2: [...longitudes] } }.
      if (value && typeof value === 'object' && Array.isArray(value.data)) {
        guardarStream(key, value.data, Array.isArray(value.data2) ? value.data2 : null);
      }
    }
  }
  return map;
}

function pickStream(map, names) {
  for (const name of names) {
    const value = map[name];
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return null;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Convierte los streams crudos en una traza compacta con arrays
 * paralelos. Las muestras sin tiempo válido se descartan y las series
 * cortas se rellenan con null (nunca con ceros inventados).
 */
function streamsToTrack(rawStreams) {
  const map = readStreams(rawStreams);
  const times = pickStream(map, STREAM_ALIASES.time);
  if (!times || times.length < 2) return null;

  const distance = pickStream(map, STREAM_ALIASES.distance);
  const altitude = pickStream(map, STREAM_ALIASES.altitude);
  const watts = pickStream(map, STREAM_ALIASES.watts);
  const heartrate = pickStream(map, STREAM_ALIASES.heartrate);
  const cadence = pickStream(map, STREAM_ALIASES.cadence);
  const latlng = pickStream(map, STREAM_ALIASES.latlng);
  const velocity = pickStream(map, STREAM_ALIASES.velocity);

  const t = [];
  const d = [];
  const ele = [];
  const p = [];
  const hr = [];
  const cad = [];
  const lat = [];
  const lon = [];

  let startSec = null;
  let cumulativeM = 0;
  let previousSec = null;
  let hasGps = false;
  let hasElevation = false;

  for (let i = 0; i < times.length; i++) {
    const rawTime = Number(times[i]);
    if (!Number.isFinite(rawTime)) continue;

    // Los streams usan segundos desde el inicio; si llegara un
    // timestamp absoluto se normaliza igualmente.
    if (startSec === null) startSec = rawTime;
    let sec = rawTime - startSec;
    if (!Number.isFinite(sec) || sec < 0) continue;
    if (previousSec !== null && sec <= previousSec) continue;

    const rawDistance = distance ? Number(distance[i]) : NaN;
    if (Number.isFinite(rawDistance) && rawDistance >= 0) {
      if (rawDistance > cumulativeM) cumulativeM = rawDistance;
    } else {
      const speed = velocity ? Number(velocity[i]) : NaN;
      if (Number.isFinite(speed) && speed > 0 && previousSec !== null) {
        cumulativeM += Math.min(speed * (sec - previousSec), 80 * (sec - previousSec));
      }
    }

    t.push(Math.round(sec));
    d.push(Math.round(cumulativeM));

    const rawEle = altitude ? Number(altitude[i]) : NaN;
    if (Number.isFinite(rawEle) && rawEle > -500 && rawEle < 9000) {
      ele.push(round1(rawEle));
      hasElevation = true;
    } else {
      ele.push(null);
    }

    const rawPower = watts ? Number(watts[i]) : NaN;
    p.push(Number.isFinite(rawPower) && rawPower >= 0 && rawPower <= 3000 ? Math.round(rawPower) : null);

    const rawHr = heartrate ? Number(heartrate[i]) : NaN;
    hr.push(Number.isFinite(rawHr) && rawHr >= 20 && rawHr <= 250 ? Math.round(rawHr) : null);

    const rawCad = cadence ? Number(cadence[i]) : NaN;
    cad.push(Number.isFinite(rawCad) && rawCad >= 0 && rawCad <= 250 ? Math.round(rawCad) : null);

    const point = latlng ? latlng[i] : null;
    let latitude = NaN;
    let longitude = NaN;
    if (Array.isArray(point) && point.length >= 2) {
      latitude = Number(point[0]);
      longitude = Number(point[1]);
    } else if (point && typeof point === 'object') {
      // Algunos exportadores usan { lat, lon } en lugar de pares.
      latitude = Number(point.lat ?? point.latitude);
      longitude = Number(point.lon ?? point.lng ?? point.longitude);
    }

    if (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180 &&
      (latitude !== 0 || longitude !== 0)
    ) {
      lat.push(Math.round(latitude * 1e5) / 1e5);
      lon.push(Math.round(longitude * 1e5) / 1e5);
      hasGps = true;
    } else {
      lat.push(null);
      lon.push(null);
    }

    previousSec = sec;
  }

  if (t.length < 2) return null;

  return {
    t,
    d,
    ele,
    p,
    hr,
    cad,
    lat,
    lon,
    hasGps,
    hasElevation,
    hasPower: p.some((value) => value !== null && value > 0),
    hasHeartRate: hr.some((value) => value !== null),
    bounds: trackBounds(lat, lon),
  };
}

function trackBounds(latitude, longitude) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (let i = 0; i < latitude.length; i++) {
    const a = latitude[i];
    const b = longitude[i];
    if (a === null || b === null) continue;
    if (a < minLat) minLat = a;
    if (a > maxLat) maxLat = a;
    if (b < minLon) minLon = b;
    if (b > maxLon) maxLon = b;
  }

  if (!Number.isFinite(minLat)) return null;
  return { minLat, maxLat, minLon, maxLon };
}

// ─── ESTADÍSTICAS DE UN TRAMO ──────────────────────────────────

function maxOf(values) {
  let max = null;
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) continue;
    if (max === null || value > max) max = value;
  }
  return max;
}

function average(values) {
  let sum = 0;
  let count = 0;
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) continue;
    sum += value;
    count++;
  }
  return count > 0 ? sum / count : null;
}

// Potencia normalizada: media móvil de 30 s elevada a la cuarta.
function normalizedPower(values) {
  const valid = values.filter((value) => value !== null && Number.isFinite(value));
  if (valid.length < 30) return null;

  let sumFourth = 0;
  let count = 0;
  let window = 0;

  for (let i = 0; i < valid.length; i++) {
    window += valid[i];
    if (i >= 30) window -= valid[i - 30];
    if (i >= 29) {
      sumFourth += (window / 30) ** 4;
      count++;
    }
  }
  if (count === 0) return null;
  return Math.round((sumFourth / count) ** 0.25);
}

/**
 * Estadísticas del tramo [from, to] (índices inclusivos).
 */
function sliceStats(track, from, to) {
  const t0 = track.t[from];
  const t1 = track.t[to];
  const d0 = track.d[from];
  const d1 = track.d[to];
  const seconds = t1 - t0;
  const meters = Math.max(0, d1 - d0);

  let gain = 0;
  for (let i = from + 1; i <= to; i++) {
    const previous = track.ele[i - 1];
    const current = track.ele[i];
    if (previous === null || current === null) continue;
    if (current > previous) gain += current - previous;
  }

  const power = track.p.slice(from, to + 1);
  const heart = track.hr.slice(from, to + 1);

  return {
    seconds,
    meters,
    gainM: Math.round(gain),
    avgPower: average(power) === null ? null : Math.round(average(power)),
    maxPower: maxOf(power),
    normalizedPower: normalizedPower(power),
    avgHeartRate: average(heart) === null ? null : Math.round(average(heart)),
    maxHeartRate: maxOf(heart),
    avgSpeedKmh: seconds > 0 ? round1((meters / seconds) * 3.6) : null,
  };
}

// ─── DETECCIÓN DE SUBIDAS (SEGMENTOS AUTOMÁTICOS) ──────────────

function smoothElevation(ele, window = 9) {
  const half = Math.floor(window / 2);
  const out = new Array(ele.length).fill(null);
  for (let i = 0; i < ele.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(ele.length - 1, i + half); j++) {
      if (ele[j] === null) continue;
      sum += ele[j];
      count++;
    }
    out[i] = count > 0 ? sum / count : null;
  }
  return out;
}

// Pendiente en % sobre una ventana temporal hacia delante.
function rollingGrade(track, smoothed, windowSec = 20) {
  const n = track.t.length;
  const grade = new Array(n).fill(null);
  let j = 0;

  for (let i = 0; i < n; i++) {
    if (j < i) j = i;
    while (j < n - 1 && track.t[j] - track.t[i] < windowSec) j++;
    const dEle = smoothed[j] !== null && smoothed[i] !== null ? smoothed[j] - smoothed[i] : null;
    const dDist = track.d[j] - track.d[i];
    if (dEle !== null && dDist > 5) {
      grade[i] = (dEle / dDist) * 100;
    }
  }
  return grade;
}

function climbCategory(gainM, lengthM) {
  const avgGrade = lengthM > 0 ? (gainM / lengthM) * 100 : 0;
  const score = (lengthM / 1000) * avgGrade;
  if (gainM >= 1500 || score >= 800) return 'HC';
  if (gainM >= 800 || score >= 320) return '1';
  if (gainM >= 400 || score >= 160) return '2';
  if (gainM >= 200 || score >= 80) return '3';
  return '4';
}

/**
 * Detecta subidas sostenidas dentro de una actividad.
 * Base: pendiente suavizada, ganancia mínima y longitud mínima.
 */
function detectClimbs(track, options = {}) {
  const {
    minGainM = 80,
    minLengthM = 500,
    minGradePct = 2.5,
    mergeGapM = 250,
    maxClimbs = 25,
  } = options;

  if (!track || !track.hasElevation || track.t.length < 30) return [];

  const smoothed = smoothElevation(track.ele, 9);
  const grade = rollingGrade(track, smoothed, 20);

  // 1. Tramos con pendiente suficiente.
  const runs = [];
  let i = 0;
  while (i < grade.length) {
    if (grade[i] === null || grade[i] < minGradePct) {
      i++;
      continue;
    }
    let j = i;
    // Se tolera una bajada puntual (40% de la pendiente mínima).
    while (j < grade.length - 1 && (grade[j] === null || grade[j] >= minGradePct * 0.4)) j++;
    runs.push([i, j]);
    i = j + 1;
  }

  // 2. Unir tramos partidos por un llano corto.
  const merged = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && track.d[run[0]] - track.d[last[1]] < mergeGapM) {
      last[1] = run[1];
    } else {
      merged.push([...run]);
    }
  }

  // 3. Ajustar extremos al pie y a la cima reales.
  const climbs = [];
  for (const [rawStart, rawEnd] of merged) {
    let start = rawStart;
    let end = rawEnd;
    let recorrido = 0;

    // Bajar al pie real sólo mientras la altitud siga descendiendo.
    while (
      start > 0 &&
      recorrido < 300 &&
      smoothed[start - 1] !== null &&
      smoothed[start] !== null &&
      smoothed[start - 1] < smoothed[start] - 0.01
    ) {
      recorrido += track.d[start] - track.d[start - 1];
      start--;
    }

    // Subir a la cima real sólo mientras la altitud siga creciendo. La
    // comparación es estricta para no devorar el llano posterior.
    recorrido = 0;
    while (
      end < track.t.length - 1 &&
      recorrido < 300 &&
      smoothed[end + 1] !== null &&
      smoothed[end] !== null &&
      smoothed[end + 1] > smoothed[end] + 0.01
    ) {
      recorrido += track.d[end + 1] - track.d[end];
      end++;
    }

    const lengthM = track.d[end] - track.d[start];
    let gain = 0;
    for (let k = start + 1; k <= end; k++) {
      if (smoothed[k] === null || smoothed[k - 1] === null) continue;
      if (smoothed[k] > smoothed[k - 1]) gain += smoothed[k] - smoothed[k - 1];
    }

    if (gain < minGainM || lengthM < minLengthM) continue;

    const avgGrade = lengthM > 0 ? (gain / lengthM) * 100 : 0;
    const startPoint = pointAt(track, start);
    const endPoint = pointAt(track, end);

    if (!startPoint || !endPoint) continue;

    climbs.push({
      startIndex: start,
      endIndex: end,
      startPoint,
      endPoint,
      lengthM: Math.round(lengthM),
      gainM: Math.round(gain),
      avgGrade: round1(avgGrade),
      category: climbCategory(gain, lengthM),
      distanceKmAtStart: round1(track.d[start] / 1000),
      seconds: track.t[end] - track.t[start],
      stats: sliceStats(track, start, end),
    });
  }

  // 4. Las más relevantes primero.
  climbs.sort((a, b) => b.gainM - a.gainM);
  return climbs.slice(0, maxClimbs);
}

function pointAt(track, index) {
  const latitude = track.lat[index];
  const longitude = track.lon[index];
  if (latitude === null || longitude === null) return null;
  return { lat: latitude, lon: longitude };
}

// Dos detecciones son la misma subida si empiezan y acaban cerca.
function isSameClimb(candidate, existing, options = {}) {
  const { startRadiusM = 120, endRadiusM = 200, lengthTolerance = 0.25 } = options;
  if (!candidate || !existing) return false;

  const startDistance = haversineM(candidate.startPoint, {
    lat: existing.inicio_lat,
    lon: existing.inicio_lon,
  });
  if (startDistance > startRadiusM) return false;

  const endDistance = haversineM(candidate.endPoint, {
    lat: existing.fin_lat,
    lon: existing.fin_lon,
  });
  if (endDistance > endRadiusM) return false;

  if (existing.distancia_m && candidate.lengthM) {
    const ratio = Math.abs(candidate.lengthM - existing.distancia_m) / existing.distancia_m;
    if (ratio > lengthTolerance) return false;
  }
  return true;
}

// ─── ESFUERZOS DENTRO DE UN SEGMENTO ───────────────────────────

function nearestIndexToPoint(track, point) {
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < track.t.length; i++) {
    if (track.lat[i] === null || track.lon[i] === null) continue;
    const distance = haversineM({ lat: track.lat[i], lon: track.lon[i] }, point);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return { index: bestIndex, distance: bestDistance };
}

/**
 * Busca el esfuerzo de una traza dentro de un segmento.
 *
 * Criterios: entrar en el radio de la salida, recorrer al menos la mitad
 * de la distancia del segmento y entrar en el radio de la llegada. Se
 * rechazan tiempos imposibles y esfuerzos en sentido contrario.
 */
function matchEffort(track, segment, options = {}) {
  const {
    radiusM = segment.radio_m || 45,
    startRadiusM = radiusM,
    endRadiusM = radiusM,
    minCoverage = 0.5,
    maxSpeedKmh = 95,
    maxDurationSec = 6 * 3600,
  } = options;

  if (!track || !track.hasGps) return null;

  const startPoint = { lat: segment.inicio_lat, lon: segment.inicio_lon };
  const endPoint = { lat: segment.fin_lat, lon: segment.fin_lon };

  const startMatch = nearestIndexToPoint(track, startPoint);
  if (startMatch.index < 0 || startMatch.distance > startRadiusM) return null;

  const segmentDistanceM = Number(segment.distancia_m) || 0;
  const minDistanceM = Math.max(50, segmentDistanceM * minCoverage);

  let endIndex = -1;
  for (let i = startMatch.index + 1; i < track.t.length; i++) {
    if (track.d[i] - track.d[startMatch.index] < minDistanceM) continue;
    if (track.lat[i] === null || track.lon[i] === null) continue;
    const distance = haversineM({ lat: track.lat[i], lon: track.lon[i] }, endPoint);
    if (distance <= endRadiusM) {
      endIndex = i;
      break;
    }
  }
  if (endIndex <= startMatch.index) return null;

  const stats = sliceStats(track, startMatch.index, endIndex);
  if (stats.seconds <= 5 || stats.seconds > maxDurationSec) return null;
  if (stats.avgSpeedKmh !== null && stats.avgSpeedKmh > maxSpeedKmh) return null;

  // Sentido: el rumbo del esfuerzo debe parecerse al del segmento.
  const segmentBearing = bearingDeg(startPoint, endPoint);
  const effortBearing = bearingDeg(
    { lat: track.lat[startMatch.index], lon: track.lon[startMatch.index] },
    { lat: track.lat[endIndex], lon: track.lon[endIndex] },
  );
  if (angleDiff(segmentBearing, effortBearing) > 100) return null;

  return {
    seconds: stats.seconds,
    meters: stats.meters,
    gainM: stats.gainM,
    avgPower: stats.avgPower,
    maxPower: stats.maxPower,
    normalizedPower: stats.normalizedPower,
    avgHeartRate: stats.avgHeartRate,
    maxHeartRate: stats.maxHeartRate,
    avgSpeedKmh: stats.avgSpeedKmh,
    startT: track.t[startMatch.index],
    endT: track.t[endIndex],
  };
}

// Bounding box ampliado, para descartar actividades sin recorrer la traza.
function boundsWithMargin(bounds, marginM) {
  if (!bounds) return null;
  const latMargin = marginM / 111320;
  const lonMargin = marginM / (111320 * Math.max(0.2, Math.cos(((bounds.minLat + bounds.maxLat) / 2) * DEG)));
  return {
    minLat: bounds.minLat - latMargin,
    maxLat: bounds.maxLat + latMargin,
    minLon: bounds.minLon - lonMargin,
    maxLon: bounds.maxLon + lonMargin,
  };
}

function boundsIntersect(a, b) {
  if (!a || !b) return false;
  return a.minLat <= b.maxLat && a.maxLat >= b.minLat && a.minLon <= b.maxLon && a.maxLon >= b.minLon;
}

module.exports = {
  haversineM,
  bearingDeg,
  angleDiff,
  streamsToTrack,
  trackBounds,
  boundsWithMargin,
  boundsIntersect,
  sliceStats,
  average,
  normalizedPower,
  detectClimbs,
  isSameClimb,
  climbCategory,
  matchEffort,
  nearestIndexToPoint,
  pointAt,
};
