// ═══════════════════════════════════════════════════════════════
// TRAINING NEED — capa de DIAGNÓSTICO (SPEC_V10_F1 §4, F2)
// ═══════════════════════════════════════════════════════════════
// Módulo PURO y testeable: recibe datos explícitos, no depende de
// estado global mutable y NO modifica ningún input (especialmente
// `decision`). No decide, no sustituye, no reprograma: devuelve
// información estructurada para capas posteriores.
//
// REGLAS (entregable F2):
// - NO reconstruye histórico que nunca fue persistido. Las
//   necesidades pendientes y sustituciones solo llegan por input
//   explícito del caller, y SOLO si ese caller dispone de datos
//   persistidos reales (hoy no existe esa persistencia: el caller
//   debe pasar null y el bloque_D queda a cero).
// - Si falta un dato, devuelve `datos_insuficientes` con la lista
//   exacta de lo que falta. Nunca inventa valores ni usa defaults
//   fisiológicos.
// - Distinción real entre:
//     'historico_insuficiente' (TN4): no hay fuente histórica de la
//       semana (contextoSemanal/sesionesSemana === null) → no se
//       puede calcular `calidad_realizadas_semana` (bloque B).
//     'datos_puntuales_incompletos' (TN5): la ventana histórica
//       existe, pero falta algún campo puntual requerido.
//   `sesionesSemana: []` es válido (semana empezada, 0 sesiones);
//   `sesionesSemana: null` significa "no sé" → insuficiente.

// Constantes de clasificación (SPEC_V10_F1 §4.1). Los tipos son los
// reales de decidirEntrenamiento/getAthleteState; el umbral de z2
// largo es la regla "resistencia si z2 largo" del spec, fijada aquí
// como constante nombrada para ser auditable.
const TIPOS_CALIDAD = ['sweetspot', 'ftp', 'vo2'];
const DUR_MIN_RESISTENCIA = 90;
// V10 (decisión aprobada en revisión F2, antes §18.4 del spec): una sesión
// cuenta como calidad realizada con IF real >= 0.80 (la grupeta incluida).
// NO es el umbral legacy de contarSesionesCalidadSemana() (index.js:906,
// intensidad > 0.85), que queda intacto en v9.5 para su propio contador.
const UMBRAL_IF_CALIDAD = 0.80;
const UMBRAL_TSB_RECUPERACION = -10; // spec §4.1: recuperación si tsb<-10

function clasificarObjetivoSesion(decision, tsb) {
  const tipo = decision.tipo;
  if (TIPOS_CALIDAD.includes(tipo)) return 'calidad';
  if (tipo === 'z1' || tipo === 'descanso') return 'recuperacion';
  if (tsb < UMBRAL_TSB_RECUPERACION) return 'recuperacion';
  if (tipo === 'z2' && (decision.durMin || 0) >= DUR_MIN_RESISTENCIA) return 'resistencia';
  return 'base';
}

// Campos puntuales requeridos (spec §4.1/4.2/4.3: ✅). hrv y
// sleep_quality son ⭕ opcionales: su ausencia NO es insuficiencia.
function camposPuntualesRequeridos(i) {
  const faltantes = [];
  if (!i.decision) faltantes.push('decision');
  else {
    if (!i.decision.tipo) faltantes.push('decision.tipo');
    if (!Number.isFinite(i.decision.durMin)) faltantes.push('decision.durMin');
    if (!Number.isFinite(i.decision.intensidad)) faltantes.push('decision.intensidad');
    if (!Number.isFinite(i.decision.tssEsperado)) faltantes.push('decision.tssEsperado');
  }
  if (!i.estado) faltantes.push('estado');
  else {
    for (const c of ['tsb', 'ctl', 'atl', 'acwr', 'readiness', 'weeklyTss']) {
      if (!Number.isFinite(i.estado[c])) faltantes.push(`estado.${c}`);
    }
    if (!i.estado.dataQuality) faltantes.push('estado.dataQuality');
  }
  if (!i.contextoSemanal) faltantes.push('contextoSemanal');
  else {
    if (!Number.isFinite(i.contextoSemanal.tssObjetivo)) faltantes.push('contextoSemanal.tssObjetivo');
    if (!Number.isFinite(i.contextoSemanal.calidadMax)) faltantes.push('contextoSemanal.calidadMax');
  }
  return faltantes;
}

