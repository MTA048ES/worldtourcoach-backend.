'use strict';

// ═══════════════════════════════════════════════════════════════
// PRUEBAS DEL MODO PIQUE (ZONA 0)
// ═══════════════════════════════════════════════════════════════
// Ejecutar: node --test test/pique.test.js
// ═══════════════════════════════════════════════════════════════

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  elegirSegmento,
  puntosCategoria,
  metricasSemana,
  distanciaKm,
  ZONA_0,
  crearServicioPique,
} = require('../lib/pique');

const CERCA = { lat: 37.92, lon: -3.78 };

function segmentoCerca(id, extra = {}) {
  return {
    id,
    nombre: `Segmento ${id}`,
    estado: 'listo',
    tipo: 'strava',
    distancia_m: 2500,
    desnivel_m: 80,
    pendiente_media: 2,
    esfuerzos: 5,
    inicio_lat: CERCA.lat,
    inicio_lon: CERCA.lon,
    fin_lat: CERCA.lat + 0.01,
    fin_lon: CERCA.lon + 0.01,
    ...extra,
  };
}

test('Las Infantas está a ~6 km de los pueblos', () => {
  const villargordo = distanciaKm(ZONA_0.lat, ZONA_0.lon, 37.9411, -3.7289);
  const mengibar = distanciaKm(ZONA_0.lat, ZONA_0.lon, 37.968, -3.8088);
  assert.ok(villargordo > 5 && villargordo < 7, `Villargordo: ${villargordo}`);
  assert.ok(mengibar > 5.5 && mengibar < 7.5, `Mengíbar: ${mengibar}`);
});

test('los puntos de categoría respetan empates', () => {
  const puntos = puntosCategoria([
    { id: 'a', valor: 5 },
    { id: 'b', valor: 10 },
    { id: 'c', valor: 10 },
    { id: 'd', valor: 1 },
  ]);
  assert.equal(puntos.get('b'), 5);
  assert.equal(puntos.get('c'), 5);
  assert.equal(puntos.get('a'), 2);
  assert.equal(puntos.get('d'), 1);
});

test('el segmento de la semana cae dentro de la Zona 0 y rota', () => {
  const segmentos = [segmentoCerca('a'), segmentoCerca('b'), segmentoCerca('c')];
  const uno = elegirSegmento({ segmentos, semana: '2026-10-26' });
  const dos = elegirSegmento({ segmentos, semana: '2026-10-26' });
  assert.ok(uno);
  assert.equal(uno.segmento.id, dos.segmento.id);
  assert.equal(uno.radio, 15);

  const lejano = segmentoCerca('z', { inicio_lat: 40.4, inicio_lon: -3.7, fin_lat: 40.41, fin_lon: -3.69 });
  const conLejano = elegirSegmento({ segmentos: [lejano], semana: '2026-10-26' });
  assert.equal(conLejano, null);
});

test('los segmentos automáticos no compiten en el pique', () => {
  const automaticos = [
    segmentoCerca('auto-1', { tipo: 'auto' }),
    segmentoCerca('auto-2', { tipo: 'auto' }),
    segmentoCerca('auto-3', { tipo: 'auto' }),
  ];
  assert.equal(elegirSegmento({ segmentos: automaticos, semana: '2026-10-26' }), null);

  const mezcla = [
    ...automaticos,
    segmentoCerca('strava-1'),
    segmentoCerca('strava-2'),
    segmentoCerca('manual-1', { tipo: 'manual' }),
  ];
  const elegido = elegirSegmento({ segmentos: mezcla, semana: '2026-10-26' });
  assert.ok(elegido);
  assert.notEqual(elegido.segmento.tipo, 'auto');
});

test('las métricas de la semana excluyen e-bike y separan rodillo', () => {
  const desde = Date.parse('2026-10-26T00:00:00Z');
  const hasta = desde + 7 * 86400000;
  const actividades = [
    { fecha: '2026-10-27T08:00:00Z', tipo: 'Ride', duracion_s: 3600, distancia_m: 40000, desnivel_m: 500, tiene_gps: true, tss: 80 },
    { fecha: '2026-10-29T08:00:00Z', tipo: 'VirtualRide', duracion_s: 3600, distancia_m: 30000, desnivel_m: 0, tiene_gps: false, tss: 60 },
    { fecha: '2026-10-30T08:00:00Z', tipo: 'EBikeRide', duracion_s: 3600, distancia_m: 50000, desnivel_m: 600, tiene_gps: true, tss: 40 },
    { fecha: '2026-10-31T08:00:00Z', tipo: 'Ride', duracion_s: 300, distancia_m: 2000, desnivel_m: 20, tiene_gps: true, tss: 5 },
  ];

  const m = metricasSemana(actividades, desde, hasta);
  assert.equal(m.km, 40);
  assert.equal(m.desnivel_m, 500);
  assert.equal(m.dias, 3);
  assert.equal(m.salidas, 3);
  assert.equal(m.rodillo_h, 1);
  assert.equal(m.horas, 3);
});

test('el servicio monta semanas, vitrina y segmento', async () => {
  const segmentos = [segmentoCerca('a'), segmentoCerca('b'), segmentoCerca('c')];
  const repository = {
    async listActivities() {
      return [
        { actividad_id: '1', fecha: '2026-10-27T08:00:00Z', tipo: 'Ride', nombre: 'Ruta', duracion_s: 3600, distancia_m: 40000, desnivel_m: 500, tiene_gps: true, tss: 80 },
        { actividad_id: '2', fecha: '2026-10-20T08:00:00Z', tipo: 'Ride', nombre: 'Otra', duracion_s: 1800, distancia_m: 20000, desnivel_m: 200, tiene_gps: true, tss: 40 },
      ];
    },
    async listSegments() {
      return segmentos;
    },
    async listEfforts() {
      return ['a', 'b', 'c'].flatMap((id) => [
        { segmento_id: id, tiempo_s: 300, fecha: '2026-10-27T09:00:00Z' },
        { segmento_id: id, tiempo_s: 320, fecha: '2026-09-01T09:00:00Z' },
        { segmento_id: id, tiempo_s: 70, fecha: '2026-10-27T09:00:00Z' },
      ]);
    },
  };

  const servicio = crearServicioPique({ repository });
  const datos = await servicio.calcular({ ahora: new Date('2026-11-01T12:00:00Z') });

  assert.equal(datos.semana_actual, '2026-10-26');
  assert.equal(datos.semanas.length, 8);
  const actual = datos.semanas[datos.semanas.length - 1];
  assert.equal(actual.km, 40);
  assert.equal(actual.salidas, 1);

  assert.equal(datos.resumen.km, 60);
  assert.equal(datos.resumen.racha_semanas, 2);
  assert.ok(datos.vitrina.length >= 4);
  assert.equal(datos.vitrina[0].id, 'semana_km');

  assert.ok(datos.segmento);
  assert.equal(datos.segmento.mejor_tiempo_s, 300);
  assert.equal(datos.segmento.mejor_semana_s, 300);
  assert.equal(datos.segmento.intentos_semana, 1);
});
