// ═══════════════════════════════════════════════════════════════
// 🧪 TESTS — Integración P2B: plan previsto diario (generación +
//    lazy-ensure) en el pipeline F2 (index.js)
// Ejecutar: node tests/test_integracionP2B.js
//
// index.js NO es importable (arranca app.listen al requerirse), así que
// —igual que test_integracionP2 / test_integracionSE— extraemos el bloque
// P2B REAL del fuente y lo evaluamos con stubs de persistencia, de
// generateWorkout y del generador getAthleteState. validarSeguridad y el
// módulo persistenciaPlan REAL se usan donde el contrato lo exige.
//
// Cubre los puntos obligatorios de P2B:
//   P2B-1  Creación del plan cuando no existe (read-or-freeze)
//   P2B-2  Lectura del plan existente
//   P2B-3  No sobrescritura del plan congelado
//   P2B-4  Decisión fresca diferente NO cambia el baseline congelado
//   P2B-5  Seguridad ANTES de congelar (gate reduce → se congela la reducida)
//   P2B-6  Decisión inválida → NO se congela nada
//   P2B-7  NO_DISPONIBLE → nunca se crea una fila artificial SIN_DATOS
//   P2B-8  Error de LECTURA Supabase → degradación segura, sin excepción
//   P2B-9  Error de ESCRITURA Supabase → degradación segura, sin excepción
//   P2B-10 Scheduler repetido → idempotente (fuente 'cron', sin duplicar)
//   P2B-11 Lazy-ensure repetido → idempotente (fuente 'hoy', sin re-congelar)
//   P2B-12 Llamadas concurrentes → ninguna lanza (PK + ignoreDuplicates arbitran)
//   P2B-13 Ausencia de recursión (ensure/generador no llaman a ConAjuste)
//   P2B-14 /hoy sigue funcionando aunque falle la congelación (orden: gate→TN→ensure→SE)
//   P2B-15 Compatibilidad total con los 86 tests actuales
//   P2B-16 Baseline PRE-INTENCIÓN (sin motorIntencion / cerebro / SE)
//   P2B-17 Endpoint cron: POST /api/cron/plan-diario con X-Cron-Secret
// ═══════════════════════════════════════════════════════════════
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');

const substitutionEngineMod = require('../substitutionEngine.js');
const { validarSeguridad: validarSeguridadReal } = require('../seguridad.js');
const persistenciaPlanReal = require('../persistenciaPlan.js');

let pasados = 0, fallados = 0;
async function test(nombre, fn) {
  try { await fn(); console.log('  ✅ ' + nombre); pasados++; }
  catch (err) { fallados++; console.log('  ❌ ' + nombre + '\n     ' + err.message); }
}

const srcIndex = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

// ─── EXTRAER EL BLOQUE P2B REAL DE index.js ────────────────────
const INI_P2B = '// 🧩 P2B — PLAN PREVISTO DIARIO: GENERACIÓN + LAZY-ENSURE';
const FIN_P2B = '\n// ─── SUBSTITUTION ENGINE: EVALUACIÓN EN PIPELINE';
const idxP2BIni = srcIndex.indexOf(INI_P2B);
const idxP2BFin = srcIndex.indexOf(FIN_P2B);
assert.ok(idxP2BIni !== -1, 'No se encontró el bloque P2B en index.js');
assert.ok(idxP2BFin > idxP2BIni, 'El bloque P2B debe estar antes del banner de Substitution Engine');
const bloqueP2B = srcIndex.slice(idxP2BIni, idxP2BFin);

// El bloque P2B usa free identifiers que el runner inyecta:
//   validarSeguridad (real), generateWorkout (stub determinista),
//   calcularTrainingNeedInformativo (stub snapshot), getAthleteState (stub),
//   computaCalidadBooleana (misma semántica que la del bloque P2).
function computaCalidadBooleanaStub(sesion) {
  try {
    const r = substitutionEngineMod.computaComoCalidad(sesion);
    return typeof r === 'boolean' ? r : null;
  } catch (err) { return null; }
}

