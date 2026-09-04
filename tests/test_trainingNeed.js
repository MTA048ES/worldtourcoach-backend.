// ═══════════════════════════════════════════════════════════════
// TESTS TRAINING NEED (F2) — node tests/test_trainingNeed.js
// ═══════════════════════════════════════════════════════════════
const assert = require('assert');
const { calcularTrainingNeed } = require('../trainingNeed.js');

let pasados = 0, fallados = 0;
function test(nombre, fn) {
  try { fn(); pasados++; console.log('  ✅ ' + nombre); }
  catch (e) { fallados++; console.log('  ❌ ' + nombre + '\n     ' + e.message); }
}

// Input válido con los nombres de campo reales del repo
// (decision: salida de resolverConflictos; estado: salida de
// calcularEstadoSistema; semanal: getTssObjetivoSemanal +
// getMaxSesionesCalidad + historial de la semana en curso).
function inputValido(overrides = {}) {
  return Object.assign({
    fecha: '2026-09-01',
    decision: { tipo: 'sweetspot', reps: 3, durMin: 75, recSec: 90, intensidad: 0.88, tssEsperado: 92, motivo: 'Plan base' },
    estado: { tsb: -8.2, ctl: 58, atl: 64, acwr: 1.12, readiness: 72, hrv: 56, sleepQuality: 2, weeklyTss: 310, dataQuality: 'FRESH' },
    restricciones: { intensidadMax: 1.0, forzarZ2: false, prohibirIntensidad: false },
    contextoSemanal: {
      tssObjetivo: 550, calidadMax: 2,
      sesionesSemana: [{ fecha: '2026-08-31', intensidad: 0.88, tss: 75 }]
    },
    necesidadesPendientes: null,
    sustitucionesSemana: null,
    rechazosConsecutivosSimilares: 0
  }, overrides);
}

console.log('━━━ TESTS TRAINING NEED ━━━');

// TN1 — caso normal con datos suficientes → necesidad coherente
test('TN1. Caso normal: sweetspot con margen de calidad → necesidad_detectada y bloques coherentes', () => {
  const r = calcularTrainingNeed(inputValido());
  assert.strictEqual(r.estado_calculo, 'necesidad_detectada');
  assert.strictEqual(r.training_need.bloque_A.objetivo_sesion, 'calidad');
  assert.strictEqual(r.training_need.bloque_A.es_sesion_calidad, true);
  assert.strictEqual(r.training_need.bloque_B.calidad_realizadas_semana, 1);
  assert.strictEqual(r.training_need.bloque_B.calidad_max_semana, 2);
  assert.strictEqual(r.training_need.bloque_B.tss_semanal_restante, 550 - 310 - 92); // 148
  assert.strictEqual(r.training_need.bloque_C.tsb, -8.2);
  assert.strictEqual(r.training_need.bloque_C.data_quality, 'FRESH');
});

// TN2 — sin necesidad → ausencia explícita
test('TN2. z2 base con tsb sano y sin pendientes → sin_necesidad explícito', () => {
  const r = calcularTrainingNeed(inputValido({
    decision: { tipo: 'z2', reps: 1, durMin: 60, recSec: 0, intensidad: 0.65, tssEsperado: 55, motivo: 'Aeróbico' },
    estado: { tsb: 5.0, ctl: 58, atl: 55, acwr: 1.05, readiness: 80, hrv: 62, sleepQuality: 3, weeklyTss: 300, dataQuality: 'FRESH' }
  }));
  assert.strictEqual(r.estado_calculo, 'sin_necesidad');
  assert.ok(r.training_need, 'el diagnóstico sigue disponible aunque no haya necesidad');
  assert.strictEqual(r.training_need.bloque_A.objetivo_sesion, 'base');
  assert.strictEqual(r.training_need.bloque_A.es_sesion_calidad, false);
});

