// ═══════════════════════════════════════════════════════════════
// 🧪 TESTS — Cumplimiento del plan contra plan_previsto_diario
// Ejecutar: node tests/test_analizarCumplimientoPlan.js
//
// Cubre el arreglo de analizarCumplimientoPlan() (index.js):
//   - el falso 100% desaparece: ya NO depende de getAthleteState() ni de
//     obtenerHistorial(), y ya no hay early-returns que devuelvan 100% ciego;
//   - el plan se lee de plan_previsto_diario vía
//     persistenciaPlan.getPlanesPrevistosFechas() (nueva, aditiva, única
//     consulta .eq(user_id).in(fecha)) con CONFIG.ATHLETE_USER_ID (nunca CHAT_ID);
//   - contrato de salida: estado, tieneDesviaciones, porcentajeCumplimiento,
//     desviaciones, recomendacion, totalActividades, conPlan, sinPlan, ok,
//     evaluadas, error;
//   - los días sin plan se registran {fecha, estado:'sin_plan'} y NO cuentan
//     como incumplimiento (parcial ≠ ok ≠ 100%);
//   - los consumidores (/sync y cmdAprender) solo afirman el 100% con
//     estado === 'ok'.
//
// Igual que test_integracionP2B.js, index.js no es importable: extraemos el
// cuerpo REAL de analizarCumplimientoPlan() del fuente y lo evaluamos con
// stubs (persistenciaPlan, obtenerActividadesReales, CONFIG, formatDate,
// safeNum). persistenciaPlan.js SÍ es importable: se prueba el contrato real
// de getPlanesPrevistosFechas con __setCliente() y un cliente fake thenable.
// ═══════════════════════════════════════════════════════════════
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const persistenciaPlanReal = require('../persistenciaPlan.js');

let pasados = 0, fallados = 0;
async function test(nombre, fn) {
  try { await fn(); console.log('  ✅ ' + nombre); pasados++; }
  catch (err) { fallados++; console.log('  ❌ ' + nombre + '\n     ' + err.message); }
}

const srcIndex = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

// ─── EXTRAER EL CUERPO REAL DE analizarCumplimientoPlan() ──────
const INI_FN = 'async function analizarCumplimientoPlan() {';
const INI_PROC = '// ─── PROCESAR RESPUESTA DE DESVIACIÓN';
const idxFn = srcIndex.indexOf(INI_FN);
const idxFin = srcIndex.indexOf(INI_PROC, idxFn);
assert.ok(idxFn !== -1, 'No se encontró analizarCumplimientoPlan() en index.js');
assert.ok(idxFin > idxFn, 'El banner de procesarRespuestaDesviacion debe venir después');
const fuenteFn = srcIndex.slice(idxFn, srcIndex.lastIndexOf('\n', idxFin));

// El cuerpo usa free identifiers que el runner inyecta: persistenciaPlan,
// CONFIG, obtenerActividadesReales, formatDate, safeNum (console/Date/Math son
// globales). No debe usar getAthleteState ni obtenerHistorial (assert CP-13).
function crearAnalizador({ actividades, planRespuesta = { ok: true, planes: [] }, planThrow = false, falloActividades = false }) {
  const llamadas = { actividades: [], planes: [] };
  const persistenciaPlan = {
    getPlanesPrevistosFechas: async (userId, fechas) => {
      llamadas.planes.push({ userId, fechas: fechas.slice() });
      if (planThrow) throw new Error('Supabase caído (plan)');
      return planRespuesta;
    }
  };
  const CONFIG = {
    CHAT_ID: 'chat_telegram',
    ATHLETE_USER_ID: 'atleta_939',
    FTP: 240
  };
  const obtenerActividadesReales = async (opts) => {
    llamadas.actividades.push(opts);
    if (falloActividades) return { ok: false, error: 'Supabase caído (actividades)', actividades: [] };
    return { ok: true, actividades: actividades || [] };
  };
  // formatDate determinista (UTC) para las fechas ISO de los fixtures.
  const formatDate = (d) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const safeNum = (val, fallback = 0) => {
    const n = Number(val);
    return (isNaN(n) || val === null || val === undefined) ? fallback : n;
  };
  const factory = new Function(
    'persistenciaPlan', 'CONFIG', 'obtenerActividadesReales', 'formatDate', 'safeNum',
    fuenteFn + '\nreturn { analizarCumplimientoPlan };'
  );
  return { fn: factory(persistenciaPlan, CONFIG, obtenerActividadesReales, formatDate, safeNum).analizarCumplimientoPlan, llamadas };
}