function crearBloqueP2B({ persistenciaPlan, validarSeguridadFn, generateWorkoutFn, calcularTNStub, getAthleteStateFn }) {
  const factory = new Function(
    'persistenciaPlan', 'validarSeguridad', 'generateWorkout',
    'calcularTrainingNeedInformativo', 'getAthleteState', 'computaCalidadBooleana',
    bloqueP2B + '\nreturn { construirFilaPlanPrevisto, generarPlanPrevistoDia, ensurePlanPrevistoDia };'
  );
  return factory(persistenciaPlan, validarSeguridadFn, generateWorkoutFn, calcularTNStub, getAthleteStateFn, computaCalidadBooleanaStub);
}

// ─── STUB DE persistenciaPlan (solo lecturas + congelación) ────
function crearPersistencia(cfg) {
  const llamadas = { planesLeidos: [], congelados: [] };
  const mod = {
    getPlanPrevistoDia: async (userId, fecha) => {
      llamadas.planesLeidos.push({ userId, fecha });
      if (cfg.readThrow) throw new Error('Supabase caído (lectura plan)');
      return cfg.plan !== undefined ? cfg.plan : null;
    },
    congelarPlanPrevisto: async (fila) => {
      llamadas.congelados.push(JSON.parse(JSON.stringify(fila)));
      if (cfg.freezeThrow) throw new Error('Supabase caído (escritura plan)');
      if (cfg.freezeError) return { ok: false, motivo: cfg.freezeError };
      return { ok: true };
    }
  };
  return { mod, llamadas };
}

// Stub determinista de generateWorkout: deriva del decision recibido
// (así se puede probar que el workout congelado corresponde EXACTAMENTE
// a la decisión congelada, incluida la versión reducida por el gate).
function crearGenerateWorkout() {
  const llamadas = [];
  const fn = (estado, restricciones, decision, traza) => {
    llamadas.push(JSON.parse(JSON.stringify(decision)));
    const tss = Number.isFinite(decision.tss) ? decision.tss : (decision.durMin || 45);
    return {
      tipo: decision.tipo, reps: decision.reps || 1, durMin: decision.durMin || 45,
      tssEsperado: Math.round(tss), ifEsperado: 0.70,
      vatios: { low: 100, high: 200 }, ftp: 240, bloques: []
    };
  };
  return { fn, llamadas };
}

// Stub del TN informativo: snapshot determinista del baseline.
function crearCalcularTN() {
  const llamadas = [];
  const fn = (decisionFinal, state) => {
    llamadas.push(JSON.parse(JSON.stringify(decisionFinal)));
    return { estado_calculo: 'sin_necesidad', snapshot_de: decisionFinal.tipo };
  };
  return { fn, llamadas };
}

// ─── FIXTURES ──────────────────────────────────────────────────
const STATE_BASE = () => ({
  decision: { tipo: 'sweetspot', reps: 3, durMin: 75, recSec: 90, intensidad: 0.88, motivo: 'Plan del entrenador' },
  workout: { tipo: 'sweetspot', tssEsperado: 92 },
  estado: { tsb: 5.0, acwr: 1.0, readiness: 80, hrv: 60, sleepQuality: 2, heatIndex: 22, dataQuality: 'OK' },
  restricciones: { forzarDescanso: false, forzarZ2: false, prohibirIntensidad: false, intensidadMax: 1.0 },
  traza: {}
});
const STATE_Z2 = () => ({ ...STATE_BASE(), decision: { tipo: 'z2', reps: 1, durMin: 60, recSec: 0, intensidad: 0.65, motivo: 'Decisión fresca distinta' } });
const PLAN_EXISTENTE = () => ({
  user_id: 'atleta1', fecha: '2026-09-02', tipo_previsto: 'sweetspot',
  duracion_prevista_min: 75, tss_previsto: 92, intensidad_prevista: 0.88,
  es_calidad: true, decision: { tipo: 'sweetspot', durMin: 75 }, workout: { tipo: 'sweetspot', tssEsperado: 92 },
  training_need: { estado_calculo: 'sin_necesidad' }, fuente: 'hoy', estado: 'VIGENTE'
});

// Cliente thenable mínimo para el módulo REAL de persistenciaPlan (congelación).
function clienteSupabase({ errorUpsert } = {}) {
  const from = () => {
    const st = { payload: null };
    const b = {
      upsert(payload) { st.payload = payload; return b; },
      then(resolve) {
        const res = st.payload
          ? (errorUpsert ? { data: null, error: errorUpsert } : { data: [{ id: 501 }], error: null })
          : { data: null, error: null };
        return Promise.resolve(res).then(resolve, () => {});
      }
    };
    return b;
  };
  return { from };
}