// TN3 — necesidad pendiente sustentada SOLO por datos persistidos (input)
test('TN3. Necesidad pendiente persistida → detectada y reproducida sin reconstrucción', () => {
  const persistida = [{ fecha_origen: '2026-08-31', tipo: 'vo2', es_calidad: true, reprogramaciones: 0 }];
  const r = calcularTrainingNeed(inputValido({
    decision: { tipo: 'z2', reps: 1, durMin: 60, recSec: 0, intensidad: 0.65, tssEsperado: 55, motivo: 'Aeróbico' },
    estado: { tsb: 5.0, ctl: 58, atl: 55, acwr: 1.05, readiness: 80, hrv: 62, sleepQuality: 3, weeklyTss: 300, dataQuality: 'FRESH' },
    necesidadesPendientes: persistida
  }));
  assert.strictEqual(r.estado_calculo, 'necesidad_detectada');
  assert.deepStrictEqual(r.training_need.bloque_D.necesidades_pendientes, persistida);
  assert.ok(r.diagnostico.includes('persistidos'));
});

// TN4 — histórico insuficiente → datos_insuficientes SIN inventar
test('TN4. sesionesSemana=null (histórico no disponible) → historico_insuficiente, training_need=null', () => {
  const r = calcularTrainingNeed(inputValido({
    contextoSemanal: { tssObjetivo: 550, calidadMax: 2, sesionesSemana: null }
  }));
  assert.strictEqual(r.estado_calculo, 'datos_insuficientes');
  assert.strictEqual(r.tipo_insuficiencia, 'historico_insuficiente');
  assert.strictEqual(r.training_need, null);
  assert.ok(r.datos_faltantes.some(f => f.includes('sesionesSemana')));
});

// TN5 — datos puntuales incompletos: la ventana existe, falta un campo
test('TN5. Ventana disponible pero decision.tssEsperado ausente → datos_puntuales_incompletos con dato exacto', () => {
  const i = inputValido();
  delete i.decision.tssEsperado;
  const r = calcularTrainingNeed(i);
  assert.strictEqual(r.estado_calculo, 'datos_insuficientes');
  assert.strictEqual(r.tipo_insuficiencia, 'datos_puntuales_incompletos');
  assert.notStrictEqual(r.tipo_insuficiencia, 'historico_insuficiente');
  assert.ok(r.datos_faltantes.includes('decision.tssEsperado'));
  assert.strictEqual(r.training_need, null, 'no se fabrican valores para completar el bloque');
});

// TN6 — NO MUTACIÓN: decision idéntica antes y después (deepStrictEqual)
test('TN6. No mutación: decision, estado y contextoSemanal quedan intactos tras calcularTrainingNeed', () => {
  const decision = { tipo: 'sweetspot', reps: 3, durMin: 75, recSec: 90, intensidad: 0.88, tssEsperado: 92, motivo: 'Plan base' };
  const estado = { tsb: -8.2, ctl: 58, atl: 64, acwr: 1.12, readiness: 72, hrv: 56, sleepQuality: 2, weeklyTss: 310, dataQuality: 'FRESH' };
  const restricciones = { intensidadMax: 1.0, forzarZ2: false, prohibirIntensidad: false };
  const contextoSemanal = { tssObjetivo: 550, calidadMax: 2, sesionesSemana: [{ fecha: '2026-08-31', intensidad: 0.66, tss: 75 }] };
  const decisionCopia = JSON.parse(JSON.stringify(decision));
  const estadoCopia = JSON.parse(JSON.stringify(estado));
  const restriccionesCopia = JSON.parse(JSON.stringify(restricciones));
  const contextoSemanalCopia = JSON.parse(JSON.stringify(contextoSemanal));

  const r = calcularTrainingNeed({
    fecha: '2026-09-01', decision, estado, restricciones, contextoSemanal,
    necesidadesPendientes: null, sustitucionesSemana: null, rechazosConsecutivosSimilares: 0
  });

  assert.deepStrictEqual(decision, decisionCopia, 'decision NO debe ser modificada');
  assert.deepStrictEqual(estado, estadoCopia, 'estado NO debe ser modificado');
  assert.deepStrictEqual(restricciones, restriccionesCopia, 'restricciones NO deben ser modificadas');
  assert.deepStrictEqual(contextoSemanal, contextoSemanalCopia, 'contextoSemanal NO debe ser modificado');
  assert.strictEqual(r.estado_calculo, 'necesidad_detectada', 'el cálculo sí se produjo');
});

