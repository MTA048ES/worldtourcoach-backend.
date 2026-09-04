// ═══════════════════════════════════════════════════════════════
// 🧪 TESTS — Integración P2: persistenciaPlan.js ↔ pipeline F2 (index.js)
// Ejecutar: node tests/test_integracionP2.js
//
// index.js NO es importable (arranca app.listen al requerirse), así que
// —igual que test_integracionSE / test_integracionTN— extraemos el bloque
// P2 REAL del fuente (helpers + ejecutor) y lo evaluamos con stubs de
// persistencia y el adapter evaluarSustitucionPipeline REAL.
//
// Cubre los 15 puntos obligatorios de P2:
//   P2-1  Plan existente → se lee correctamente (como referencia prevista)
//   P2-2  Plan inexistente → no se inventa sustitución ni plan
//   P2-3  El contador semanal se transmite correctamente al motor
//   P2-4  Contador = 0 → evaluación normal
//   P2-5  Contador = 3 → sustitución bloqueada
//   P2-6  Contador = null (error) → NO se desbloquea sustitución
//   P2-7  aplicada === false → NO existe escritura
//   P2-8  aplicada === true → se intenta registrar (payload válido según
//        contrato de persistenciaPlan.js, verificado contra el módulo REAL)
//   P2-9  validarSeguridad() se ejecuta nuevamente tras la evaluación
//   P2-10 Si la segunda validación rechaza/reduce → NO se registra
//   P2-11 Error de Supabase → /hoy continúa sin excepción
//   P2-12 La decisión original NO se modifica antes de evaluar
//   P2-13 Los datos persistidos del plan se pasan correctamente como contexto
//   P2-14 Una sustitución registrada no altera retrospectivamente la decisión
//   P2-15 Compatibilidad total con todos los tests anteriores
//   P2-16 El call-site de P2 usa CONFIG.ATHLETE_USER_ID (nunca CHAT_ID/'default')
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

// ─── EXTRAER EL BLOQUE P2 REAL DE index.js ─────────────────────
const INI_P2 = '// 🧩 P2 — ORQUESTACIÓN DE SUSTITUCIÓN CON PERSISTENCIA';
const FIN_P2 = '\n// ─── TRAINING NEED: CONTEXTO SEMANAL';
const idxP2Ini = srcIndex.indexOf(INI_P2);
const idxP2Fin = srcIndex.indexOf(FIN_P2);
assert.ok(idxP2Ini !== -1, 'No se encontró el bloque P2 en index.js');
assert.ok(idxP2Fin > idxP2Ini, 'El bloque P2 debe estar antes del banner de Training Need en el fuente');
const bloqueP2 = srcIndex.slice(idxP2Ini, idxP2Fin);

// Adapter REAL evaluarSustitucionPipeline (mismo patrón que test_integracionSE).
const INI_SE = '// ─── SUBSTITUTION ENGINE: EVALUACIÓN EN PIPELINE';
const FIN_SE = '\n// ─── CEREBRO: ANALIZAR CUMPLIMIENTO DEL PLAN';
const idxSeIni = srcIndex.indexOf(INI_SE);
const idxSeFin = srcIndex.indexOf(FIN_SE);
assert.ok(idxSeIni !== -1 && idxSeFin > idxSeIni, 'Adapter SE no localizado en index.js');
const bloqueSE = srcIndex.slice(idxSeIni, idxSeFin);

function crearAdapter(validarSeguridadFn) {
  const factory = new Function(
    'substitutionEngine', 'validarSeguridad',
    bloqueSE + '\nreturn { evaluarSustitucionPipeline };'
  );
  return factory(substitutionEngineMod, validarSeguridadFn).evaluarSustitucionPipeline;
}

function crearBloqueP2({ persistenciaPlan, validarSeguridadFn }) {
  const factory = new Function(
    'persistenciaPlan', 'validarSeguridad', 'evaluarSustitucionPipeline', 'substitutionEngine',
    bloqueP2 + '\nreturn { construirSesionPrevista, sustitucionSigueAplicable, construirRegistroSustitucion, registrarSustitucionAceptadaEnPersistencia, ejecutarSustitucionP2 };'
  );
  return factory(persistenciaPlan, validarSeguridadFn, crearAdapter(validarSeguridadFn), substitutionEngineMod);
}

