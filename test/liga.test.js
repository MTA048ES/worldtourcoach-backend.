'use strict';

// ═══════════════════════════════════════════════════════════════
// PRUEBAS DE LA LIGA ZONA 0 (VARIOS JUGADORES)
// ═══════════════════════════════════════════════════════════════
// Ejecutar: node --test test/liga.test.js
// ═══════════════════════════════════════════════════════════════

const test = require('node:test');
const assert = require('node:assert/strict');

const { crearServicioLiga } = require('../lib/liga');
const { puntosCategoria } = require('../lib/pique');

const SEMANA = '2026-10-26';

function semana(extra = {}) {
  return {
    semana: SEMANA,
    km: 0,
    desnivel_m: 0,
    dias: 0,
    salidas: 0,
    horas: 0,
    tss: 0,
    rodillo_h: 0,
    remontada_pct: null,
    ...extra,
  };
}

function usuario({ id, nombre, semanas, esfuerzos = [], calcularSegmento = null }) {
  return {
    perfil: { userId: id, nombre },
    getServicios: async () => ({
      perfil: { userId: id, nombre },
      piqueService: {
        getPique: async () => ({
          semana_actual: SEMANA,
          semanas,
          segmento: {
            id: 'seg-mangalobos',
            nombre: 'Mangalobos',
            distancia_m: 1900,
            pendiente_media: 3.1,
          },
        }),
        ...(calcularSegmento ? { calcularSegmento } : {}),
      },
      repository: {
        listEfforts: async () => esfuerzos,
      },
    }),
  };
}

test('la liga reparte puntos y maillots entre dos personas', async () => {
  const ana = usuario({
    id: 'i1',
    nombre: 'Ana',
    semanas: [semana({ km: 100, desnivel_m: 1000, dias: 5, remontada_pct: 10 })],
    esfuerzos: [
      { fecha: '2026-10-27T10:00:00Z', tiempo_s: 300, segmento_id: 'seg-mangalobos' },
      { fecha: '2026-10-29T10:00:00Z', tiempo_s: 310, segmento_id: 'seg-mangalobos' },
    ],
  });
  const luis = usuario({
    id: 'i2',
    nombre: 'Luis',
    semanas: [semana({ km: 50, desnivel_m: 2000, dias: 3, remontada_pct: 20 })],
    esfuerzos: [
      { fecha: '2026-10-28T10:00:00Z', tiempo_s: 330, segmento_id: 'seg-mangalobos' },
    ],
  });

  const liga = await crearServicioLiga({ usuarios: [ana, luis] }).calcular();

  assert.equal(liga.participantes, 2);
  assert.equal(liga.semanas.length, 1);

  const filas = liga.semanas[0].filas;
  const filaAna = filas.find((fila) => fila.user_id === 'i1');
  const filaLuis = filas.find((fila) => fila.user_id === 'i2');

  assert.equal(filaAna.categorias.km, 5);
  assert.equal(filaLuis.categorias.km, 3);
  assert.equal(filaAna.categorias.desnivel, 3);
  assert.equal(filaLuis.categorias.desnivel, 5);
  assert.equal(filaAna.categorias.dias, 5);
  assert.equal(filaLuis.categorias.dias, 3);
  assert.equal(filaAna.categorias.remontada, 3);
  assert.equal(filaLuis.categorias.remontada, 5);
  assert.equal(filaAna.categorias.segmento, 5);
  assert.equal(filaLuis.categorias.segmento, 3);
  assert.equal(filaAna.bonus_segmento, 1);
  assert.equal(filaLuis.bonus_segmento, 1);
  assert.equal(filaAna.puntos, 22);
  assert.equal(filaLuis.puntos, 20);

  assert.equal(liga.semanas[0].maillots.amarillo.user_id, 'i1');
  assert.equal(liga.semanas[0].maillots.verde.user_id, 'i1');
  assert.equal(liga.semanas[0].maillots.montana.user_id, 'i2');
  assert.equal(liga.semanas[0].maillots.segmentos.user_id, 'i1');
  assert.equal(liga.semanas[0].maillots.remontada.user_id, 'i2');

  assert.equal(liga.tabla.length, 2);
  assert.equal(liga.tabla[0].user_id, 'i1');
  assert.equal(liga.tabla[0].puntos, 22);
  assert.equal(liga.tabla[1].puntos, 20);
  assert.equal(liga.maillots.amarillo.user_id, 'i1');
  assert.equal(liga.maillots.montana.user_id, 'i2');
});

test('todos aparecen aunque no hayan entrenado', async () => {
  const ana = usuario({
    id: 'i1',
    nombre: 'Ana',
    semanas: [semana({ km: 80, desnivel_m: 900, dias: 4 })],
  });
  const luis = usuario({
    id: 'i2',
    nombre: 'Luis',
    semanas: [semana()],
  });

  const liga = await crearServicioLiga({ usuarios: [ana, luis] }).calcular();
  const filaLuis = liga.semanas[0].filas.find((fila) => fila.user_id === 'i2');

  assert.equal(liga.tabla.length, 2);
  assert.equal(filaLuis.puntos, 0);
  assert.equal(filaLuis.bonus_segmento, 0);
  assert.equal(filaLuis.segmento_s, null);
  assert.equal(liga.semanas[0].maillots.amarillo.user_id, 'i1');
  assert.equal(liga.semanas[0].maillots.montana.user_id, 'i1');
  assert.equal(liga.semanas[0].maillots.remontada, null);
  assert.equal(liga.semanas[0].maillots.segmentos, null);
});

