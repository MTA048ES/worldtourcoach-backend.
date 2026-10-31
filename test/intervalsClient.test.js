'use strict';

// ═══════════════════════════════════════════════════════════════
// PRUEBAS DEL CLIENTE DE INTERVALS.ICU (sin red)
// ═══════════════════════════════════════════════════════════════
// Ejecutar: node --test test/intervalsClient.test.js
// ═══════════════════════════════════════════════════════════════

const test = require('node:test');
const assert = require('node:assert/strict');

const { createIntervalsClient, normalizeActivity } = require('../lib/intervalsClient');

function respuesta(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

function crearCliente(fetchImpl) {
  return createIntervalsClient({
    apiKey: 'clave-de-prueba',
    athleteId: 'i12345',
    fetchImpl,
    minIntervalMs: 0,
  });
}

test('listActivities firma con Basic API_KEY y consulta el rango', async () => {
  const llamadas = [];
  const client = crearCliente(async (url, options) => {
    llamadas.push({ url, options });
    return respuesta(200, [{ id: 'i1' }]);
  });

  const actividades = await client.listActivities({ oldest: '2026-01-01', newest: '2026-01-31' });

  assert.equal(actividades.length, 1);
  assert.equal(llamadas.length, 1);
  assert.match(llamadas[0].url, /\/athlete\/i12345\/activities\?oldest=2026-01-01&newest=2026-01-31/);
  assert.equal(
    llamadas[0].options.headers.Authorization,
    `Basic ${Buffer.from('API_KEY:clave-de-prueba').toString('base64')}`,
  );
});

test('getStreams usa la ruta singular de actividad', async () => {
  let urlPedida = '';
  const client = crearCliente(async (url) => {
    urlPedida = url;
    return respuesta(200, { time: [0, 1], watts: [100, 200] });
  });

  await client.getStreams('i999');
  assert.match(urlPedida, /\/activity\/i999\/streams\.json$/);
});

test('getActivitySegments devuelve la lista de Intervals', async () => {
  let urlPedida = '';
  const client = crearCliente(async (url) => {
    urlPedida = url;
    return respuesta(200, [{ segment_id: 1, name: 'Recta', start_index: 5, end_index: 50 }]);
  });

  const segmentos = await client.getActivitySegments('i999');

  assert.equal(segmentos.length, 1);
  assert.equal(segmentos[0].segment_id, 1);
  assert.match(urlPedida, /\/activity\/i999\/segments$/);
});

test('getActivitySegments devuelve [] si la actividad no tiene segmentos (404)', async () => {
  const client = crearCliente(async () => respuesta(404, {}));

  assert.deepEqual(await client.getActivitySegments('i999'), []);
});

test('reintenta una vez tras un 429 respetando Retry-After', async () => {
  let intentos = 0;
  const client = crearCliente(async () => {
    intentos++;
    if (intentos === 1) return respuesta(429, {}, { 'retry-after': '0' });
    return respuesta(200, []);
  });

  const resultado = await client.listActivities({ oldest: '2026-01-01', newest: '2026-01-02' });

  assert.deepEqual(resultado, []);
  assert.equal(intentos, 2);
});

test('un 401 se reporta sin filtrar la clave', async () => {
  const client = crearCliente(async () => respuesta(401, {}));

  await assert.rejects(
    () => client.listActivities({ oldest: '2026-01-01', newest: '2026-01-02' }),
    (error) => {
      assert.match(error.message, /credenciales/i);
      assert.ok(!error.message.includes('clave-de-prueba'));
      return true;
    },
  );
});

test('un error de red no propaga credenciales', async () => {
  const client = crearCliente(async () => {
    throw new Error('ECONNRESET');
  });

  await assert.rejects(
    () => client.listActivities({ oldest: '2026-01-01', newest: '2026-01-02' }),
    (error) => {
      assert.match(error.message, /error de red/i);
      assert.ok(!error.message.includes('clave-de-prueba'));
      return true;
    },
  );
});

test('normalizeActivity adapta los campos de Intervals', () => {
  const row = normalizeActivity({
    id: 'i55751783',
    start_date_local: '2026-05-01T08:00:00',
    type: 'Ride',
    name: 'Puerto de prueba',
    moving_time: 7200,
    distance: 60000,
    total_elevation_gain: 900,
    average_watts: 210,
    icu_weighted_avg_watts: 240,
    average_heartrate: 145,
    icu_training_load: 180,
  });

  assert.equal(row.actividad_id, 'i55751783');
  assert.equal(row.tipo, 'Ride');
  assert.equal(row.duracion_s, 7200);
  assert.equal(row.distancia_m, 60000);
  assert.equal(row.np, 240);
  assert.equal(row.tss, 180);
});

test('normalizeActivity descarta filas sin id o sin fecha válida', () => {
  assert.equal(normalizeActivity(null), null);
  assert.equal(normalizeActivity({ start_date_local: '2026-05-01' }), null);
  assert.equal(normalizeActivity({ id: 'i1', start_date_local: 'no-es-fecha' }), null);
});

test('normalizeActivity deja en null los datos ausentes (no los convierte en 0)', () => {
  const row = normalizeActivity({
    id: 'i200446051',
    start_date_local: '2026-10-22T17:03:03',
    type: 'Ride',
    moving_time: 5835,
    distance: 43521,
  });

  assert.equal(row.pot_media, null);
  assert.equal(row.pot_max, null);
  assert.equal(row.np, null);
  assert.equal(row.fc_media, null);
  assert.equal(row.fc_max, null);
  assert.equal(row.cadencia_media, null);
  assert.equal(row.desnivel_m, null);
  assert.equal(row.tss, null);

  const vacios = normalizeActivity({
    id: 'i1',
    start_date_local: '2026-05-01T08:00:00',
    average_watts: '',
    icu_training_load: null,
  });
  assert.equal(vacios.pot_media, null);
  assert.equal(vacios.tss, null);
});

test('normalizeActivity conserva un cero real de potencia', () => {
  const row = normalizeActivity({
    id: 'i2',
    start_date_local: '2026-05-01T08:00:00',
    average_watts: 0,
  });

  assert.equal(row.pot_media, 0);
});

test('normalizeActivity redondea las medias decimales para las columnas integer', () => {
  const row = normalizeActivity({
    id: 'i201414978',
    start_date_local: '2026-10-25T10:41:32',
    moving_time: 10853,
    distance: 97928.4,
    total_elevation_gain: 807.6,
    icu_average_watts: 149.7,
    icu_weighted_avg_watts: 194.3,
    average_heartrate: 148.4,
    max_heartrate: 181,
    average_cadence: 79.04113,
    average_speed: 9.027,
    icu_training_load: 197.234,
  });

  assert.equal(row.distancia_m, 97928);
  assert.equal(row.pot_media, 150);
  assert.equal(row.np, 194);
  assert.equal(row.fc_media, 148);
  assert.equal(row.cadencia_media, 79);
  // tss y velocidad son columnas real: conservan el decimal.
  assert.equal(row.tss, 197.234);
  assert.equal(row.velocidad_media, 9.027);
});
