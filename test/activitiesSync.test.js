'use strict';

// ═══════════════════════════════════════════════════════════════
// PRUEBAS DE SINCRONIZACIÓN (sin red)
// ═══════════════════════════════════════════════════════════════
// Ejecutar: node --test test/activitiesSync.test.js
//
// Repositorio e Intervals.icu simulados en memoria: se comprueba que
// el sync es incremental, que guarda trazas y que crea segmentos.
// ═══════════════════════════════════════════════════════════════

const test = require('node:test');
const assert = require('node:assert/strict');

const { createActivitiesSync, buildWindows } = require('../lib/activitiesSync');
const { createSegmentsService } = require('../lib/segmentsService');
const engine = require('../lib/segmentEngine');
const codec = require('../lib/trackCodec');

const METERS_PER_DEG_LAT = 111320;

function buildStreams({ seconds = 1200, speed = 8, climbFrom = 200, climbTo = 800, gain = 300 } = {}) {
  const time = [];
  const distance = [];
  const altitude = [];
  const watts = [];
  const heartrate = [];
  const latlng = [];

  for (let i = 0; i < seconds; i++) {
    time.push(i);
    distance.push(speed * i);
    altitude.push(200 + (i > climbFrom ? Math.min(1, (i - climbFrom) / (climbTo - climbFrom)) * gain : 0));
    watts.push(210);
    heartrate.push(142);
    latlng.push([40 + (speed * i) / METERS_PER_DEG_LAT, -5]);
  }

  return { time, distance, altitude, watts, heartrate, latlng };
}

function createFakeRepository() {
  const actividades = new Map();
  const tracks = new Map();
  const segmentos = [];
  const esfuerzos = [];

  return {
    actividades,
    tracks,
    segmentos,
    esfuerzos,
    async existingActivityIds(ids) {
      return new Set(ids.filter((id) => actividades.has(id)));
    },
    async upsertActivity(row) {
      actividades.set(row.actividad_id, row);
    },
    async upsertTrack(row) {
      tracks.set(row.actividad_id, row);
    },
    async getActivity(id) {
      return actividades.get(id) || null;
    },
    async getTrackRows(ids) {
      return ids.map((id) => tracks.get(id)).filter(Boolean);
    },
    async *iterateTracks() {
      yield Array.from(tracks.values());
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

function createFakeIntervals(activities) {
  const llamadasStreams = [];
  return {
    llamadasStreams,
    async listActivities() {
      return activities;
    },
    async getStreams(id) {
      llamadasStreams.push(id);
      return buildStreams();
    },
  };
}

function buildSync(repository, intervals) {
  const segmentsService = createSegmentsService({ repository, userId: 'u1' });
  return createActivitiesSync({
    repository,
    segmentsService,
    intervals,
    userId: 'u1',
    now: () => new Date('2026-06-01T10:00:00Z'),
  });
}

const ACTIVIDADES = [
  {
    id: 'i1',
    start_date_local: '2026-05-01T08:00:00',
    type: 'Ride',
    moving_time: 1200,
    distance: 9600,
    average_watts: 210,
  },
  {
    id: 'i2',
    start_date_local: '2026-05-08T08:00:00',
    type: 'Ride',
    moving_time: 1200,
    distance: 9600,
    average_watts: 205,
  },
];

test('el primer sync guarda actividades, trazas y segmentos', async () => {
  const repository = createFakeRepository();
  const intervals = createFakeIntervals(ACTIVIDADES);
  const sync = buildSync(repository, intervals);

  const resultado = await sync.run({ desde: '2026-01-01', hasta: '2026-06-01' });

  assert.equal(resultado.estado, 'listo');
  assert.equal(resultado.nuevas, 2);
  assert.equal(repository.actividades.size, 2);
  assert.equal(repository.tracks.size, 2);
  assert.equal(repository.segmentos.length, 1);
  assert.ok(repository.esfuerzos.length >= 2);
  assert.equal(intervals.llamadasStreams.length, 2);
});

test('el segundo sync no vuelve a descargar lo ya guardado', async () => {
  const repository = createFakeRepository();
  const intervals = createFakeIntervals(ACTIVIDADES);
  const sync = buildSync(repository, intervals);

  await sync.run({ desde: '2026-01-01', hasta: '2026-06-01' });
  const segunda = await sync.run({ desde: '2026-01-01', hasta: '2026-06-01' });

  assert.equal(segunda.nuevas, 0);
  assert.equal(intervals.llamadasStreams.length, 2, 'no se repiten descargas');
  assert.equal(repository.segmentos.length, 1, 'no se duplican segmentos');
});

test('un fallo en una actividad no aborta el resto', async () => {
  const repository = createFakeRepository();
  const intervals = {
    async listActivities() {
      return ACTIVIDADES;
    },
    async getStreams(id) {
      if (id === 'i1') throw new Error('fallo simulado');
      return buildStreams();
    },
  };
  const sync = buildSync(repository, intervals);

  const resultado = await sync.run({ desde: '2026-01-01', hasta: '2026-06-01' });

  assert.equal(resultado.estado, 'listo');
  assert.equal(resultado.errores, 1);
  assert.equal(resultado.nuevas, 1);
  assert.equal(repository.actividades.size, 1);
});

test('startSync impide dos ejecuciones simultáneas', async () => {
  const repository = createFakeRepository();
  const intervals = createFakeIntervals(ACTIVIDADES);
  const sync = buildSync(repository, intervals);

  const primero = sync.startSync({ desde: '2026-01-01', hasta: '2026-06-01' });
  const segundo = sync.startSync({ desde: '2026-01-01', hasta: '2026-06-01' });

  assert.equal(primero.iniciado, true);
  assert.equal(segundo.iniciado, false);
  assert.equal(segundo.motivo, 'ya_en_curso');
});

test('buildWindows cubre el rango completo sin solaparse', () => {
  const windows = buildWindows(new Date('2025-01-01T00:00:00Z'), new Date('2025-12-31T00:00:00Z'), 120);

  assert.ok(windows.length >= 4);
  assert.equal(windows[0].oldest, '2025-01-01');
  assert.equal(windows[windows.length - 1].newest, '2025-12-31');
  for (let i = 1; i < windows.length; i++) {
    assert.ok(windows[i].oldest > windows[i - 1].newest, 'las ventanas no se pisan');
  }
});

test('decodeTrack recupera la traza guardada por el sync', async () => {
  const repository = createFakeRepository();
  const intervals = createFakeIntervals(ACTIVIDADES);
  const sync = buildSync(repository, intervals);

  await sync.run({ desde: '2026-01-01', hasta: '2026-06-01' });

  const row = repository.tracks.get('i1');
  const track = codec.decodeTrack(row.datos);
  assert.ok(track);
  assert.equal(track.t.length, 1200);
  assert.equal(track.hasGps, true);
  assert.ok(engine.detectClimbs(track).length >= 1);
});
