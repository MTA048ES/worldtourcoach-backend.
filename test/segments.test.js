'use strict';

// ═══════════════════════════════════════════════════════════════
// PRUEBAS DE SEGMENTOS (sin red, sin dependencias)
// ═══════════════════════════════════════════════════════════════
// Ejecutar: node --test test/segments.test.js
//
// Se generan trazas sintéticas con geometría conocida (velocidad
// constante, subida lineal) para comprobar detección de subidas,
// matching de esfuerzos y compresión de trazas.
// ═══════════════════════════════════════════════════════════════

const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../lib/segmentEngine');
const codec = require('../lib/trackCodec');
const strava = require('../lib/stravaSegments');
const { createSegmentsService } = require('../lib/segmentsService');

const BASE_LAT = 40.0;
const BASE_LON = -5.0;
const METERS_PER_DEG_LAT = 111320;

/**
 * Salida sintética: 1 muestra/s, velocidad constante y una subida
 * lineal entre `climbFrom` y `climbTo`.
 */
function buildStreams(options = {}) {
  const {
    seconds = 1800,
    speed = 8,
    climbFrom = 300,
    climbTo = 1200,
    climbGain = 350,
    baseEle = 200,
    power = 200,
    hr = 140,
    withGps = true,
    withPower = true,
  } = options;

  const time = [];
  const distance = [];
  const altitude = [];
  const watts = [];
  const heartrate = [];
  const latlng = [];

  for (let i = 0; i < seconds; i++) {
    time.push(i);
    distance.push(speed * i);
    let ele = baseEle;
    if (i > climbFrom) {
      const ratio = Math.min(1, (i - climbFrom) / (climbTo - climbFrom));
      ele += ratio * climbGain;
    }
    altitude.push(ele);
    if (withPower) watts.push(power);
    heartrate.push(hr);
    if (withGps) {
      latlng.push([BASE_LAT + (speed * i) / METERS_PER_DEG_LAT, BASE_LON]);
    }
  }

  const streams = { time, distance, altitude, heartrate };
  if (withPower) streams.watts = watts;
  if (withGps) streams.latlng = latlng;
  return streams;
}

test('streamsToTrack normaliza la traza y calcula límites', () => {
  const track = engine.streamsToTrack(buildStreams());

  assert.equal(track.t.length, 1800);
  assert.equal(track.t[0], 0);
  assert.equal(track.d[1799], 8 * 1799);
  assert.equal(track.hasGps, true);
  assert.equal(track.hasElevation, true);
  assert.equal(track.hasPower, true);
  assert.ok(track.bounds.maxLat > track.bounds.minLat);
});

test('streamsToTrack acepta el formato de array [{type, data}]', () => {
  const streams = buildStreams({ seconds: 60 });
  const asArray = Object.entries(streams).map(([type, data]) => ({ type, data }));
  const track = engine.streamsToTrack(asArray);

  assert.equal(track.t.length, 60);
  assert.equal(track.p[0], 200);
});

test('streamsToTrack recompone el GPS que Intervals parte en data/data2', () => {
  const streams = buildStreams({ seconds: 120 });
  const lats = streams.latlng.map(([lat]) => lat);
  const lons = streams.latlng.map(([, lon]) => lon);

  const asArray = Object.entries(streams)
    .filter(([type]) => type !== 'latlng')
    .map(([type, data]) => ({ type, data }));
  asArray.push({ type: 'latlng', name: 'latlng', data: lats, data2: lons });

  const track = engine.streamsToTrack(asArray);

  assert.equal(track.hasGps, true);
  assert.equal(track.lat.length, 120);
  assert.equal(track.lon[0], BASE_LON);
  assert.ok(track.bounds.maxLat > track.bounds.minLat);
});

test('streamsToTrack recompone el GPS cuando el stream llega como objeto', () => {
  const streams = buildStreams({ seconds: 120 });
  const lats = streams.latlng.map(([lat]) => lat);
  const lons = streams.latlng.map(([, lon]) => lon);

  const track = engine.streamsToTrack({
    ...streams,
    latlng: { data: lats, data2: lons },
  });

  assert.equal(track.hasGps, true);
  assert.equal(track.lon[0], BASE_LON);
});

test('streamsToTrack no inventa potencia cuando no existe', () => {
  const track = engine.streamsToTrack(buildStreams({ withPower: false, seconds: 120 }));

  assert.equal(track.hasPower, false);
  assert.equal(track.p.every((value) => value === null), true);
  assert.equal(track.hasHeartRate, true);
});

