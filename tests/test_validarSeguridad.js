// ═══════════════════════════════════════════════════════════════
// 🧪 TESTS — validarSeguridad() (F2, SPEC_V10_F1 §10 + §13 DoD #4)
// Ejecutar: node tests/test_validarSeguridad.js
// Sin framework: el proyecto no tiene ninguno instalado.
// ═══════════════════════════════════════════════════════════════
const assert = require('assert');
const { validarSeguridad } = require('../seguridad');
const motorIntencion = require('../motorIntencion');

let pasados = 0;
let fallados = 0;

function test(nombre, fn) {
  try {
    fn();
    console.log(`  ✅ ${nombre}`);
    pasados++;
  } catch (err) {
    console.log(`  ❌ ${nombre}\n     ${err.message}`);
    fallados++;
  }
}

// Replica EXACTA de lo que produciría aplicarRestriccionesGlobales()
// (index.js 2865-2949) para el estado del test. Se replica a mano
// porque index.js no es importable (arranca el servidor al requerirse).
function restriccionesACWRcritico(estado) {
  const r = {
    intensidadMax: 1.0, volumenMax: 1.0, recuperacionExtra: false,
    forzarDescanso: false, forzarZ2: false, prohibirIntensidad: false,
    zonasPermitidas: ['z1', 'z2', 'z3', 'sweetspot', 'ftp', 'vo2'],
    zonasRestringidas: [], motivo: []
  };
  if (estado.acwr > 1.3) {
    r.volumenMax = 0.8;
    r.intensidadMax = 0.9;
    r.motivo.push('ACWR - Reducción de carga');
    if (estado.acwr > 1.5) {
      r.forzarZ2 = true;
      r.prohibirIntensidad = true;
      r.motivo.push('🚨 ACWR crítico - Solo Z2');
    }
  }
  return r;
}

// ─── TEST OBLIGATORIO A — ACWR > 1.5 (SPEC_V10_F1 §10.1, contradicción A) ───
test('A0. ACWR>1.5: resolverConflictos da z2/25/0.60, la intención la convierte en grupeta 120/0.85, el gate lo revierte', () => {
  const estado = {
    tsb: -15, ctl: 58, atl: 64, acwr: 1.62, readiness: 55,
    hrv: 50, sleepQuality: 2, heatIndex: 24, haceCalor: false,
    weeklyTss: 450, flags: {}
  };
  // Decisión SEGURA tras resolverConflictos() (index.js 2541-2551):
  // ACWR>1.5 → z2 / 25 min / IF 0.60 / 1 rep.
  const decisionSegura = {
    tipo: 'z2', reps: 1, durMin: 25, recSec: 0, intensidad: 0.60,
    motivo: 'Plan | 🔴 ACWR alto (1.62) - Reducción obligatoria'
  };

  // Capa posterior: adaptarDecisionParaIntencion() con intención grupeta
  // (motorIntencion.js 183-204: pisa sin condiciones → 120 min / IF 0.85).
  const decisionMutada = motorIntencion.adaptarDecisionParaIntencion(
    decisionSegura, { tipo: 'grupeta' }, estado
  );

  // Pre-condición: el bug se reproduce (la mutación eleva la sesión).
  // NOTA FIEL AL CÓDIGO: con TSB=-15, la rama grupeta aplica además su
  // ajuste por fatiga (motorIntencion.js:199-201, tsb<-10 → IF 0.75 en
  // lugar de 0.85). El pisoteo de la restricción de seguridad existe
  // igualmente: IF 0.75 > 0.60 y durMin 120 > 25.
  assert.strictEqual(decisionMutada.tipo, 'grupeta');
  assert.strictEqual(decisionMutada.durMin, 120);
  assert.strictEqual(decisionMutada.intensidad, 0.75);
  assert.ok(decisionMutada.intensidad > 0.60,
    'la mutación eleva el IF por encima del cap de seguridad 0.60');
  console.log('     [bug reproducido] tras adaptarDecisionParaIntencion:',
    `grupeta / ${decisionMutada.durMin} min / IF ${decisionMutada.intensidad} (0.85 si TSB>-10)`);

  // GATE: validarSeguridad() debe restaurar la restricción de seguridad.
  const final = validarSeguridad(decisionMutada, estado, restriccionesACWRcritico(estado));
  assert.strictEqual(final.tipo, 'z2', `tipo: esperado z2, obtenido ${final.tipo}`);
  assert.strictEqual(final.durMin, 25, `duración: esperado 25, obtenido ${final.durMin}`);
  assert.strictEqual(final.intensidad, 0.60, `IF: esperado 0.60, obtenido ${final.intensidad}`);
  assert.strictEqual(final.reps, 1);
  console.log(`     [gate aplicado] resultado FINAL: ${final.tipo} / ${final.durMin} min / IF ${final.intensidad}`);
});

