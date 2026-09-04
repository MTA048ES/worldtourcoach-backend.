// ═══════════════════════════════════════════════════════════════
// 🧪 TESTS — Integración Training Need (F2, SPEC_V10_F1 §4/§6 paso 8)
// Ejecutar: node tests/test_integracionTN.js
// Sin framework: el proyecto no tiene ninguno instalado.
//
// index.js NO es importable (arranca app.listen al requerirse).
// Como en test_ajustarPlanAutomaticamente.js (M1-M5), extraemos el
// código REAL de index.js (helpers construirContextoSemanal y
// calcularTrainingNeedInformativo, y formatDate) y lo evaluamos con
// stubs de sus dependencias (obtenerHistorial, getTssObjetivoSemanal,
// getMaxSesionesCalidad) y el calcularTrainingNeed real del módulo.
// ═══════════════════════════════════════════════════════════════
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { calcularTrainingNeed } = require('../trainingNeed.js');

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

// ─── EXTRAER CÓDIGO REAL DE index.js ───────────────────────────
const srcIndex = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

// formatDate REAL (index.js ~807)
const mFmt = srcIndex.match(/function formatDate\(d\) \{[\s\S]*?\n\}/);
assert.ok(mFmt && mFmt[0], 'No se encontró formatDate en index.js');
const formatDateReal = new Function(mFmt[0] + '; return formatDate;')();

// Bloque TN real (comentarios + ambas funciones). Vive DESPUÉS de
// getAthleteStateConAjuste y antes del banner (sin indentar) de CEREBRO.
const INI = '// ─── TRAINING NEED: CONTEXTO SEMANAL';
const FIN = '\n// ─── CEREBRO: ANALIZAR CUMPLIMIENTO DEL PLAN';
const idxIni = srcIndex.indexOf(INI);
const idxFin = srcIndex.indexOf(FIN);
assert.ok(idxIni !== -1, 'No se encontró el bloque Training Need en index.js');
assert.ok(idxFin !== -1 && idxFin > idxIni, 'No se encontró el fin del bloque Training Need en index.js');
const bloqueTN = srcIndex.slice(idxIni, idxFin);

// Fábrica: construye las funciones reales con dependencias inyectadas.
function crearHelpers(historial, tssObjetivo, calidadMax) {
  const factory = new Function(
    'formatDate', 'obtenerHistorial', 'getTssObjetivoSemanal', 'getMaxSesionesCalidad', 'calcularTrainingNeed',
    bloqueTN + '\nreturn { construirContextoSemanal, calcularTrainingNeedInformativo };'
  );
  return factory(
    formatDateReal,
    () => historial,
    () => tssObjetivo,
    () => calidadMax,
    calcularTrainingNeed
  );
}

// Réplica EXACTA del cálculo de ventana lunes-domingo de
// construirContextoSemanal / contarSesionesCalidadSemana (index.js ~890),
// para construir casos de frontera respecto al "hoy" real del test.
function ventanaSemanalActual() {
  const ahora = new Date();
  const diaSemana = ahora.getDay();
  const diasDesdeLunes = diaSemana === 0 ? 6 : diaSemana - 1;
  const lunes = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - diasDesdeLunes);
  const domingo = new Date(lunes.getTime() + 6 * 86400000);
  return { lunes, domingo, lunesStr: formatDateReal(lunes), domingoStr: formatDateReal(domingo) };
}

const fechaLocalMediodia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);

// ─── I1. BUILDER: construye sesionesSemana correctamente ───────
test('I1. construirContextoSemanal mapea el historial de la semana (in/fuera/inválido/sin entreno)', () => {
  const { lunes } = ventanaSemanalActual();
  const historial = [
    { fecha: fechaLocalMediodia(new Date(lunes.getTime() + 1 * 86400000)).toISOString(), entreno: { tipo: 'SWEETSPOT', intensidad: 0.88, tssEsperado: 92 } },
    { fecha: fechaLocalMediodia(new Date(lunes.getTime() - 2 * 86400000)).toISOString(), entreno: { intensidad: 0.90, tssEsperado: 100 } }, // semana anterior → fuera
    { fecha: null },                                                        // inválida → fuera
    { fecha: fechaLocalMediodia(new Date(lunes.getTime() + 2 * 86400000)).toISOString() } // sin entreno → dentro con 0s
  ];
  const { construirContextoSemanal } = crearHelpers(historial, 550, 2);
  const ctx = construirContextoSemanal();

  assert.strictEqual(ctx.tssObjetivo, 550);
  assert.strictEqual(ctx.calidadMax, 2);
  assert.ok(Array.isArray(ctx.sesionesSemana));
  assert.strictEqual(ctx.sesionesSemana.length, 2, 'solo 2 entradas dentro de la ventana');
  assert.deepStrictEqual(ctx.sesionesSemana[0], { fecha: ctx.sesionesSemana[0].fecha, intensidad: 0.88, tss: 92 });
  assert.deepStrictEqual(ctx.sesionesSemana[1], { fecha: ctx.sesionesSemana[1].fecha, intensidad: 0, tss: 0 }, 'entrada sin entreno no inventa datos: 0/0');
  // Las fechas mapeadas son strings YYYY-MM-DD
  for (const s of ctx.sesionesSemana) assert.match(s.fecha, /^\d{4}-\d{2}-\d{2}$/);
});

