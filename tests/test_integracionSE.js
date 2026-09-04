// ═══════════════════════════════════════════════════════════════
// 🧪 TESTS — Integración Substitution Engine (F2, SPEC §6 paso 9, §7.3.b)
// Ejecutar: node tests/test_integracionSE.js
//
// Extrae el código REAL de index.js (adapter evaluarSustitucionPipeline)
// y lo evalúa con módulos reales (substitutionEngine + validarSeguridad)
// y stubs solo para datos (estado/restricciones). Complementa a
// test_substitutionEngine.js (S1-S10, motor puro) verificando el cableado:
// candidato por intención, gate tras motor, contador honesto, no-mutación
// y orden canónico en el fuente (hoisting: helpers tras el caller es válido).
// ═══════════════════════════════ work on "no me apetece" is future work ══
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const substitutionEngineMod = require('../substitutionEngine.js');
const { validarSeguridad } = require('../seguridad.js');

let pasados = 0, fallados = 0;
function test(nombre, fn) {
  try { fn(); console.log('  ✅ ' + nombre); pasados++; }
  catch (err) { fallados++; console.log('  ❌ ' + nombre + '\n     ' + err.message); }
}

const srcIndex = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

// ─── EXTRAER EL ADAPTER REAL DE index.js ───────────────────────
const INI = '// ─── SUBSTITUTION ENGINE: EVALUACIÓN EN PIPELINE';
const FIN = '\n// ─── CEREBRO: ANALIZAR CUMPLIMIENTO DEL PLAN';
const idxIni = srcIndex.indexOf(INI);
const idxFin = srcIndex.indexOf(FIN);
assert.ok(idxIni !== -1, 'No se encontró el bloque SE en index.js');
assert.ok(idxFin > idxIni, 'El bloque SE debe estar localizado antes del banner CEREBRO en el fuente');
const bloqueSE = srcIndex.slice(idxIni, idxFin);

function crearAdapter() {
  const factory = new Function(
    'substitutionEngine', 'validarSeguridad',
    bloqueSE + '\nreturn { evaluarSustitucionPipeline };'
  );
  return factory(substitutionEngineMod, validarSeguridad).evaluarSustitucionPipeline;
}

// Fábricas de datos (mismos perfiles que S1-S10 para trazabilidad)
const prevista = () => ({ tipo: 'sweetspot', reps: 3, durMin: 75, recSec: 90, intensidad: 0.88, tssEsperado: 92, motivo: 'Plan' });
const grupeta = () => ({ tipo: 'grupeta', reps: 1, durMin: 120, recSec: 0, intensidad: 0.88, tss: 110, motivo: '🎯 Intención: grupeta', esIntencion: true });
const estadoSano = () => ({ tsb: 5.0, acwr: 1.0, readiness: 80, heatIndex: 22, flags: {} });
const restriccionesSanas = () => ({ forzarDescanso: false, forzarZ2: false, prohibirIntensidad: false, intensidadMax: 1.0 });

// ─── SU1. Válida (±30% OK) → aplicada y re-gateada ─────────────
test('SU1. Sustitución válida (grupeta +19.6%): aplicada y re-validada por validarSeguridad', () => {
  const evaluar = crearAdapter();
  const prev = prevista();
  const cand = grupeta();
  const r = evaluar({ sesionPrevista: prev, candidato: cand, trainingNeed: null, estado: estadoSano(), restricciones: restriccionesSanas(), sustitucionesSemana: 0 });
  assert.strictEqual(r.estado, 'aceptada');
  assert.strictEqual(r.aplicada, true);
  assert.strictEqual(r.decisionFinal.tipo, 'grupeta');
  assert.strictEqual(r.decisionFinal.sustitucion.desviacion_tss_pct, 19.6);
});

// ─── SU2. Fuera de ±30% → no se aplica ──────────────────────────
test('SU2. Sustitución fuera de ±30% (grupeta TSS 140 vs 92): no_valida, no aplicada', () => {
  const evaluar = crearAdapter();
  const cand = { tipo: 'grupeta', reps: 1, durMin: 120, recSec: 0, intensidad: 0.95, tss: 140, motivo: 'Intención' };
  const r = evaluar({ sesionPrevista: prevista(), candidato: cand, trainingNeed: null, estado: estadoSano(), restricciones: restriccionesSanas(), sustitucionesSemana: 0 });
  assert.strictEqual(r.estado, 'no_valida');
  assert.strictEqual(r.aplicada, false);
  assert.strictEqual(r.decisionFinal, null);
  assert.ok(r.motivo.includes('±30%'));
});

// ─── SU3. Límite semanal: 3 hechas → 4.ª rechazada SIEMPRE ──────
test('SU3. Con sustitucionesSemana=3: rechazada siempre, no aplicada', () => {
  const evaluar = crearAdapter();
  const r = evaluar({ sesionPrevista: prevista(), candidato: grupeta(), trainingNeed: null, estado: estadoSano(), restricciones: restriccionesSanas(), sustitucionesSemana: 3 });
  assert.strictEqual(r.estado, 'rechazada');
  assert.strictEqual(r.aplicada, false);
  assert.strictEqual(r.decisionFinal, null);
});

