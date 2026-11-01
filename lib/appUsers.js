'use strict';

// ═══════════════════════════════════════════════════════════════
// 👥 PERFILES DE LA APP (FASE 2 JUGADORES)
// ═══════════════════════════════════════════════════════════════
// Cada amigo tiene su propio token y su propia clave de
// Intervals.icu. El token se guarda en la app; la clave nunca sale
// del servidor. Los perfiles se declaran en la variable APP_USERS
// (JSON) para no crear tablas nuevas mientras probamos con 2.
//
// Formato:
// [{"token":"...","nombre":"Ana","intervals_api_key":"..."}]
//
// Si falta athlete_id, se pregunta a Intervals.icu (/athlete/0) y
// se usa el id devuelto como user_id de Supabase.
// ═══════════════════════════════════════════════════════════════

const { compararSecreto } = require('./security');

const DEFAULT_BASE_URL = 'https://intervals.icu/api/v1';
const MAX_PERFILES = 20;

function texto(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

function parseAppUsers(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { perfiles: [], error: null };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    return { perfiles: [], error: 'APP_USERS no es JSON válido' };
  }

  if (!Array.isArray(data)) {
    return { perfiles: [], error: 'APP_USERS debe ser una lista' };
  }

  const perfiles = [];
  const errores = [];

  data.slice(0, MAX_PERFILES).forEach((item, indice) => {
    const etiqueta = `perfil ${indice + 1}`;
    if (!item || typeof item !== 'object') {
      errores.push(`${etiqueta}: no es un objeto`);
      return;
    }

    const token = texto(item.token);
    const nombre = texto(item.nombre);
    const intervalsApiKey = texto(item.intervals_api_key || item.api_key);

    if (token.length < 20 || token.length > 256) {
      errores.push(`${etiqueta}: token no válido`);
      return;
    }
    if (!nombre || nombre.length > 40) {
      errores.push(`${etiqueta}: nombre no válido`);
      return;
    }
    if (intervalsApiKey.length < 10) {
      errores.push(`${etiqueta}: falta intervals_api_key`);
      return;
    }

    perfiles.push({
      token,
      nombre,
      intervalsApiKey,
      athleteId: texto(item.athlete_id) || null,
      userId: texto(item.user_id) || null,
      origen: 'env',
    });
  });

  if (data.length > MAX_PERFILES) {
    errores.push(`solo se aceptan ${MAX_PERFILES} perfiles`);
  }

  return { perfiles, error: errores.length > 0 ? errores.join('; ') : null };
}

function construirPerfiles({ legacy = null, raw = '', logger = () => {} } = {}) {
  const { perfiles: extras, error } = parseAppUsers(raw);
  if (error) {
    logger(`[appUsers] ${error}`);
  }

  const perfiles = [];
  const tokens = new Set();
  const usuarios = new Set();

  function add(perfil) {
    if (!perfil || typeof perfil.token !== 'string' || perfil.token.length === 0) {
      return;
    }
    if (tokens.has(perfil.token)) {
      return;
    }
    if (perfil.userId && usuarios.has(perfil.userId)) {
      logger(`[appUsers] perfil duplicado para el usuario ${perfil.userId}; se ignora`);
      return;
    }
    tokens.add(perfil.token);
    if (perfil.userId) usuarios.add(perfil.userId);
    perfiles.push(perfil);
  }

  add(legacy);
  for (const perfil of extras) add(perfil);

  return { perfiles, error };
}

function perfilPorToken(perfiles, token) {
  if (!Array.isArray(perfiles) || typeof token !== 'string' || token.length === 0) {
    return null;
  }
  for (const perfil of perfiles) {
    if (compararSecreto(token, perfil.token)) {
      return perfil;
    }
  }
  return null;
}

/**
 * Pregunta a Intervals.icu quién es el dueño de una API key.
 * No registra la clave ni la cabecera Authorization.
 */
async function resolverAtleta({
  apiKey,
  fetchImpl = globalThis.fetch,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 10000,
} = {}) {
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new Error('Falta la clave de Intervals.icu');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch no disponible');
  }

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  let response;
  try {
    response = await fetchImpl(`${baseUrl}/athlete/0`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(`API_KEY:${apiKey.trim()}`).toString('base64')}`,
        Accept: 'application/json',
      },
      signal: controller ? controller.signal : undefined,
    });
  } catch (error) {
    if (timer) clearTimeout(timer);
    const motivo = error && error.name === 'AbortError' ? 'tiempo de espera agotado' : 'error de red';
    throw new Error(`Intervals.icu: ${motivo}`);
  }
  if (timer) clearTimeout(timer);

  if (!response.ok) {
    throw new Error(`Intervals.icu: HTTP ${response.status}`);
  }

  let data;
  try {
    data = await response.json();
  } catch (_) {
    throw new Error('Intervals.icu: respuesta no válida');
  }

  const athleteId = texto(data && data.id);
  if (!athleteId) {
    throw new Error('Intervals.icu no devolvió el id del atleta');
  }

  return {
    athleteId,
    nombre: texto(data.name) || null,
  };
}

module.exports = {
  parseAppUsers,
  construirPerfiles,
  perfilPorToken,
  resolverAtleta,
};
