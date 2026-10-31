'use strict';

// ═══════════════════════════════════════════════════════════════
// 🔌 CLIENTE DE INTERVALS.ICU
// ═══════════════════════════════════════════════════════════════
// Basic auth con usuario literal "API_KEY" y la clave como password.
// Límites documentados de la API: 10 peticiones/s por IP, 2.500 por
// ventana de 15 minutos y 5.000 al día. Se aplica un intervalo mínimo
// entre peticiones y se reintenta una vez ante 429 respetando
// Retry-After.
//
// El `fetch` es inyectable para poder probar sin red.
// ═══════════════════════════════════════════════════════════════

const DEFAULT_BASE_URL = 'https://intervals.icu/api/v1';
const DEFAULT_MIN_INTERVAL_MS = 130;
const DEFAULT_TIMEOUT_MS = 20000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeStatus(status) {
  if (status === 401 || status === 403) return 'credenciales de Intervals.icu rechazadas';
  if (status === 404) return 'recurso no encontrado en Intervals.icu';
  if (status === 429) return 'límite de peticiones de Intervals.icu alcanzado';
  return `Intervals.icu respondió HTTP ${status}`;
}

function createIntervalsClient(options = {}) {
  const {
    apiKey,
    athleteId,
    fetchImpl = globalThis.fetch,
    baseUrl = DEFAULT_BASE_URL,
    minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    logger = () => {},
    now = () => Date.now(),
  } = options;

  if (!apiKey) throw new Error('Falta INTERVALS_API_KEY');
  if (!athleteId) throw new Error('Falta ATHLETE_ID');
  if (typeof fetchImpl !== 'function') throw new Error('fetch no disponible');

  const auth = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`;
  let lastRequestAt = 0;

  async function throttle() {
    const elapsed = now() - lastRequestAt;
    if (elapsed < minIntervalMs) {
      await sleep(minIntervalMs - elapsed);
    }
    lastRequestAt = now();
  }

  async function request(path, { raw = false, retries = 1, allow404 = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      await throttle();

      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

      let response;
      try {
        response = await fetchImpl(`${baseUrl}${path}`, {
          method: 'GET',
          headers: {
            Authorization: auth,
            Accept: raw ? '*/*' : 'application/json',
          },
          signal: controller ? controller.signal : undefined,
        });
      } catch (error) {
        if (timer) clearTimeout(timer);
        const reason = error && error.name === 'AbortError' ? 'tiempo de espera agotado' : 'error de red';
        throw new Error(`Intervals.icu: ${reason} al pedir ${path}`);
      }
      if (timer) clearTimeout(timer);

      if (response.status === 429 && attempt < retries) {
        const retryAfter = Number(response.headers && response.headers.get && response.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : 2000;
        logger(`[intervals] 429 en ${path}; reintento en ${Math.round(waitMs / 1000)} s`);
        await sleep(Math.min(waitMs, 30000));
        continue;
      }

      if (!response.ok) {
        if (allow404 && response.status === 404) {
          return null;
        }
        throw new Error(`Intervals.icu: ${describeStatus(response.status)} (${path})`);
      }

      if (raw) {
        return response;
      }

      try {
        return await response.json();
      } catch (_) {
        throw new Error(`Intervals.icu: respuesta no válida en ${path}`);
      }
    }
  }

  // Actividades de un rango de fechas locales (yyyy-MM-dd).
  async function listActivities({ oldest, newest, limit } = {}) {
    const query = new URLSearchParams();
    if (oldest) query.set('oldest', oldest);
    if (newest) query.set('newest', newest);
    if (limit) query.set('limit', String(limit));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const data = await request(`/athlete/${encodeURIComponent(athleteId)}/activities${suffix}`);
    return Array.isArray(data) ? data : [];
  }

  async function getActivity(activityId) {
    return request(`/activity/${encodeURIComponent(activityId)}`);
  }

  // Streams por segundo de una actividad.
  async function getStreams(activityId, types) {
    const suffix = types && types.length > 0 ? `?types=${types.join(',')}` : '';
    return request(`/activity/${encodeURIComponent(activityId)}/streams.json${suffix}`);
  }

  /**
   * Esfuerzos de segmentos de Strava de una actividad tal como los ve
   * Intervals: { id, name, segment_id, start_index, end_index, starred }.
   * Devuelve [] si la actividad no tiene segmentos.
   */
  async function getActivitySegments(activityId) {
    const data = await request(
      `/activity/${encodeURIComponent(activityId)}/segments`,
      { allow404: true },
    );
    return Array.isArray(data) ? data : [];
  }

  return { listActivities, getActivity, getStreams, getActivitySegments };
}

// Campos de una actividad de Intervals normalizados para la app.
function normalizeActivity(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? raw.activity_id ?? '').trim();
  if (!id) return null;

  const fecha = raw.start_date_local ?? raw.start_date ?? null;
  if (!fecha || Number.isNaN(new Date(fecha).getTime())) return null;

  const numero = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  // Intervals.icu devuelve medias con decimales (cadencia 79.04113,
  // potencia 149.7) y las columnas enteras de Supabase rechazan la fila
  // entera por un solo decimal. Todo lo que va a una columna integer se
  // redondea aquí.
  const entero = (value) => {
    const num = numero(value);
    return num === null ? null : Math.round(num);
  };

  return {
    actividad_id: id,
    fecha,
    tipo: typeof raw.type === 'string' ? raw.type : null,
    nombre: typeof raw.name === 'string' ? raw.name.slice(0, 120) : null,
    duracion_s: entero(raw.moving_time) ?? entero(raw.elapsed_time),
    distancia_m: entero(raw.distance ?? raw.icu_distance),
    desnivel_m: entero(raw.total_elevation_gain),
    pot_media: entero(raw.average_watts ?? raw.icu_average_watts),
    pot_max: entero(raw.max_watts),
    np: entero(raw.icu_weighted_avg_watts ?? raw.weighted_average_watts),
    fc_media: entero(raw.average_heartrate),
    fc_max: entero(raw.max_heartrate),
    cadencia_media: entero(raw.average_cadence),
    velocidad_media: numero(raw.average_speed),
    tss: numero(raw.icu_training_load),
  };
}

module.exports = {
  createIntervalsClient,
  normalizeActivity,
  DEFAULT_BASE_URL,
};