// TN7 — DATOS AUSENTES: defensivo, explícito, sin excepciones ni inventos
test('TN7. Entradas null/undefined/{} → sin excepción, datos_insuficientes, sin valores fisiológicos inventados', () => {
  let r = calcularTrainingNeed(null);
  assert.strictEqual(r.estado_calculo, 'datos_insuficientes');
  assert.strictEqual(r.training_need, null);
  assert.ok(Array.isArray(r.datos_faltantes) && r.datos_faltantes.length > 0, 'lista de faltantes explícita');

  r = calcularTrainingNeed({});
  assert.strictEqual(r.estado_calculo, 'datos_insuficientes');
  assert.strictEqual(r.training_need, null);
  for (const campo of ['decision', 'estado', 'contextoSemanal']) {
    assert.ok(r.datos_faltantes.includes(campo), `declara explícitamente que falta ${campo}`);
  }

  // campos puntuales null dentro de objetos presentes (hrv/sleepQuality son ⭕ opcionales → null, no fallo)
  r = calcularTrainingNeed(inputValido({
    estado: { tsb: -8.2, ctl: 58, atl: 64, acwr: 1.12, readiness: 72, hrv: null, sleepQuality: null, weeklyTss: 310, dataQuality: 'FRESH' }
  }));
  assert.strictEqual(r.estado_calculo, 'necesidad_detectada',
    'hrv/sleepQuality son opcionales (spec §4.3 ⭕): su ausencia no es insuficiencia');
  assert.strictEqual(r.training_need.bloque_C.hrv, null, 'se refleja como null, nunca como valor inventado');
  assert.strictEqual(r.training_need.bloque_C.sleep_quality, null);

  // dato puntual obligatorio null → insuficiencia explícita, no default
  r = calcularTrainingNeed(inputValido({
    estado: { tsb: null, ctl: 58, atl: 64, acwr: 1.12, readiness: 72, hrv: 56, sleepQuality: 2, weeklyTss: 310, dataQuality: 'FRESH' }
  }));
  assert.strictEqual(r.estado_calculo, 'datos_insuficientes');
  assert.strictEqual(r.tipo_insuficiencia, 'datos_puntuales_incompletos');
  assert.ok(r.datos_faltantes.includes('estado.tsb'), 'identifica el dato exacto que falta');
  assert.strictEqual(r.training_need, null, 'no fabrica tsb');
});

// TN8 — SEPARACIÓN DE RESPONSABILIDADES: diagnóstico sí, instrucciones no
test('TN8. La salida contiene diagnóstico pero NINGUNA instrucción para modificar la decisión', () => {
  const r = calcularTrainingNeed(inputValido());
  // No contiene campos de acción/decisión
  for (const prohibido of ['accion', 'decision_final', 'tipo_recomendado', 'durMin_recomendado',
    'intensidad_recomendada', 'aceptar', 'rechazar', 'sustituir', 'reprogramar',
    'workout', 'workoutAjustado', 'decision']) {
    assert.strictEqual(prohibido in r, false, `la salida NO debe contener '${prohibido}'`);
  }
  // Sus claves son exclusivamente informativas
  const clavesPermitidas = ['fecha', 'estado_calculo', 'tipo_insuficiencia', 'datos_faltantes',
    'training_need', 'diagnostico', 'fuentes'];
  assert.deepStrictEqual(Object.keys(r).sort(), clavesPermitidas.slice().sort(),
    'la salida solo contiene campos de diagnóstico');
  // El training_need refleja la decisión tal cual (lectura), no una alternativa
  assert.strictEqual(r.training_need.bloque_A.tipo_solicitado, 'sweetspot');
  assert.strictEqual(r.training_need.bloque_A.tss_objetivo, 92);
  assert.strictEqual(typeof r.diagnostico, 'string', 'diagnóstico textual presente');
  assert.ok(r.diagnostico.length > 0, 'diagnóstico no vacío');
});