// ─── STUB DE persistenciaPlan (registra lecturas y escrituras) ─
function crearPersistencia(cfg) {
  const llamadas = { planesLeidos: [], contadoresLeidos: [], registros: [] };
  const mod = {
    getPlanPrevistoDia: async (userId, fecha) => {
      llamadas.planesLeidos.push({ userId, fecha });
      if (cfg.planThrow) throw new Error('Supabase caído (plan)');
      if (cfg.planError) return null;
      return cfg.plan !== undefined ? cfg.plan : null;
    },
    getSustitucionesSemana: async (userId, fecha) => {
      llamadas.contadoresLeidos.push({ userId, fecha });
      if (cfg.countThrow) throw new Error('Supabase caído (contador)');
      if (cfg.countError) return null;   // C2: error → null, NUNCA 0
      return cfg.count !== undefined ? cfg.count : 0;
    },
    registrarSustitucion: async (registro) => {
      llamadas.registros.push(JSON.parse(JSON.stringify(registro)));
      if (cfg.insertError) return { ok: false, motivo: 'error' };
      return { ok: true, id: cfg.insertId !== undefined ? cfg.insertId : 101 };
    }
  };
  return { mod, llamadas };
}

// Cliente thenable mínimo para el módulo REAL de persistenciaPlan (TP-style).
function clienteSupabase({ planRow, count }) {
  const from = (tabla) => {
    const st = { payload: null };
    const b = {
      select() { return b; },
      eq() { return b; },
      gte() { return b; },
      lte() { return b; },
      maybeSingle() { return b; },
      insert(payload) { st.payload = payload; return b; },
      then(resolve) {
        let res;
        if (st.payload) res = { data: [{ id: 321 }], error: null };
        else if (tabla === 'plan_previsto_diario') res = { data: planRow || null, error: null };
        else res = { count: typeof count === 'number' ? count : 0, error: null };
        return Promise.resolve(res).then(resolve, () => {});
      }
    };
    return b;
  };
  return { from };
}

// ─── FIXTURES ──────────────────────────────────────────────────
const PLAN_BASE = () => ({
  user_id: 'atleta1', fecha: '2026-09-02',
  tipo_previsto: 'sweetspot', duracion_prevista_min: 75, tss_previsto: 92,
  intensidad_prevista: 0.88, es_calidad: true,
  decision: { tipo: 'sweetspot', reps: 3, durMin: 75, recSec: 90, intensidad: 0.88, motivo: 'Plan' },
  workout: { tipo: 'sweetspot', tssEsperado: 92, ifEsperado: 0.88 },
  training_need: { estado_calculo: 'necesidad_detectada' },
  estado: 'VIGENTE', fuente: 'scheduler'
});

// Decisión fresca del pipeline (DISTINTA del plan: z2/60/80) para poder
// demostrar que la referencia prevista del motor es el plan congelado.
const STATE_BASE = () => ({
  decision: { tipo: 'z2', reps: 1, durMin: 60, recSec: 0, intensidad: 0.65, motivo: 'Decisión fresca del día' },
  workout: { tipo: 'z2', tssEsperado: 80 },
  estado: { tsb: 5.0, acwr: 1.0, readiness: 80, hrv: 60, sleepQuality: 2, heatIndex: 22, flags: {} },
  restricciones: { forzarDescanso: false, forzarZ2: false, prohibirIntensidad: false, intensidadMax: 1.0 },
  traza: {}
});

// Intención grupeta (misma forma que la salida de motorIntencion + tss).
const GRUPETA = () => ({
  tipo: 'grupeta', reps: 1, durMin: 120, recSec: 0, intensidad: 0.88, tss: 110,
  motivo: '🎯 Intención: grupeta', esIntencion: true, tipoIntencion: 'grupeta'
});

const TN_OK = () => ({ estado_calculo: 'sin_necesidad' });

async function ejecutarCon(cfgPersistencia, decisionAjustada, state, trainingNeed) {
  const { mod } = crearPersistencia(cfgPersistencia);
  const bloque = crearBloqueP2({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal });
  return bloque.ejecutarSustitucionP2({
    state: state || STATE_BASE(),
    decisionAjustada: decisionAjustada !== undefined ? decisionAjustada : GRUPETA(),
    trainingNeed: trainingNeed !== undefined ? trainingNeed : TN_OK(),
    userId: 'atleta1',
    fecha: '2026-09-02'
  });
}

