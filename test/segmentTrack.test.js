'use strict';

// ═══════════════════════════════════════════════════════════════
// GEOMETRÍA DEL SEGMENTO (mapa + perfil de altitud)
// ═══════════════════════════════════════════════════════════════
// Ejecutar: node --test test/segmentTrack.test.js
// ═══════════════════════════════════════════════════════════════

const test = require('node:test');
const assert = require('node:assert/strict');

let express = null;
try {
  express = require('express');
} catch {
  express = null;
}

const skip = express ? false : 'express no está instalado (ejecuta npm ci)';

const TOKEN = 'token-de-prueba-123';

// Traza recta de 300 muestras: 8 m por segundo, subiendo 1 m cada muestra.
const STREAMS = { time: [], distance: [], altitude: [], watts: [], latlng: [] };
for (let i = 0; i < 300; i++) {
  STREAMS.time.push(i);
  STREAMS.distance.push(8 * i);
  STREAMS.altitude.push(200 + i);
  STREAMS.watts.push(210);
  STREAMS.latlng.push([40 + (8 * i) / 111320, -5]);
}

const SEGMENTO = {
  id: 'seg-geo',
  nombre: 'Tramo de prueba',
  distancia_m: 800,
  radio_m: 45,
  inicio_lat: STREAMS.latlng[50][0],
  inicio_lon: STREAMS.latlng[50][1],
  fin_lat: STREAMS.latlng[150][0],
  fin_lon: STREAMS.latlng[150][1],
  referencia_actividad: 'i123',
};

const SIN_REFERENCIA = { ...SEGMENTO, id: 'seg-sin-ref', referencia_actividad: null };

function createRepository(codec, engine) {
  return {
    async listActivities() {
      return [];
    },
    async countSegments() {
      return 1;
    },
    async countEfforts() {
      return 0;
    },
    async getSegment(id) {
      if (id === SEGMENTO.id) return SEGMENTO;
      if (id === SIN_REFERENCIA.id) return SIN_REFERENCIA;
      return null;
    },
    async getTrackRow(id) {
      return id === 'i123'
        ? { actividad_id: id, datos: codec.encodeTrack(engine.streamsToTrack(STREAMS)).datos, muestras: 300 }
        : null;
    },
  };
}

async function startServer() {
  const codec = require('../lib/trackCodec');
  const engine = require('../lib/segmentEngine');
  const { createAppApiRouter } = require('../lib/appApiRouter');

  const app = express();
  app.use(express.json());
  app.use(
    '/api/app',
    createAppApiRouter({
      repository: createRepository(codec, engine),
      segmentsService: { async getSegmentDetail() { return null; } },
      token: TOKEN,
    }),
  );

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}/api/app` };
}

async function get(base, path) {
  const response = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return { status: response.status, body: await response.json() };
}

test('devuelve el tramo con puntos, bounds y estadísticas', { skip }, async () => {
  const { server, base } = await startServer();
  try {
    const result = await get(base, '/segments/seg-geo/track?max=120');
    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);

    const data = result.body.data;
    assert.equal(data.segmento_id, 'seg-geo');
    assert.equal(data.tiene_gps, true);
    assert.ok(data.puntos.length > 10);
    assert.ok(data.bounds);
    assert.equal(data.puntos[0].d, 0);
    assert.equal(data.puntos[0].t, 0);
    // El recorte acaba en la primera muestra dentro del radio de llegada:
    // unos 800 m y ~100 m de subida, con tolerancia de una muestra.
    assert.ok(data.stats.metros >= 700 && data.stats.metros <= 800, `metros ${data.stats.metros}`);
    assert.ok(data.stats.desnivel_m >= 90 && data.stats.desnivel_m <= 100, `desnivel ${data.stats.desnivel_m}`);
    assert.equal(data.stats.pot_media, 210);
    assert.ok(data.stats.velocidad_media > 0);
  } finally {
    server.close();
  }
});

test('404 si el segmento no existe', { skip }, async () => {
  const { server, base } = await startServer();
  try {
    const result = await get(base, '/segments/no-existe/track');
    assert.equal(result.status, 404);
  } finally {
    server.close();
  }
});

test('422 si el segmento no tiene actividad de referencia', { skip }, async () => {
  const { server, base } = await startServer();
  try {
    const result = await get(base, '/segments/seg-sin-ref/track');
    assert.equal(result.status, 422);
    assert.equal(result.body.success, false);
  } finally {
    server.close();
  }
});