// ─── FIXTURES ──────────────────────────────────────────────────
const FECHAS_7 = [
  '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03',
  '2026-09-04', '2026-09-05', '2026-09-06'
];
// Actividad en el formato canónico de obtenerActividadesReales (fecha ISO).
const ACT = (fecha, tss, np) => ({ fecha: fecha + 'T12:00:00.000Z', tss, np, user_id: 'atleta_939' });
// Fila de plan_previsto_diario (campos usados: fecha, tipo_previsto, tss_previsto).
const PLAN = (fecha, tipo, tss) => ({ user_id: 'atleta_939', fecha, tipo_previsto: tipo, tss_previsto: tss });
// ─── CLIENTE FAKE thenable para persistenciaPlan REAL ─────────
function crearClientePlan(cfg) {
  const llamadas = { consultas: [] };
  function builder(tabla) {
    const st = { tabla, selectArgs: null, filtros: [] };
    const b = {
      select(args) { st.selectArgs = args; return b; },
      eq(col, val) { st.filtros.push(['eq', col, val]); return b; },
      in(col, vals) { st.filtros.push(['in', col, vals]); return b; },
      then(resolve) {
        llamadas.consultas.push(st);
        const res = cfg.error
          ? { data: null, error: cfg.error }
          : { data: cfg.planes || [], error: null };
        return Promise.resolve(res).then(resolve);
      }
    };
    return b;
  }
  return { cliente: { from: builder }, llamadas };
}

