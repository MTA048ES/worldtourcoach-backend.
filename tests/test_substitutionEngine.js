// ═══════════════════════════════════════════════════════════════
// TESTS SUBSTITUTION ENGINE (S1-S10) — SPEC_V10_F1 §7 + D-18.2/3/4/5
// ═══════════════════════════════════════════════════════════════
const assert = require('node:assert/strict');
const { evaluarSustitucion, computaComoCalidad, esEquivalente, UMBRAL_IF_CALIDAD } =
  require('../substitutionEngine.js');
const { validarSeguridad } = require('../seguridad.js');

let pasados = 0, fallados = 0;
function test(nombre, fn) {
  try { fn(); pasados++; console.log('  ✅ ' + nombre); }
  catch (err) { fallados++; console.log('  ❌ ' + nombre + '\n     ' + err.message); }
}

// Sesión prevista canónica: sweetspot 75min, TSS 92 (salida típica del pipeline).
const prevista = () => ({ tipo: 'sweetspot', reps: 3, durMin: 75, recSec: 90, intensidad: 0.88, tssEsperado: 92, motivo: 'Plan' });
const benigno = () => ({ tsb: 5.0, acwr: 1.0, readiness: 80, heatIndex: 22, flags: {} });

// ─── S1 — Sustitución válida (dentro de ±30%) ───────────────────
test('S1. Grupeta TSS 110 vs previsto 92 (+19.6%): aceptada como candidata', () => {
  const r = evaluarSustitucion({
    sesionPrevista: prevista(),
    candidato: { tipo: 'grupeta', reps: 1, durMin: 120, recSec: 0, intensidad: 0.88, tss: 110, motivo: 'Intención' },
    sustitucionesSemana: 0
  });
  assert.strictEqual(r.estado, 'aceptada');
  assert.ok(r.decision_sustituta, 'debe construir decisión sustituta');
  assert.strictEqual(r.decision_sustituta.tipo, 'grupeta');
  assert.strictEqual(r.decision_sustituta.sustitucion.desviacion_tss_pct, 19.6);
  assert.ok(r.motivo.includes('validarSeguridad'), 'el resultado declara que falta el gate');
});

// ─── S2 — Límite inferior: −30% exacto es VÁLIDO (D-18.2 inclusivo) ──
test('S2. TSS 70 vs previsto 100 (−30% exacto): aceptada (umbral inclusivo)', () => {
  const r = evaluarSustitucion({
    sesionPrevista: { tipo: 'sweetspot', tssEsperado: 100 },
    candidato: { tipo: 'ftp', tss: 70 },
    sustitucionesSemana: 0
  });
  assert.strictEqual(r.estado, 'aceptada');
  assert.strictEqual(r.decision_sustituta.sustitucion.desviacion_tss_pct, -30);
});

// ─── S3 — Límite superior: +30% exacto es VÁLIDO ────────────────
test('S3. TSS 130 vs previsto 100 (+30% exacto): aceptada (umbral inclusivo)', () => {
  const r = evaluarSustitucion({
    sesionPrevista: { tipo: 'sweetspot', tssEsperado: 100 },
    candidato: { tipo: 'vo2', tss: 130 },
    sustitucionesSemana: 0
  });
  assert.strictEqual(r.estado, 'aceptada');
  assert.strictEqual(r.decision_sustituta.sustitucion.desviacion_tss_pct, 30);
});

// ─── S4 — Fuera de ±30% → NO VÁLIDO (sin redondeos silenciosos) ──
// Nota: los candidatos deben ser EQUIVALENTES a la prevista para aislar la
// regla de carga (si no lo fueran, el motor rechaza antes por equivalencia).
test('S4. TSS 65 (−35%) y TSS 140 (+40%): rechazadas por carga', () => {
  const baja = evaluarSustitucion({
    sesionPrevista: { tipo: 'sweetspot', tssEsperado: 100 },
    candidato: { tipo: 'ftp', tss: 65 },
    sustitucionesSemana: 0
  });
  assert.strictEqual(baja.estado, 'no_valida');
  assert.strictEqual(baja.decision_sustituta, null);
  assert.ok(baja.motivo.includes('±30%'));
  const alta = evaluarSustitucion({
    sesionPrevista: { tipo: 'sweetspot', tssEsperado: 100 },
    candidato: { tipo: 'vo2', tss: 140 },
    sustitucionesSemana: 0
  });
  assert.strictEqual(alta.estado, 'no_valida');
  assert.strictEqual(alta.decision_sustituta, null);
});

// ─── S5 — Flip-flop: 3 sustituciones → la 4.ª se rechaza SIEMPRE ──
test('S5. Con 3 sustituciones/semana: 4.ª rechazada, incluido descanso espontáneo', () => {
  const normal = evaluarSustitucion({
    sesionPrevista: prevista(),
    candidato: { tipo: 'grupeta', tss: 110, intensidad: 0.88 },
    sustitucionesSemana: 3
  });
  assert.strictEqual(normal.estado, 'rechazada');
  assert.strictEqual(normal.decision_sustituta, null);
  // La excepción D-18.5 del descanso NO anula el límite semanal:
  const descanso = evaluarSustitucion({
    sesionPrevista: prevista(),
    candidato: { tipo: 'descanso', durMin: 0, intensidad: 0 },
    sustitucionesSemana: 3
  });
  assert.strictEqual(descanso.estado, 'rechazada');
  assert.strictEqual(descanso.decision_sustituta, null);
});