(async () => {

  // ─── P2-1. Plan existente → se lee correctamente ─────────────
  await test('P2-1. Plan congelado existente → se lee y se usa como sesión prevista de referencia', async () => {
    const { mod, llamadas } = crearPersistencia({ plan: PLAN_BASE(), count: 0 });
    const bloque = crearBloqueP2({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal });
    const r = await bloque.ejecutarSustitucionP2({
      state: STATE_BASE(), decisionAjustada: GRUPETA(), trainingNeed: TN_OK(),
      userId: 'atleta1', fecha: '2026-09-02'
    });
    assert.deepStrictEqual(llamadas.planesLeidos, [{ userId: 'atleta1', fecha: '2026-09-02' }], 'el plan del día se lee con el userId/fecha correctos');
    assert.strictEqual(r.planPrevisto.user_id, 'atleta1');
    assert.strictEqual(r.evaluacionSustitucion.estado, 'aceptada', 'evaluado contra el plan congelado (sweetspot 92 vs grupeta 110 = +19.6%)');
    assert.strictEqual(r.evaluacionSustitucion.aplicada, true);
    assert.strictEqual(r.decisionFinalUsada.tipo, 'grupeta');
    assert.strictEqual(r.decisionFinalUsada.sustitucion.tss_previsto, 92);
    assert.strictEqual(r.decisionFinalUsada.sustitucion.desviacion_tss_pct, 19.6);
  });

  // ─── P2-2. Plan inexistente → no se inventa sustitución ni plan ─
  await test('P2-2. Sin plan congelado → NO se inventa sustitución ni plan (degradación segura)', async () => {
    const { mod, llamadas } = crearPersistencia({ plan: null, count: 0 });
    const bloque = crearBloqueP2({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal });
    const r = await bloque.ejecutarSustitucionP2({
      state: STATE_BASE(), decisionAjustada: GRUPETA(), trainingNeed: TN_OK(),
      userId: 'atleta1', fecha: '2026-09-02'
    });
    assert.strictEqual(r.evaluacionSustitucion.estado, 'sin_plan_previsto');
    assert.strictEqual(r.evaluacionSustitucion.aplicada, false);
    assert.strictEqual(r.decisionFinalUsada, null);
    assert.strictEqual(r.planPrevisto, null, 'no se inventa plan');
    assert.strictEqual(llamadas.registros.length, 0, 'no se registra sustitución fantasma');
  });

  // ─── P2-3. El contador semanal se transmite al motor ──────────
  await test('P2-3. Contador semanal llega al motor: con contador 0 el motor evalúa (aceptada)', async () => {
    const { mod, llamadas } = crearPersistencia({ plan: PLAN_BASE(), count: 0 });
    const bloque = crearBloqueP2({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal });
    const r = await bloque.ejecutarSustitucionP2({
      state: STATE_BASE(), decisionAjustada: GRUPETA(), trainingNeed: TN_OK(),
      userId: 'atleta1', fecha: '2026-09-02'
    });
    assert.strictEqual(llamadas.contadoresLeidos.length, 1, 'el contador se lee una vez');
    assert.strictEqual(r.sustitucionesSemana, 0);
    // Si el contador NO hubiera llegado (null), el motor respondería
    // dependencia_persistencia; que responda 'aceptada' demuestra la transmisión.
    assert.notStrictEqual(r.evaluacionSustitucion.estado, 'dependencia_persistencia');
    assert.strictEqual(r.evaluacionSustitucion.estado, 'aceptada');
  });

  // ─── P2-4. Contador = 0 → evaluación normal ───────────────────
  await test('P2-4. Contador 0 → evaluación normal: sustitución válida aplicada y registrada', async () => {
    const { mod, llamadas } = crearPersistencia({ plan: PLAN_BASE(), count: 0 });
    const bloque = crearBloqueP2({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal });
    const r = await bloque.ejecutarSustitucionP2({
      state: STATE_BASE(), decisionAjustada: GRUPETA(), trainingNeed: TN_OK(),
      userId: 'atleta1', fecha: '2026-09-02'
    });
    assert.strictEqual(r.evaluacionSustitucion.estado, 'aceptada');
    assert.strictEqual(r.evaluacionSustitucion.aplicada, true);
    assert.deepStrictEqual(r.registroIntento, { ok: true, id: 101 }, 'se intenta y logra el registro');
    assert.strictEqual(llamadas.registros.length, 1);
  });

  // ─── P2-5. Contador = 3 → sustitución bloqueada ───────────────
  await test('P2-5. Contador 3 → 4ª sustitución bloqueada: rechazada, sin registro', async () => {
    const { mod, llamadas } = crearPersistencia({ plan: PLAN_BASE(), count: 3 });
    const bloque = crearBloqueP2({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal });
    const r = await bloque.ejecutarSustitucionP2({
      state: STATE_BASE(), decisionAjustada: GRUPETA(), trainingNeed: TN_OK(),
      userId: 'atleta1', fecha: '2026-09-02'
    });
    assert.strictEqual(r.evaluacionSustitucion.estado, 'rechazada');
    assert.strictEqual(r.evaluacionSustitucion.aplicada, false);
    assert.strictEqual(r.decisionFinalUsada, null);
    assert.strictEqual(llamadas.registros.length, 0, 'nunca se escribe con el límite alcanzado');
  });

  // ─── P2-6. Contador = null (error) → NO se desbloquea ─────────
  await test('P2-6. Contador null por error Supabase → dependencia_persistencia, sin registro', async () => {
    const { mod, llamadas } = crearPersistencia({ plan: PLAN_BASE(), countError: true });
    const bloque = crearBloqueP2({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal });
    const r = await bloque.ejecutarSustitucionP2({
      state: STATE_BASE(), decisionAjustada: GRUPETA(), trainingNeed: TN_OK(),
      userId: 'atleta1', fecha: '2026-09-02'
    });
    assert.strictEqual(r.sustitucionesSemana, null, 'nunca se convierte null en 0');
    assert.strictEqual(r.evaluacionSustitucion.estado, 'dependencia_persistencia');
    assert.strictEqual(r.evaluacionSustitucion.aplicada, false);
    assert.strictEqual(llamadas.registros.length, 0, 'error → NO se desbloquea una sustitución');
  });

  // ─── P2-7. aplicada === false → NO existe escritura ───────────
  await test('P2-7. Sustitución no válida (fuera de ±30%) → aplicada false y NINGUNA escritura', async () => {
    const fueraRango = { ...GRUPETA(), tss: 160 }; // +73.9% vs 92 → no_valida
    const { mod, llamadas } = crearPersistencia({ plan: PLAN_BASE(), count: 0 });
    const bloque = crearBloqueP2({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal });
    const r = await bloque.ejecutarSustitucionP2({
      state: STATE_BASE(), decisionAjustada: fueraRango, trainingNeed: TN_OK(),
      userId: 'atleta1', fecha: '2026-09-02'
    });
    assert.strictEqual(r.evaluacionSustitucion.estado, 'no_valida');
    assert.strictEqual(r.evaluacionSustitucion.aplicada, false);
    assert.strictEqual(r.decisionFinalUsada, null);
    assert.strictEqual(llamadas.registros.length, 0, 'aplicada === false → no hay escritura');
  });

  // ─── P2-8. aplicada === true → se intenta registrar ───────────
  await test('P2-8. Sustitución aplicada → registro con payload correcto y válido según contrato REAL', async () => {
    const { mod, llamadas } = crearPersistencia({ plan: PLAN_BASE(), count: 0 });
    const bloque = crearBloqueP2({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal });
    const r = await bloque.ejecutarSustitucionP2({
      state: STATE_BASE(), decisionAjustada: GRUPETA(), trainingNeed: TN_OK(),
      userId: 'atleta1', fecha: '2026-09-02'
    });
    assert.strictEqual(r.evaluacionSustitucion.aplicada, true);
    assert.strictEqual(llamadas.registros.length, 1, 'aplicada === true → se intenta registrar');
    const reg = llamadas.registros[0];
    // Datos congelados previstos (plan) + datos de la sustitución
    assert.strictEqual(reg.user_id, 'atleta1');
    assert.strictEqual(reg.fecha, '2026-09-02');
    assert.strictEqual(reg.prevista_tipo, 'sweetspot');
    assert.strictEqual(reg.prevista_tss, 92);
    assert.strictEqual(reg.prevista_duracion_min, 75);
    assert.strictEqual(reg.prevista_es_calidad, true);
    assert.strictEqual(reg.sustituta_tipo, 'grupeta');
    assert.strictEqual(reg.sustituta_tss, 110);
    assert.strictEqual(reg.sustituta_duracion_min, 120);
    assert.strictEqual(reg.sustituta_es_calidad, true);
    assert.strictEqual(reg.categoria, 'grupeta');
    assert.deepStrictEqual(reg.training_need_congelado, { estado_calculo: 'necesidad_detectada' });
    assert.ok(reg.motivo.includes('Sustitución'), 'el motivo documenta la sustitución');
    assert.strictEqual('tss_real' in reg, false, 'tss_real se queda en null hasta la sync (P3)');

    // El payload cumple el contrato del módulo REAL (allowlist + decision=aceptada):
    persistenciaPlanReal.__setCliente(clienteSupabase({ planRow: PLAN_BASE(), count: 0 }));
    const resp = await persistenciaPlanReal.registrarSustitucion(reg);
    assert.strictEqual(resp.ok, true, 'el módulo real acepta el registro');
    assert.strictEqual(resp.id, 321);
    persistenciaPlanReal.__resetCliente();
  });

  // ─── P2-9. validarSeguridad() se ejecuta NUEVAMENTE tras la evaluación ─
  await test('P2-9. Segunda pasada de validarSeguridad() tras evaluarSustitucionPipeline', async () => {
    const llamadasValidar = [];
    const vg = (d, e, r) => { llamadasValidar.push(JSON.parse(JSON.stringify(d))); return validarSeguridadReal(d, e, r); };
    const { mod } = crearPersistencia({ plan: PLAN_BASE(), count: 0 });
    const bloque = crearBloqueP2({ persistenciaPlan: mod, validarSeguridadFn: vg });
    const r = await bloque.ejecutarSustitucionP2({
      state: STATE_BASE(), decisionAjustada: GRUPETA(), trainingNeed: TN_OK(),
      userId: 'atleta1', fecha: '2026-09-02'
    });
    assert.strictEqual(r.evaluacionSustitucion.aplicada, true);
    assert.ok(llamadasValidar.length >= 2, `validarSeguridad debe ejecutarse de nuevo tras la evaluación (llamadas: ${llamadasValidar.length})`);
    const ultima = llamadasValidar[llamadasValidar.length - 1];
    assert.ok(ultima && ultima.sustitucion, 'la segunda validación recibe la decisión final con metadatos de sustitución');
    assert.strictEqual(ultima.tipo, 'grupeta');
  });

  // ─── P2-10. Segunda validación rechaza/reduce → NO se registra ─
  await test('P2-10. La revalidación reduce la sustitución (ACWR 1.62) → NO se registra como aceptada', async () => {
    const estadoACWR = { tsb: 5.0, acwr: 1.62, readiness: 55, heatIndex: 22, flags: {} };
    const stateACWR = { ...STATE_BASE(), estado: estadoACWR };
    const { mod, llamadas } = crearPersistencia({ plan: PLAN_BASE(), count: 0 });
    const bloque = crearBloqueP2({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal });
    const r = await bloque.ejecutarSustitucionP2({
      state: stateACWR, decisionAjustada: GRUPETA(), trainingNeed: TN_OK(),
      userId: 'atleta1', fecha: '2026-09-02'
    });
    assert.strictEqual(r.evaluacionSustitucion.estado, 'aceptada', 'el motor acepta (carga dentro de ±30%)');
    assert.strictEqual(r.evaluacionSustitucion.aplicada, true);
    assert.strictEqual(r.decisionFinalUsada.tipo, 'z2', 'el gate prevalece sobre la sustitución (S9)');
    assert.strictEqual(r.decisionFinalUsada.durMin, 25);
    assert.strictEqual(llamadas.registros.length, 0, 'la sustitución reducida por la 2ª validación NO se registra');
  });

  // ─── P2-11. Error de Supabase → /hoy continúa sin excepción ──
  await test('P2-11. Fallos de Supabase en lecturas → sin excepción y comportamiento degradado', async () => {
    // Caso A: fallan AMBAS lecturas
    let sinExcepcion = true;
    let rA = null;
    try {
      const { mod } = crearPersistencia({ planThrow: true, countThrow: true });
      const bloque = crearBloqueP2({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal });
      rA = await bloque.ejecutarSustitucionP2({
        state: STATE_BASE(), decisionAjustada: GRUPETA(), trainingNeed: TN_OK(),
        userId: 'atleta1', fecha: '2026-09-02'
      });
    } catch (err) { sinExcepcion = false; }
    assert.ok(sinExcepcion, 'no debe lanzar excepción cuando Supabase falla');
    assert.strictEqual(rA.evaluacionSustitucion.estado, 'sin_plan_previsto', 'degradación segura: no se actúa');
    assert.strictEqual(rA.evaluacionSustitucion.aplicada, false);

    // Caso B: solo falla el contador (el plan sí se leyó)
    let rB = null;
    try {
      const { mod } = crearPersistencia({ plan: PLAN_BASE(), countThrow: true });
      const bloque = crearBloqueP2({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal });
      rB = await bloque.ejecutarSustitucionP2({
        state: STATE_BASE(), decisionAjustada: GRUPETA(), trainingNeed: TN_OK(),
        userId: 'atleta1', fecha: '2026-09-02'
      });
    } catch (err) { sinExcepcion = false; }
    assert.ok(sinExcepcion, 'no debe lanzar excepción cuando el contador falla');
    assert.strictEqual(rB.evaluacionSustitucion.estado, 'dependencia_persistencia', 'contador desconocido → no se desbloquea');
    assert.strictEqual(rB.evaluacionSustitucion.aplicada, false);
  });

  // ─── P2-12. La decisión original NO se modifica antes de evaluar ─
  await test('P2-12. No-mutación: decisión original, candidato y plan intactos antes/durante/después', async () => {
    const state = STATE_BASE();
    const candidato = GRUPETA();
    const plan = PLAN_BASE();
    const snapStateDecision = JSON.parse(JSON.stringify(state.decision));
    const snapCandidato = JSON.parse(JSON.stringify(candidato));
    const snapPlan = JSON.parse(JSON.stringify(plan));
    const { mod } = crearPersistencia({ plan, count: 0 });
    const bloque = crearBloqueP2({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal });
    const r = await bloque.ejecutarSustitucionP2({
      state, decisionAjustada: candidato, trainingNeed: TN_OK(),
      userId: 'atleta1', fecha: '2026-09-02'
    });
    assert.strictEqual(r.evaluacionSustitucion.aplicada, true);
    assert.deepStrictEqual(state.decision, snapStateDecision, 'state.decision no debe mutarse antes de evaluar');
    assert.deepStrictEqual(candidato, snapCandidato, 'el candidato (decisión adaptada) no debe mutarse');
    assert.deepStrictEqual(plan, snapPlan, 'el plan persistido no debe mutarse');
  });

  // ─── P2-13. Datos persistidos del plan → contexto del motor ──
  await test('P2-13. El plan persistido llega como contexto: se evalúa contra el plan, no contra la decisión fresca', async () => {
    const state = STATE_BASE(); // decisión fresca z2/60/80 — distinta del plan
    const { mod } = crearPersistencia({ plan: PLAN_BASE(), count: 0 });
    const bloque = crearBloqueP2({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal });
    // La sesión prevista construida desde el plan:
    const prevista = bloque.construirSesionPrevista(PLAN_BASE(), state);
    assert.strictEqual(prevista.tipo, 'sweetspot', 'tipo previsto desde el plan congelado');
    assert.strictEqual(prevista.tssEsperado, 92, 'tss previsto desde el plan congelado');
    assert.strictEqual(prevista.durMin, 75);
    assert.strictEqual(prevista.intensidad, 0.88);
    assert.strictEqual(prevista.es_calidad, true);
    assert.strictEqual(prevista.desdePlanCongelado, true);
    // Y la evaluación usa esa referencia: grupeta 110 vs 92 (+19.6% → aceptada).
    // Contra la decisión fresca (80) sería +37.5% → no_valida.
    const r = await bloque.ejecutarSustitucionP2({
      state, decisionAjustada: GRUPETA(), trainingNeed: TN_OK(),
      userId: 'atleta1', fecha: '2026-09-02'
    });
    assert.strictEqual(r.evaluacionSustitucion.estado, 'aceptada', 'se evaluó contra el plan persistido (92), no contra la decisión fresca (80)');
    assert.strictEqual(r.decisionFinalUsada.sustitucion.tss_previsto, 92);
    assert.strictEqual(r.decisionFinalUsada.sustitucion.tipo_previsto, 'sweetspot');
  });

  // ─── P2-14. Una sustitución registrada no altera retrospectivamente ─
  await test('P2-14. El registro no altera retrospectivamente la decisión original ni el plan', async () => {
    const state = STATE_BASE();
    const candidato = GRUPETA();
    const snapStateDecision = JSON.parse(JSON.stringify(state.decision));
    const snapCandidato = JSON.parse(JSON.stringify(candidato));
    const { mod } = crearPersistencia({ plan: PLAN_BASE(), count: 0 });
    const bloque = crearBloqueP2({ persistenciaPlan: mod, validarSeguridadFn: validarSeguridadReal });
    const r = await bloque.ejecutarSustitucionP2({
      state, decisionAjustada: candidato, trainingNeed: TN_OK(),
      userId: 'atleta1', fecha: '2026-09-02'
    });
    assert.deepStrictEqual(r.registroIntento, { ok: true, id: 101 }, 'registrada');
    assert.deepStrictEqual(state.decision, snapStateDecision, 'la decisión original queda intacta tras registrar');
    assert.deepStrictEqual(candidato, snapCandidato, 'el candidato queda intacto tras registrar');
    assert.notStrictEqual(r.decisionFinalUsada, candidato, 'la decisión final aplicada es un objeto nuevo, no el candidato original');
  });

  // ─── P2-16. Identificador canónico en el call-site de P2 ─────
  await test('P2-16. El call-site de P2 pasa userId: CONFIG.ATHLETE_USER_ID (no CHAT_ID ni \'default\')', async () => {
    // El bloque P2 extraído es agnóstico del CONFIG (recibe userId como
    // parámetro); el identificador real se fija en el call-site dentro de
    // getAthleteStateConAjuste. Verificación estática sobre el fuente REAL.
    const marca = 'const resultadoSustitucion = await ejecutarSustitucionP2({';
    const ini = srcIndex.indexOf(marca);
    assert.ok(ini !== -1, 'call-site de ejecutarSustitucionP2 no localizado en index.js');
    const cierre = srcIndex.indexOf('});', ini);
    assert.ok(cierre > ini, 'cierre del call-site no localizado');
    const callSite = srcIndex.slice(ini, cierre + 3);
    // Comprobación sobre la línea de la propiedad userId (no sobre comentarios).
    const lineaUserId = callSite.split('\n').find(l => /userId\s*:/.test(l));
    assert.ok(lineaUserId, 'línea userId no localizada en el call-site');
    assert.ok(/userId:\s*CONFIG\.ATHLETE_USER_ID\s*,$/.test(lineaUserId.trim()),
      'la propiedad userId debe ser CONFIG.ATHLETE_USER_ID → ' + lineaUserId.trim());
    assert.ok(!/CONFIG\.CHAT_ID/.test(lineaUserId),
      'la propiedad userId NO debe usar CONFIG.CHAT_ID');
    assert.ok(!/'default'/.test(lineaUserId),
      'la propiedad userId NO debe usar el fallback \'default\'');
  });

  // ─── P2-15. Compatibilidad total con los tests anteriores ────
  await test('P2-15. Compatibilidad total: todas las suites previas siguen verdes', async () => {
    const suites = [
      'test_validarSeguridad.js', 'test_trainingNeed.js', 'test_integracionTN.js',
      'test_substitutionEngine.js', 'test_integracionSE.js',
      'test_ajustarPlanAutomaticamente.js', 'test_persistenciaPlan.js'
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
  console.log(`INTEGRACIÓN P2: ${pasados} pasados, ${fallados} fallados`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(fallados > 0 ? 1 : 0);

})().catch(err => {
  console.log('❌ ERROR FATAL del runner de tests:', err && err.message);
  process.exit(1);
});
