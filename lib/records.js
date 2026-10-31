'use strict';

// ═══════════════════════════════════════════════════════════════
// ⚡ RÉCORDS DE POTENCIA (CURVA DE POTENCIA DEL HISTORIAL)
// ═══════════════════════════════════════════════════════════════
// Para cada duración estándar (5 s … 60 min) busca la mejor media de
// potencia en todas las trazas guardadas. Es lo que Strava llama
// "Best Efforts" y TrainingPeaks/Intervals "Power Curve".
//
// Se calcula al vuelo con sumas prefijas (O(muestras × ventanas)) y se
// cachea en memoria unos minutos: la primera consulta tarda unos
// segundos, las siguientes son instantáneas.
// ═══════════════════════════════════════════════════════════════

const VENTANAS_S = [5, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600];

/** Solo bicicleta: la potencia de carrera (estimada por el reloj) distorsiona la curva. */
function esCiclismo(tipo) {
  return /ride|bike|cycl/i.test(String(tipo || ''));
}

/**
 * Mejor media de potencia de una traza para cada ventana.
 * Devuelve un objeto { [segundos]: vatios } o null si no hay potencia.
 */
function mejoresDeTrack(track, ventanas = VENTANAS_S) {
  const n = track && Array.isArray(track.t) ? track.t.length : 0;
  if (!track || !track.hasPower || n < 10) return null;

  // Sumas y validez prefijas: cualquier media sale en O(1).
  const suma = new Float64Array(n + 1);
  const validas = new Int32Array(n + 1);
  for (let i = 0; i < n; i += 1) {
    const valor = track.p[i];
    const ok = valor !== null && Number.isFinite(valor) && valor >= 0;
    suma[i + 1] = suma[i] + (ok ? valor : 0);
    validas[i + 1] = validas[i] + (ok ? 1 : 0);
  }

  const totalSec = track.t[n - 1] - track.t[0];
  if (!(totalSec > 0)) return null;
  const dt = totalSec / (n - 1) || 1;

  const salida = {};
  for (const ventana of ventanas) {
    if (ventana > totalSec) continue;
    const count = Math.max(1, Math.round(ventana / dt));
    if (count > n) continue;

    let mejor = 0;
    for (let inicio = 0; inicio + count <= n; inicio += 1) {
      if (validas[inicio + count] - validas[inicio] !== count) continue;
      const media = (suma[inicio + count] - suma[inicio]) / count;
      if (media > mejor) mejor = media;
    }
    if (mejor > 0) salida[ventana] = Math.round(mejor);
  }

  return Object.keys(salida).length > 0 ? salida : null;
}

function crearServicioRecords({ repository, codec, cacheMs = 10 * 60 * 1000, logger = () => {} }) {
  let cache = null;
  let cacheadoEn = 0;

  async function calcular() {
    // Metadatos de las actividades (nombre, fecha, tipo) para acompañar al récord.
    const actividades = new Map();
    for (let offset = 0; offset <= 20000; offset += 200) {
      const lote = await repository.listActivities({ limit: 200, offset });
      for (const actividad of lote) actividades.set(actividad.actividad_id, actividad);
      if (lote.length < 200) break;
    }

    const mejores = new Map();
    let salidas = 0;

    for await (const filas of repository.iterateTracks({ pageSize: 20 })) {
      for (const fila of filas) {
        const actividad = actividades.get(fila.actividad_id) || {};
        if (!esCiclismo(actividad.tipo)) continue;

        let track = null;
        try {
          track = codec.decodeTrack(fila.datos);
        } catch (error) {
          logger(`[records] traza ${fila.actividad_id}: ${error.message}`);
          continue;
        }
        if (!track) continue;

        const esfuerzos = mejoresDeTrack(track);
        if (!esfuerzos) continue;
        salidas += 1;

        for (const [ventana, potencia] of Object.entries(esfuerzos)) {
          const previo = mejores.get(Number(ventana));
          if (previo && previo.potencia >= potencia) continue;
          mejores.set(Number(ventana), {
            duracion_s: Number(ventana),
            potencia,
            actividad_id: fila.actividad_id,
            nombre: actividad.nombre ?? null,
            fecha: actividad.fecha ?? null,
            tipo: actividad.tipo ?? null,
          });
        }
      }
    }

    return {
      records: [...mejores.values()].sort((a, b) => a.duracion_s - b.duracion_s),
      salidas,
    };
  }

  async function getRecords({ refresh = false } = {}) {
    const ahora = Date.now();
    if (!refresh && cache && ahora - cacheadoEn < cacheMs) {
      return {
        records: cache.records,
        salidas: cache.salidas,
        actualizado: new Date(cacheadoEn).toISOString(),
        cacheado: true,
      };
    }

    const { records, salidas } = await calcular();
    cache = { records, salidas };
    cacheadoEn = ahora;
    return { records, salidas, actualizado: new Date(cacheadoEn).toISOString(), cacheado: false };
  }

  return { getRecords, calcular };
}

module.exports = { crearServicioRecords, mejoresDeTrack, VENTANAS_S };
