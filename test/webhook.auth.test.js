'use strict';

// ═══════════════════════════════════════════════════════════════
// PRUEBAS DE INTEGRACIÓN DEL WEBHOOK (sin dependencias ni red)
// ═══════════════════════════════════════════════════════════════
// Carga index.js sustituyendo express, cors, supabase, node-fetch,
// form-data y dotenv por dobles en memoria. Cualquier intento de
// salida a red hace fallar la prueba (node-fetch lanza).
// Ejecutar: node --test test/webhook.auth.test.js
// ═══════════════════════════════════════════════════════════════

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const SECRETO = 'secreto_de_prueba_ABC-123';
const USUARIO = '111111111';
const CHAT = '111111111';
const CABECERA = 'x-telegram-bot-api-secret-token';

process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_ANON_KEY = 'anon-key-de-prueba';
process.env.TELEGRAM_WEBHOOK_SECRET = SECRETO;
process.env.AUTHORIZED_USER_ID = USUARIO;
process.env.CHAT_ID = CHAT;
delete process.env.TELEGRAM_TOKEN;
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.PUBLIC_URL;
delete process.env.RAILWAY_PUBLIC_DOMAIN;
delete process.env.RENDER_EXTERNAL_URL;

let llamadasDeRed = 0;
const rutas = new Map();

const expressStub = function expressStub() {
  return {
    use() {},
    get() {},
    post(ruta, handler) { rutas.set('POST ' + ruta, handler); },
    listen() {}
  };
};
expressStub.json = () => (req, res, next) => { if (next) next(); };
expressStub.urlencoded = () => (req, res, next) => { if (next) next(); };
// index.js monta ahora un router propio en /api/app.
expressStub.Router = () => ({
  use() {},
  get() {},
  post() {},
  delete() {}
});

const supabaseStub = {
  createClient: () => ({
    from: () => { throw new Error('SUPABASE_NO_PERMITIDO_EN_PRUEBAS'); }
  })
};

const cargarOriginal = Module._load;
Module._load = function (request) {
  if (request === 'express') return expressStub;
  if (request === 'cors') return () => (req, res, next) => { if (next) next(); };
  if (request === '@supabase/supabase-js') return supabaseStub;
  if (request === 'node-fetch') {
    return () => {
      llamadasDeRed += 1;
      throw new Error('RED_NO_PERMITIDA_EN_PRUEBAS');
    };
  }
  if (request === 'form-data') {
    return class FormDataStub {
      append() {}
      getHeaders() { return {}; }
    };
  }
  if (request === 'dotenv') return { config: () => ({}) };
  return cargarOriginal.apply(this, arguments);
};

const logOriginal = console.log;
console.log = () => {};

require('../index.js');

console.log = logOriginal;
Module._load = cargarOriginal;

const handler = rutas.get('POST /webhook');
assert.ok(handler, 'index.js debe registrar POST /webhook');

function mensaje(overrides = {}) {
  const base = {
    message_id: 1,
    from: { id: Number(USUARIO) },
    chat: { id: Number(CHAT), type: 'private' },
    text: '/comando-invalido'
  };
  return { ...base, ...overrides };
}

// Ejecuta el handler con req/res mínimos y devuelve lo observado.
function enviar(cabeceras, body) {
  return new Promise((resolve, reject) => {
    const capturado = [];
    const logPrevio = console.log;
    console.log = (...args) => { capturado.push(args.join(' ')); };

    let statusCode = null;
    let respuesta = null;
    let terminado = false;

    const finalizar = () => {
      if (terminado) return;
      terminado = true;
      clearTimeout(temporizador);
      console.log = logPrevio;
      resolve({ statusCode, respuesta, logs: capturado });
    };

    const temporizador = setTimeout(() => {
      console.log = logPrevio;
      reject(new Error('El webhook no respondió en 2s'));
    }, 2000);
    if (temporizador.unref) temporizador.unref();

    const res = {
      headersSent: false,
      status(codigo) { statusCode = codigo; return this; },
      json(cuerpo) { respuesta = cuerpo; this.headersSent = true; finalizar(); }
    };
    const req = {
      body,
      get(nombre) { return cabeceras[String(nombre).toLowerCase()]; }
    };

    try {
      handler(req, res).catch((err) => {
        console.log = logPrevio;
        clearTimeout(temporizador);
        reject(err);
      });
    } catch (err) {
      console.log = logPrevio;
      clearTimeout(temporizador);
      reject(err);
    }
  });
}

test('rechaza la petición sin cabecera de secreto', async () => {
  const r = await enviar({}, { update_id: 10, message: mensaje() });
  assert.equal(r.statusCode, 401);
  assert.ok(!r.logs.some((l) => l.includes('[Webhook] Mensaje:')), 'no debe procesar');
});

test('rechaza la petición con secreto incorrecto', async () => {
  const r = await enviar({ [CABECERA]: 'secreto-incorrecto' }, { update_id: 11, message: mensaje() });
  assert.equal(r.statusCode, 401);
  assert.ok(!r.logs.some((l) => l.includes('[Webhook] Mensaje:')), 'no debe procesar');
});

test('con secreto correcto pero otro usuario no ejecuta nada', async () => {
  const r = await enviar(
    { [CABECERA]: SECRETO },
    { update_id: 12, message: mensaje({ from: { id: 222222222 } }) }
  );
  assert.equal(r.statusCode, 200);
  assert.ok(r.logs.some((l) => l.includes('Update no autorizado')));
  assert.ok(!r.logs.some((l) => l.includes('[Webhook] Mensaje:')), 'no debe procesar');
});

test('con secreto correcto y usuario correcto en grupo no ejecuta nada', async () => {
  const r = await enviar(
    { [CABECERA]: SECRETO },
    { update_id: 13, message: mensaje({ chat: { id: -100123456, type: 'group' } }) }
  );
  assert.equal(r.statusCode, 200);
  assert.ok(!r.logs.some((l) => l.includes('[Webhook] Mensaje:')), 'no debe procesar');
});

test('ignora channel_post aunque el secreto sea correcto', async () => {
  const r = await enviar(
    { [CABECERA]: SECRETO },
    { update_id: 14, channel_post: { chat: { id: -100999, type: 'channel' }, text: '/estado' } }
  );
  assert.equal(r.statusCode, 200);
  assert.ok(!r.logs.some((l) => l.includes('[Webhook] Mensaje:')), 'no debe procesar');
});

test('con secreto y usuario correctos procesa el mensaje', async () => {
  const r = await enviar({ [CABECERA]: SECRETO }, { update_id: 15, message: mensaje() });
  assert.equal(r.statusCode, 200);
  assert.ok(
    r.logs.some((l) => l.includes('[Webhook] Mensaje: /comando-invalido')),
    'debe llegar al procesamiento'
  );
  assert.equal(llamadasDeRed, 0, 'ninguna prueba debe contactar servicios externos');
});