(async () => {

  // ─── CONTRATO REAL DE persistenciaPlan.getPlanesPrevistosFechas ─
  await test('CP-1. getPlanesPrevistosFechas éxito: una única consulta .eq(user_id).in(fecha) → {ok:true, planes}', async () => {
    const filas = [PLAN('2026-09-01', 'z2', 41), PLAN('2026-09-02', 'sweetspot', 90)];
    const { cliente, llamadas } = crearClientePlan({ planes: filas });
    persistenciaPlanReal.__setCliente(cliente);
    try {
      const fechas = ['2026-09-01', '2026-09-02', '2026-09-03'];
      const r = await persistenciaPlanReal.getPlanesPrevistosFechas('atleta1', fechas);
      assert.deepStrictEqual(r, { ok: true, planes: filas });
      assert.strictEqual(llamadas.consultas.length, 1, 'una única consulta de solo lectura');
      const st = llamadas.consultas[0];
      assert.strictEqual(st.tabla, 'plan_previsto_diario');
      assert.strictEqual(st.selectArgs, '*');
      assert.deepStrictEqual(st.filtros, [
        ['eq', 'user_id', 'atleta1'],
        ['in', 'fecha', fechas]
      ]);
    } finally {
      persistenciaPlanReal.__resetCliente();
    }
  });

  await test('CP-2. getPlanesPrevistosFechas: error Supabase → {ok:false}, sin lanzar; sin cliente → {ok:false}', async () => {
    const { cliente } = crearClientePlan({ error: { message: 'conexión rechazada' } });
    persistenciaPlanReal.__setCliente(cliente);
    try {
      const r = await persistenciaPlanReal.getPlanesPrevistosFechas('atleta1', ['2026-09-01']);
      assert.deepStrictEqual(r, { ok: false });
    } finally {
      persistenciaPlanReal.__resetCliente();
    }
    persistenciaPlanReal.__setCliente(null); // modo degradado forzado
    try {
      const r2 = await persistenciaPlanReal.getPlanesPrevistosFechas('atleta1', ['2026-09-01']);
      assert.deepStrictEqual(r2, { ok: false });
      const r3 = await persistenciaPlanReal.getPlanesPrevistosFechas('atleta1', []);
      assert.deepStrictEqual(r3, { ok: false });
      const r4 = await persistenciaPlanReal.getPlanesPrevistosFechas(null, ['2026-09-01']);
      assert.deepStrictEqual(r4, { ok: false });
    } finally {
      persistenciaPlanReal.__resetCliente();
    }
  });

  // ─── CASO CLAVE: TSS real 53 vs plan TSS 41 tipo z2 → ok ─────
  await test('CP-3. Actividad TSS 53 real vs plan z2 TSS 41 → estado ok y 100% para esa actividad evaluada', async () => {
    const { fn } = crearAnalizador({
      actividades: [ACT('2026-09-02', 53, 100)], // np 100 → realTipo z2 (IF 0.42)
      planRespuesta: { ok: true, planes: [PLAN('2026-09-02', 'z2', 41)] }
    });
    const r = await fn();
    assert.strictEqual(r.estado, 'ok');
    assert.strictEqual(r.tieneDesviaciones, false);
    assert.strictEqual(r.porcentajeCumplimiento, 100);
    assert.deepStrictEqual(r.desviaciones, [], '|53-41|=12 no supera el 30% de 41 (12.3)');
    assert.strictEqual(r.totalActividades, 1);
    assert.strictEqual(r.conPlan, 1);
    assert.strictEqual(r.sinPlan, 0);
    assert.strictEqual(r.ok, 1);
    assert.strictEqual(r.evaluadas, 1);
    assert.strictEqual(r.error, false);
  });

  // ─── ok ───────────────────────────────────────────────────────
  await test('CP-4. 7 actividades todas con plan y cumpliendo → estado ok, 100%, sin sin_plan', async () => {
    const { fn } = crearAnalizador({
      actividades: FECHAS_7.map(f => ACT(f, 55, 100)), // z2, |55-50|=5 ≤ 15 → cumple
      planRespuesta: { ok: true, planes: FECHAS_7.map(f => PLAN(f, 'z2', 50)) }
    });
    const r = await fn();
    assert.strictEqual(r.estado, 'ok');
    assert.strictEqual(r.tieneDesviaciones, false);
    assert.strictEqual(r.porcentajeCumplimiento, 100);
    assert.strictEqual(r.totalActividades, 7);
    assert.strictEqual(r.conPlan, 7);
    assert.strictEqual(r.sinPlan, 0);
    assert.strictEqual(r.ok, 7);
    assert.strictEqual(r.evaluadas, 7);
    assert.deepStrictEqual(r.desviaciones, []);
  });

  // ─── desviacion ───────────────────────────────────────────────
  await test('CP-5. Plan sweetspot realizado ftp (IF>0.95) con TSS en ±30% → estado desviacion por tipo', async () => {
    const { fn } = crearAnalizador({
      actividades: [ACT('2026-09-01', 100, 234), ACT('2026-09-02', 53, 100)], // 234/240=0.975 → ftp
      planRespuesta: { ok: true, planes: [PLAN('2026-09-01', 'sweetspot', 90), PLAN('2026-09-02', 'z2', 41)] }
    });
    const r = await fn();
    assert.strictEqual(r.estado, 'desviacion');
    assert.strictEqual(r.tieneDesviaciones, true);
    assert.strictEqual(r.totalActividades, 2);
    assert.strictEqual(r.conPlan, 2);
    assert.strictEqual(r.sinPlan, 0);
    assert.strictEqual(r.ok, 1, 'solo la actividad z2 cumple');
    assert.strictEqual(r.evaluadas, 2);
    assert.strictEqual(r.porcentajeCumplimiento, 50);
    assert.strictEqual(r.desviaciones.length, 1, 'solo la desviación real (sin entradas sin_plan)');
    const d = r.desviaciones[0];
    assert.strictEqual(d.planTipo, 'sweetspot');
    assert.strictEqual(d.realTipo, 'ftp');
    assert.strictEqual(d.planTSS, 90);
    assert.strictEqual(d.realTSS, 100);
    assert.strictEqual(d.diferenciaTSS, 10);
    assert.ok(/Tipo diferente/.test(d.motivo), 'motivo por tipo');
  });

  await test('CP-6. TSS fuera de ±30% (real 90 vs plan 41) → estado desviacion por TSS', async () => {
    const { fn } = crearAnalizador({
      actividades: [ACT('2026-09-02', 90, 100)], // z2, |90-41|=49 > 12.3
      planRespuesta: { ok: true, planes: [PLAN('2026-09-02', 'z2', 41)] }
    });
    const r = await fn();
    assert.strictEqual(r.estado, 'desviacion');
    assert.strictEqual(r.tieneDesviaciones, true);
    assert.strictEqual(r.porcentajeCumplimiento, 0);
    assert.strictEqual(r.desviaciones.length, 1);
    assert.strictEqual(r.desviaciones[0].diferenciaTSS, 49);
    assert.ok(/más de lo planeado/.test(r.desviaciones[0].motivo));
    assert.strictEqual(r.ok, 0);
  });

  // ─── parcial (clave del arreglo) ──────────────────────────────
  await test('CP-7. 7 actividades, solo 1 fecha con plan (cumple), 6 sin plan → parcial, NUNCA ok ni PERFECTO', async () => {
    const { fn } = crearAnalizador({
      actividades: [
        ACT('2026-08-31', 40, 100), ACT('2026-09-01', 40, 100),
        ACT('2026-09-02', 53, 100), // única con plan: z2/41 → cumple
        ACT('2026-09-03', 40, 100), ACT('2026-09-04', 40, 100),
        ACT('2026-09-05', 40, 100), ACT('2026-09-06', 40, 100)
      ],
      planRespuesta: { ok: true, planes: [PLAN('2026-09-02', 'z2', 41)] }
    });
    const r = await fn();
    assert.strictEqual(r.estado, 'parcial', 'no puede ser ok: hay actividades sin plan');
    assert.notStrictEqual(r.estado, 'ok');
    assert.strictEqual(r.tieneDesviaciones, false, 'los días sin plan NO son incumplimiento');
    assert.strictEqual(r.totalActividades, 7);
    assert.strictEqual(r.conPlan, 1);
    assert.strictEqual(r.sinPlan, 6);
    assert.strictEqual(r.ok, 1);
    assert.strictEqual(r.evaluadas, 1, 'solo las actividades con plan se evalúan');
    assert.strictEqual(r.porcentajeCumplimiento, 100, 'fórmula: round(ok/evaluadas*100); el 100% SOLO se afirma en estado ok');
    // Los días sin plan quedan registrados como {fecha, estado:'sin_plan'}:
    assert.strictEqual(r.desviaciones.length, 6);
    const fechasSinPlan = r.desviaciones.map(d => d.fecha).sort();
    const esperadas = FECHAS_7.filter(f => f !== '2026-09-02').sort();
    assert.deepStrictEqual(fechasSinPlan, esperadas);
    assert.ok(r.desviaciones.every(d => d.estado === 'sin_plan' && d.planTipo === undefined), 'entradas sin_plan sin campos de desviación');
  });

  // ─── sin_plan ─────────────────────────────────────────────────
  await test('CP-8. Actividades sin NINGUNA fecha con plan congelado → estado sin_plan, porcentaje null', async () => {
    const { fn } = crearAnalizador({
      actividades: [ACT('2026-09-01', 53, 100), ACT('2026-09-02', 40, 100), ACT('2026-09-03', 40, 100)],
      planRespuesta: { ok: true, planes: [] }
    });
    const r = await fn();
    assert.strictEqual(r.estado, 'sin_plan');
    assert.strictEqual(r.porcentajeCumplimiento, null);
    assert.strictEqual(r.tieneDesviaciones, false);
    assert.strictEqual(r.conPlan, 0);
    assert.strictEqual(r.evaluadas, 0);
    assert.strictEqual(r.ok, 0);
    assert.strictEqual(r.sinPlan, 3);
    assert.strictEqual(r.desviaciones.length, 3);
    assert.ok(r.desviaciones.every(d => d.estado === 'sin_plan'));
    assert.strictEqual(r.error, false);
  });

  // ─── sin_actividades ──────────────────────────────────────────
  await test('CP-9. Sin actividades (vacío o error de actividades) → estado sin_actividades, porcentaje null', async () => {
    const { fn } = crearAnalizador({ actividades: [] });
    const r1 = await fn();
    assert.strictEqual(r1.estado, 'sin_actividades');
    assert.strictEqual(r1.porcentajeCumplimiento, null);
    assert.strictEqual(r1.tieneDesviaciones, false);
    assert.strictEqual(r1.totalActividades, 0);
    assert.strictEqual(r1.error, false);
    const { fn: fn2 } = crearAnalizador({ actividades: [], falloActividades: true });
    const r2 = await fn2();
    assert.strictEqual(r2.estado, 'sin_actividades');
    assert.strictEqual(r2.porcentajeCumplimiento, null);
  });

  // ─── error ────────────────────────────────────────────────────
  await test('CP-10. Fallo de la consulta del plan (ok:false y excepción) → estado error, sin falso 100%', async () => {
    const { fn } = crearAnalizador({
      actividades: [ACT('2026-09-02', 53, 100)],
      planRespuesta: { ok: false }
    });
    const r = await fn();
    assert.strictEqual(r.estado, 'error');
    assert.strictEqual(r.error, true);
    assert.strictEqual(r.porcentajeCumplimiento, null);
    assert.strictEqual(r.tieneDesviaciones, false);
    assert.deepStrictEqual(r.desviaciones, []);
    // La excepción también queda capturada (nunca un 100% ciego):
    const { fn: fn2 } = crearAnalizador({
      actividades: [ACT('2026-09-02', 53, 100)],
      planThrow: true
    });
    const r2 = await fn2();
    assert.strictEqual(r2.estado, 'error');
    assert.strictEqual(r2.error, true);
    assert.strictEqual(r2.porcentajeCumplimiento, null);
  });

  // ─── identidad del plan ───────────────────────────────────────
  await test('CP-11. La consulta del plan usa CONFIG.ATHLETE_USER_ID (nunca CHAT_ID) y las 7 fechas del periodo', async () => {
    const { fn, llamadas } = crearAnalizador({
      actividades: FECHAS_7.map(f => ACT(f, 55, 100)),
      planRespuesta: { ok: true, planes: FECHAS_7.map(f => PLAN(f, 'z2', 50)) }
    });
    await fn();
    assert.strictEqual(llamadas.planes.length, 1, 'una única consulta de plan');
    assert.strictEqual(llamadas.planes[0].userId, 'atleta_939', 'CONFIG.ATHLETE_USER_ID');
    assert.notStrictEqual(llamadas.planes[0].userId, 'chat_telegram', 'jamás CONFIG.CHAT_ID');
    assert.deepStrictEqual(llamadas.planes[0].fechas, FECHAS_7, 'las 7 fechas del periodo actual');
    // Las actividades siguen leyéndose con la identidad original del comando:
    assert.strictEqual(llamadas.actividades[0].userId, 'chat_telegram');
    assert.strictEqual(llamadas.actividades[0].limite, 7);
    assert.strictEqual(llamadas.actividades[0].soloCiclismo, true);
  });

  // ─── z2 planificado no exige tipo exacto ──────────────────────
  await test('CP-12. z2 planificado NO exige coincidencia exacta de tipo: real vo2 con TSS en ±30% → ok', async () => {
    const { fn } = crearAnalizador({
      actividades: [ACT('2026-09-02', 53, 260)], // 260/240=1.08 → vo2
      planRespuesta: { ok: true, planes: [PLAN('2026-09-02', 'z2', 41)] }
    });
    const r = await fn();
    assert.strictEqual(r.estado, 'ok', 'desviacionTipo = planTipo !== realTipo && planTipo !== z2 → false');
    assert.strictEqual(r.porcentajeCumplimiento, 100);
    assert.deepStrictEqual(r.desviaciones, []);
  });

  // ─── estático: dependencias del cuerpo ────────────────────────
  await test('CP-13. La implementación ya no depende de getAthleteState ni obtenerHistorial', () => {
    assert.ok(!/getAthleteState/.test(fuenteFn), 'sin getAthleteState (causa del falso 100%)');
    assert.ok(!/obtenerHistorial/.test(fuenteFn), 'sin historial de decisiones');
    assert.ok(/persistenciaPlan\.getPlanesPrevistosFechas/.test(fuenteFn), 'plan desde plan_previsto_diario');
    assert.ok(/CONFIG\.ATHLETE_USER_ID/.test(fuenteFn), 'id canónico del atleta');
    assert.ok(/tipo_previsto/.test(fuenteFn) && /tss_previsto/.test(fuenteFn), 'campos del plan usados');
    assert.ok(!/plan\.decision\b/.test(fuenteFn), 'plan.decision NO participa en el cálculo');
    assert.ok(!/plan\.workout\b/.test(fuenteFn), 'plan.workout NO participa en el cálculo');
    assert.ok(!/plan\.training_need/.test(fuenteFn), 'plan.training_need NO participa en el cálculo');
  });

  // ─── estático: consumidores con gate por estado ───────────────
  await test('CP-14. cmdSync: el PERFECTO/100% SOLO bajo estado ok; los días sin plan no se listan como desviación', () => {
    const ini = srcIndex.indexOf('const analisis = await analizarCumplimientoPlan();');
    const fin = srcIndex.indexOf("setUserProperty('esperando_respuesta_desviacion', 'true');", ini);
    assert.ok(ini !== -1 && fin > ini, 'bloque de cmdSync localizado');
    const bloque = srcIndex.slice(ini, fin + 1);
    const idxOk = bloque.indexOf("analisis.estado === 'ok'");
    const idxPerf = bloque.indexOf('🎯 *¡PERFECTO!*');
    assert.ok(idxOk !== -1 && idxPerf !== -1, 'rama estado ok y texto PERFECTO presentes');
    assert.ok(idxOk < idxPerf, 'el PERFECTO/100% solo puede estar en la rama estado === ok');
    assert.ok(!/tieneDesviaciones/.test(bloque), 'el gate ya no es tieneDesviaciones');
    assert.ok(bloque.includes('No se pudo consultar el plan congelado (Supabase). Cumplimiento no evaluado.'), 'mensaje error');
    assert.ok(bloque.includes('No hay plan congelado para estas fechas — no se puede evaluar cumplimiento.'), 'mensaje sin_plan');
    assert.ok(bloque.includes('No hay actividades recientes en este periodo'), 'mensaje sin_actividades');
    assert.ok(bloque.includes('quedaron sin plan'), 'mensaje parcial');
    assert.ok(/estado === 'desviacion'/.test(bloque), 'la lista de desviaciones va en la rama desviacion');
    assert.ok(/d\.estado !== 'sin_plan'/.test(bloque), 'las entradas sin_plan se excluyen de la lista/prompt');
    assert.ok(!/analisis\.tieneDesviaciones\s*&&/.test(bloque), 'el guardado para la conversación ya no depende de tieneDesviaciones');
  });

  await test('CP-15. cmdAprender: el "Excelente al 100%" SOLO bajo estado ok', () => {
    const ini = srcIndex.indexOf('// ─── SECCIÓN 3: ANÁLISIS DE DESVIACIONES');
    const fin = srcIndex.indexOf('// ─── SECCIÓN 4', ini);
    assert.ok(ini !== -1 && fin > ini, 'SECCIÓN 3 localizada');
    const bloque = srcIndex.slice(ini, fin);
    const idxOk = bloque.indexOf("estado === 'ok'");
    const idxExcelente = bloque.indexOf('Excelente! Estás cumpliendo al 100% con el plan.');
    assert.ok(idxOk !== -1 && idxExcelente !== -1, 'rama estado ok y texto Excelente presentes');
    assert.ok(idxOk < idxExcelente, 'el 100% solo puede afirmarse en la rama estado === ok');
    assert.ok(!/tieneDesviaciones/.test(bloque), 'el gate ya no es tieneDesviaciones');
    assert.ok(/desviacionesReales\.length/.test(bloque), 'cuenta solo desviaciones reales');
    assert.ok(bloque.includes('CUMPLIMIENTO PARCIAL'), 'rama parcial coherente');
    assert.ok(bloque.includes('No hay plan congelado para estas fechas'), 'rama sin_plan coherente');
    assert.ok(bloque.includes('No hay actividades recientes en este periodo'), 'rama sin_actividades coherente');
    assert.ok(bloque.includes('Cumplimiento no evaluado.'), 'rama error coherente');
  });

  persistenciaPlanReal.__resetCliente();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`CUMPLIMIENTO PLAN: ${pasados} pasados, ${fallados} fallados`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(fallados > 0 ? 1 : 0);

})().catch(err => {
  console.log('❌ ERROR FATAL del runner de tests:', err && err.message);
  process.exit(1);
});
