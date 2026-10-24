'use strict';

// ═══════════════════════════════════════════════════════════════
// PRUEBAS HTTP DE /api/app (Express real, sin red externa)
// ═══════════════════════════════════════════════════════════════
// Ejecutar: node --test test/appApiRouter.test.js
// Requiere las dependencias instaladas (express). Se omiten si no lo
// están, para no romper una ejecución sin `npm ci`.
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

const ACTIVIDAD = {
  actividad_id: 'i123',
  fecha: '2026-05-01T08:00:00Z',
  tipo: 'Ride',
  nombre: 'Puerto de prueba',
  duracion_s: 7200,
  distancia_m: 60000,
  desnivel_m: 900,
  pot_media: 210,
  pot_max: 620,
  np: 240,
  fc_media: 145,
  fc_max: 178,
  cadencia_media: 84,
  velocidad_media: 8.3,
  tss: 180,
  muestras: 7200,
  tiene_gps: true,
};

const SEGMENTO = {
  id: 'seg-1',
  nombre: 'Puerto de prueba',
  tipo: 'auto',
  distancia_m: 5200,
  desnivel_m: 320,
  pendiente_media: 6.2,
  categoria: '3',
  estado: 'listo',
  intentos: 2,
  mejor: { tiempo_s: 1200, pot_media: 240, fc_media: 158, fecha: '2026-05-01T08:00:00Z', actividad_id: 'i123' },
};

function createRepository() {
  return {
    async countActivities() {
      return 1;
    },
    async listActivities({ limit, offset }) {
      assert.equal(typeof limit, 'number');
      assert.equal(typeof offset, 'number');
      return [ACTIVIDAD];
    },
    async getActivity(id) {
      return id === ACTIVIDAD.actividad_id ? ACTIVIDAD : null;
    },
    async getTrackRow(id) {
      return id === ACTIVIDAD.actividad_id
        ? { actividad_id: id, datos: 'datos-de-prueba', muestras: 7200 }
        : null;
    },
    async listSegments() {
      return [SEGMENTO];
    },
    async getSegment(id) {
      return id === SEGMENTO.id ? SEGMENTO : null;
    },
    async deleteSegment() {},
  };
}

function createSegmentsServiceStub() {
  return {
    async listSegmentsWithBest() {
      return [SEGMENTO];
    },
    async getSegmentDetail(id) {
      if (id !== SEGMENTO.id) return null;
      return {
        ...SEGMENTO,
        clasificacion: [
          {
            posicion: 1,
            actividad_id: 'i123',
            fecha: '2026-05-01T08:00:00Z',
            tiempo_s: 1200,
            pot_media: 240,
            np: 260,
            fc_media: 158,
            velocidad_media: 15.6,
          },
        ],
      };
    },
    async createManualSegment({ nombre }) {
      if (nombre.trim().length < 2) throw new Error('El nombre del segmento es obligatorio');
      return { segment: { ...SEGMENTO, id: 'seg-2', tipo: 'manual', nombre, estado: 'calculando' }, stats: {} };
    },
    recomputeSegment() {
      return Promise.resolve(1);
    },
  };
}

async function startServer(options = {}) {
  // Se carga el códec real para que el endpoint de traza tenga datos
  // válidos; el resto de dependencias se simulan.
  const codec = require('../lib/trackCodec');
  const engine = require('../lib/segmentEngine');

  const streams = { time: [], distance: [], altitude: [], watts: [], latlng: [] };
  for (let i = 0; i < 300; i++) {
    streams.time.push(i);
    streams.distance.push(8 * i);
    streams.altitude.push(200 + i);
    streams.watts.push(210);
    streams.latlng.push([40 + (8 * i) / 111320, -5]);
  }
  const enriched = {
    async getTrackRow(id) {
      return id === ACTIVIDAD.actividad_id
        ? { actividad_id: id, datos: codec.encodeTrack(engine.streamsToTrack(streams)).datos, muestras: 300 }
        : null;
    },
  };

  const { createAppApiRouter } = require('../lib/appApiRouter');
  const app = express();
  app.use(express.json());
  app.use(
    '/api/app',
    createAppApiRouter({
      repository: { ...createRepository(), getTrackRow: enriched.getTrackRow },
      segmentsService: createSegmentsServiceStub(),
      activitiesSync: {
        getStatus: () => ({ estado: 'inactivo' }),
        isRunning: () => false,
        startSync: () => ({ iniciado: true, estado: { estado: 'ejecutando' } }),
      },
      token: options.token,
    }),
  );

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}/api/app` };
}

async function get(base, path, token) {
  const response = await fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, body: await response.json() };
}

test('sin token responde 401', { skip }, async () => {
  const { server, base } = await startServer({ token: TOKEN });
  try {
    const result = await get(base, '/health');
    assert.equal(result.status, 401);
    assert.equal(result.body.success, false);
  } finally {
    server.close();
  }
});

test('con token incorrecto responde 401', { skip }, async () => {
  const { server, base } = await startServer({ token: TOKEN });
  try {
    const result = await get(base, '/segments', 'otro-token');
    assert.equal(result.status, 401);
  } finally {
    server.close();
  }
});

test('sin APP_API_TOKEN configurado responde 503 (fail-closed)', { skip }, async () => {
  const { server, base } = await startServer({ token: undefined });
  try {
    const result = await get(base, '/health', 'cualquiera');
    assert.equal(result.status, 503);
  } finally {
    server.close();
  }
});

test('lista de actividades con token', { skip }, async () => {
  const { server, base } = await startServer({ token: TOKEN });
  try {
    const result = await get(base, '/activities?limit=10', TOKEN);
    assert.equal(result.status, 200);
    assert.equal(result.body.data.actividades.length, 1);
    assert.equal(result.body.data.actividades[0].actividad_id, 'i123');
  } finally {
    server.close();
  }
});

test('la traza devuelve puntos con potencia y pulso', { skip }, async () => {
  const { server, base } = await startServer({ token: TOKEN });
  try {
    const result = await get(base, '/activities/i123/track?max=100', TOKEN);
    assert.equal(result.status, 200);
    assert.ok(result.body.data.puntos.length > 10);
    assert.equal(result.body.data.tiene_gps, true);
    assert.equal(result.body.data.puntos[0].p, 210);
  } finally {
    server.close();
  }
});

test('segmento inexistente responde 404', { skip }, async () => {
  const { server, base } = await startServer({ token: TOKEN });
  try {
    const result = await get(base, '/segments/no-existe', TOKEN);
    assert.equal(result.status, 404);
  } finally {
    server.close();
  }
});

test('el detalle del segmento trae la clasificación', { skip }, async () => {
  const { server, base } = await startServer({ token: TOKEN });
  try {
    const result = await get(base, '/segments/seg-1', TOKEN);
    assert.equal(result.status, 200);
    assert.equal(result.body.data.clasificacion[0].posicion, 1);
    assert.equal(result.body.data.clasificacion[0].pot_media, 240);
  } finally {
    server.close();
  }
});

test('crear segmento valida coordenadas', { skip }, async () => {
  const { server, base } = await startServer({ token: TOKEN });
  try {
    const response = await fetch(`${base}/segments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: 'Prueba',
        actividad_id: 'i123',
        inicio: { lat: 'no-es-numero', lon: -5 },
        fin: { lat: 40, lon: -5 },
      }),
    });
    assert.equal(response.status, 400);
  } finally {
    server.close();
  }
});
