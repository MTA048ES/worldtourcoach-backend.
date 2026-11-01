'use strict';

// ═══════════════════════════════════════════════════════════════
// PRUEBAS DE PERFILES DE LA APP
// ═══════════════════════════════════════════════════════════════
// Ejecutar: node --test test/appUsers.test.js
// ═══════════════════════════════════════════════════════════════

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseAppUsers,
  construirPerfiles,
  perfilPorToken,
  resolverAtleta,
} = require('../lib/appUsers');

const TOKEN_ANA = 'wtc_ana_0123456789abcdef0123456789abcdef';
const TOKEN_LUIS = 'wtc_luis_0123456789abcdef0123456789abcdef';

test('parsea perfiles válidos y descarta los incompletos', () => {
  const raw = JSON.stringify([
    { token: TOKEN_ANA, nombre: 'Ana', intervals_api_key: 'clave-de-ana' },
    { token: 'corto', nombre: 'Sin token', intervals_api_key: 'clave' },
    { token: TOKEN_LUIS, nombre: 'Luis' },
  ]);

  const { perfiles, error } = parseAppUsers(raw);

  assert.equal(perfiles.length, 1);
  assert.equal(perfiles[0].nombre, 'Ana');
  assert.equal(perfiles[0].origen, 'env');
  assert.match(error, /token no válido/);
  assert.match(error, /intervals_api_key/);
});

test('APP_USERS inválido no rompe el arranque', () => {
  const { perfiles, error } = parseAppUsers('{no es json');
  assert.deepEqual(perfiles, []);
  assert.match(error, /JSON/);
});

test('el perfil legacy va primero y se evita duplicar usuario', () => {
  const legacy = {
    token: 'token-legacy-0123456789',
    nombre: 'Manu',
    intervalsApiKey: 'clave-manu',
    athleteId: 'i26693',
    userId: '939585578',
  };
  const raw = JSON.stringify([
    { token: TOKEN_ANA, nombre: 'Ana', intervals_api_key: 'clave-de-ana' },
    {
      token: TOKEN_LUIS,
      nombre: 'Luis repetido',
      intervals_api_key: 'clave-de-luis',
      user_id: '939585578',
    },
  ]);

  const { perfiles } = construirPerfiles({ legacy, raw });

  assert.equal(perfiles.length, 2);
  assert.equal(perfiles[0].nombre, 'Manu');
  assert.equal(perfiles[1].nombre, 'Ana');
});

test('busca el perfil por token sin filtrar el token', () => {
  const perfiles = [
    { token: TOKEN_ANA, nombre: 'Ana' },
    { token: TOKEN_LUIS, nombre: 'Luis' },
  ];

  assert.equal(perfilPorToken(perfiles, TOKEN_ANA).nombre, 'Ana');
  assert.equal(perfilPorToken(perfiles, TOKEN_LUIS).nombre, 'Luis');
  assert.equal(perfilPorToken(perfiles, 'token-que-no-existe'), null);
  assert.equal(perfilPorToken(perfiles, ''), null);
});

test('resuelve el atleta a partir de la API key', async () => {
  let peticion = null;
  const fetchImpl = async (url, init) => {
    peticion = { url, auth: init.headers.Authorization };
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'i123456', name: 'Ana' }),
    };
  };

  const atleta = await resolverAtleta({ apiKey: 'clave-secreta', fetchImpl });

  assert.equal(atleta.athleteId, 'i123456');
  assert.equal(atleta.nombre, 'Ana');
  assert.match(peticion.url, /\/athlete\/0$/);
  assert.match(peticion.auth, /^Basic /);
});

test('si Intervals rechaza la clave, el error no la incluye', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}) });

  await assert.rejects(
    () => resolverAtleta({ apiKey: 'clave-secreta', fetchImpl }),
    (error) => {
      assert.match(error.message, /HTTP 403/);
      assert.ok(!error.message.includes('clave-secreta'));
      return true;
    },
  );
});
