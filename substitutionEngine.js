// ═══════════════════════════════════════════════════════════════
// 🔄 SUBSTITUTION ENGINE (F2) — SPEC_V10_F1 §7 + decisiones aprobadas
// ═══════════════════════════════════════════════════════════════
// Capa de EVALUACIÓN de sustituciones. NO es una capa de seguridad:
// no duplica reglas fisiológicas (ACWR/TSB/readiness/HRV/sueño/calor/
// intensidadMax/forzarDescanso/forzarZ2 — pertenecen a validarSeguridad).
//
// Flujo arquitectónico obligatorio (SPEC_V10_F1 §1, §8):
//   decisión candidata → Substitution Engine → validarSeguridad() → generateWorkout()
// El motor solo EVALÚA (equivalencia, ±30% TSS, límite semanal).
// El gate de seguridad lo ejecuta el caller sobre el candidato aceptado.
//
// Decisiones aprobadas (§18, documentadas en el spec):
//   D-18.2  ±30% del TSS previsto (inclusive). Fuera de rango → NO VÁLIDO.
//   D-18.3  Máximo 3 sustituciones/semana. La 4.ª se RECHAZA SIEMPRE,
//           incluido el descanso espontáneo.
//   D-18.4  Grupeta cuenta como calidad con IF >= 0.80 (no el >0.85 legacy).
//   D-18.5  Descanso espontáneo = MISMO flujo, con excepción explícita:
//           el chequeo ±30% TSS y la equivalencia plan→plan NO se aplican
//           cuando candidato.tipo === 'descanso' (TSS=0 haría imposible
//           sustituir cualquier sesión con carga). Sí respeta el límite
//           semanal y DEBE pasar por validarSeguridad() después.
//   Equivalencia plan→plan por clase funcional de objetivo_sesion (§4.1),
//           aprobada en revisión F2; EQUIVALENCIAS[].equivalenciaPlan se
//           conserva para intenciones. No se inventan otras equivalencias.
//
// SIN PERSISTENCIA (decisión aprobada): el contador semanal llega como
// input explícito del caller. Si el caller no dispone del dato (no existe
// registro_sustituciones), el motor NO inventa contador ni reconstruye
// histórico: devuelve 'dependencia_persistencia'.

const { EQUIVALENCIAS } = require('./motorIntencion.js');

const LIMITE_SUSTITUCIONES_SEMANA = 3;   // D-18.3
const UMBRAL_IF_CALIDAD = 0.80;          // D-18.4 (idéntico a trainingNeed.js:37)

// Clases funcionales plan→plan (aprobadas): tipos de un mismo
// objetivo_sesion son equivalentes entre sí para el motor.
const CLASES_FUNCIONALES = {
  calidad:      ['sweetspot', 'ftp', 'vo2'],
  base:         ['z2', 'z3'],
  recuperacion: ['z1'],
  descanso:     ['descanso']
};

function claseDe(tipo) {
  if (typeof tipo !== 'string') return null;
  for (const [objetivo, tipos] of Object.entries(CLASES_FUNCIONALES)) {
    if (tipos.includes(tipo)) return objetivo;
  }
  return null; // intención (grupeta/rodillo/salida_tranquila) o desconocido
}

// Equivalencia prevista→candidata. Reglas (sin inventar fisiología):
//  a) ambos son tipos de plan → misma clase funcional;
//  b) candidato es intención → su EQUIVALENCIAS.equivalenciaPlan
//     incluye el tipo previsto;
//  c) previsto es intención y candidato es plan → la clase del candidato
//     interseca el equivalenciaPlan de esa intención en EQUIVALENCIAS;
//  d) ambos intencionales → solo si son el mismo tipo.
function esEquivalente(tipoPrevisto, tipoCandidato) {
  const clasePrev = claseDe(tipoPrevisto);
  const claseCand = claseDe(tipoCandidato);
  if (clasePrev && claseCand) return clasePrev === claseCand;
  if (!clasePrev && claseCand) {
    const tiposClase = CLASES_FUNCIONALES[claseCand];
    const entry = Object.entries(EQUIVALENCIAS || {})
      .find(([clave]) => clave === tipoPrevisto);
    return !!entry && (entry[1].equivalenciaPlan || [])
      .some(t => tiposClase.includes(t));
  }
  if (clasePrev && !claseCand) {
    const entry = EQUIVALENCIAS && EQUIVALENCIAS[tipoCandidato];
    return !!entry && (entry.equivalenciaPlan || []).includes(tipoPrevisto);
  }
  return tipoPrevisto === tipoCandidato;
}

