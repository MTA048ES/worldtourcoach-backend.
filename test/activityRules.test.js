'use strict';

// ═══════════════════════════════════════════════════════════════
// PRUEBAS DE LAS REGLAS DE ACTIVIDAD
// ═══════════════════════════════════════════════════════════════
// Una sola fuente para liga, récords, zonas, logros y segmentos.
// ═══════════════════════════════════════════════════════════════

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clasificarActividad,
  puedeCrearSegmentos,
  esCiclismoPotencia,
} = require('../lib/activityRules');

function actividad(extra = {}) {
  return {
    tipo: 'Ride',
    duracion_s: 3600,
    distancia_m: 40000,
    desnivel_m: 500,
    tiene_gps: true,
    ...extra,
  };
}

test('una salida de carretera válida cuenta para todo', () => {
  const regla = clasificarActividad(actividad());

  assert.equal(regla.cuentaKm, true);
  assert.equal(regla.cuentaConstancia, true);
  assert.equal(regla.cuentaTss, true);
  assert.equal(regla.cuentaLogros, true);
  assert.equal(regla.puedeCrearSegmentos, true);
});

test('running, manual y sin GPS no cuentan', () => {
  assert.equal(clasificarActividad(actividad({ tipo: 'Run' })).cuentaConstancia, false);
  assert.equal(
    clasificarActividad(actividad({ origen: 'manual' })).cuentaConstancia,
    false,
  );
  assert.equal(
    clasificarActividad(actividad({ tiene_gps: false })).cuentaConstancia,
    false,
  );
});

test('los mínimos son 10 minutos y 3 km', () => {
  assert.equal(clasificarActividad(actividad({ duracion_s: 599 })).cuentaConstancia, false);
  assert.equal(clasificarActividad(actividad({ distancia_m: 2999 })).cuentaConstancia, false);

  const justa = clasificarActividad(actividad({ duracion_s: 600, distancia_m: 3000 }));
  assert.equal(justa.cuentaKm, true);
});

test('la e-bike suma constancia pero no rendimiento', () => {
  const regla = clasificarActividad(actividad({ tipo: 'EBikeRide' }));

  assert.equal(regla.esEbike, true);
  assert.equal(regla.cuentaConstancia, true);
  assert.equal(regla.cuentaKm, false);
  assert.equal(regla.cuentaTss, false);
  assert.equal(regla.cuentaLogros, false);
  assert.equal(regla.puedeCrearSegmentos, false);
  assert.equal(esCiclismoPotencia('EBikeRide'), false);
});

test('la e-bike también necesita 3 km y GPS para constancia', () => {
  assert.equal(
    clasificarActividad(actividad({ tipo: 'EBikeRide', distancia_m: 2999 })).cuentaConstancia,
    false,
  );
  assert.equal(
    clasificarActividad(actividad({ tipo: 'EBikeRide', tiene_gps: false })).cuentaConstancia,
    false,
  );
});

test('el rodillo solo cuenta constancia y no crea segmentos', () => {
  const regla = clasificarActividad(
    actividad({ tipo: 'VirtualRide', tiene_gps: false, distancia_m: 0 }),
  );

  assert.equal(regla.esRodillo, true);
  assert.equal(regla.cuentaConstancia, true);
  assert.equal(regla.cuentaKm, false);
  assert.equal(regla.cuentaTss, true);
  assert.equal(regla.cuentaLogros, false);
  assert.equal(regla.puedeCrearSegmentos, false);
  assert.equal(puedeCrearSegmentos({ tipo: 'VirtualRide', tiene_gps: false }), false);
  // El rodillo no entra en récords ni en zonas de potencia.
  assert.equal(esCiclismoPotencia('VirtualRide'), false);
  assert.equal(esCiclismoPotencia('Ride'), true);
  assert.equal(esCiclismoPotencia('Ride', { tipo: 'Ride', origen: 'manual' }), false);
});

test('una salida corta sigue siendo válida para el historial personal de segmentos', () => {
  const regla = clasificarActividad(actividad({ duracion_s: 300, distancia_m: 2000 }));
  assert.equal(regla.cuentaKm, false);
  assert.equal(regla.puedeCrearSegmentos, true);
});
