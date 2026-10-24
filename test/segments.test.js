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
      const segment = { ...row, id: `seg-${segmentos.length + 1}` };
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