test('detectClimbs encuentra la subida sintética', () => {
  const track = engine.streamsToTrack(buildStreams());
  const climbs = engine.detectClimbs(track);

  assert.equal(climbs.length, 1);
  const climb = climbs[0];
  assert.ok(climb.gainM >= 330 && climb.gainM <= 370, `ganancia ${climb.gainM}`);
  assert.ok(climb.lengthM >= 7000 && climb.lengthM <= 7400, `longitud ${climb.lengthM}`);
  assert.ok(climb.avgGrade > 4 && climb.avgGrade < 6, `pendiente ${climb.avgGrade}`);
  assert.equal(climb.category, '3');
  assert.ok(climb.startPoint.lat > BASE_LAT);
});

test('detectClimbs ignora un recorrido llano', () => {
  const track = engine.streamsToTrack(buildStreams({ climbGain: 0 }));
  assert.equal(engine.detectClimbs(track).length, 0);
});

test('detectClimbs no detecta subidas sin altitud', () => {
  const streams = buildStreams();
  delete streams.altitude;
  const track = engine.streamsToTrack(streams);

  assert.equal(track.hasElevation, false);
  assert.equal(engine.detectClimbs(track).length, 0);
});

test('matchEffort devuelve tiempo y potencia del tramo', () => {
  const track = engine.streamsToTrack(buildStreams());
  const climb = engine.detectClimbs(track)[0];

  const segment = {
    inicio_lat: climb.startPoint.lat,
    inicio_lon: climb.startPoint.lon,
    fin_lat: climb.endPoint.lat,
    fin_lon: climb.endPoint.lon,
    distancia_m: climb.lengthM,
    radio_m: 60,
  };

  const effort = engine.matchEffort(track, segment);
  assert.ok(effort, 'debería encontrar el esfuerzo');
  assert.ok(effort.seconds >= 850 && effort.seconds <= 950, `tiempo ${effort.seconds}`);
  assert.equal(effort.avgPower, 200);
  assert.equal(effort.avgHeartRate, 140);
  assert.ok(effort.gainM >= 330 && effort.gainM <= 370);
});

test('matchEffort descarta actividades sin GPS', () => {
  const track = engine.streamsToTrack(buildStreams({ withGps: false }));
  const segment = {
    inicio_lat: BASE_LAT,
    inicio_lon: BASE_LON,
    fin_lat: BASE_LAT + 0.01,
    fin_lon: BASE_LON,
    distancia_m: 1000,
  };

  assert.equal(engine.matchEffort(track, segment), null);
});

test('matchEffort devuelve null si el recorrido no pasa por el segmento', () => {
  const track = engine.streamsToTrack(buildStreams());
  const segment = {
    inicio_lat: BASE_LAT + 0.5,
    inicio_lon: BASE_LON + 0.5,
    fin_lat: BASE_LAT + 0.6,
    fin_lon: BASE_LON + 0.5,
    distancia_m: 5000,
  };

  assert.equal(engine.matchEffort(track, segment), null);
});

test('isSameClimb agrupa la misma subida y separa otra distinta', () => {
  const track = engine.streamsToTrack(buildStreams());
  const climb = engine.detectClimbs(track)[0];

  const existing = {
    inicio_lat: climb.startPoint.lat,
    inicio_lon: climb.startPoint.lon,
    fin_lat: climb.endPoint.lat,
    fin_lon: climb.endPoint.lon,
    distancia_m: climb.lengthM,
  };

  assert.equal(engine.isSameClimb(climb, existing), true);
  assert.equal(
    engine.isSameClimb(climb, { ...existing, inicio_lat: existing.inicio_lat + 0.01 }),
    false,
  );
});

test('encodeTrack y decodeTrack conservan la traza', () => {
  const track = engine.streamsToTrack(buildStreams());
  const encoded = codec.encodeTrack(track);
  const decoded = codec.decodeTrack(encoded.datos);

  assert.ok(encoded.datos.length > 0);
  assert.ok(encoded.bytes > encoded.datos.length, 'gzip debe reducir el tamaño');
  assert.equal(decoded.t.length, track.t.length);
  assert.equal(decoded.d[500], track.d[500]);
  assert.equal(decoded.p[500], track.p[500]);
  assert.equal(decoded.hasGps, true);
  assert.ok(Math.abs(decoded.lat[500] - track.lat[500]) < 1e-4);
});

