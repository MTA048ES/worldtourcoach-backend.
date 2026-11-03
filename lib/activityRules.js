'use strict';

// ═══════════════════════════════════════════════════════════════
// 🚦 REGLAS DE ACTIVIDAD
// ═══════════════════════════════════════════════════════════════
// Una sola definición para toda la app de qué actividad cuenta y
// para qué. Evita que la liga, los récords, las zonas, los logros y
// los segmentos usen filtros distintos.
//
// Reglas de la liga:
//   - Salida válida: bici de carretera/gravel/MTB, 10 min, 3 km y GPS.
//   - Manual: nunca cuenta.
//   - Running: nunca cuenta.
//   - E-bike: cuenta constancia (días/horas), pero no km, desnivel,
//     segmentos, récords ni zonas de potencia.
//   - Rodillo/virtual: solo constancia y remontada; nunca km,
//     desnivel ni segmentos.
// ═══════════════════════════════════════════════════════════════

const MIN_DURACION_S = 600; // 10 min
const MIN_DISTANCIA_M = 3000; // 3 km
const MAX_DURACION_DIA_S = 8 * 3600; // tope de 8 h por día
const MAX_DISTANCIA_DIA_M = 300000; // tope de 300 km por día

function normalizarTipo(tipo) {
  return String(tipo || '').toLowerCase();
}

/** Incluye bici de carretera, gravel, MTB, e-bike y rodillo virtual. */
function esCiclismo(tipo) {
  return /ride|bike|cycl|gravel|mtb|mountain/.test(normalizarTipo(tipo));
}

function esEbike(tipo) {
  return /ebike|e-bike|e_bike|electric/.test(normalizarTipo(tipo));
}

function esRodillo(tipo) {
  return /virtual|indoor|trainer|rodillo/.test(normalizarTipo(tipo));
}

function esManual(actividad = {}) {
  return (
    /manual/.test(normalizarTipo(actividad.tipo)) ||
    normalizarTipo(actividad.origen) === 'manual'
  );
}

function duracionS(actividad = {}) {
  const valor = Number(actividad.duracion_s);
  return Number.isFinite(valor) && valor > 0 ? valor : 0;
}

function distanciaM(actividad = {}) {
  const valor = Number(actividad.distancia_m);
  return Number.isFinite(valor) && valor > 0 ? valor : 0;
}

/**
 * Clasifica una actividad para todos los motores.
 *
 * `cuentaKm` es la salida competitiva: la que puede sumar kilómetros,
 * desnivel, puntos de liga, logros de distancia y segmentos.
 * `cuentaConstancia` es más amplia: incluye e-bike y rodillo siempre
 * que cumplan la duración mínima (y GPS/distancia en el caso de la
 * e-bike). `puedeCrearSegmentos` evita guardar esfuerzos nuevos de
 * actividades que nunca podrán competir.
 */
function clasificarActividad(actividad = {}) {
  const tipo = normalizarTipo(actividad.tipo);
  const ciclismo = esCiclismo(tipo);
  const ebike = esEbike(tipo);
  const rodillo = esRodillo(tipo);
  const manual = esManual(actividad);
  const gps = Boolean(actividad.tiene_gps);
  const duracion = duracionS(actividad);
  const distancia = distanciaM(actividad);

  const exterior = ciclismo && !rodillo && !ebike;
  const base = !manual && duracion >= MIN_DURACION_S;
  const salidaValida = exterior && base && gps && distancia >= MIN_DISTANCIA_M;
  const ebikeValida = ebike && base && gps && distancia >= MIN_DISTANCIA_M;
  const rodilloValido = rodillo && base;
  const constancia = salidaValida || ebikeValida || rodilloValido;

  return {
    tipo,
    esCiclismo: ciclismo,
    esEbike: ebike,
    esRodillo: rodillo,
    esManual: manual,
    esExterior: exterior,
    duracionS: duracion,
    distanciaM: distancia,
    tieneGps: gps,
    // Rendimiento competitivo: km, desnivel y liga.
    cuentaKm: salidaValida,
    // Presencia: días, salidas, horas y remontada.
    cuentaConstancia: constancia,
    // TSS de la salida: no mezclar el motor de la e-bike con el entrenamiento.
    cuentaTss: salidaValida || rodilloValido,
    // Logros de distancia/desnivel: misma regla que la liga.
    cuentaLogros: salidaValida,
    // Solo se guardan esfuerzos nuevos de salidas exteriores con GPS.
    // La duración/distancia se comprueba al puntuar, no al guardar, para
    // no perder el historial personal de tramos cortos.
    puedeCrearSegmentos: exterior && !manual && gps,
  };
}

/**
 * Actividades que pueden aportar una curva de potencia al aire libre.
 * El rodillo solo suma constancia/remontada, así que no entra en
 * récords ni en zonas de potencia.
 */
function esCiclismoPotencia(tipo, actividad = null) {
  if (actividad && esManual(actividad)) return false;
  return esCiclismo(tipo) && !esEbike(tipo) && !esRodillo(tipo);
}

/** ¿Esta actividad puede aportar esfuerzos nuevos a un segmento? */
function puedeCrearSegmentos(actividad = {}) {
  return clasificarActividad(actividad).puedeCrearSegmentos;
}

module.exports = {
  MIN_DURACION_S,
  MIN_DISTANCIA_M,
  MAX_DURACION_DIA_S,
  MAX_DISTANCIA_DIA_M,
  esCiclismo,
  esEbike,
  esRodillo,
  esManual,
  esCiclismoPotencia,
  clasificarActividad,
  puedeCrearSegmentos,
};
