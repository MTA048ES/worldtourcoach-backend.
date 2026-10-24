'use strict';

// ═══════════════════════════════════════════════════════════════
// 🔐 SEGURIDAD TELEGRAM - UTILIDADES PURAS
// ═══════════════════════════════════════════════════════════════
// Sin dependencias externas (solo crypto nativo) para poder
// probarlas de forma aislada, sin arrancar el servidor.
// ═══════════════════════════════════════════════════════════════

const crypto = require('crypto');

// Formato exigido por Telegram para secret_token: 1-256 chars [A-Za-z0-9_-]
const PATRON_SECRETO = /^[A-Za-z0-9_-]{1,256}$/;
// Ids de Telegram son numéricos (positivos para usuarios/chats privados)
const PATRON_ID = /^\d{1,32}$/;

function esSecretoValido(valor) {
  return typeof valor === 'string' && PATRON_SECRETO.test(valor);
}

function esIdNumericoValido(valor) {
  return typeof valor === 'string' && PATRON_ID.test(valor);
}

// Comparación en tiempo constante. Se comparan digests SHA-256 para
// que longitudes distintas no revelen información ni provoquen excepción.
function compararSecreto(recibido, esperado) {
  if (typeof recibido !== 'string' || typeof esperado !== 'string') return false;
  if (recibido.length === 0 || esperado.length === 0) return false;

  const digestRecibido = crypto.createHash('sha256').update(recibido, 'utf8').digest();
  const digestEsperado = crypto.createHash('sha256').update(esperado, 'utf8').digest();

  return crypto.timingSafeEqual(digestRecibido, digestEsperado);
}

// Política de identidad: sólo el usuario autorizado, en chat privado.
// Canales (sin from), grupos y supergrupos quedan fuera.
function mensajeAutorizado(message, usuarioAutorizado) {
  if (!message || typeof message !== 'object') return false;
  if (!message.from || message.from.is_bot) return false;
  if (!message.chat || message.chat.type !== 'private') return false;
  if (message.from.id === undefined || message.from.id === null) return false;
  if (usuarioAutorizado === undefined || usuarioAutorizado === null) return false;

  return String(message.from.id) === String(usuarioAutorizado);
}

// Enmascara credenciales en textos que puedan acabar en logs o errores.
function redactarUrl(texto) {
  if (typeof texto !== 'string' || texto.length === 0) return '(sin detalle)';

  return texto
    // Token del bot en la ruta: /bot<token>/...
    .replace(/\/bot[^/\s?#]*/gi, '/bot<redactado>')
    // Parámetros sensibles en query string
    .replace(/([?&](?:secret_token|token|api_key|apikey|key|access_token)=)[^&\s"']+/gi, '$1<redactado>')
    // Credenciales embebidas en la URL (user:pass@host)
    .replace(/\/\/[^/\s@]+@/g, '//<redactado>@');
}

module.exports = {
  esSecretoValido,
  esIdNumericoValido,
  compararSecreto,
  mensajeAutorizado,
  redactarUrl
};