// TN9 — UMBRAL DE CALIDAD V10 (decisión aprobada, ex-pregunta §18.4/G-8): IF real >= 0.80
test('TN9. Umbral calidad: IF 0.79 NO cuenta, IF 0.80 SÍ (>= inclusivo), IF 0.85 SÍ', () => {
  const conSesion = (ifReal) => inputValido({
    contextoSemanal: { tssObjetivo: 550, calidadMax: 2, sesionesSemana: [{ fecha: '2026-08-31', intensidad: ifReal, tss: 75 }] }
  });
  // 0.79 → por debajo del umbral: NO cuenta (sin redondeo ni tolerancia)
  let r = calcularTrainingNeed(conSesion(0.79));
  assert.strictEqual(r.training_need.bloque_B.calidad_realizadas_semana, 0,
    'IF 0.79 < 0.80: NO cuenta como calidad');
  // 0.80 → justo en el umbral: SÍ cuenta (>=, a diferencia del >0.85 legacy)
  r = calcularTrainingNeed(conSesion(0.80));
  assert.strictEqual(r.training_need.bloque_B.calidad_realizadas_semana, 1,
    'IF 0.80: SÍ cuenta como calidad (umbral inclusivo >= 0.80)');
  // 0.85 → SÍ cuenta (ojo: el contador legacy >0.85 con 0.85 exacto NO contaría)
  r = calcularTrainingNeed(conSesion(0.85));
  assert.strictEqual(r.training_need.bloque_B.calidad_realizadas_semana, 1,
    'IF 0.85: SÍ cuenta como calidad');
});

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
// TN10 — ramas de clasificación de clasificarObjetivoSesion no cubiertas
 test('TN10. Clasificación: z1/descanso → recuperacion; z2>=90 → resistencia; z2 con 89 → base', () => {
  const conEstado = (tsb) => ({ tsb, ctl: 58, atl: 55, acwr: 1.05, readiness: 80, hrv: 60, sleepQuality: 3, weeklyTss: 300, dataQuality: 'FRESH' });
  let r = calcularTrainingNeed(inputValido({ decision: { tipo: 'z1', reps: 1, durMin: 30, recSec: 0, intensidad: 0.55, tssEsperado: 20, motivo: 'Regenerativo' }, estado: conEstado(5.0) }));
  assert.strictEqual(r.training_need.bloque_A.objetivo_sesion, 'recuperacion');
  r = calcularTrainingNeed(inputValido({ decision: { tipo: 'descanso', reps: 0, durMin: 0, recSec: 0, intensidad: 0, tssEsperado: 0, motivo: 'Descanso' }, estado: conEstado(5.0) }));
  assert.strictEqual(r.training_need.bloque_A.objetivo_sesion, 'recuperacion');
  r = calcularTrainingNeed(inputValido({ decision: { tipo: 'z2', reps: 1, durMin: 90, recSec: 0, intensidad: 0.65, tssEsperado: 85, motivo: 'Fondo' }, estado: conEstado(5.0) }));
  assert.strictEqual(r.training_need.bloque_A.objetivo_sesion, 'resistencia', 'z2 de 90 min exactos ya es resistencia');
  r = calcularTrainingNeed(inputValido({ decision: { tipo: 'z2', reps: 1, durMin: 89, recSec: 0, intensidad: 0.65, tssEsperado: 84, motivo: 'Fondo corto' }, estado: conEstado(5.0) }));
  assert.strictEqual(r.training_need.bloque_A.objetivo_sesion, 'base', '89 min aún es base (umbral >= 90, sin tolerancia)');
});