// ─── TEST OBLIGATORIO B — TSB < -20, cap de duración 45 min (contradicción D) ───
test('B0. TSB<-20: cap 45 min, salida_tranquila lo pisa con 60, el gate lo devuelve a 45', () => {
  const estado = {
    tsb: -22, ctl: 58, atl: 64, acwr: 1.10, readiness: 60,
    hrv: 48, sleepQuality: 2, heatIndex: 24, haceCalor: false,
    weeklyTss: 380, flags: {}
  };
  // Decisión SEGURA tras resolverConflictos() (index.js 2613-2626):
  // TSB<-20 → duración con cap de 45 min.
  const decisionSegura = {
    tipo: 'z2', reps: 1, durMin: 45, recSec: 0, intensidad: 0.65,
    motivo: 'Plan | 🧠 TSB < -20 - Duración máxima 45 min'
  };

  // Capa posterior: intención salida tranquila (motorIntencion.js 217-228:
  // fija durMin=60 pisando el cap).
  const decisionMutada = motorIntencion.adaptarDecisionParaIntencion(
    decisionSegura, { tipo: 'salida_tranquila' }, estado
  );

  // Pre-condición: la mutación infla la duración por encima del cap.
  assert.strictEqual(decisionMutada.durMin, 60,
    `pre-condición: salida_tranquila debería fijar 60 min, obtenido ${decisionMutada.durMin}`);
  console.log(`     [bug reproducido] tras adaptarDecisionParaIntencion: ${decisionMutada.tipo} / ${decisionMutada.durMin} min`);

  // GATE: la duración final debe respetar el cap de 45 min.
  const restricciones = {
    intensidadMax: 1.0, volumenMax: 1.0, forzarDescanso: false,
    forzarZ2: false, prohibirIntensidad: false,
    zonasPermitidas: ['z1', 'z2', 'z3', 'sweetspot', 'ftp', 'vo2'],
    zonasRestringidas: [], motivo: []
  };
  const final = validarSeguridad(decisionMutada, estado, restricciones);
  assert.ok(final.durMin <= 45, `duración: esperado ≤ 45, obtenido ${final.durMin}`);
  assert.strictEqual(final.durMin, 45);
  console.log(`     [gate aplicado] resultado FINAL: ${final.tipo} / ${final.durMin} min (cap 45 respetado)`);
});

// ─── SIN CAMBIO DE COMPORTAMIENTO (v9.5 se conserva) ─────────────────
test('R1. Grupeta legítima SIN restricciones activas NO se toca', () => {
  const estado = { tsb: 5.0, acwr: 0.95, readiness: 85, heatIndex: 22, flags: {} };
  const decision = { tipo: 'sweetspot', reps: 3, durMin: 75, recSec: 90, intensidad: 0.88, motivo: 'Plan' };
  const mutada = motorIntencion.adaptarDecisionParaIntencion(decision, { tipo: 'grupeta' }, estado);
  const final = validarSeguridad(mutada, estado, {});
  assert.strictEqual(final.tipo, 'grupeta');
  assert.strictEqual(final.durMin, 120);
  assert.strictEqual(final.intensidad, 0.85);
  assert.strictEqual(final.gateSeguridad, undefined);
});