// ─── SU4. Seguridad prevalece sobre el candidato aceptado ───────
test('SU4. Gate de seguridad: grupeta aceptada con ACWR>1.5 → decisionFinal = z2/25/0.60', () => {
  const evaluar = crearAdapter();
  const estadoACWR = { tsb: 5.0, acwr: 1.62, readiness: 55, heatIndex: 22, flags: {} };
  const r = evaluar({ sesionPrevista: prevista(), candidato: grupeta(), trainingNeed: null, estado: estadoACWR, restricciones: restriccionesSanas(), sustitucionesSemana: 0 });
  assert.strictEqual(r.estado, 'aceptada', 'el motor acepta (carga dentro de ±30%)');
  assert.strictEqual(r.decisionFinal.tipo, 'z2', 'el gate prevalece sobre la sustitución');
  assert.strictEqual(r.decisionFinal.durMin, 25);
  assert.strictEqual(r.decisionFinal.intensidad, 0.60);
});

// ─── SU5. No-mutación de entradas ───────────────────────────────
test('SU5. No-mutación: sesionPrevista y candidato intactos; decisionFinal es objeto nuevo', () => {
  const evaluar = crearAdapter();
  const prev = prevista();
  const cand = grupeta();
  const p0 = JSON.parse(JSON.stringify(prev));
  const c0 = JSON.parse(JSON.stringify(cand));
  const r = evaluar({ sesionPrevista: prev, candidato: cand, trainingNeed: null, estado: estadoSano(), restricciones: restriccionesSanas(), sustitucionesSemana: 0 });
  assert.strictEqual(r.estado, 'aceptada');
  assert.deepStrictEqual(prev, p0, 'sesionPrevista no debe mutarse');
  assert.deepStrictEqual(cand, c0, 'candidato no debe mutarse');
  assert.notStrictEqual(r.decisionFinal, cand, 'decisionFinal es un objeto nuevo');
});

// ─── SU6. Sin datos suficientes: no se inventa sustitución ──────
test('SU6. TN insuficiente → datos_insuficientes; sin contador → dependencia_persistencia', () => {
  const evaluar = crearAdapter();
  const tnInsuficiente = { estado_calculo: 'datos_insuficientes', tipo_insuficiencia: 'datos_puntuales_incompletos', datos_faltantes: ['decision.tssEsperado'] };
  let r = evaluar({ sesionPrevista: prevista(), candidato: grupeta(), trainingNeed: tnInsuficiente, estado: estadoSano(), restricciones: restriccionesSanas(), sustitucionesSemana: 0 });
  assert.strictEqual(r.estado, 'datos_insuficientes');
  assert.strictEqual(r.aplicada, false);
  assert.strictEqual(r.decisionFinal, null);
  // Sin contador (hoy: null en producción) → NO se inventa (S10)
  r = evaluar({ sesionPrevista: prevista(), candidato: grupeta(), trainingNeed: null, estado: estadoSano(), restricciones: restriccionesSanas(), sustitucionesSemana: null });
  assert.strictEqual(r.estado, 'dependencia_persistencia');
  assert.strictEqual(r.aplicada, false);
  assert.strictEqual(r.decisionFinal, null);
  assert.ok(r.motivo.includes('registro_sustituciones'));
});

// ─── SU7. Sin candidato → no evaluada (flujo normal intacto) ────
test('SU7. Sin intención (sin candidato): sin_candidato, flujo normal intacto', () => {
  const evaluar = crearAdapter();
  const r = evaluar({ sesionPrevista: prevista(), candidato: null, trainingNeed: null, estado: estadoSano(), restricciones: restriccionesSanas(), sustitucionesSemana: 0 });
  assert.strictEqual(r.estado, 'sin_candidato');
  assert.strictEqual(r.aplicada, false);
  assert.strictEqual(r.decisionFinal, null);
});

// ─── SU8. Orden canónico en el fuente (SPEC §6) ─────────────────
test('SU8. En index.js: gate → TN → SE; adapter antes de la función; reasignación solo si aplicada', () => {
  const idxGate = srcIndex.indexOf('decisionAjustada = validarSeguridad(decisionAjustada, state.estado, state.restricciones);');
  const idxTN = srcIndex.indexOf('const trainingNeed = calcularTrainingNeedInformativo(decisionAjustada, state);');
  const idxSE = srcIndex.indexOf('const evaluacionSustitucion = evaluarSustitucionPipeline({');
  const idxFn = srcIndex.indexOf('async function getAthleteStateConAjuste() {');
  const idxCerebro = srcIndex.indexOf('\n// ─── CEREBRO: ANALIZAR CUMPLIMIENTO DEL PLAN');
  assert.ok(idxGate !== -1 && idxTN !== -1 && idxSE !== -1 && idxFn !== -1 && idxCerebro !== -1, 'anclas presentes');
  assert.ok(idxGate < idxTN && idxTN < idxSE, 'orden canónico: gate → TN → SE');
  assert.ok(idxFn < idxSE, 'helpers SE definidos después del caller es válido (hoisting de function declarations)');
  assert.ok(idxSE < idxCerebro, 'bloque SE antes de la siguiente sección');
  const usos = (srcIndex.match(/\bsustitucion: resumenSustitucion\b/g) || []).length;
  assert.strictEqual(usos, 2, 'sustitucion: resumenSustitucion debe estar en ambas ramas de retorno');
  const idxApl = srcIndex.indexOf('if (evaluacionSustitucion.aplicada && evaluacionSustitucion.decisionFinal) {');
  assert.ok(idxApl !== -1 && idxApl > idxSE, 'reasignación de decisionAjustada solo si aplicada');
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`RESULTADO: ${pasados} pasados, ${fallados} fallados`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
process.exit(fallados > 0 ? 1 : 0);
