// ═══════════════════════════════════════════════════════════════
// 🧪 TESTS — persistenciaPlan.js (fase P1/P2, diseño aprobado)
// Ejecutar: node tests/test_persistenciaPlan.js
//
// A diferencia de index.js, persistenciaPlan.js SÍ es importable
// (cliente Supabase lazy + inyectable), así que estos tests usan el
// módulo REAL con un stub de cliente que emula el query builder
// (thenable, igual que el real). Sin red, sin credenciales.
//
// Cubre las condiciones aprobadas:
//   C1 contador = COUNT de aceptadas en registro_sustituciones
//   C2 error Supabase en contador → null (NUNCA 0)
//   C4 las lecturas jamás insertan
//   C5 el plan no se inventa (SIN_DATOS / sin decision+workout → no congelar)
//   C8 degradación segura: nada lanza; /hoy podría degradar sin romperse
//   idempotencia (23505 → duplicada), límite 3, sin plan, no-mutación
// ═══════════════════════════════════════════════════════════════
const assert = require('node:assert/strict');
const persistenciaPlan = require('../persistenciaPlan.js');

let pasados = 0, fallados = 0;
async function test(nombre, fn) {
  try { await fn(); console.log('  ✅ ' + nombre); pasados++; }
  catch (err) { fallados++; console.log('  ❌ ' + nombre + '\n     ' + err.message); }
}

// ─── STUB del cliente Supabase (thenable, como el builder real) ──
function crearStubCliente(cfg) {
  const llamadas = { selects: [], insertados: [] };
  function builder(tabla) {
    const st = { tabla, filtros: [], selectArgs: null, maybeSingle: false, insertPayload: null };
    const b = {
      select(args, opts) { st.selectArgs = { args, opts: opts || null }; llamadas.selects.push(st); return b; },
      eq(col, val) { st.filtros.push(['eq', col, val]); return b; },
      gte(col, val) { st.filtros.push(['gte', col, val]); return b; },
      lte(col, val) { st.filtros.push(['lte', col, val]); return b; },
      maybeSingle() { st.maybeSingle = true; return b; },
      upsert(payload, opts) { st.insertPayload = payload; st.upsertOpts = opts || null; llamadas.insertados.push(st); return b; },
      insert(payload) { st.insertPayload = payload; llamadas.insertados.push(st); return b; },
      then(resolve, reject) {
        let res;
        if (st.insertPayload) {
          if (cfg.errorInsert) res = { data: null, error: cfg.errorInsert };
          else if (cfg.simularDuplicado) res = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "registro_sust_unica_por_dia"' } };
          else res = { data: [{ id: 101 }], error: null };
        } else if (st.tabla === 'plan_previsto_diario') {
          res = { data: cfg.planError ? null : (cfg.planRow !== undefined ? cfg.planRow : null), error: cfg.planError || null };
        } else {
          res = { count: cfg.countError ? null : (typeof cfg.count === 'number' ? cfg.count : 0), error: cfg.countError || null };
        }
        return Promise.resolve(res).then(resolve, reject);
      }
    };
    return b;
  }
  return { cliente: { from: builder }, llamadas };
}

function inyectar(cfg) {
  const stub = crearStubCliente(cfg);
  persistenciaPlan.__setCliente(stub.cliente);
  return stub.llamadas;
}

const PLAN_BASE = () => ({
  user_id: 'atleta1', fecha: '2026-09-02', tipo_previsto: 'tempo',
  duracion_prevista_min: 60, tss_previsto: 80, intensidad_prevista: 0.88,
  es_calidad: true, decision: { tipo: 'tempo' }, workout: { tssEsperado: 80 },
  training_need: { estado_calculo: 'sin_necesidad' }, fuente: 'scheduler', estado: 'VIGENTE'
});
const REG_BASE = () => ({
  user_id: 'atleta1', fecha: '2026-09-02',
  prevista_tipo: 'tempo', prevista_tss: 80, prevista_duracion_min: 60, prevista_es_calidad: true,
  sustituta_tipo: 'grupeta', sustituta_tss: 110, sustituta_duracion_min: 120, sustituta_es_calidad: true,
  categoria: 'grupeta', motivo: '🎯 Intención: grupeta',
  training_need_congelado: { estado_calculo: 'necesidad_detectada' }
});