test('decodeTrack rechaza datos corruptos sin lanzar', () => {
  assert.equal(codec.decodeTrack('no-es-base64-valido'), null);
  assert.equal(codec.decodeTrack(''), null);
});

test('downsampleTrack reduce puntos y conserva el último', () => {
  const track = engine.streamsToTrack(buildStreams());
  const points = codec.downsampleTrack(track, 100);

  assert.ok(points.length >= 90 && points.length <= 102, `puntos ${points.length}`);
  assert.equal(points[points.length - 1].t, track.t[track.t.length - 1]);
});

// ─── SERVICIO CON REPOSITORIO SIMULADO ─────────────────────────

function createFakeRepository() {
  const actividades = new Map();
  const tracks = new Map();
  const segmentos = [];
  const esfuerzos = [];

  return {
    actividades,
    segmentos,
    esfuerzos,
    tracks,
    async getActivity(id) {
      return actividades.get(id) || null;
    },
    async getTrackRow(id) {
      return tracks.get(id) || null;
    },
    async getTrackRows(ids) {
      return ids.map((id) => tracks.get(id)).filter(Boolean);
    },
    async *iterateTracks() {
      const rows = Array.from(tracks.values());
      for (let i = 0; i < rows.length; i += 20) yield rows.slice(i, i + 20);
    },
    async listSegments() {
      return segmentos;
    },
    async getSegment(id) {
      return segmentos.find((item) => item.id === id) || null;
    },
    async insertSegment(row) {
      const segment = { ...row, id: row.id || `seg-${segmentos.length + 1}` };
      segmentos.push(segment);
      return segment;
    },
    async updateSegment(id, patch) {
      const segment = segmentos.find((item) => item.id === id);
      if (segment) Object.assign(segment, patch);
      return segment;
    },
    async upsertEffort(row) {
      const index = esfuerzos.findIndex(
        (item) => item.segmento_id === row.segmento_id && item.actividad_id === row.actividad_id,
      );
      if (index >= 0) esfuerzos[index] = row;
      else esfuerzos.push(row);
    },
    async deleteEffort(segmentoId, actividadId) {
      const index = esfuerzos.findIndex(
        (item) => item.segmento_id === segmentoId && item.actividad_id === actividadId,
      );
      if (index >= 0) esfuerzos.splice(index, 1);
    },
    async listEffortsForSegment(segmentoId) {
      return esfuerzos.filter((item) => item.segmento_id === segmentoId);
    },
    async listEffortsForActivity(actividadId) {
      return esfuerzos.filter((item) => item.actividad_id === actividadId);
    },
    async listEfforts(segmentosId) {
      const wanted = new Set(segmentosId);
      return esfuerzos
        .filter((item) => wanted.has(item.segmento_id))
        .sort((a, b) => a.tiempo_s - b.tiempo_s);
    },
  };
}

function seedActivity(repository, { id = 'a1', track, fecha = '2026-05-01T08:00:00Z' }) {
  repository.actividades.set(id, { actividad_id: id, fecha });
  const encoded = codec.encodeTrack(track);
  repository.tracks.set(id, { actividad_id: id, datos: encoded.datos, muestras: encoded.muestras });
}

test('storeAutoSegments crea el segmento y su esfuerzo', async () => {
  const repository = createFakeRepository();
  const track = engine.streamsToTrack(buildStreams());
  seedActivity(repository, { track });

  const service = createSegmentsService({ repository, userId: 'u1' });
  const result = await service.storeAutoSegments({
    activityId: 'a1',
    fecha: '2026-05-01T08:00:00Z',
    track,
    segments: [],
  });

  assert.equal(result.creados, 1);
  assert.equal(repository.segmentos.length, 1);
  assert.equal(repository.segmentos[0].tipo, 'auto');
  assert.equal(repository.segmentos[0].categoria, '3');
  assert.equal(repository.esfuerzos.length, 1);
  assert.equal(repository.esfuerzos[0].pot_media, 200);
});

