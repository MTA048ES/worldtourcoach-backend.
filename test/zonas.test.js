'use strict';

// ═══════════════════════════════════════════════════════════════
// PRUEBAS DE ZONAS SEMANALES Y POLARIZACIÓN
// ═══════════════════════════════════════════════════════════════
// Ejecutar: node --test test/zonas.test.js
// ═══════════════════════════════════════════════════════════════

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  zonaDePotencia,
  inicioSemana,
  segundosEnZonas,
  polarizacion,
  crearServicioZonas,
} = require('../lib/zonas');
const codec = require('../lib/trackCodec');

function trackPlano({ seconds = 600, watts = 200 } = {}) {
  const t = [];
  const p = [];
  for (let i = 0; i < seconds; i++) {
    t.push(i);
    p.push(watts);
  }
  return {
    t,
    d: t.map((v) => v * 8),
    p,
    ele: t.map(() => 200),
    hr: t.map(() => 140),
    lat: t.map(() => 40),
    lon: t.map(() => -5),
    hasPower: true,
  };
}

test('cada potencia cae en su zona de Coggan', () => {
  const ftp = 250;
  assert.equal(zonaDePotencia(100, ftp), 1); // 40 %
  assert.equal(zonaDePotencia(150, ftp), 2); // 60 %
  assert.equal(zonaDePotencia(200, ftp), 3); // 80 %
  assert.equal(zonaDePotencia(250, ftp), 4); // 100 %
  assert.equal(zonaDePotencia(275, ftp), 5); // 110 %
  assert.equal(zonaDePotencia(350, ftp), 6); // 140 %
  assert.equal(zonaDePotencia(400, ftp), 7); // 160 %
  assert.equal(zonaDePotencia(0, ftp), 0);
  assert.equal(zonaDePotencia(200, 0), 0);
});

test('la semana empieza en lunes', () => {
  // Sábado 31/10/2026 → lunes 26/10/2026.
  assert.equal(inicioSemana('2026-10-31T10:00:00Z'), '2026-10-26');
  assert.equal(inicioSemana('2026-10-26T00:00:00Z'), '2026-10-26');
  assert.equal(inicioSemana('2026-11-01T23:59:00Z'), '2026-10-26');
  assert.equal(inicioSemana('2026-11-02T00:00:00Z'), '2026-11-02');
});

test('cuenta segundos por zona y descarta huecos sin potencia', () => {
  const track = trackPlano({ seconds: 300, watts: 200 });
  for (let i = 100; i < 110; i++) track.p[i] = null;

  const { zonas, total_s } = segundosEnZonas(track, 250);
  assert.equal(zonas[2], 289); // 299 s válidos − 10 nulos
  assert.equal(total_s, 289);
});

test('polarización: fácil menos intenso sobre el total', () => {
  const pi = polarizacion([600, 600, 0, 0, 300, 0, 0]);
  assert.equal(pi.indice, 0.6);
  assert.equal(pi.facil_pct, 80);
  assert.equal(pi.intenso_pct, 20);
});

test('el servicio agrupa por semanas y resume el periodo', async () => {
  const suave = codec.encodeTrack(trackPlano({ seconds: 600, watts: 100 }));
  const fuerte = codec.encodeTrack(trackPlano({ seconds: 600, watts: 300 }));

  const repository = {
    async listActivities() {
      return [
        {
          actividad_id: 'a1',
          fecha: '2026-10-27T08:00:00Z',
          tipo: 'Ride',
          nombre: 'Suave',
          duracion_s: 600,
          tss: 40,
          desnivel_m: 100,
          distancia_m: 20000,
        },
        {
          actividad_id: 'a2',
          fecha: '2026-10-29T08:00:00Z',
          tipo: 'Ride',
          nombre: 'Series',
          duracion_s: 600,
          tss: 80,
          desnivel_m: 200,
          distancia_m: 25000,
        },
      ];
    },
    async getTrackRows() {
      return [
        { actividad_id: 'a1', datos: suave.datos },
        { actividad_id: 'a2', datos: fuerte.datos },
      ];
    },
  };

  const servicio = crearServicioZonas({ repository, codec });
  const datos = await servicio.calcular({ semanas: 2, ftp: 250, ahora: new Date('2026-10-31T12:00:00Z') });

  assert.equal(datos.semanas.length, 2);
  assert.equal(datos.semanas[0].semana, '2026-10-19');
  assert.equal(datos.semanas[0].salidas, 0);
  assert.equal(datos.semanas[1].semana, '2026-10-26');
  assert.equal(datos.semanas[1].salidas, 2);
  assert.equal(datos.semanas[1].zonas.z1_s, 599);
  assert.equal(datos.semanas[1].zonas.z5_s, 599);
  assert.equal(datos.semanas[1].tss, 120);

  assert.equal(datos.resumen.salidas, 2);
  assert.equal(datos.resumen.horas, 0.3);
  assert.equal(datos.resumen.polarizacion.indice, 0);
  assert.equal(datos.resumen.zonas_pct.z1, 50);
});