(async () => {

  // ─── LECTURA DEL PLAN ─────────────────────────────────────────
  await test('TP1. getPlanPrevistoDia: fila existente → fila correcta', async () => {
    const fila = PLAN_BASE();
    inyectar({ planRow: fila });
    const r = await persistenciaPlan.getPlanPrevistoDia('atleta1', '2026-09-02');
    assert.deepStrictEqual(r, fila);
  });

  await test('TP2. getPlanPrevistoDia: día sin plan → null (nunca se inventa)', async () => {
    inyectar({ planRow: null });
    const r = await persistenciaPlan.getPlanPrevistoDia('atleta1', '2026-09-02');
    assert.strictEqual(r, null);
  });

  await test('TP3. getPlanPrevistoDia: error Supabase → null controlado, sin lanzar (C8)', async () => {
    inyectar({ planError: { message: 'conexión rechazada' } });
    const r = await persistenciaPlan.getPlanPrevistoDia('atleta1', '2026-09-02');
    assert.strictEqual(r, null);
  });

  // ─── CONTADOR SEMANAL (C1 + C2) ───────────────────────────────
  await test('TP4. getSustitucionesSemana: cuenta aceptadas con head-count y filtros de semana', async () => {
    const llamadas = inyectar({ count: 2 });
    const r = await persistenciaPlan.getSustitucionesSemana('atleta1', '2026-09-02');
    assert.strictEqual(r, 2);
    const st = llamadas.selects[0];
    assert.strictEqual(st.tabla, 'registro_sustituciones');
    assert.deepStrictEqual(st.selectArgs.opts, { count: 'exact', head: true });
    assert.ok(st.filtros.some(f => f[0] === 'eq' && f[1] === 'decision' && f[2] === 'aceptada'), 'filtra decision=aceptada');
    assert.ok(st.filtros.some(f => f[0] === 'gte' && f[1] === 'fecha' && f[2] === '2026-08-31'), 'lunes');
    assert.ok(st.filtros.some(f => f[0] === 'lte' && f[1] === 'fecha' && f[2] === '2026-09-06'), 'domingo');
  });

  await test('TP5. Frontera semanal lunes-domingo, criterio local idéntico a contarSesionesCalidadSemana', async () => {
    // sept-2026: mi 02, lu 31 (ago), do 06 (sep), do 30 (ago), lu 07 (sep)
    assert.deepStrictEqual(persistenciaPlan.fechaSemanaDe('2026-09-02'), { lunes: '2026-08-31', domingo: '2026-09-06' });
    assert.deepStrictEqual(persistenciaPlan.fechaSemanaDe('2026-08-31'), { lunes: '2026-08-31', domingo: '2026-09-06' });
    assert.deepStrictEqual(persistenciaPlan.fechaSemanaDe('2026-09-06'), { lunes: '2026-08-31', domingo: '2026-09-06' });
    assert.deepStrictEqual(persistenciaPlan.fechaSemanaDe('2026-08-30'), { lunes: '2026-08-24', domingo: '2026-08-30' });
    assert.deepStrictEqual(persistenciaPlan.fechaSemanaDe('2026-09-07'), { lunes: '2026-09-07', domingo: '2026-09-13' });
  });

  await test('TP6. getSustitucionesSemana: error Supabase → null, NUNCA 0 (C2)', async () => {
    inyectar({ countError: { message: 'timeout' } });
    const r = await persistenciaPlan.getSustitucionesSemana('atleta1', '2026-09-02');
    assert.strictEqual(r, null);
    assert.notStrictEqual(r, 0);
  });

  // ─── REGISTRO DE SUSTITUCIÓN ──────────────────────────────────
  await test('TP7. registrarSustitucion feliz: insert con allowlist de columnas y decision=aceptada', async () => {
    const llamadas = inyectar({ planRow: PLAN_BASE(), count: 1 });
    const r = await persistenciaPlan.registrarSustitucion(REG_BASE());
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.id, 101);
    const p = llamadas.insertados[0].insertPayload[0];
    assert.strictEqual(llamadas.insertados[0].tabla, 'registro_sustituciones');
    assert.strictEqual(p.decision, 'aceptada');
    assert.strictEqual(p.prevista_tipo, 'tempo');
    assert.strictEqual(p.prevista_tss, 80);
    assert.strictEqual(p.prevista_es_calidad, true);
    assert.strictEqual(p.sustituta_tipo, 'grupeta');
    assert.strictEqual(p.sustituta_tss, 110);
    assert.strictEqual(p.sustituta_es_calidad, true);
    assert.strictEqual(p.tss_real, null, 'tss_real null hasta la sync (P3)');
    assert.strictEqual(p.motivo, '🎯 Intención: grupeta');
    assert.deepStrictEqual(p.training_need_congelado, { estado_calculo: 'necesidad_detectada' });
    assert.strictEqual(Object.keys(p).indexOf('semana'), -1, 'sin columna semana derivada errónea');
  });

  await test('TP8. Idempotencia: 23505 (única aceptada/día) → {ok:false, duplicada}, sin lanzar', async () => {
    inyectar({ planRow: PLAN_BASE(), count: 0, simularDuplicado: true });
    const r = await persistenciaPlan.registrarSustitucion(REG_BASE());
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.motivo, 'duplicada');
  });

  await test('TP9. Límite semanal: contador 3 → limite_alcanzado y NINGÚN insert', async () => {
    const llamadas = inyectar({ planRow: PLAN_BASE(), count: 3 });
    const r = await persistenciaPlan.registrarSustitucion(REG_BASE());
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.motivo, 'limite_alcanzado');
    assert.strictEqual(llamadas.insertados.length, 0);
  });

  await test('TP10. Sin plan previsto → sin_plan y NINGÚN insert (no hay sustitución fantasma)', async () => {
    const llamadas = inyectar({ planRow: null, count: 0 });
    const r = await persistenciaPlan.registrarSustitucion(REG_BASE());
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.motivo, 'sin_plan');
    assert.strictEqual(llamadas.insertados.length, 0);
  });

  await test('TP11. Error Supabase en el INSERT → {ok:false, error}, sin lanzar (C8)', async () => {
    inyectar({ planRow: PLAN_BASE(), count: 0, errorInsert: { message: 'fallo de red' } });
    const r = await persistenciaPlan.registrarSustitucion(REG_BASE());
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.motivo, 'error');
  });

  await test('TP12. Error Supabase al leer contador durante registro → no inserta (C2, doble seguro)', async () => {
    const llamadas = inyectar({ planRow: PLAN_BASE(), countError: { message: 'timeout' } });
    const r = await persistenciaPlan.registrarSustitucion(REG_BASE());
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.motivo, 'error');
    assert.strictEqual(llamadas.insertados.length, 0);
  });

  await test('TP13. No-mutación: el registro de entrada queda intacto', async () => {
    inyectar({ planRow: PLAN_BASE(), count: 0 });
    const reg = REG_BASE();
    const copia = JSON.parse(JSON.stringify(reg));
    await persistenciaPlan.registrarSustitucion(reg);
    assert.deepStrictEqual(reg, copia);
  });

  await test('TP14. Validación de entrada: inválidos → registro_invalido; no-aceptadas → solo_aceptadas', async () => {
    const base = { planRow: PLAN_BASE(), count: 0 };
    let r = await persistenciaPlan.registrarSustitucion(null);
    assert.strictEqual(r.motivo, 'registro_invalido');
    let reg = REG_BASE(); reg.prevista_tipo = null;
    inyectar(base);
    r = await persistenciaPlan.registrarSustitucion(reg);
    assert.strictEqual(r.motivo, 'registro_invalido');
    reg = REG_BASE(); reg.prevista_tss = '80';
    inyectar(base);
    r = await persistenciaPlan.registrarSustitucion(reg);
    assert.strictEqual(r.motivo, 'registro_invalido');
    reg = REG_BASE(); reg.prevista_es_calidad = 'sí';
    inyectar(base);
    r = await persistenciaPlan.registrarSustitucion(reg);
    assert.strictEqual(r.motivo, 'registro_invalido');
    reg = REG_BASE(); reg.sustituta_tipo = '';
    inyectar(base);
    r = await persistenciaPlan.registrarSustitucion(reg);
    assert.strictEqual(r.motivo, 'registro_invalido');
    reg = REG_BASE(); reg.decision = 'rechazada';
    inyectar(base);
    r = await persistenciaPlan.registrarSustitucion(reg);
    assert.strictEqual(r.motivo, 'solo_aceptadas');
  });

  // ─── CONGELACIÓN DEL PLAN (C5) ────────────────────────────────
  await test('TP15. congelarPlanPrevisto: fila válida → upsert con allowlist y estado por defecto', async () => {
    const llamadas = inyectar({});
    const fila = PLAN_BASE();
    const r = await persistenciaPlan.congelarPlanPrevisto(fila);
    assert.strictEqual(r.ok, true);
    const st = llamadas.insertados[0];
    assert.strictEqual(st.tabla, 'plan_previsto_diario');
    const p = st.insertPayload[0];
    assert.strictEqual(p.user_id, 'atleta1');
    assert.strictEqual(p.fecha, '2026-09-02');
    assert.strictEqual(p.estado, 'VIGENTE');
    assert.strictEqual(p.fuente, 'scheduler');
    assert.deepStrictEqual(p.decision, { tipo: 'tempo' });
  });

  await test('TP16. congelarPlanPrevisto NO inventa plan: SIN_DATOS, sin decision/workout o fuente inválida → rechazo (C5)', async () => {
    let fila = PLAN_BASE(); fila.estado = 'SIN_DATOS';
    inyectar({});
    let r = await persistenciaPlan.congelarPlanPrevisto(fila);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.motivo, 'sin_datos');
    fila = PLAN_BASE(); fila.decision = null;
    inyectar({});
    r = await persistenciaPlan.congelarPlanPrevisto(fila);
    assert.strictEqual(r.motivo, 'sin_datos');
    fila = PLAN_BASE(); fila.workout = undefined;
    inyectar({});
    r = await persistenciaPlan.congelarPlanPrevisto(fila);
    assert.strictEqual(r.motivo, 'sin_datos');
    fila = PLAN_BASE(); fila.fuente = 'memoria';
    inyectar({});
    r = await persistenciaPlan.congelarPlanPrevisto(fila);
    assert.strictEqual(r.motivo, 'fuente_invalida');
    inyectar({});
    r = await persistenciaPlan.congelarPlanPrevisto(null);
    assert.strictEqual(r.motivo, 'fila_invalida');
  });

  // ─── DEGRADACIÓN SIN CLIENTE (C8) ─────────────────────────────
  await test('TP17. Sin cliente: lecturas → null, escrituras → {ok:false}, nada lanza (modo degradado)', async () => {
    persistenciaPlan.__setCliente(null);
    assert.strictEqual(await persistenciaPlan.getPlanPrevistoDia('atleta1', '2026-09-02'), null);
    assert.strictEqual(await persistenciaPlan.getSustitucionesSemana('atleta1', '2026-09-02'), null);
    let r = await persistenciaPlan.registrarSustitucion(REG_BASE());
    assert.deepStrictEqual(r, { ok: false, motivo: 'sin_cliente' });
    r = await persistenciaPlan.congelarPlanPrevisto(PLAN_BASE());
    assert.deepStrictEqual(r, { ok: false, motivo: 'sin_cliente' });
  });

  await test('TP18. fechaSemanaDe defensiva: basura → null, fechas imposibles → null', async () => {
    assert.strictEqual(persistenciaPlan.fechaSemanaDe(null), null);
    assert.strictEqual(persistenciaPlan.fechaSemanaDe(''), null);
    assert.strictEqual(persistenciaPlan.fechaSemanaDe('02-09-2026'), null);
    assert.strictEqual(persistenciaPlan.fechaSemanaDe('2026-13-01'), null);
    assert.strictEqual(persistenciaPlan.fechaSemanaDe('2026-02-30'), null);
  });

  persistenciaPlan.__resetCliente();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`RESULTADO: ${pasados} pasados, ${fallados} fallados`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(fallados > 0 ? 1 : 0);

})().catch(err => {
  console.log('❌ ERROR FATAL del runner de tests:', err && err.message);
  process.exit(1);
});