test('storeAutoSegments reutiliza el segmento en otra salida', async () => {
  const repository = createFakeRepository();
  const track = engine.streamsToTrack(buildStreams());
  seedActivity(repository, { id: 'a1', track });
  seedActivity(repository, { id: 'a2', track });

  const service = createSegmentsService({ repository, userId: 'u1' });
  await service.storeAutoSegments({
    activityId: 'a1',
    fecha: '2026-05-01T08:00:00Z',
    track,
    segments: [],
  });
  const second = await service.storeAutoSegments({
    activityId: 'a2',
    fecha: '2026-05-08T08:00:00Z',
    track,
    segments: repository.segmentos,
  });

  assert.equal(second.creados, 0);
  assert.equal(repository.segmentos.length, 1);
  assert.equal(repository.esfuerzos.length, 2);
});

test('createManualSegment calcula distancia y lanza el recálculo', async () => {
  const repository = createFakeRepository();
  const track = engine.streamsToTrack(buildStreams());
  seedActivity(repository, { track });

  const service = createSegmentsService({ repository, userId: 'u1' });
  const inicio = { lat: track.lat[200], lon: track.lon[200] };
  const fin = { lat: track.lat[900], lon: track.lon[900] };

  const { segment, stats } = await service.createManualSegment({
    nombre: 'Puerto de prueba',
    actividadId: 'a1',
    startPoint: inicio,
    endPoint: fin,
  });

  assert.equal(segment.tipo, 'manual');
  assert.equal(segment.nombre, 'Puerto de prueba');
  assert.ok(stats.meters > 5000 && stats.meters < 6000, `metros ${stats.meters}`);
  assert.equal(segment.distancia_m, Math.round(stats.meters));

  const guardados = await service.recomputeSegment(segment.id);
  assert.equal(guardados, 1);
  assert.equal(repository.esfuerzos.length, 1);
  assert.ok(repository.esfuerzos[0].tiempo_s > 600);
});

test('createManualSegment rechaza nombres vacíos', async () => {
  const repository = createFakeRepository();
  const service = createSegmentsService({ repository, userId: 'u1' });

  await assert.rejects(
    () => service.createManualSegment({ nombre: ' ', actividadId: 'a1', startPoint: {}, endPoint: {} }),
    /nombre/i,
  );
});

test('listSegmentsForActivity devuelve el puesto en el ranking', async () => {
  const repository = createFakeRepository();
  repository.segmentos.push({
    id: 'seg-1',
    nombre: 'Cuesta test',
    tipo: 'manual',
    distancia_m: 1200,
    desnivel_m: 40,
    pendiente_media: 3.2,
    estado: 'listo',
  });
  repository.esfuerzos.push(
    { segmento_id: 'seg-1', actividad_id: 'a1', fecha: '2026-05-01T08:00:00Z', tiempo_s: 300, pot_media: 200, np: 210, fc_media: 140, velocidad_media: 24 },
    { segmento_id: 'seg-1', actividad_id: 'a2', fecha: '2026-05-02T08:00:00Z', tiempo_s: 280, pot_media: 230, np: 240, fc_media: 150, velocidad_media: 26 },
  );

  const service = createSegmentsService({ repository, userId: 'u1' });

  const delRapido = await service.listSegmentsForActivity('a2');
  assert.equal(delRapido.length, 1);
  assert.equal(delRapido[0].segmento_id, 'seg-1');
  assert.equal(delRapido[0].posicion, 1);
  assert.equal(delRapido[0].intentos, 2);

  const delLento = await service.listSegmentsForActivity('a1');
  assert.equal(delLento[0].posicion, 2);
  assert.equal(delLento[0].tiempo_s, 300);
});

test('listSegmentsForActivity devuelve vacío sin esfuerzos', async () => {
  const repository = createFakeRepository();
  const service = createSegmentsService({ repository, userId: 'u1' });

  assert.deepEqual(await service.listSegmentsForActivity('inexistente'), []);
});