(async () => {

  // ─── P2B-1. Creación del plan cuando NO existe ────────────────
  await test('P2B-1. Sin plan → ensure congela el baseline (fuente \'hoy\') y lo devuelve', async () => {
    const { mod, llamadas } = crearPersistencia({ plan: null });
    const gw = crearGenerateWorkout();
    const tn = crearCalcularTN();
    const bloque = crearBloqueP2B({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal, generateWorkoutFn: gw.fn, calcularTNStub: tn.fn, getAthleteStateFn: async () => STATE_BASE() });
    const r = await bloque.ensurePlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02', state: STATE_BASE() });
    assert.strictEqual(r.creado, true);
    assert.ok(r.plan, 'el plan congelado se devuelve');
    assert.strictEqual(r.plan.user_id, 'atleta1');
    assert.strictEqual(r.plan.fecha, '2026-09-02');
    assert.strictEqual(r.plan.fuente, 'hoy');
    assert.strictEqual(r.plan.estado, 'VIGENTE');
    assert.strictEqual(r.plan.tipo_previsto, 'sweetspot');
    assert.strictEqual(r.plan.tss_previsto, 75, 'tss del workout generado para la decisión congelada');
    assert.strictEqual(llamadas.planesLeidos.length, 1, 'lectura previa read-or-freeze');
    assert.strictEqual(llamadas.congelados.length, 1, 'se congela exactamente una vez');
    assert.strictEqual(llamadas.congelados[0].fuente, 'hoy');
  });

  // ─── P2B-2. Lectura del plan existente ────────────────────────
  await test('P2B-2. Plan existente → se devuelve tal cual, sin congelar', async () => {
    const plan = PLAN_EXISTENTE();
    const { mod, llamadas } = crearPersistencia({ plan });
    const bloque = crearBloqueP2B({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal, generateWorkoutFn: crearGenerateWorkout().fn, calcularTNStub: crearCalcularTN().fn, getAthleteStateFn: async () => STATE_BASE() });
    const r = await bloque.ensurePlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02', state: STATE_BASE() });
    assert.strictEqual(r.creado, false);
    assert.strictEqual(r.plan, plan, 'es exactamente la fila persistida');
    assert.strictEqual(llamadas.congelados.length, 0, 'no se vuelve a congelar');
  });

  // ─── P2B-3. No sobrescritura ──────────────────────────────────
  await test('P2B-3. El plan congelado NUNCA se sobrescribe (read-or-freeze)', async () => {
    const plan = PLAN_EXISTENTE();
    const { mod, llamadas } = crearPersistencia({ plan });
    const bloque = crearBloqueP2B({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal, generateWorkoutFn: crearGenerateWorkout().fn, calcularTNStub: crearCalcularTN().fn, getAthleteStateFn: async () => STATE_Z2() });
    const r = await bloque.ensurePlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02', state: STATE_Z2() });
    assert.strictEqual(r.creado, false);
    assert.deepStrictEqual(r.plan, plan, 'la fila persistida queda intacta');
    assert.strictEqual(llamadas.congelados.length, 0, 'ni siquiera se intenta congelar con la decisión fresca');
  });

  // ─── P2B-4. Decisión fresca diferente no cambia el baseline ──
  await test('P2B-4. Tras congelar, una decisión fresca distinta NO cambia el baseline', async () => {
    const { mod, llamadas } = crearPersistencia({ plan: null });
    const bloque = crearBloqueP2B({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal, generateWorkoutFn: crearGenerateWorkout().fn, calcularTNStub: crearCalcularTN().fn, getAthleteStateFn: async () => STATE_Z2() });
    const r1 = await bloque.ensurePlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02', state: STATE_BASE() });
    assert.strictEqual(r1.creado, true);
    assert.strictEqual(r1.plan.tipo_previsto, 'sweetspot');
    // El día sigue: llega una decisión fresca distinta (z2) con el plan ya en BD.
    mod.getPlanPrevistoDia = async () => r1.plan;
    const r2 = await bloque.ensurePlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02', state: STATE_Z2() });
    assert.strictEqual(r2.creado, false);
    assert.strictEqual(r2.plan.tipo_previsto, 'sweetspot', 'el baseline congelado permanece estable');
    assert.strictEqual(llamadas.congelados.length, 1, 'solo la primera generación congela');
  });

  // ─── P2B-5. Seguridad ANTES de congelar ───────────────────────
  await test('P2B-5. El gate se aplica antes de congelar: ACWR 1.62 → se congela la versión reducida z2/25/0.60', async () => {
    const state = STATE_BASE();
    state.decision = { tipo: 'sweetspot', reps: 3, durMin: 75, recSec: 90, intensidad: 0.88, motivo: 'Plan' };
    state.estado.acwr = 1.62; // dispara el cap duro del gate
    const snapDecision = JSON.parse(JSON.stringify(state.decision));
    const gw = crearGenerateWorkout();
    const bloque = crearBloqueP2B({ persistenciaPlan: crearPersistencia({ plan: null }).mod, validarSeguridadFn: validarSeguridadReal, generateWorkoutFn: gw.fn, calcularTNStub: crearCalcularTN().fn, getAthleteStateFn: async () => state });
    const r = await bloque.ensurePlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02', state });
    assert.strictEqual(r.creado, true);
    assert.strictEqual(r.plan.decision.tipo, 'z2', 'se congela la versión segura, no la original');
    assert.strictEqual(r.plan.decision.durMin, 25);
    assert.strictEqual(r.plan.decision.intensidad, 0.60);
    assert.ok(r.plan.decision.motivo.includes('🔒 Gate seguridad'), 'el motivo documenta el gate');
    assert.strictEqual(gw.llamadas[0].tipo, 'z2', 'el workout se genera EXACTAMENTE para la decisión congelada (reducida)');
    assert.deepStrictEqual(state.decision, snapDecision, 'la decisión original NO se muta (el gate trabaja sobre copia)');
  });

  // ─── P2B-6. Decisión inválida → NO se congela ─────────────────
  await test('P2B-6. Sin decisión válida → NO se congela nada (ensure y generador)', async () => {
    const { mod, llamadas } = crearPersistencia({ plan: null });
    const bloque = crearBloqueP2B({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal, generateWorkoutFn: crearGenerateWorkout().fn, calcularTNStub: crearCalcularTN().fn, getAthleteStateFn: async () => ({ ...STATE_BASE(), decision: null }) });
    const r = await bloque.ensurePlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02', state: { ...STATE_BASE(), decision: null } });
    assert.strictEqual(r.plan, null);
    assert.strictEqual(r.creado, false);
    assert.strictEqual(r.error, 'sin_decision_valida');
    assert.strictEqual(llamadas.congelados.length, 0, 'nunca se inventa un plan');
    const rGen = await bloque.generarPlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02' });
    assert.strictEqual(rGen.ok, false);
    assert.strictEqual(rGen.motivo, 'sin_decision_valida');
    assert.strictEqual(llamadas.congelados.length, 0);
    // Sin state en el ensure → parametros_invalidos, sin llamadas a Supabase.
    const rSin = await bloque.ensurePlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02', state: null });
    assert.strictEqual(rSin.error, 'parametros_invalidos');
  });

  // ─── P2B-7. NO_DISPONIBLE → nunca una fila artificial SIN_DATOS ─
  await test('P2B-7. dataQuality NO_DISPONIBLE con decisión válida → plan VIGENTE, nunca SIN_DATOS', async () => {
    const state = STATE_BASE();
    state.estado.dataQuality = 'NO_DISPONIBLE';
    const { mod } = crearPersistencia({ plan: null });
    const bloque = crearBloqueP2B({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal, generateWorkoutFn: crearGenerateWorkout().fn, calcularTNStub: crearCalcularTN().fn, getAthleteStateFn: async () => state });
    const r = await bloque.ensurePlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02', state });
    assert.strictEqual(r.creado, true);
    assert.strictEqual(r.plan.estado, 'VIGENTE');
    // Contrato REAL: una fila SIN_DATOS se rechaza (C5) y la fila P2B se acepta.
    persistenciaPlanReal.__setCliente(clienteSupabase());
    const filaOK = r.plan;
    const respOK = await persistenciaPlanReal.congelarPlanPrevisto(filaOK);
    assert.strictEqual(respOK.ok, true, 'el módulo real acepta la fila del baseline');
    const filaSIN = { ...filaOK, estado: 'SIN_DATOS' };
    const respSIN = await persistenciaPlanReal.congelarPlanPrevisto(filaSIN);
    assert.strictEqual(respSIN.ok, false);
    assert.strictEqual(respSIN.motivo, 'sin_datos');
    persistenciaPlanReal.__resetCliente();
  });

  // ─── P2B-8. Error de lectura Supabase ─────────────────────────
  await test('P2B-8. Error de lectura → degradación segura: {plan:null, error}, sin excepción', async () => {
    const { mod, llamadas } = crearPersistencia({ readThrow: true });
    const bloque = crearBloqueP2B({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal, generateWorkoutFn: crearGenerateWorkout().fn, calcularTNStub: crearCalcularTN().fn, getAthleteStateFn: async () => STATE_BASE() });
    let sinExcepcion = true;
    let r = null;
    try {
      r = await bloque.ensurePlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02', state: STATE_BASE() });
    } catch (err) { sinExcepcion = false; }
    assert.ok(sinExcepcion, 'no debe lanzar excepción');
    assert.strictEqual(r.plan, null);
    assert.strictEqual(r.creado, false);
    assert.strictEqual(r.error, 'error');
    assert.strictEqual(llamadas.congelados.length, 0, 'con la lectura fallida no se intenta escribir');
  });

  // ─── P2B-9. Error de escritura Supabase ───────────────────────
  await test('P2B-9. Error de escritura → degradación segura, sin excepción (el plan se reintentará)', async () => {
    const { mod } = crearPersistencia({ freezeError: 'error' });
    const bloque = crearBloqueP2B({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal, generateWorkoutFn: crearGenerateWorkout().fn, calcularTNStub: crearCalcularTN().fn, getAthleteStateFn: async () => STATE_BASE() });
    let sinExcepcion = true;
    let r = null;
    try {
      r = await bloque.ensurePlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02', state: STATE_BASE() });
    } catch (err) { sinExcepcion = false; }
    assert.ok(sinExcepcion, 'no debe lanzar excepción');
    assert.strictEqual(r.plan, null);
    assert.strictEqual(r.error, 'error');
    // Escritura que lanza excepción también se captura:
    const { mod: mod2 } = crearPersistencia({ freezeThrow: true });
    const bloque2 = crearBloqueP2B({ persistenciaPlan: mod2, validarSeguridadFn: validarSeguridadReal, generateWorkoutFn: crearGenerateWorkout().fn, calcularTNStub: crearCalcularTN().fn, getAthleteStateFn: async () => STATE_BASE() });
    let sinExcepcion2 = true;
    let r2 = null;
    try {
      r2 = await bloque2.ensurePlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02', state: STATE_BASE() });
    } catch (err) { sinExcepcion2 = false; }
    assert.ok(sinExcepcion2, 'escritura que lanza → capturada sin excepción');
    assert.strictEqual(r2.error, 'error');
  });

  // ─── P2B-10. Scheduler repetido (idempotencia 'cron') ────────
  await test('P2B-10. Scheduler repetido: primera vez congela (cron), segunda devuelve el existente', async () => {
    const { mod, llamadas } = crearPersistencia({ plan: null });
    const bloque = crearBloqueP2B({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal, generateWorkoutFn: crearGenerateWorkout().fn, calcularTNStub: crearCalcularTN().fn, getAthleteStateFn: async () => STATE_BASE() });
    const r1 = await bloque.generarPlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02' });
    assert.strictEqual(r1.ok, true);
    assert.strictEqual(r1.creado, true);
    assert.strictEqual(r1.plan.fuente, 'cron', 'el scheduler congela con fuente \'cron\'');
    assert.strictEqual(llamadas.congelados[0].fuente, 'cron');
    mod.getPlanPrevistoDia = async () => r1.plan;
    const r2 = await bloque.generarPlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02' });
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(r2.creado, false, 'segunda ejecución del cron: no duplica ni sobrescribe');
    assert.strictEqual(llamadas.congelados.length, 1, 'solo la primera ejecución congela');
    // Scheduler fallido (getAthleteState → null) → ok:false, y el lazy-ensure recupera después:
    const bloqueFallido = crearBloqueP2B({ persistenciaPlan: crearPersistencia({ plan: null }).mod, validarSeguridadFn: validarSeguridadReal, generateWorkoutFn: crearGenerateWorkout().fn, calcularTNStub: crearCalcularTN().fn, getAthleteStateFn: async () => null });
    const rFail = await bloqueFallido.generarPlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02' });
    assert.strictEqual(rFail.ok, false);
    assert.strictEqual(rFail.motivo, 'sin_decision_valida');
    // El lazy-ensure (misma capa de persistencia) recupera el plan en la
    // siguiente interacción, reutilizando el state ya calculado:
    const rRec = await bloqueFallido.ensurePlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02', state: STATE_BASE() });
    assert.strictEqual(rRec.creado, true, 'el lazy-ensure recupera el plan tras un scheduler fallido');
  });

  // ─── P2B-11. Lazy-ensure repetido (idempotencia 'hoy') ───────
  await test('P2B-11. Lazy-ensure repetido: sin re-congelar ni cambiar el baseline', async () => {
    const { mod, llamadas } = crearPersistencia({ plan: null });
    const bloque = crearBloqueP2B({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal, generateWorkoutFn: crearGenerateWorkout().fn, calcularTNStub: crearCalcularTN().fn, getAthleteStateFn: async () => STATE_BASE() });
    const r1 = await bloque.ensurePlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02', state: STATE_BASE() });
    assert.strictEqual(r1.creado, true);
    mod.getPlanPrevistoDia = async () => r1.plan;
    const r2 = await bloque.ensurePlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02', state: STATE_Z2() });
    const r3 = await bloque.ensurePlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02', state: STATE_BASE() });
    assert.strictEqual(r2.creado, false);
    assert.strictEqual(r3.creado, false);
    assert.strictEqual(llamadas.congelados.length, 1, 'un solo congelado en total');
    assert.strictEqual(r3.plan.tipo_previsto, 'sweetspot');
  });

  // ─── P2B-12. Llamadas concurrentes / idempotencia ─────────────
  await test('P2B-12. Dos ensure simultáneos sin plan: ninguno lanza; la BD (PK+ignoreDuplicates) arbitra', async () => {
    const { mod, llamadas } = crearPersistencia({ plan: null });
    const bloque = crearBloqueP2B({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal, generateWorkoutFn: crearGenerateWorkout().fn, calcularTNStub: crearCalcularTN().fn, getAthleteStateFn: async () => STATE_BASE() });
    const [a, b] = await Promise.all([
      bloque.ensurePlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02', state: STATE_BASE() }),
      bloque.ensurePlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02', state: STATE_BASE() })
    ]);
    assert.ok(a.plan && b.plan, 'ambas llamadas resuelven sin excepción');
    assert.strictEqual(llamadas.congelados.length, 2, 'ambas intentan congelar; la deduplicación real la garantiza la PK de Supabase (TP15/TP16)');
    assert.strictEqual(llamadas.congelados[0].fecha, '2026-09-02');
    assert.strictEqual(llamadas.congelados[1].user_id, 'atleta1');
  });

  // ─── P2B-13. Ausencia de recursión ────────────────────────────
  await test('P2B-13. Prohibición de recursión: ensure/generador NUNCA llaman a getAthleteStateConAjuste ni se llaman entre sí', () => {
    const desdeGenerar = bloqueP2B.indexOf('async function generarPlanPrevistoDia(');
    const hastaEnsure = bloqueP2B.indexOf('// Lazy-ensure');
    const desdeEnsure = bloqueP2B.indexOf('async function ensurePlanPrevistoDia(');
    assert.ok(desdeGenerar !== -1 && hastaEnsure > desdeGenerar && desdeEnsure > hastaEnsure, 'anclas del bloque P2B');
    const cuerpoGenerar = bloqueP2B.slice(desdeGenerar, hastaEnsure);
    const cuerpoEnsure = bloqueP2B.slice(desdeEnsure);
    assert.ok(!/getAthleteStateConAjuste/.test(cuerpoGenerar), 'el generador no llama a getAthleteStateConAjuste');
    assert.ok(!/ensurePlanPrevistoDia/.test(cuerpoGenerar), 'el generador no llama al lazy-ensure');
    assert.ok(!/getAthleteState\s*\(/.test(cuerpoEnsure), 'el lazy-ensure NO re-ejecuta getAthleteState() (solo reutiliza el state ya calculado)');
    assert.ok(!/getAthleteStateConAjuste/.test(cuerpoEnsure), 'el lazy-ensure no llama a getAthleteStateConAjuste');
    // El generador sí usa el pipeline base getAthleteState():
    assert.ok(/getAthleteState\s*\(/.test(cuerpoGenerar), 'el generador usa el pipeline base getAthleteState()');
  });

  // ─── P2B-14. /hoy sigue funcionando aunque falle la congelación ─
  await test('P2B-14. Orden canónico en /hoy: gate → TN → lazy-ensure → SE; fallo de ensure no rompe nada', async () => {
    const idxGate = srcIndex.indexOf('decisionAjustada = validarSeguridad(decisionAjustada, state.estado, state.restricciones);');
    const idxTN = srcIndex.indexOf('const trainingNeed = calcularTrainingNeedInformativo(decisionAjustada, state);');
    const idxEnsure = srcIndex.indexOf('const planPrevistoEnsure = await ensurePlanPrevistoDia({');
    const idxSE = srcIndex.indexOf('const resultadoSustitucion = await ejecutarSustitucionP2({');
    assert.ok(idxGate !== -1 && idxTN !== -1 && idxEnsure !== -1 && idxSE !== -1, 'anclas del orden en getAthleteStateConAjuste');
    assert.ok(idxGate < idxTN, 'gate antes que TN');
    assert.ok(idxTN < idxEnsure, 'TN antes que el lazy-ensure');
    assert.ok(idxEnsure < idxSE, 'lazy-ensure ANTES de ejecutarSustitucionP2 (el plan debe existir antes de evaluar sustituciones)');
    // El call-site del ensure pasa el state YA calculado (pre-intención) y el id canónico:
    const cierre = srcIndex.indexOf('});', idxEnsure);
    const callSite = srcIndex.slice(idxEnsure, cierre + 3);
    assert.ok(/userId:\s*CONFIG\.ATHLETE_USER_ID/.test(callSite), 'userId canónico en el ensure');
    assert.ok(/fecha:\s*formatDate\(new Date\(\)\)/.test(callSite), 'fecha local del día');
    assert.ok(/\bstate\b/.test(callSite), 'reutiliza el state ya calculado');
    assert.ok(!/getAthleteState\s*\(/.test(callSite), 'el call-site no re-ejecuta getAthleteState');
    // Con congelación fallida (P2B-9 ya probado) el ensure devuelve {plan:null}; el flujo continúa:
    const { mod } = crearPersistencia({ freezeError: 'error' });
    const bloque = crearBloqueP2B({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal, generateWorkoutFn: crearGenerateWorkout().fn, calcularTNStub: crearCalcularTN().fn, getAthleteStateFn: async () => STATE_BASE() });
    const r = await bloque.ensurePlanPrevistoDia({ userId: 'atleta1', fecha: '2026-09-02', state: STATE_BASE() });
    assert.strictEqual(r.plan, null); // /hoy continuaría con planPrevisto: null
    assert.ok(r.error, 'el fallo queda reportado, no lanzado');
  });

  // ─── P2B-16. Baseline PRE-INTENCIÓN (criterio especial §13) ──
  await test('P2B-16. El plan congelado es PRE-INTENCIÓN: usa state.decision, sin motorIntencion/cerebro/SE', async () => {
    // Comportamiento: la fila se construye desde state.decision (sweetspot),
    // jamás desde una decisión post-intención.
    const gw = crearGenerateWorkout();
    const tn = crearCalcularTN();
    const bloque = crearBloqueP2B({ persistenciaPlan: crearPersistencia({ plan: null }).mod, validarSeguridadFn: validarSeguridadReal, generateWorkoutFn: gw.fn, calcularTNStub: tn.fn, getAthleteStateFn: async () => STATE_BASE() });
    const fila = bloque.construirFilaPlanPrevisto({ userId: 'atleta1', fecha: '2026-09-02', state: STATE_BASE(), fuente: 'hoy' });
    assert.strictEqual(fila.decision.tipo, 'sweetspot', 'baseline del entrenador, no la intención');
    assert.strictEqual(tn.llamadas[0].tipo, 'sweetspot', 'el TN snapshot se calcula sobre el baseline (no post-intención)');
    assert.strictEqual(fila.training_need.snapshot_de, 'sweetspot');
    assert.strictEqual(gw.llamadas[0].tipo, 'sweetspot', 'workout exacto de la decisión congelada');
    assert.strictEqual(fila.es_calidad, true);
    // Estático: el bloque P2B no referencia ninguna capa de mutación posterior.
    assert.ok(!/motorIntencion/.test(bloqueP2B), 'sin motorIntencion en la congelación');
    assert.ok(!/ajustarPlanAutomaticamente/.test(bloqueP2B), 'sin ajustarPlanAutomaticamente en la congelación');
    assert.ok(!/esIntencion/.test(bloqueP2B), 'sin marcador de intención en la congelación');
    assert.ok(!/evaluarSustitucionPipeline/.test(bloqueP2B), 'sin Substitution Engine en la congelación');
    // El call-site del ensure en /hoy pasa state (pre-intención), no decisionAjustada.
    const idxEnsure = srcIndex.indexOf('const planPrevistoEnsure = await ensurePlanPrevistoDia({');
    const cierre = srcIndex.indexOf('});', idxEnsure);
    const callSite = srcIndex.slice(idxEnsure, cierre + 3);
    assert.ok(!/decisionAjustada/.test(callSite), 'el ensure recibe state (baseline), no la decisión ajustada');
  });

  // ─── P2B-17. Endpoint cron: POST /api/cron/plan-diario ───────
  await test('P2B-17. Endpoint cron protegido con X-Cron-Secret y CONFIG.CRON_SECRET (sin CONFIG en el bloque)', () => {
    const marca = "app.post('/api/cron/plan-diario'";
    const ini = srcIndex.indexOf(marca);
    assert.ok(ini !== -1, 'ruta POST /api/cron/plan-diario no localizada');
    const fin = srcIndex.indexOf('\n});', ini);
    const ruta = srcIndex.slice(ini, fin + 4);
    assert.ok(/x-cron-secret/.test(ruta), 'lee la cabecera X-Cron-Secret');
    assert.ok(/CONFIG\.CRON_SECRET/.test(ruta), 'compara contra CONFIG.CRON_SECRET');
    assert.ok(/401/.test(ruta), 'sin secret correcto → 401');
    assert.ok(/generarPlanPrevistoDia\(\{/.test(ruta), 'invoca el generador del plan');
    assert.ok(/userId:\s*CONFIG\.ATHLETE_USER_ID/.test(ruta), 'id canónico del atleta');
    assert.ok(!/getAthleteStateConAjuste/.test(ruta), 'la ruta cron NO usa el flujo ajustado');
    // CONFIG define CRON_SECRET desde el entorno (ausente → null → 401).
    const idxCronCfg = srcIndex.indexOf('CRON_SECRET: process.env.CRON_SECRET');
    assert.ok(idxCronCfg !== -1 && idxCronCfg < ini, 'CONFIG.CRON_SECRET definido antes de las rutas');
  });

  // ─── P2B-15. Compatibilidad total con los 86 tests actuales ──
  await test('P2B-15. Compatibilidad total: todas las suites previas (incl. P2) siguen verdes', async () => {
    const suites = [
      'test_validarSeguridad.js', 'test_trainingNeed.js', 'test_integracionTN.js',
      'test_substitutionEngine.js', 'test_integracionSE.js',
      'test_ajustarPlanAutomaticamente.js', 'test_persistenciaPlan.js',
      'test_integracionP2.js'
    ];
    const fallos = [];
    for (const s of suites) {
      const ruta = path.join(__dirname, s);
      try {
        const out = execFileSync(process.execPath, [ruta], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        const resumen = (out.split('\n').filter(l => /RESULTADO|pasados/.test(l)).pop() || out.trim()).slice(0, 140);
        console.log(`    ↳ ${s} ✅ — ${resumen.replace(/\s+/g, ' ')}`);
      } catch (err) {
        fallos.push(s);
        const detalle = String((err.stdout || '') + (err.stderr || '') + (err.message || ''));
        console.log(`    ↳ ${s} ❌\n${detalle.split('\n').slice(-10).join('\n')}`);
      }
    }
    assert.strictEqual(fallos.length, 0, 'suites con regresiones: ' + fallos.join(', '));
  });

  persistenciaPlanReal.__resetCliente();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`INTEGRACIÓN P2B: ${pasados} pasados, ${fallados} fallados`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(fallados > 0 ? 1 : 0);

})().catch(err => {
  console.log('❌ ERROR FATAL del runner de tests:', err && err.message);
  process.exit(1);
});