'use strict';

// ═══════════════════════════════════════════════════════════════
// PRUEBAS DE ARRANQUE FAIL-CLOSED (procesos hijos, sin red)
// ═══════════════════════════════════════════════════════════════
// Cada caso arranca index.js en un proceso nuevo con módulos externos
// sustituidos en memoria. No hay red: node-fetch lanza si se invoca.
// Ejecutar: node --test test/startup.failclosed.test.js
// ═══════════════════════════════════════════════════════════════

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');

// Guion del proceso hijo: dobles de módulos + carga de index.js.
const GUION = String.raw`
const Module = require('module');
const cargar = Module._load;
Module._load = function (peticion) {
  if (peticion === 'express') {
    const f = () => ({ use() {}, get() {}, post() {}, listen() {} });
    f.json = () => (q, s, n) => n && n();
    f.urlencoded = () => (q, s, n) => n && n();
    f.Router = () => ({ use() {}, get() {}, post() {}, delete() {} });
    return f;
  }
  if (peticion === 'cors') return () => (q, s, n) => n && n();
  if (peticion === '@supabase/supabase-js') return { createClient: () => ({ from: () => ({}) }) };
  if (peticion === 'node-fetch') return () => { throw new Error('RED_NO_PERMITIDA'); };
  if (peticion === 'form-data') return class FormDataStub {};
  if (peticion === 'dotenv') return { config: () => ({}) };
  return cargar.apply(this, arguments);
};
require('./index.js');
`;

function arrancar(overrides) {
  const env = {
    ...process.env,
    SUPABASE_URL: 'https://example.invalid',
    SUPABASE_ANON_KEY: 'anon-key-de-prueba'
  };
  delete env.TELEGRAM_TOKEN;
  delete env.TELEGRAM_BOT_TOKEN;
  delete env.TELEGRAM_WEBHOOK_SECRET;
  delete env.AUTHORIZED_USER_ID;
  delete env.PUBLIC_URL;
  delete env.RAILWAY_PUBLIC_DOMAIN;
  delete env.RENDER_EXTERNAL_URL;
  Object.assign(env, overrides);

  return spawnSync(process.execPath, ['-e', GUION], {
    cwd: RAIZ,
    env,
    encoding: 'utf8',
    timeout: 15000
  });
}

test('sin token arranca sin exigir secreto ni usuario', () => {
  const r = arrancar({});
  assert.equal(r.status, 0, r.stderr);
});

test('con token y sin TELEGRAM_WEBHOOK_SECRET aborta y no filtra el token', () => {
  const tokenSenuelo = 'TOKEN_SENUELO_NO_REAL';
  const r = arrancar({ TELEGRAM_TOKEN: tokenSenuelo, AUTHORIZED_USER_ID: '111111111' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /TELEGRAM_WEBHOOK_SECRET/);
  assert.ok(!(r.stdout + r.stderr).includes(tokenSenuelo), 'el token no debe aparecer');
});

test('con token y sin AUTHORIZED_USER_ID aborta', () => {
  const r = arrancar({ TELEGRAM_TOKEN: 'TOKEN_SENUELO_NO_REAL', TELEGRAM_WEBHOOK_SECRET: 'secreto_valido_123' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /AUTHORIZED_USER_ID/);
});

test('con AUTHORIZED_USER_ID no numérico aborta', () => {
  const r = arrancar({
    TELEGRAM_TOKEN: 'TOKEN_SENUELO_NO_REAL',
    TELEGRAM_WEBHOOK_SECRET: 'secreto_valido_123',
    AUTHORIZED_USER_ID: 'usuario-invalido'
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /AUTHORIZED_USER_ID/);
});

test('con token y ambas variables válidas arranca', () => {
  const r = arrancar({
    TELEGRAM_TOKEN: 'TOKEN_SENUELO_NO_REAL',
    TELEGRAM_WEBHOOK_SECRET: 'secreto_valido_123',
    AUTHORIZED_USER_ID: '111111111'
  });
  assert.equal(r.status, 0, r.stderr);
});