test('stravaSegmentUuid es determinista y distinto por segmento', () => {
  const a = strava.stravaSegmentUuid(16477939);
  const b = strava.stravaSegmentUuid(16477939);
  const c = strava.stravaSegmentUuid(16477940);

  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('effortRange descarta índices fuera de la traza', () => {
  const track = engine.streamsToTrack(buildStreams({ seconds: 300 }));

  assert.ok(strava.effortRange(track, { start_index: 10, end_index: 200 }));
  assert.equal(strava.effortRange(track, { start_index: 250, end_index: 10 }), null);
  assert.equal(strava.effortRange(track, { start_index: 10, end_index: 9999 }), null);
  assert.equal(strava.effortRange(track, { start_index: 'x', end_index: 20 }), null);
});

test('importStravaSegments crea segmento y esfuerzo desde los índices', async () => {
  const repository = createFakeRepository();
  const track = engine.streamsToTrack(buildStreams({ seconds: 600 }));
  const service = createSegmentsService({ repository, userId: 'u1' });
  const intervals = {
    async getActivitySegments() {
      return [{ segment_id: 999, name: 'Recta de prueba', start_index: 100, end_index: 400, starred: false }];
    },
  };

  const result = await service.importStravaSegments({
    activityId: 'a1',
    fecha: '2026-05-01T08:00:00Z',
    track,
    intervals,
  });

  assert.equal(result.creados, 1);
  assert.equal(result.esfuerzos, 1);

  const segment = await repository.getSegment(strava.stravaSegmentUuid(999));
  assert.ok(segment);
  assert.equal(segment.nombre, 'Recta de prueba');
  assert.ok(segment.distancia_m > 0);
  assert.ok(Number.isFinite(segment.inicio_lat));
  assert.ok(Number.isFinite(segment.fin_lat));

  const esfuerzos = await repository.listEffortsForSegment(segment.id);
  assert.equal(esfuerzos.length, 1);
  assert.equal(esfuerzos[0].tiempo_s, Math.round(track.t[400] - track.t[100]));
});

test('importStravaSegments es idempotente', async () => {
  const repository = createFakeRepository();
  const track = engine.streamsToTrack(buildStreams({ seconds: 600 }));
  const service = createSegmentsService({ repository, userId: 'u1' });
  const intervals = {
    async getActivitySegments() {
      return [{ segment_id: 999, name: 'Recta de prueba', start_index: 100, end_index: 400 }];
    },
  };

  await service.importStravaSegments({ activityId: 'a1', fecha: '2026-05-01T08:00:00Z', track, intervals });
  const segunda = await service.importStravaSegments({
    activityId: 'a1',
    fecha: '2026-05-01T08:00:00Z',
    track,
    intervals,
  });

  assert.equal(segunda.creados, 0);
  assert.equal(segunda.esfuerzos, 1);
});

test('assignMissingEfforts empareja por geometría y no duplica', async () => {
  const repository = createFakeRepository();
  const track = engine.streamsToTrack(buildStreams({ seconds: 600 }));

  const segmento = {
    id: 'seg-geo',
    nombre: 'Tramo geométrico',
    tipo: 'strava',
    distancia_m: Math.round(track.d[300] - track.d[100]),
    inicio_lat: track.lat[100],
    inicio_lon: track.lon[100],
    fin_lat: track.lat[300],
    fin_lon: track.lon[300],
    radio_m: 45,
  };
  repository.segmentos.push(segmento);

  const service = createSegmentsService({ repository, userId: 'u1' });

  const primera = await service.assignMissingEfforts({
    activityId: 'a1',
    fecha: '2026-05-01T08:00:00Z',
    track,
    segments: [segmento],
  });
  const segunda = await service.assignMissingEfforts({
    activityId: 'a1',
    fecha: '2026-05-01T08:00:00Z',
    track,
    segments: [segmento],
  });

  assert.equal(primera, 1);
  assert.equal(segunda, 0);
  assert.equal(repository.esfuerzos.length, 1);
});

test('importStravaSegments descarta tramos parciales que no cubren el segmento', async () => {
  const repository = createFakeRepository();
  const track = engine.streamsToTrack(buildStreams({ seconds: 600 }));
  const service = createSegmentsService({ repository, userId: 'u1' });

  repository.segmentos.push({
    id: strava.stravaSegmentUuid(999),
    nombre: 'Segmento largo',
    tipo: 'manual',
    distancia_m: 5000,
    inicio_lat: track.lat[100],
    inicio_lon: track.lon[100],
    fin_lat: track.lat[400],
    fin_lon: track.lon[400],
  });

  const intervals = {
    async getActivitySegments() {
      // Índices que solo cubren unos metros del segmento.
      return [{ segment_id: 999, name: 'Segmento largo', start_index: 100, end_index: 110 }];
    },
  };

  const result = await service.importStravaSegments({
    activityId: 'a1',
    fecha: '2026-05-01T08:00:00Z',
    track,
    intervals,
  });

  assert.equal(result.creados, 0);
  assert.equal(result.esfuerzos, 0);
  assert.equal(repository.esfuerzos.length, 0);
});
