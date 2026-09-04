// ═══════════════════════════════════════════════════════════════
// 🔒 GATE FINAL DE SEGURIDAD — F2 (SPEC_V10_F1 §10)
// ═══════════════════════════════════════════════════════════════
// Regla (SPEC_V10_F1 §10.2): NINGUNA capa posterior puede invalidar
// una restricción de seguridad establecida por resolverConflictos()
// sin volver a pasar por la jerarquía de seguridad.
//
// Este gate RE-EJECUTA los chequeos de seguridad existentes de v9.5
// (extracción, no lógica nueva). Umbrales sin cambios:
//   - resolverConflictos() NIVEL 1: TSB<-30 / readiness<30 / ACWR>1.5
//   - resolverConflictos() NIVEL 2: Heat Index >40
//   - resolverConflictos() NIVEL 3: TSB<-20 → duración máx 45 min
//   - decidirEntrenamiento(): forzarZ2 (IF máx 0.70, durMin ×0.8),
//     intensidadMax + cadena de downgrade vo2→ftp→sweetspot→z2
//
// Se invoca DESPUÉS de adaptarDecisionParaIntencion() y
// ajustarPlanAutomaticamente(), y ANTES de generateWorkout().

function validarSeguridad(decision, estado, restricciones) {
  if (!decision || typeof decision !== 'object') return decision;

  const resultado = JSON.parse(JSON.stringify(decision));
  const reglas = [];
  estado = estado || {};
  restricciones = restricciones || {};

  // Las decisiones de descanso no se modifican.
  if (resultado.tipo === 'descanso') return resultado;

  const esDescanso = (motivo) => ({
    tipo: 'descanso',
    reps: 0,
    durMin: 0,
    recSec: 0,
    intensidad: 0,
    override: true,
    motivo: (resultado.motivo || '') + ` | 🔒 Gate seguridad: ${motivo}`
  });

  // ─── NIVEL 1: SEGURIDAD (resolverConflictos 2513-2539, 2960-2970) ─
  if (typeof estado.tsb === 'number' && estado.tsb < -30) {
    return esDescanso(`TSB extremo (${estado.tsb.toFixed(1)}) - Descanso obligatorio`);
  }
  if (typeof estado.readiness === 'number' && estado.readiness < 30) {
    return esDescanso(`Readiness muy bajo (${estado.readiness}/100) - Descanso obligatorio`);
  }
  if (restricciones.forzarDescanso) {
    return esDescanso('Descanso obligatorio por restricciones globales');
  }

  // ─── NIVEL 2: CLIMA EXTREMO (resolverConflictos 2554) ─────────────
  if (typeof estado.heatIndex === 'number' && estado.heatIndex > 40) {
    return esDescanso(`Heat Index ${estado.heatIndex}°C - Descanso obligatorio`);
  }

  // ─── NIVEL 1: ACWR crítico (resolverConflictos 2541-2551) ────────
  // Cap duro: z2 / durMin ≤ 25 / IF ≤ 0.60 / 1 rep.
  if (typeof estado.acwr === 'number' && estado.acwr > 1.5) {
    if (resultado.tipo !== 'z2' || (resultado.durMin || 0) > 25 ||
        (resultado.intensidad || 0) > 0.60) {
      resultado.tipo = 'z2';
      resultado.durMin = Math.min(resultado.durMin || 30, 25);
      resultado.intensidad = Math.min(resultado.intensidad || 0.60, 0.60);
      resultado.reps = 1;
      resultado.recSec = 0;
      reglas.push(`ACWR crítico (${estado.acwr.toFixed(2)}) - Reducción obligatoria z2/25min/0.60`);
    }
  }

  // ─── NIVEL 3: FATIGA AGUDA - cap de duración (resolverConflictos 2621-2624) ─
  if (typeof estado.tsb === 'number' && estado.tsb < -20) {
    if ((resultado.durMin || 0) > 45) {
      resultado.durMin = 45;
      reglas.push('TSB < -20 - Duración máxima 45 min');
    }
  }

  // ─── RESTRICCIONES: forzarZ2 / prohibirIntensidad (decidirEntrenamiento 3167-3174) ─
  if ((restricciones.forzarZ2 || restricciones.prohibirIntensidad) && resultado.tipo !== 'z1') {
    if (resultado.tipo !== 'z2' || (resultado.intensidad || 0) > 0.70 || (resultado.reps || 1) > 1) {
      resultado.tipo = 'z2';
      resultado.intensidad = Math.min(0.70, resultado.intensidad || 0.65);
      resultado.reps = 1;
      resultado.recSec = 0;
      reglas.push(restricciones.prohibirIntensidad
        ? 'Intensidad prohibida - Forzado a z2'
        : 'Forzado a z2 por restricciones globales');
    }
  }

  // ─── RESTRICCIONES: intensidadMax + downgrade (decidirEntrenamiento 3176-3184) ─
  const maxInt = restricciones.intensidadMax;
  if (typeof maxInt === 'number' && maxInt < 1.0 &&
      typeof resultado.intensidad === 'number' && resultado.intensidad > maxInt) {
    resultado.intensidad = maxInt;
    if (resultado.tipo === 'vo2' && maxInt < 1.05) resultado.tipo = 'ftp';
    if (resultado.tipo === 'ftp' && maxInt < 0.92) resultado.tipo = 'sweetspot';
    if (resultado.tipo === 'sweetspot' && maxInt < 0.82) resultado.tipo = 'z2';
    reglas.push(`Intensidad limitada a ${maxInt} por restricciones globales`);
  }

  if (reglas.length > 0) {
    resultado.motivo = (resultado.motivo || '') + ` | 🔒 Gate seguridad: ${reglas.join('; ')}`;
    resultado.gateSeguridad = reglas;
  }
  return resultado;
}

module.exports = { validarSeguridad };