// TSS del candidato (la decisión de resolverConflictos no lleva TSS; el
// caller aporta tssEsperado|tss de cada sesión).
function tssDe(sesion) {
  if (!sesion || typeof sesion !== 'object') return null;
  if (Number.isFinite(sesion.tssEsperado)) return sesion.tssEsperado;
  if (Number.isFinite(sesion.tss)) return sesion.tss;
  return null;
}

/**
 * evaluarSustitucion({ sesionPrevista, candidato, sustitucionesSemana, trainingNeed })
 * Inputs EXPLÍCITOS, sin estado global ni persistencia. Devuelve objeto NUEVO;
 * nunca muta entradas. NO ejecuta validarSeguridad(): es responsabilidad del
 * caller sobre decision_sustituta (flujo §1 del spec).
 */
function evaluarSustitucion({ sesionPrevista, candidato, sustitucionesSemana, trainingNeed } = {}) {
  // Propagación de insuficiencia de datos de Training Need (si se aporta).
  if (trainingNeed && trainingNeed.estado_calculo === 'datos_insuficientes') {
    return {
      estado: 'datos_insuficientes',
      motivo: 'Training Need reportó datos insuficientes; no se evalúa la sustitución',
      tipo_insuficiencia: trainingNeed.tipo_insuficiencia || null,
      datos_faltantes: trainingNeed.datos_faltantes || [],
      decision_sustituta: null
    };
  }

  // D-18.3 / dependencia de persistencia: sin contador explícito NO se
  // inventa (S10).
  if (!Number.isFinite(sustitucionesSemana)) {
    return {
      estado: 'dependencia_persistencia',
      motivo: 'sustitucionesSemana no disponible: requiere registro_sustituciones (entregable F2 posterior). No se reconstruye histórico ni se inventa contador',
      decision_sustituta: null
    };
  }
  // 4.ª sustitución RECHAZADA SIEMPRE, incluido descanso espontáneo (S5).
  if (sustitucionesSemana >= LIMITE_SUSTITUCIONES_SEMANA) {
    return {
      estado: 'rechazada',
      motivo: `Límite semanal alcanzado (${sustitucionesSemana}/${LIMITE_SUSTITUCIONES_SEMANA}). La ${sustitucionesSemana + 1}ª sustitución se rechaza siempre, incluido el descanso espontáneo (D-18.3)`,
      decision_sustituta: null
    };
  }

  if (!sesionPrevista || !candidato || typeof sesionPrevista !== 'object' || typeof candidato !== 'object' || !sesionPrevista.tipo || !candidato.tipo) {
    return { estado: 'rechazada', motivo: 'sesionPrevista o candidato inválidos', decision_sustituta: null };
  }

  // Excepción D-18.5: el candidato descanso NO exige TSS propio, ni
  // equivalencia plan→plan, ni ±30% (TSS=0 lo haría imposible). Sí respeta
  // el límite semanal (ya comprobado arriba) y pasará por el gate después.
  if (candidato.tipo === 'descanso') {
    return construirDecisionSustituta({ sesionPrevista, candidato, tssPrevisto: tssDe(sesionPrevista), tssCandidato: 0, esDescanso: true });
  }

  const tssPrevisto = tssDe(sesionPrevista);
  const tssCandidato = tssDe(candidato);
  if (!Number.isFinite(tssPrevisto) || !Number.isFinite(tssCandidato)) {
    return {
      estado: 'datos_insuficientes',
      motivo: 'Falta TSS (tssEsperado|tss) de la sesión prevista o del candidato; no se fabrica',
      datos_faltantes: [!Number.isFinite(tssPrevisto) ? 'sesionPrevista.tssEsperado' : null,
                        !Number.isFinite(tssCandidato) ? 'candidato.tssEsperado' : null].filter(Boolean),
      decision_sustituta: null
    };
  }
  return evaluarCarga({ sesionPrevista, candidato, tssPrevisto, tssCandidato });
}