function fuenteHistoricaSemanalInsuficiente(i) {
  if (!i.contextoSemanal) return true;
  // null = "no dispongo del histórico de la semana" → no computable.
  // [] = "semana empezada, 0 sesiones registradas" → válido.
  if (!Array.isArray(i.contextoSemanal.sesionesSemana)) return true;
  return false;
}

function restriccionesActivas(restricciones) {
  const activas = [];
  if (!restricciones) return activas;
  if (restricciones.forzarDescanso) activas.push('forzarDescanso');
  if (restricciones.prohibirIntensidad) activas.push('prohibirIntensidad');
  if (restricciones.forzarZ2) activas.push('forzarZ2');
  if (Number.isFinite(restricciones.intensidadMax) && restricciones.intensidadMax < 1) {
    activas.push(`intensidadMax:${restricciones.intensidadMax}`);
  }
  return activas;
}

function calcularTrainingNeed(inputs) {
  const i = inputs || {};
  const salida = {
    fecha: i.fecha || null,
    estado_calculo: null,          // 'necesidad_detectada' | 'sin_necesidad' | 'datos_insuficientes'
    tipo_insuficiencia: null,      // 'historico_insuficiente' | 'datos_puntuales_incompletos'
    datos_faltantes: [],
    training_need: null,
    diagnostico: '',
    fuentes: {
      decision: 'input del caller (decisión congelada/actual, solo lectura)',
      estado: 'input del caller (salida de calcularEstadoSistema)',
      contextoSemanal: 'input del caller (getTssObjetivoSemanal/getMaxSesionesCalidad/historial semana)',
      bloque_D: 'input del caller; SOLO datos persistidos. Hoy no existe persistencia de sustituciones → null→0'
    }
  };

  // ── Validaciones ──────────────────────────────────────────────
  const historicoInsuficiente = fuenteHistoricaSemanalInsuficiente(i);
  const faltantesPuntuales = camposPuntualesRequeridos(i);
  salida.datos_faltantes = [
    ...(historicoInsuficiente ? ['contextoSemanal.sesionesSemana (histórico semanal no disponible)'] : []),
    ...faltantesPuntuales
  ];

  if (historicoInsuficiente) {
    salida.estado_calculo = 'datos_insuficientes';
    salida.tipo_insuficiencia = 'historico_insuficiente';
    salida.diagnostico = 'No hay fuente histórica semanal disponible: no es posible calcular calidad_realizadas_semana. No se reconstruye histórico.';
    return salida;
  }
  if (faltantesPuntuales.length > 0 || (i.estado && i.estado.dataQuality === 'NO_DISPONIBLE')) {
    if (i.estado && i.estado.dataQuality === 'NO_DISPONIBLE' && !faltantesPuntuales.includes('estado.dataQuality')) {
      salida.datos_faltantes.push('estado.dataQuality=NO_DISPONIBLE');
    }
    salida.estado_calculo = 'datos_insuficientes';
    salida.tipo_insuficiencia = 'datos_puntuales_incompletos';
    salida.diagnostico = 'Ventana histórica disponible pero faltan campos puntuales requeridos. No se fabrican valores.';
    return salida;
  }

  // ── Bloque A: sesión solicitada (solo lectura de decision) ────
  const objetivoSesion = clasificarObjetivoSesion(i.decision, i.estado.tsb);
  const bloqueA = {
    tipo_solicitado: i.decision.tipo,
    intensidad_solicitada_if: i.decision.intensidad,
    duracion_solicitada_min: i.decision.durMin,
    tss_objetivo: i.decision.tssEsperado,
    objetivo_sesion: objetivoSesion,
    es_sesion_calidad: objetivoSesion === 'calidad'
  };

  // ── Bloque B: contexto semanal ────────────────────────────────
  const sesionesSemana = i.contextoSemanal.sesionesSemana;
  const calidadRealizadas = sesionesSemana.filter(
    s => (s && Number.isFinite(s.intensidad) ? s.intensidad : 0) >= UMBRAL_IF_CALIDAD
  ).length;
  const tssRestante = i.contextoSemanal.tssObjetivo - i.estado.weeklyTss - bloqueA.tss_objetivo;
  const bloqueB = {
    tss_semanal_actual: i.estado.weeklyTss,
    tss_semanal_objetivo: i.contextoSemanal.tssObjetivo,
    tss_semanal_restante: tssRestante,
    calidad_realizadas_semana: calidadRealizadas,
    calidad_max_semana: i.contextoSemanal.calidadMax,
    // Limitación documentada: no existe plan futuro persistido →
    // programadas restantes = 0. Pendiente = margen restante.
    calidad_pendiente_semana: Math.max(0, i.contextoSemanal.calidadMax - calidadRealizadas)
  };

  // ── Bloque C: estado fisiológico y seguridad (snapshot) ───────
  const bloqueC = {
    tsb: i.estado.tsb,
    ctl: i.estado.ctl,
    atl: i.estado.atl,
    acwr: i.estado.acwr,
    readiness: i.estado.readiness,
    hrv: Number.isFinite(i.estado.hrv) ? i.estado.hrv : null,
    sleep_quality: Number.isFinite(i.estado.sleepQuality) ? i.estado.sleepQuality : null,
    restricciones_activas: restriccionesActivas(i.restricciones),
    data_quality: i.estado.dataQuality
  };

  // ── Bloque D: SOLO necesidades persistidas explícitas ─────────
  const pendientes = Array.isArray(i.necesidadesPendientes) ? i.necesidadesPendientes : [];
  const sustituciones = Array.isArray(i.sustitucionesSemana) ? i.sustitucionesSemana : [];
  const bloqueD = {
    sustituciones_semana_total: sustituciones.length,
    sustituciones_semana_calidad: sustituciones.filter(s => s && s.es_calidad === true).length,
    rechazos_consecutivos_similares: Number.isFinite(i.rechazosConsecutivosSimilares) ? i.rechazosConsecutivosSimilares : 0,
    necesidades_pendientes: pendientes
  };

  // ── Diagnóstico (NO decisión) ─────────────────────────────────
  const huecoCalidad = bloqueA.es_sesion_calidad && bloqueB.calidad_realizadas_semana < bloqueB.calidad_max_semana;
  const detectada = huecoCalidad || i.estado.tsb < UMBRAL_TSB_RECUPERACION || pendientes.length > 0;
  salida.estado_calculo = detectada ? 'necesidad_detectada' : 'sin_necesidad';
  salida.training_need = { bloque_A: bloqueA, bloque_B: bloqueB, bloque_C: bloqueC, bloque_D: bloqueD };
  salida.diagnostico = detectada
    ? (huecoCalidad ? 'Necesidad de calidad: margen semanal disponible'
        : i.estado.tsb < UMBRAL_TSB_RECUPERACION ? `Necesidad de recuperación: tsb<${UMBRAL_TSB_RECUPERACION}`
        : 'Necesidad pendiente de días previos (datos persistidos)')
    : 'Sin necesidad destacable según estado y contexto actuales';
  return salida;
}

module.exports = { calcularTrainingNeed, TIPOS_CALIDAD, DUR_MIN_RESISTENCIA, UMBRAL_IF_CALIDAD, UMBRAL_TSB_RECUPERACION };
