'use strict';

// ═══════════════════════════════════════════════════════════════
// PRUEBAS DE RÉCORDS DE POTENCIA
// ═══════════════════════════════════════════════════════════════
// Ejecutar: node --test test/records.test.js
// ═══════════════════════════════════════════════════════════════

const test = require('node:test');
const assert = require('node:assert/strict');

const { mejoresDeTrack, crearServicioRecords } = require('../lib/records');
const codec = require('../lib/trackCodec');

function trackConstante({ seconds = 600, watts = 200, picos = [] } = {}) {
  const t = [];
  const p = [];
  for (let i = 0; i < seconds; i++) {
    t.push(i);
    let valor = watts;
    for (const pico of picos) {
      if (i >= pico.desde && i < pico.desde + pico.duracion) valor = pico.vatios;
    }
    p.push(valor);
  }
  return { t, d: t.map((v) => v * 8), p, ele: t.map(() => 200), hr: t.map(() => 140), lat: t.map(() => 40), lon: t.map(() => -5), hasPower: true };
}

test('encuentra el mejor 5 s y el mejor 10 s', () => {
  const track = trackConstante({
    seconds: 600,
    picos: [
      { desde: 100, duracion: 10, vatios: 400 },
      { desde: 300, duracion: 5, vatios: 600 },
    ],
  });

  const mejores = mejoresDeTrack(track);
  assert.equal(mejores[5], 600);
  assert.equal(mejores[10], 400);
  assert.ok(mejores[60] >= 200 && mejores[60] < 400);
  // No hay ventana de 20 min en una salida de 10 min.
  assert.equal(mejores[1200], undefined);
});

test('omite ventanas con datos incompletos', () => {
  const track = trackConstante({ seconds: 120 });
  // Hueco de pulso nulo de 30 s en mitad del tramo.
  for (let i = 40; i < 70; i++) track.p[i] = null;

  const mejores = mejoresDeTrack(track);
  // El hueco parte la salida en tramos de 40 s y 50 s: no cabe ninguna ventana de 60 s.
  assert.equal(mejores[60], undefined);
  assert.equal(mejores[120], undefined);
  assert.equal(mejores[30], 200);
});

test('sin potencia no devuelve nada', () => {
  const track = trackConstante({ seconds: 60 });
  track.hasPower = false;
  assert.equal(mejoresDeTrack(track), null);
});

test('el servicio elige el récord global y lo cachea', async () => {
  const lento = codec.encodeTrack(trackConstante({ seconds: 300, watts: 180, picos: [{ desde: 10, duracion: 20, vatios: 350 }] }));
  const rapido = codec.encodeTrack(trackConstante({ seconds: 300, watts: 220, picos: [{ desde: 10, duracion: 20, vatios: 500 }] }));

  const repository = {
    async listActivities() {
      return [
        { actividad_id: 'a1', fecha: '2026-01-01T09:00:00Z', nombre: 'Suave', tipo: 'Ride' },
        { actividad_id: 'a2', fecha: '2026-02-01T09:00:00Z', nombre: 'Fuerte', tipo: 'Ride' },
      ];
    },
    async *iterateTracks() {
      yield [
        { actividad_id: 'a1', datos: lento.datos },
        { actividad_id: 'a2', datos: rapido.datos },
      ];
    },
  };

  const servicio = crearServicioRecords({ repository, codec });
  const primera = await servicio.getRecords();

  assert.equal(primera.cacheado, false);
  const diez = primera.records.find((r) => r.duracion_s === 10);
  assert.equal(diez.potencia, 500);
  assert.equal(diez.actividad_id, 'a2');
  assert.equal(diez.nombre, 'Fuerte');

  const segunda = await servicio.getRecords();
  assert.equal(segunda.cacheado, true);
  assert.equal(segunda.records.length, primera.records.length);
});
