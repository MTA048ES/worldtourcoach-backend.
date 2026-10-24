'use strict';

// ═══════════════════════════════════════════════════════════════
// PRUEBAS AISLADAS DE SEGURIDAD (sin red, sin dependencias)
// ═══════════════════════════════════════════════════════════════
// Ejecutar: node --test test/security.test.js
// Sólo cubre las utilidades puras de lib/security.js y la ausencia
// de patrones peligrosos conocidos en index.js. La verificación HTTP
// del webhook requiere las dependencias del proyecto instaladas.
// ═══════════════════════════════════════════════════════════════

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  esSecretoValido,
  esIdNumericoValido,
  compararSecreto,
  mensajeAutorizado,
  redactarUrl
} = require('../lib/security');

const USUARIO = '111111111';

function mensaje(overrides = {}) {
  return {
    from: { id: 111111111 },
    chat: { id: 111111111, type: 'private' },
    text: '/estado',
    ...overrides
  };
}

// ─── SECRETO DEL WEBHOOK ───────────────────────────────────────
test('compararSecreto rechaza ausente, vacío o distinto', () => {
  assert.equal(compararSecreto(undefined, 'secreto_de_prueba'), false);
  assert.equal(compararSecreto(null, 'secreto_de_prueba'), false);
  assert.equal(compararSecreto('', 'secreto_de_prueba'), false);
  assert.equal(compararSecreto('secreto_de_prueba', undefined), false);
  assert.equal(compararSecreto('secreto_de_pruebaX', 'secreto_de_prueba'), false);
});

test('compararSecreto acepta el correcto y no lanza con longitudes distintas', () => {
  assert.equal(compararSecreto('secreto_de_prueba', 'secreto_de_prueba'), true);
  assert.equal(compararSecreto('corto', 'un-secreto-mucho-mas-largo'), false);
});

test('esSecretoValido aplica el formato de Telegram', () => {
  assert.equal(esSecretoValido('Abc_123-xyz'), true);
  assert.equal(esSecretoValido('a'.repeat(256)), true);
  assert.equal(esSecretoValido('a'.repeat(257)), false);
  assert.equal(esSecretoValido(''), false);
  assert.equal(esSecretoValido('con espacio'), false);
  assert.equal(esSecretoValido('con:dos-puntos'), false);
  assert.equal(esSecretoValido(undefined), false);
});

test('esIdNumericoValido sólo admite ids numéricos positivos', () => {
  assert.equal(esIdNumericoValido('123456789'), true);
  assert.equal(esIdNumericoValido('-100123456'), false);
  assert.equal(esIdNumericoValido('123abc'), false);
  assert.equal(esIdNumericoValido(''), false);
  assert.equal(esIdNumericoValido(undefined), false);
});

// ─── IDENTIDAD DEL USUARIO ─────────────────────────────────────
test('mensajeAutorizado acepta al usuario autorizado en chat privado', () => {
  assert.equal(mensajeAutorizado(mensaje(), USUARIO), true);
});

test('mensajeAutorizado rechaza a otro usuario aunque el chat sea privado', () => {
  assert.equal(mensajeAutorizado(mensaje({ from: { id: 222222222 } }), USUARIO), false);
});

test('mensajeAutorizado rechaza grupos y supergrupos', () => {
  assert.equal(mensajeAutorizado(mensaje({ chat: { id: -1001, type: 'group' } }), USUARIO), false);
  assert.equal(mensajeAutorizado(mensaje({ chat: { id: -1002, type: 'supergroup' } }), USUARIO), false);
});

test('mensajeAutorizado rechaza canales y mensajes sin remitente', () => {
  assert.equal(mensajeAutorizado({ chat: { id: -1003, type: 'channel' }, text: '/estado' }, USUARIO), false);
  assert.equal(mensajeAutorizado({ chat: { id: 111111111, type: 'private' }, text: '/estado' }, USUARIO), false);
});

test('mensajeAutorizado rechaza bots y mensajes sin from.id', () => {
  assert.equal(mensajeAutorizado(mensaje({ from: { id: 111111111, is_bot: true } }), USUARIO), false);
  assert.equal(mensajeAutorizado(mensaje({ from: {} }), USUARIO), false);
});

test('mensajeAutorizado rechaza si no hay usuario autorizado configurado', () => {
  assert.equal(mensajeAutorizado(mensaje(), undefined), false);
  assert.equal(mensajeAutorizado(mensaje(), null), false);
});

// ─── REDACCIÓN DE SECRETOS ─────────────────────────────────────
test('redactarUrl elimina el token del bot de la ruta', () => {
  const salida = redactarUrl(
    'Timeout (10000ms) en https://api.telegram.org/botSENTINEL123:ABC/sendMessage'
  );
  assert.ok(!salida.includes('SENTINEL123'), 'no debe aparecer el token');
  assert.ok(salida.includes('/bot<redactado>'), 'debe quedar la marca de redacción');
});

test('redactarUrl elimina secret_token de la query string', () => {
  const salida = redactarUrl(
    'https://example.test/setWebhook?url=https://bot.test/webhook&secret_token=SENTINEL456'
  );
  assert.ok(!salida.includes('SENTINEL456'), 'no debe aparecer el secreto');
});

test('redactarUrl no rompe textos sin credenciales', () => {
  assert.equal(redactarUrl('Error interno del servidor'), 'Error interno del servidor');
  assert.equal(redactarUrl(''), '(sin detalle)');
});

// ─── GUARDAS ESTÁTICAS SOBRE index.js ──────────────────────────
test('index.js no contiene las fugas ni el canal no permitido', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

  assert.ok(!src.includes('channel_post'), 'no debe procesarse channel_post');
  assert.ok(!src.includes('url.substring(0, 50)'), 'el error de timeout no debe truncar la URL con token');
  assert.ok(
    !src.includes('bot${CONFIG.TELEGRAM_TOKEN}/setWebhook?url='),
    'no debe construirse un log con el token interpolado'
  );
  assert.ok(
    src.includes("req.get('X-Telegram-Bot-Api-Secret-Token')"),
    'el webhook debe leer la cabecera del secreto'
  );
  assert.ok(
    src.includes('secret_token: CONFIG.TELEGRAM_WEBHOOK_SECRET'),
    'setWebhook debe registrar el secreto'
  );
  assert.ok(
    src.includes('mensajeAutorizado(message, CONFIG.AUTHORIZED_USER_ID)'),
    'la autorización debe depender del usuario'
  );
  assert.ok(!src.includes('curl "https://api.telegram.org/bot'), 'sin curl con credenciales');
});