// TN11 — frontera del disparador de recuperación: tsb < -10 estricto
 test('TN11. tsb<-10 dispara necesidad_detectada; tsb=-10 exacto NO (comparación estricta)', () => {
  const decisionZ2 = { tipo: 'z2', reps: 1, durMin: 60, recSec: 0, intensidad: 0.65, tssEsperado: 55, motivo: 'Aeróbico' };
  let r = calcularTrainingNeed(inputValido({
    decision: decisionZ2,
    estado: { tsb: -10.1, ctl: 58, atl: 68, acwr: 1.1, readiness: 60, hrv: 50, sleepQuality: 2, weeklyTss: 400, dataQuality: 'FRESH' }
  }));
  assert.strictEqual(r.estado_calculo, 'necesidad_detectada');
  assert.ok(r.diagnostico.includes('recuperación'), 'diagnóstico apunta a recuperación');
  r = calcularTrainingNeed(inputValido({
    decision: decisionZ2,
    estado: { tsb: -10, ctl: 58, atl: 68, acwr: 1.1, readiness: 60, hrv: 50, sleepQuality: 2, weeklyTss: 400, dataQuality: 'FRESH' }
  }));
  assert.strictEqual(r.estado_calculo, 'sin_necesidad', 'tsb=-10 exacto no cumple tsb < -10');
});

// TN12 — restriccionesActivas reflejadas en bloque_C (snapshot de seguridad)
 test('TN12. restriccionesActivas: flags e intensidadMax<1 en bloque_C; restricciones vacías/null → []', () => {
  let r = calcularTrainingNeed(inputValido({
    restricciones: { forzarDescanso: false, prohibirIntensidad: true, forzarZ2: true, intensidadMax: 0.75 }
  }));
  assert.deepStrictEqual(r.training_need.bloque_C.restricciones_activas, ['prohibirIntensidad', 'forzarZ2', 'intensidadMax:0.75']);
  r = calcularTrainingNeed(inputValido({ restricciones: {} }));
  assert.deepStrictEqual(r.training_need.bloque_C.restricciones_activas, []);
  r = calcularTrainingNeed(inputValido({ restricciones: null }));
  assert.deepStrictEqual(r.training_need.bloque_C.restricciones_activas, []);
});

// TN13 — tss_semanal_restante negativo y bloque_D con sustituciones reales del input
 test('TN13. tssRestante puede ser negativo; bloque_D cuenta sustituciones totales y de calidad', () => {
  const r = calcularTrainingNeed(inputValido({
    estado: { tsb: -8.2, ctl: 58, atl: 64, acwr: 1.12, readiness: 72, hrv: 56, sleepQuality: 2, weeklyTss: 600, dataQuality: 'FRESH' },
    contextoSemanal: { tssObjetivo: 550, calidadMax: 2, sesionesSemana: [] },
    sustitucionesSemana: [{ es_calidad: true }, { es_calidad: false }, null],
    rechazosConsecutivosSimilares: 2
  }));
  assert.strictEqual(r.training_need.bloque_B.tss_semanal_restante, 550 - 600 - 92, 'restante negativo sin clampear');
  assert.strictEqual(r.training_need.bloque_D.sustituciones_semana_total, 3);
  assert.strictEqual(r.training_need.bloque_D.sustituciones_semana_calidad, 1);
  assert.strictEqual(r.training_need.bloque_D.rechazos_consecutivos_similares, 2);
});

console.log(`RESULTADO: ${pasados} pasados, ${fallados} fallados`);
process.exit(fallados > 0 ? 1 : 0);