// ─── S6 — Grupeta como calidad: IF >= 0.80 (D-18.4, no el legacy) ──
test('S6. Grupeta IF 0.80 cuenta como calidad; IF 0.79 no (umbral ' + UMBRAL_IF_CALIDAD + ')', () => {
  assert.strictEqual(computaComoCalidad({ tipo: 'grupeta', intensidad: 0.80 }), true);
  assert.strictEqual(computaComoCalidad({ tipo: 'grupeta', intensidad: 0.79 }), false);
  assert.strictEqual(computaComoCalidad({ tipo: 'grupeta', intensidad: 0.85 }), true);
  // El umbral 0.80 es inclusivo y NO es el >0.85 legacy:
  assert.ok(0.80 >= UMBRAL_IF_CALIDAD);
});

// ─── S7 — Descanso espontáneo: MISMO flujo + excepción ±30% ─────
test('S7. Descanso espontáneo por el mismo flujo (excepción D-18.5): aceptado', () => {
  // TSS=0 estaría a −100% del previsto: sin la excepción sería imposible.
  const r = evaluarSustitucion({
    sesionPrevista: prevista(),                       // sweetspot TSS 92
    candidato: { tipo: 'descanso', reps: 0, durMin: 0, intensidad: 0, motivo: 'No me apetece' },
    sustitucionesSemana: 2
  });
  assert.strictEqual(r.estado, 'aceptada', 'mismo flujo: evaluarSustitucion lo acepta con la excepción');
  assert.strictEqual(r.decision_sustituta.sustitucion.es_descanso_espontaneo, true);
  assert.strictEqual(r.decision_sustituta.sustitucion.excepcion_carga_aplicada, true);
  // Mismo punto de entrada que S1 (no hay camino paralelo):
  assert.ok(r.motivo.includes('validarSeguridad'));
});

// ─── S8 — NO mutación: el motor no toca las entradas (deepStrictEqual) ──
test('S8. No mutación: sesionPrevista y candidato intactas tras evaluar', () => {
  const prev = prevista();
  const cand = { tipo: 'grupeta', reps: 1, durMin: 120, recSec: 0, intensidad: 0.88, tss: 110, motivo: 'Intención' };
  const copiaPrev = JSON.parse(JSON.stringify(prev));
  const copiaCand = JSON.parse(JSON.stringify(cand));
  const r = evaluarSustitucion({ sesionPrevista: prev, candidato: cand, sustitucionesSemana: 0 });
  assert.strictEqual(r.estado, 'aceptada');
  assert.deepStrictEqual(prev, copiaPrev, 'sesionPrevista no debe mutarse');
  assert.deepStrictEqual(cand, copiaCand, 'candidato no debe mutarse');
  // La decisión sustituta es un objeto NUEVO (copia), no la misma referencia:
  assert.notStrictEqual(r.decision_sustituta, cand);
});

// ─── S9 — Seguridad: la sustitución NO se salta validarSeguridad() ──
test('S9. Grupeta aceptada por el motor pero ACWR>1.5: el gate impone z2/25/0.60', () => {
  const r = evaluarSustitucion({
    sesionPrevista: prevista(), // sweetspot TSS 92
    candidato: { tipo: 'grupeta', reps: 1, durMin: 120, recSec: 0, intensidad: 0.88, tss: 110, motivo: 'Intención' }, // +19.6%: carga OK
    sustitucionesSemana: 0
  });
  assert.strictEqual(r.estado, 'aceptada');
  assert.strictEqual(r.decision_sustituta.intensidad, 0.88);
  // El gate (ACWR 1.62 > 1.5) prevalece sobre la sustitución propuesta:
  const final = validarSeguridad(r.decision_sustituta,
    { tsb: 5.0, acwr: 1.62, readiness: 55, heatIndex: 22, flags: {} },
    { forzarDescanso: false, forzarZ2: false, prohibirIntensidad: false, intensidadMax: 1 });
  assert.strictEqual(final.tipo, 'z2');
  assert.strictEqual(final.durMin, 25);
  assert.strictEqual(final.intensidad, 0.60);
});

// ─── S10 — Ausencia de persistencia: sin contador → dependencia explícita ──
test('S10. Contador semanal no disponible: dependencia_persistencia, sin inventar histórico', () => {
  const r = evaluarSustitucion({
    sesionPrevista: prevista(),
    candidato: { tipo: 'grupeta', tss: 110, intensidad: 0.88 },
    sustitucionesSemana: null
  });
  assert.strictEqual(r.estado, 'dependencia_persistencia');
  assert.strictEqual(r.decision_sustituta, null);
  assert.ok(r.motivo.includes('registro_sustituciones'), 'declara la dependencia de persistencia');
  const r2 = evaluarSustitucion({
    sesionPrevista: prevista(),
    candidato: { tipo: 'grupeta', tss: 110, intensidad: 0.88 }
  });
  assert.strictEqual(r2.estado, 'dependencia_persistencia');
  assert.strictEqual(r2.decision_sustituta, null);
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`SUBSTITUTION ENGINE: ${pasados} pasados, ${fallados} fallados`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