// D-18.4: ¿el candidato computa como calidad realizada? Tipos de clase
// 'calidad' siempre; grupeta solo con IF >= 0.80 (no el >0.85 legacy).
// Sin IF determinable en una grupeta → null (desconocido, no inventado).
function computaComoCalidad(candidato) {
  const clase = claseDe(candidato.tipo);
  if (clase === 'calidad') return true;
  if (clase) return false;
  if (candidato.tipo === 'grupeta') {
    return Number.isFinite(candidato.intensidad) ? candidato.intensidad >= UMBRAL_IF_CALIDAD : null;
  }
  return false;
}

// Chequeo de carga para candidatos NO-descanso: equivalencia + ±30% TSS.
function evaluarCarga({ sesionPrevista, candidato, tssPrevisto, tssCandidato }) {
  if (!esEquivalente(sesionPrevista.tipo, candidato.tipo)) {
    return {
      estado: 'rechazada',
      motivo: `Sin equivalencia: previsto '${sesionPrevista.tipo}' vs candidato '${candidato.tipo}' (clases funcionales §4.1 + EQUIVALENCIAS)`,
      decision_sustituta: null
    };
  }
  const desviacionPct = ((tssCandidato - tssPrevisto) / tssPrevisto) * 100;
  // D-18.2: ±30% inclusive. Fuera de rango → NO VÁLIDO, sin redondeos.
  if (Math.abs(desviacionPct) > 30) {
    return {
      estado: 'no_valida',
      motivo: `TSS candidato ${tssCandidato} vs previsto ${tssPrevisto}: desviación ${desviacionPct.toFixed(1)}% fuera de ±30% (D-18.2)`,
      decision_sustituta: null
    };
  }
  return construirDecisionSustituta({ sesionPrevista, candidato, tssPrevisto, tssCandidato, esDescanso: false });
}

// Construye la decisión sustituta como objeto NUEVO (copia profunda del
// candidato + metadatos de sustitución). NO muta ninguna entrada (S8).
// La decisión devuelta AÚN DEBE pasar por validarSeguridad() (S9): el motor
// no aplica reglas fisiológicas.
function construirDecisionSustituta({ sesionPrevista, candidato, tssPrevisto, tssCandidato, esDescanso }) {
  const decision = JSON.parse(JSON.stringify(candidato));
  const desviacionPct = Number.isFinite(tssPrevisto) && tssPrevisto > 0
    ? ((tssCandidato - tssPrevisto) / tssPrevisto) * 100
    : null;
  decision.sustitucion = {
    tipo_previsto: sesionPrevista.tipo,
    tipo_candidato: candidato.tipo,
    es_descanso_espontaneo: esDescanso,
    excepcion_carga_aplicada: esDescanso,
    tss_previsto: tssPrevisto,
    tss_candidato: tssCandidato,
    desviacion_tss_pct: desviacionPct === null ? null : Number(desviacionPct.toFixed(1)),
    computa_como_calidad: esDescanso ? false : computaComoCalidad(candidato),
    umbral_if_calidad: UMBRAL_IF_CALIDAD
  };
  decision.motivo = (decision.motivo ? decision.motivo + ' | ' : '')
    + (esDescanso
      ? '🔄 Sustitución: descanso espontáneo (excepción ±30% TSS, D-18.5). Pendiente de validarSeguridad()'
      : `🔄 Sustitución de '${sesionPrevista.tipo}' (${desviacionPct.toFixed(1)}% TSS). Pendiente de validarSeguridad()`);
  return {
    estado: 'aceptada',
    motivo: esDescanso
      ? 'Descanso espontáneo aceptado como candidata (excepción D-18.5); pendiente de validarSeguridad()'
      : 'Sustitución aceptada como candidata (equivalencia + ±30% TSS); pendiente de validarSeguridad()',
    decision_sustituta: decision
  };
}

module.exports = {
  evaluarSustitucion,
  computaComoCalidad,
  esEquivalente,
  claseDe,
  CLASES_FUNCIONALES,
  LIMITE_SUSTITUCIONES_SEMANA,
  UMBRAL_IF_CALIDAD
};