// ─── I2. FRONTERA TEMPORAL: lunes y domingo incluidos, vecinos no ───
test('I2. Frontera semanal: lunes y domingo entran; domingo anterior y lunes siguiente no', () => {
  const { lunes, domingo } = ventanaSemanalActual();
  const historial = [
    { fecha: fechaLocalMediodia(new Date(lunes.getTime() - 1 * 86400000)).toISOString(), entreno: { intensidad: 0.9, tssEsperado: 99 } },  // domingo anterior → FUERA
    { fecha: fechaLocalMediodia(lunes).toISOString(), entreno: { intensidad: 0.88, tssEsperado: 91 } },                                     // lunes → DENTRO
    { fecha: fechaLocalMediodia(domingo).toISOString(), entreno: { intensidad: 0.86, tssEsperado: 93 } },                                   // domingo → DENTRO
    { fecha: fechaLocalMediodia(new Date(domingo.getTime() + 1 * 86400000)).toISOString(), entreno: { intensidad: 0.9, tssEsperado: 101 } } // lunes siguiente → FUERA
  ];
  const { construirContextoSemanal } = crearHelpers(historial, 550, 2);
  const ctx = construirContextoSemanal();

  assert.strictEqual(ctx.sesionesSemana.length, 2, 'lunes y domingo de ESTA semana; los vecinos quedan fuera');
  assert.strictEqual(ctx.sesionesSemana[0].tss, 91);
  assert.strictEqual(ctx.sesionesSemana[1].tss, 93);
});

// ─── I3. ADAPTER tssEsperado: llega desde state.workout a bloque_A ───
test('I3. tssEsperado viaja de workout al TN: decision SIN tssEsperado → bloque_A.tss_objetivo = workout.tssEsperado', () => {
  const { calcularTrainingNeedInformativo } = crearHelpers([], 550, 2);
  const decision = { tipo: 'sweetspot', reps: 3, durMin: 75, recSec: 90, intensidad: 0.88, motivo: 'Plan' }; // SIN tssEsperado
  const state = {
    decision,
    workout: { tipo: 'sweetspot', tssEsperado: 92, ifEsperado: '0.88' },
    estado: { tsb: -8.2, ctl: 58, atl: 64, acwr: 1.12, readiness: 72, hrv: 56, sleepQuality: 2, weeklyTss: 310, dataQuality: { estado: 'FRESH', fuente: 'intervals', fecha: '2026-09-01', motivo: 'datos frescos' } },
    restricciones: { intensidadMax: 1.0, forzarZ2: false, prohibirIntensidad: false }
  };

  const tn = calcularTrainingNeedInformativo(decision, state);

  assert.ok(tn, 'el TN se calcula');
  assert.strictEqual(tn.estado_calculo, 'necesidad_detectada', 'datos completos tras el adapter: no hay insuficiencia');
  assert.strictEqual(tn.training_need.bloque_A.tss_objetivo, 92, 'tssEsperado inyectado desde workout');
  assert.strictEqual(tn.training_need.bloque_A.tipo_solicitado, 'sweetspot');
  assert.strictEqual(tn.training_need.bloque_B.tss_semanal_restante, 550 - 310 - 92);
});

// ─── I4. ADAPTER dataQuality: objeto → string ──────────────────
test('I4. dataQuality llega como STRING al TN: objeto {estado} mapea; ausente → NO_DISPONIBLE; string pasa tal cual', () => {
  const { calcularTrainingNeedInformativo } = crearHelpers([], 550, 2);
  const decision = { tipo: 'z2', reps: 1, durMin: 60, recSec: 0, intensidad: 0.65, motivo: 'Aeróbico' };
  const base = {
    decision,
    workout: { tssEsperado: 55 },
    estado: { tsb: 5.0, ctl: 58, atl: 55, acwr: 1.05, readiness: 80, weeklyTss: 300 },
    restricciones: {}
  };

  // A) objeto (formato real del pipeline) → usa .estado
  const s1 = JSON.parse(JSON.stringify(base));
  s1.estado.dataQuality = { estado: 'STALE', fuente: 'intervals', fecha: '2026-08-30', motivo: 'ayer' };
  let tn = calcularTrainingNeedInformativo(s1.decision, s1);
  assert.strictEqual(tn.training_need.bloque_C.data_quality, 'STALE', 'objeto → string .estado');

  // B) ausente → NO_DISPONIBLE (y el módulo lo trata como insuficiencia explícita)
  const s2 = JSON.parse(JSON.stringify(base));
  delete s2.estado.dataQuality;
  tn = calcularTrainingNeedInformativo(s2.decision, s2);
  assert.strictEqual(tn.estado_calculo, 'datos_insuficientes', 'no explota');
  assert.strictEqual(tn.tipo_insuficiencia, 'datos_puntuales_incompletos');
  assert.ok(tn.datos_faltantes.some(f => f.includes('NO_DISPONIBLE')), 'declara dataQuality=NO_DISPONIBLE');

  // C) ya string (futuro-proof) → pasa tal cual
  const s3 = JSON.parse(JSON.stringify(base));
  s3.estado.dataQuality = 'FRESH';
  tn = calcularTrainingNeedInformativo(s3.decision, s3);
  assert.strictEqual(tn.training_need.bloque_C.data_quality, 'FRESH');
});

