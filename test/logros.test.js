'use strict';

// ═══════════════════════════════════════════════════════════════
// PRUEBAS DE LOGROS / NIVEL / RETOS
// ═══════════════════════════════════════════════════════════════
// Ejecutar: node --test test/logros.test.js
// ═══════════════════════════════════════════════════════════════

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeLogros, rachaSemanas, claveSemana } = require('../lib/logros');

const AHORA = new Date('2026-10-31T12:00:00Z'); // sábado

function actividad(fecha, distanciaKm, desnivel, horas, extra = {}) {
  return {
    actividad_id: `a-${fecha}`,
    fecha,
    tipo: 'Ride',
    nombre: 'Salida',
    distancia_m: distanciaKm * 1000,
    desnivel_m: desnivel,
    duracion_s: horas * 3600,
    tiene_gps: true,
    ...extra,
  };
}

const HISTORIAL = [
  actividad('2026-10-27T05:30:00Z', 120, 1200, 4), // semana actual, madrugador
  actividad('2026-10-21T19:30:00Z', 30, 200, 1), // semana anterior, nocturno
  actividad('2026-10-14T09:00:00Z', 30, 200, 1),
  actividad('2026-10-07T09:00:00Z', 30, 200, 1),
];

test('claveSemana agrupa por lunes en hora de Madrid', () => {
  assert.equal(claveSemana('2026-10-27T05:30:00Z'), '2026-10-26');
  assert.equal(claveSemana('2026-10-31T23:00:00Z'), '2026-10-26');
  assert.equal(claveSemana('2026-11-01T00:30:00Z'), '2026-10-26');
  // Domingo 23:30 UTC ya es lunes en Madrid.
  assert.equal(claveSemana('2026-11-01T23:30:00Z'), '2026-11-02');
});

test('computeLogros suma totales, puntos y nivel', async () => {
  const logros = computeLogros({ actividades: HISTORIAL, ahora: AHORA });

  assert.equal(logros.totales.salidas, 4);
  assert.equal(logros.totales.km, 210);
  assert.equal(logros.totales.desnivel_m, 1800);
  assert.equal(logros.totales.horas, 7);
  assert.ok(logros.puntos > 0);
  assert.ok(logros.nivel >= 2, `nivel ${logros.nivel}`);
  assert.equal(logros.progreso_nivel >= 0 && logros.progreso_nivel <= 1, true);
  assert.equal(logros.medallas_totales, 12);
  assert.ok(logros.medallas_conseguidas >= 3);
});

test('running, e-bike, manuales y salidas sin GPS no contaminan los totales', () => {
  const mezcla = [
    actividad('2026-10-27T08:00:00Z', 100, 1000, 3),
    actividad('2026-10-28T08:00:00Z', 50, 500, 2, { tipo: 'EBikeRide' }),
    actividad('2026-10-29T08:00:00Z', 20, 0, 1, { tipo: 'VirtualRide', tiene_gps: false }),
    actividad('2026-10-30T08:00:00Z', 10, 100, 1, { tipo: 'Run' }),
    actividad('2026-10-30T09:00:00Z', 50, 500, 2, { origen: 'manual' }),
    actividad('2026-10-30T10:00:00Z', 1, 10, 0.05),
    actividad('2026-10-30T11:00:00Z', 50, 500, 2, { tiene_gps: false }),
  ];

  const logros = computeLogros({ actividades: mezcla, ahora: AHORA });

  // E-bike y rodillo suman constancia, pero no km/desnivel.
  assert.equal(logros.totales.salidas, 3);
  assert.equal(logros.totales.horas, 6);
  assert.equal(logros.totales.rodillo, 1);
  assert.equal(logros.totales.km, 100);
  assert.equal(logros.totales.desnivel_m, 1000);
  assert.equal(logros.medallas.find((m) => m.id === 'dia_100').progreso, 1);
  assert.equal(logros.racha_semanas, 1);
});

test('las medallas suben de nivel con los umbrales', async () => {
  const logros = computeLogros({ actividades: HISTORIAL, ahora: AHORA });
  const km = logros.medallas.find((m) => m.id === 'km');
  const racha = logros.medallas.find((m) => m.id === 'racha');
  const centurion = logros.medallas.find((m) => m.id === 'dia_100');

  // 210 km: bronce (100), siguiente plata (1000).
  assert.equal(km.nivel, 1);
  assert.equal(km.siguiente, 1000);

  // 4 semanas seguidas: bronce y plata, siguiente oro (8).
  assert.equal(racha.nivel, 2);
  assert.equal(racha.siguiente, 8);

  // Una salida de 100 km o más.
  assert.equal(centurion.nivel, 1);
  assert.equal(centurion.conseguida, true);
});

test('la racha aguanta la semana en curso sin salidas', async () => {
  // Solo hay salidas en las tres semanas anteriores.
  const sinEstaSemana = [
    actividad('2026-10-21T09:00:00Z', 20, 100, 1),
    actividad('2026-10-14T09:00:00Z', 20, 100, 1),
    actividad('2026-10-07T09:00:00Z', 20, 100, 1),
  ];

  assert.equal(rachaSemanas(sinEstaSemana, AHORA), 3);

  // Un hueco corta la racha.
  const conHueco = [
    actividad('2026-10-21T09:00:00Z', 20, 100, 1),
    actividad('2026-09-30T09:00:00Z', 20, 100, 1),
  ];
  assert.equal(rachaSemanas(conHueco, AHORA), 1);
});

test('los retos semanales solo cuentan la semana en curso', async () => {
  const logros = computeLogros({ actividades: HISTORIAL, ahora: AHORA });
  const salidas = logros.retos.find((r) => r.id === 'salidas');
  const km = logros.retos.find((r) => r.id === 'km');
  const desnivel = logros.retos.find((r) => r.id === 'desnivel');
  const horas = logros.retos.find((r) => r.id === 'horas');

  assert.equal(salidas.progreso, 1);
  assert.equal(salidas.conseguido, false);
  assert.equal(km.progreso, 120);
  assert.equal(km.conseguido, true);
  assert.equal(desnivel.progreso, 1200);
  assert.equal(desnivel.conseguido, true);
  assert.equal(horas.progreso, 4);
  assert.equal(horas.conseguido, true);
});

test('sin historial devuelve nivel 1 y todo a cero', async () => {
  const logros = computeLogros({ actividades: [], ahora: AHORA });

  assert.equal(logros.nivel, 1);
  assert.equal(logros.puntos, 0);
  assert.equal(logros.racha_semanas, 0);
  assert.equal(logros.totales.salidas, 0);
  assert.equal(logros.medallas_conseguidas, 0);
});