test('R2. Decisión ya conforme: sin mutaciones ni ruido en el motivo', () => {
  const estado = { tsb: -25, acwr: 1.4, readiness: 65, heatIndex: 24, flags: {} };
  const decision = { tipo: 'z2', reps: 1, durMin: 40, recSec: 0, intensidad: 0.65, motivo: 'Plan' };
  const final = validarSeguridad(decision, estado, { intensidadMax: 1.0, forzarZ2: false, prohibirIntensidad: false });
  assert.strictEqual(final.durMin, 40);
  assert.strictEqual(final.intensidad, 0.65);
  assert.strictEqual(final.gateSeguridad, undefined);
});

test('R3. forzarDescanso → descanso aunque una capa posterior proponga grupeta', () => {
  const estado = { tsb: 5.0, acwr: 1.0, readiness: 80, heatIndex: 22, flags: {} };
  const decision = { tipo: 'grupeta', reps: 1, durMin: 120, recSec: 0, intensidad: 0.85, motivo: 'Intención' };
  const final = validarSeguridad(decision, estado, { forzarDescanso: true, motivo: [] });
  assert.strictEqual(final.tipo, 'descanso');
  assert.strictEqual(final.durMin, 0);
  assert.strictEqual(final.intensidad, 0);
});

test('R4. TSB < -30 → descanso (NIVEL 1) aunque la mutación proponga intensidad', () => {
  const estado = { tsb: -32.0, acwr: 1.2, readiness: 70, heatIndex: 22, flags: {} };
  const decision = { tipo: 'sweetspot', reps: 3, durMin: 75, recSec: 90, intensidad: 0.88, motivo: 'Plan' };
  const final = validarSeguridad(decision, estado, {});
  assert.strictEqual(final.tipo, 'descanso');
});

test('R5. intensidadMax=0.75 + grupeta 0.85 → IF clampeado (semántica de decidirEntrenamiento 3176-3184)', () => {
  const estado = { tsb: 5.0, acwr: 1.0, readiness: 80, heatIndex: 22, flags: {} };
  const decision = { tipo: 'grupeta', reps: 1, durMin: 120, recSec: 0, intensidad: 0.85, motivo: 'Intención' };
  const final = validarSeguridad(decision, estado, { intensidadMax: 0.75, forzarZ2: false, prohibirIntensidad: false });
  assert.strictEqual(final.intensidad, 0.75);
  assert.strictEqual(final.tipo, 'grupeta'); // grupeta no está en la cadena de downgrade de v9.5
});

test('R6. descanso entrante: passthrough sin cambios', () => {
  const estado = { tsb: -40.0, acwr: 1.8, readiness: 20, heatIndex: 45, flags: {} };
  const decision = { tipo: 'descanso', reps: 0, durMin: 0, recSec: 0, intensidad: 0, motivo: 'Ya es descanso' };
  const final = validarSeguridad(decision, estado, { forzarDescanso: true, motivo: [] });
  assert.deepStrictEqual(final, decision);
});

test('R7. defensivo: decision inválida / estado ausente no explota', () => {
  assert.strictEqual(validarSeguridad(null, {}, {}), null);
  assert.strictEqual(validarSeguridad(undefined, undefined), undefined);
  const d = { tipo: 'z2', reps: 1, durMin: 60, recSec: 0, intensidad: 0.65, motivo: 'Plan' };
  const final = validarSeguridad(d); // sin estado ni restricciones
  assert.strictEqual(final.tipo, 'z2');
  assert.strictEqual(final.gateSeguridad, undefined);
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`RESULTADO: ${pasados} pasados, ${fallados} fallados`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
process.exit(fallados > 0 ? 1 : 0);