// ─── I5. NO-MUTACIÓN: decision/estado/workout/restricciones intactos ───
test('I5. La decisión original NO se modifica (ni se le inyecta tssEsperado); estado/workout intactos', () => {
  const { calcularTrainingNeedInformativo } = crearHelpers([], 550, 2);
  const decision = { tipo: 'sweetspot', reps: 3, durMin: 75, recSec: 90, intensidad: 0.88, motivo: 'Plan' }; // SIN tssEsperado
  const state = {
    decision,
    workout: { tipo: 'sweetspot', tssEsperado: 92 },
    estado: { tsb: -8.2, ctl: 58, atl: 64, acwr: 1.12, readiness: 72, weeklyTss: 310, dataQuality: { estado: 'FRESH' } },
    restricciones: { intensidadMax: 1.0 }
  };
  const snap = (o) => JSON.parse(JSON.stringify(o));
  const d0 = snap(decision), e0 = snap(state.estado), w0 = snap(state.workout), r0 = snap(state.restricciones);

  const tn = calcularTrainingNeedInformativo(decision, state);

  assert.deepStrictEqual(decision, d0, 'decision mutada: el adapter debe trabajar sobre COPIA');
  assert.strictEqual(decision.tssEsperado, undefined, 'decision no debe recibir tssEsperado por efecto lateral');
  assert.deepStrictEqual(state.estado, e0);
  assert.deepStrictEqual(state.workout, w0);
  assert.deepStrictEqual(state.restricciones, r0);
  assert.strictEqual(tn.training_need.bloque_A.tss_objetivo, 92, 'el TN sí ve el tss de workout (copia)');
});

// ─── I6. SEPARACIÓN: la salida del TN es SOLO diagnóstico ──────
test('I6. El TN integrado no contiene campos de acción y es defensivo ante entradas nulas', () => {
  const { calcularTrainingNeedInformativo } = crearHelpers([], 550, 2);
  const decision = { tipo: 'sweetspot', reps: 3, durMin: 75, recSec: 90, intensidad: 0.88, motivo: 'Plan' };
  const state = {
    decision,
    workout: { tssEsperado: 92 },
    estado: { tsb: -8.2, ctl: 58, atl: 64, acwr: 1.12, readiness: 72, weeklyTss: 310, dataQuality: { estado: 'FRESH' } },
    restricciones: {}
  };

  const tn = calcularTrainingNeedInformativo(decision, state);
  const clavesPermitidas = ['fecha', 'estado_calculo', 'tipo_insuficiencia', 'datos_faltantes', 'training_need', 'diagnostico', 'fuentes'];
  assert.deepStrictEqual(Object.keys(tn).sort(), clavesPermitidas.slice().sort(), 'salida 100% informativa');
  for (const prohibido of ['accion', 'decision_final', 'tipo_recomendado', 'durMin_recomendado', 'intensidad_recomendada', 'workout', 'decision']) {
    assert.strictEqual(prohibido in tn, false, `la salida NO debe contener '${prohibido}'`);
  }

  // Defensivo: nulos → null, sin excepción (la capa informativa nunca rompe /hoy)
  assert.strictEqual(calcularTrainingNeedInformativo(null, state), null);
  assert.strictEqual(calcularTrainingNeedInformativo(decision, null), null);
  assert.strictEqual(calcularTrainingNeedInformativo(decision, {}), null);
});

// ─── I7. ORDEN CANÓNICO EN EL FUENTE (SPEC §6): gate → TN → retornos ───
test('I7. En index.js el TN se calcula DESPUÉS del gate y se adjunta en AMBAS ramas de retorno', () => {
  const idxGate = srcIndex.indexOf('decisionAjustada = validarSeguridad(decisionAjustada, state.estado, state.restricciones);');
  const idxCall = srcIndex.indexOf('const trainingNeed = calcularTrainingNeedInformativo(decisionAjustada, state);');
  assert.ok(idxGate !== -1, 'gate no encontrado');
  assert.ok(idxCall > idxGate, 'el TN debe calcularse DESPUÉS de validarSeguridad (SPEC §6 paso 8)');
  const rama1 = srcIndex.indexOf('        trainingNeed,');
  // La segunda rama lleva trainingNeed seguido del resumen de sustitución (F2 SE)
  const rama2 = srcIndex.indexOf('      trainingNeed,\n      sustitucion: resumenSustitucion\n    };');
  assert.ok(rama1 > idxCall && rama2 > idxCall, 'ambas ramas de retorno deben incluir trainingNeed');
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`RESULTADO: ${pasados} pasados, ${fallados} fallados`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
process.exit(fallados > 0 ? 1 : 0);