test('sin intentos no hay punto extra de segmento', async () => {
  const ana = usuario({
    id: 'i1',
    nombre: 'Ana',
    semanas: [semana({ km: 120, desnivel_m: 600, dias: 4 })],
  });
  const luis = usuario({
    id: 'i2',
    nombre: 'Luis',
    semanas: [semana({ km: 60, desnivel_m: 1200, dias: 2 })],
  });

  const liga = await crearServicioLiga({ usuarios: [ana, luis] }).calcular();
  const filas = liga.semanas[0].filas;

  assert.equal(filas.every((fila) => fila.bonus_segmento === 0), true);
  assert.equal(filas.every((fila) => fila.puntos === 13 || fila.puntos === 11), true);
  assert.equal(liga.semanas[0].maillots.segmentos, null);
});

test('con una sola persona la liga sigue siendo válida', async () => {
  const ana = usuario({
    id: 'i1',
    nombre: 'Ana',
    semanas: [semana({ km: 90, desnivel_m: 800, dias: 3, remontada_pct: 5 })],
  });

  const liga = await crearServicioLiga({ usuarios: [ana] }).calcular();

  assert.equal(liga.participantes, 1);
  assert.equal(liga.tabla.length, 1);
  assert.equal(liga.maillots.amarillo.user_id, 'i1');
  assert.equal(liga.maillots.verde.user_id, 'i1');
  assert.equal(liga.maillots.montana.user_id, 'i1');
});

test('cada semana puntúa con su propio segmento', async () => {
  const calcularSegmento = async (semanaIso) =>
    semanaIso === '2026-10-19'
      ? { id: 'seg-a', nombre: 'Segmento A', distancia_m: 1000, pendiente_media: 2 }
      : { id: 'seg-b', nombre: 'Segmento B', distancia_m: 1200, pendiente_media: 4 };

  const ana = usuario({
    id: 'i1',
    nombre: 'Ana',
    semanas: [semana({ semana: '2026-10-19' }), semana({ semana: '2026-10-26' })],
    esfuerzos: [
      { fecha: '2026-10-20T10:00:00Z', tiempo_s: 300, segmento_id: 'seg-a' },
      { fecha: '2026-10-27T10:00:00Z', tiempo_s: 310, segmento_id: 'seg-b' },
    ],
    calcularSegmento,
  });
  const luis = usuario({
    id: 'i2',
    nombre: 'Luis',
    semanas: [semana({ semana: '2026-10-19' }), semana({ semana: '2026-10-26' })],
    esfuerzos: [
      { fecha: '2026-10-21T10:00:00Z', tiempo_s: 330, segmento_id: 'seg-a' },
      { fecha: '2026-10-28T10:00:00Z', tiempo_s: 300, segmento_id: 'seg-b' },
    ],
    calcularSegmento,
  });

  const liga = await crearServicioLiga({ usuarios: [ana, luis] }).calcular();

  assert.equal(liga.semanas[0].segmento.nombre, 'Segmento A');
  assert.equal(liga.semanas[1].segmento.nombre, 'Segmento B');

  const anaSemana1 = liga.semanas[0].filas.find((fila) => fila.user_id === 'i1');
  const luisSemana1 = liga.semanas[0].filas.find((fila) => fila.user_id === 'i2');
  const anaSemana2 = liga.semanas[1].filas.find((fila) => fila.user_id === 'i1');
  const luisSemana2 = liga.semanas[1].filas.find((fila) => fila.user_id === 'i2');

  assert.equal(anaSemana1.segmento_s, 300);
  assert.equal(luisSemana1.segmento_s, 330);
  assert.equal(anaSemana1.categorias.segmento, 5);
  assert.equal(luisSemana1.categorias.segmento, 3);

  assert.equal(anaSemana2.segmento_s, 310);
  assert.equal(luisSemana2.segmento_s, 300);
  assert.equal(anaSemana2.categorias.segmento, 3);
  assert.equal(luisSemana2.categorias.segmento, 5);

  assert.equal(anaSemana1.puntos, 6);
  assert.equal(luisSemana1.puntos, 4);
  assert.equal(anaSemana2.puntos, 4);
  assert.equal(luisSemana2.puntos, 6);
});

test('los tiempos del segmento puntúan de menor a mayor', () => {
  const puntos = puntosCategoria(
    [
      { id: 'lento', valor: 330 },
      { id: 'rapido', valor: 300 },
    ],
    { ascendente: true },
  );

  assert.equal(puntos.get('rapido'), 5);
  assert.equal(puntos.get('lento'), 3);
});
