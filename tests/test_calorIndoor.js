// ═══════════════════════════════════════════════════════════════
// 🧪 TESTS — Factor calor + RODILLO/INDOOR (jerarquía acordada)
// Ejecutar: node tests/test_calorIndoor.js
// Sin framework: el proyecto no tiene ninguno instalado.
//
// Jerarquía acordada (sin cambiar ninguna regla de seguridad actual):
//   1. HI > 40 + exterior/no indoor            → DESCANSO
//   2. HI > 40 + rodillo/indoor                → Z2 controlado, máx 45 min, máx IF 0.70
//   3. HI > 40 + rodillo + ACWR > 1.5          → regla ACWR vigente: Z2, máx 25 min, máx IF 0.60
//                                                (ACWR > 1.5 NUNCA fuerza descanso)
//   4. HI > 40 + rodillo + TSB < -30           → DESCANSO
//   5. HI > 40 + rodillo + readiness < 30      → DESCANSO
//   6. Ninguna de estas pruebas altera las reglas existentes (regresión).
//
// CONTRATO DE ENTRADA (pendiente de implementar en producción):
//   La señal indoor/rodillo se modela como `estado.indoor === true`,
//   un campo NUEVO que producción aún no lee. Los tests lo pasan
//   directamente en el objeto `estado` (misma vía que `heatIndex`,
//   `tsb`, `acwr`, ...). En producción la señal se deriva de la
//   intención 'rodillo' existente de motorIntencion (HI>35) dentro de
//   getAthleteState() (index.js), y la consumen resolverConflictos() y
//   validarSeguridad(). Las reglas fisiológicas (TSB/readiness/ACWR) se
//   prueban SIN indoor para garantizar que no cambian (regla 6).
// ═══════════════════════════════════════════════════════════════
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { validarSeguridad } = require('../seguridad');

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

// ─── ESTADOS DE PARTIDA ────────────────────────────────────────
// Sanos salvo el factor en estudio. `indoor` es la señal propuesta.
const estadoCalor = (extra = {}) => ({
  tsb: 5.0, ctl: 58, atl: 60, acwr: 1.0, readiness: 80,
  hrv: 60, sleepQuality: 2, heatIndex: 41, haceCalor: true,
  weeklyTss: 450, flags: {}, ...extra
});

// Decisión típica que produciría decidirEntrenamiento() antes del
// conflict resolver (base z2 o calidad).
const decisionBase = (tipo = 'z2') => ({
  tipo, reps: 1, durMin: 60, recSec: 0, intensidad: 0.65,
  motivo: 'Plan'
});

const restriccionesBenignas = {
  intensidadMax: 1.0, volumenMax: 1.0, recuperacionExtra: false,
  forzarDescanso: false, forzarZ2: false, prohibirIntensidad: false,
  zonasPermitidas: ['z1', 'z2', 'z3', 'sweetspot', 'ftp', 'vo2'],
  zonasRestringidas: [], motivo: []
};

// ═══════════════════════════════════════════════════════════════
// BLOQUE A — GATE FINAL: validarSeguridad() (seguridad.js)
// ═══════════════════════════════════════════════════════════════

// ─── REGLA 1 ───────────────────────────────────────────────────
test('CI1. HI>40 SIN indoor → DESCANSO (el gate mantiene la regla vigente)', () => {
  const final = validarSeguridad(
    decisionBase('sweetspot'),
    estadoCalor(),                       // sin indoor
    restriccionesBenignas
  );
  assert.strictEqual(final.tipo, 'descanso', `tipo: esperado descanso, obtenido ${final.tipo}`);
  assert.strictEqual(final.durMin, 0);
  assert.strictEqual(final.intensidad, 0);
  assert.ok(final.motivo.includes('Heat Index 41'), 'el motivo debe citar el Heat Index');
});

// ─── REGLA 2 ───────────────────────────────────────────────────
test('CI2. HI>40 + indoor → Z2 controlado, máx 45 min y máx IF 0.70', () => {
  const final = validarSeguridad(
    decisionBase('sweetspot'),
    estadoCalor({ indoor: true }),
    restriccionesBenignas
  );
  assert.notStrictEqual(final.tipo, 'descanso',
    'con rodillo/indoor el calor NO debe forzar descanso');
  assert.strictEqual(final.tipo, 'z2', `tipo: esperado z2, obtenido ${final.tipo}`);
  assert.ok(final.durMin <= 45, `duración: esperado ≤ 45, obtenido ${final.durMin}`);
  assert.ok(final.intensidad <= 0.70, `IF: esperado ≤ 0.70, obtenido ${final.intensidad}`);
  assert.strictEqual(final.reps, 1, 'sin series: reps debe ser 1');
});

// ─── REGLA 3 ───────────────────────────────────────────────────
test('CI3. HI>40 + indoor + ACWR>1.5 → Z2 máx 25 min / IF máx 0.60, NUNCA descanso', () => {
  // Orden en el gate (seguridad.js): TSB → readiness → forzarDescanso →
  // CLIMA(>40) → ACWR. Con HI 41 el calor corta antes de llegar a ACWR:
  // por eso la regla de calor debe saltarse cuando hay indoor, para que
  // la semántica existente de ACWR (z2/25/0.60) siga mandando.
  const final = validarSeguridad(
    decisionBase('sweetspot'),
    estadoCalor({ indoor: true, acwr: 1.6 }),
    restriccionesBenignas
  );
  assert.notStrictEqual(final.tipo, 'descanso',
    'ACWR > 1.5 NUNCA fuerza descanso (semántica vigente, regla 3)');
  assert.strictEqual(final.tipo, 'z2', `tipo: esperado z2, obtenido ${final.tipo}`);
  assert.ok(final.durMin <= 25, `duración: esperado ≤ 25 (cap ACWR), obtenido ${final.durMin}`);
  assert.ok(final.intensidad <= 0.60, `IF: esperado ≤ 0.60 (cap ACWR), obtenido ${final.intensidad}`);
  assert.strictEqual(final.reps, 1);
});

// ─── REGLA 4 ───────────────────────────────────────────────────
test('CI4. HI>40 + indoor + TSB<-30 → DESCANSO (seguridad fisiológica manda)', () => {
  const final = validarSeguridad(
    decisionBase('sweetspot'),
    estadoCalor({ indoor: true, tsb: -32.0 }),
    restriccionesBenignas
  );
  assert.strictEqual(final.tipo, 'descanso', `tipo: esperado descanso, obtenido ${final.tipo}`);
  assert.ok(final.motivo.includes('TSB extremo'), 'el motivo debe citar TSB');
});

// ─── REGLA 5 ───────────────────────────────────────────────────
test('CI5. HI>40 + indoor + readiness<30 → DESCANSO (seguridad fisiológica manda)', () => {
  const final = validarSeguridad(
    decisionBase('sweetspot'),
    estadoCalor({ indoor: true, readiness: 25 }),
    restriccionesBenignas
  );
  assert.strictEqual(final.tipo, 'descanso', `tipo: esperado descanso, obtenido ${final.tipo}`);
  assert.ok(final.motivo.includes('Readiness muy bajo'), 'el motivo debe citar readiness');
});

// ─── REGLA 6 ───────────────────────────────────────────────────
test('CI6. indoor SIN calor: decisión conforme pasa intacta (no altera reglas existentes)', () => {
  const estado = { tsb: 5.0, acwr: 1.0, readiness: 80, heatIndex: 22, indoor: true, flags: {} };
  const decision = { tipo: 'z2', reps: 1, durMin: 60, recSec: 0, intensidad: 0.65, motivo: 'Plan' };
  const snapshotDecision = JSON.parse(JSON.stringify(decision));
  const snapshotEstado = JSON.parse(JSON.stringify(estado));

  const final = validarSeguridad(decision, estado, restriccionesBenignas);

  assert.strictEqual(final.tipo, 'z2');
  assert.strictEqual(final.durMin, 60);
  assert.strictEqual(final.intensidad, 0.65);
  assert.strictEqual(final.gateSeguridad, undefined, 'sin amenazas no debe tocarse la decisión');
  // No-mutación: ni la decisión ni el estado entrantes se modifican.
  assert.deepStrictEqual(decision, snapshotDecision, 'la decisión de entrada fue mutada');
  assert.deepStrictEqual(estado, snapshotEstado, 'el estado de entrada fue mutado');
});

// ═══════════════════════════════════════════════════════════════
// BLOQUE B — resolverConflictos() extraída de index.js
// (patrón del proyecto: test_ajustarPlanAutomaticamente.js —
//  index.js NO es importable, arranca el servidor al requerirse).
// ═══════════════════════════════════════════════════════════════
const srcIndex = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const INI = 'function resolverConflictos';
const FIN = '// 📋 LEARNING FILTER';
const idxIni = srcIndex.indexOf(INI);
const idxFin = srcIndex.indexOf(FIN);
assert.ok(idxIni !== -1, 'No se encontró "function resolverConflictos" en index.js');
assert.ok(idxFin !== -1 && idxFin > idxIni, 'No se encontró el marcador de fin (LEARNING FILTER)');
const fnSrc = srcIndex.slice(idxIni, idxFin);

// Fábrica: construye la función REAL con stubs de sus dependencias libres.
function crearResolverConflictos() {
  const registrarConflictoTraza = () => {};
  const registrarDecisionTraza = () => {};
  const estaAclimatado = () => false;
  const getFaseActual = () => 'base';
  const fabrica = new Function(
    'registrarConflictoTraza', 'registrarDecisionTraza', 'estaAclimatado', 'getFaseActual',
    'return (' + fnSrc + ');'
  );
  return fabrica(registrarConflictoTraza, registrarDecisionTraza, estaAclimatado, getFaseActual);
}

const resolver = crearResolverConflictos();
const traza = {};

// ─── REGLA 1 ───────────────────────────────────────────────────
test('CI7. [resolverConflictos] HI>40 SIN indoor → DESCANSO', () => {
  const final = resolver(estadoCalor(), {}, decisionBase('sweetspot'), traza);
  assert.strictEqual(final.tipo, 'descanso', `tipo: esperado descanso, obtenido ${final.tipo}`);
  assert.ok(final.motivo.includes('Calor extremo'), 'el motivo debe citar calor extremo');
});

// ─── REGLA 2 ───────────────────────────────────────────────────
test('CI8. [resolverConflictos] HI>40 + indoor → Z2 máx 45 min / IF máx 0.70', () => {
  // Nota para la implementación: con indoor el bloque >40 debe saltar el
  // descanso y APLICAR UN CAP EXPLÍCITO de 45/0.70 (la cascada >38 con
  // factor 0.80 daría 48 min sobre 60, incumpliendo el contrato ≤ 45).
  const final = resolver(estadoCalor({ indoor: true }), {}, decisionBase(), traza);
  assert.notStrictEqual(final.tipo, 'descanso',
    'con rodillo/indoor el calor NO debe forzar descanso');
  assert.strictEqual(final.tipo, 'z2', `tipo: esperado z2, obtenido ${final.tipo}`);
  assert.ok(final.durMin <= 45, `duración: esperado ≤ 45, obtenido ${final.durMin}`);
  assert.ok(final.intensidad <= 0.70, `IF: esperado ≤ 0.70, obtenido ${final.intensidad}`);
  assert.strictEqual(final.reps, 1, 'sin series: reps debe ser 1');
});

// ─── REGLA 3 ───────────────────────────────────────────────────
test('CI9. [resolverConflictos] HI>40 + indoor + ACWR>1.5 → Z2 máx 25 / IF máx 0.60 (ACWR va antes que clima)', () => {
  // En resolverConflictos el ACWR crítico (NIVEL 1, 2541-2551) se evalúa
  // ANTES que el clima (NIVEL 2): por eso aquí la regla ACWR ya gana hoy,
  // con o sin indoor. Test de regresión de la semántica vigente.
  const final = resolver(estadoCalor({ indoor: true, acwr: 1.6 }), {}, decisionBase('sweetspot'), traza);
  assert.notStrictEqual(final.tipo, 'descanso', 'ACWR > 1.5 NUNCA fuerza descanso');
  assert.strictEqual(final.tipo, 'z2', `tipo: esperado z2, obtenido ${final.tipo}`);
  assert.ok(final.durMin <= 25, `duración: esperado ≤ 25, obtenido ${final.durMin}`);
  assert.ok(final.intensidad <= 0.60, `IF: esperado ≤ 0.60, obtenido ${final.intensidad}`);
  assert.strictEqual(final.reps, 1);
});

// ─── REGLA 4 ───────────────────────────────────────────────────
test('CI10. [resolverConflictos] HI>40 + indoor + TSB<-30 → DESCANSO', () => {
  const final = resolver(estadoCalor({ indoor: true, tsb: -32.0 }), {}, decisionBase('sweetspot'), traza);
  assert.strictEqual(final.tipo, 'descanso', `tipo: esperado descanso, obtenido ${final.tipo}`);
  assert.ok(final.motivo.includes('TSB extremo'), 'el motivo debe citar TSB');
});

// ─── REGLA 5 ───────────────────────────────────────────────────
test('CI11. [resolverConflictos] HI>40 + indoor + readiness<30 → DESCANSO', () => {
  const final = resolver(estadoCalor({ indoor: true, readiness: 25 }), {}, decisionBase('sweetspot'), traza);
  assert.strictEqual(final.tipo, 'descanso', `tipo: esperado descanso, obtenido ${final.tipo}`);
  assert.ok(final.motivo.includes('Readiness muy bajo'), 'el motivo debe citar readiness');
});

// ─── REGLA 6 ───────────────────────────────────────────────────
test('CI12. [resolverConflictos] no muta la decisión de entrada', () => {
  const decision = decisionBase('vo2');
  const snapshot = JSON.parse(JSON.stringify(decision));
  resolver(estadoCalor(), {}, decision, traza);
  assert.deepStrictEqual(decision, snapshot, 'la decisión de entrada fue mutada');
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`RESULTADO: ${pasados} pasados, ${fallados} fallados`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
process.exit(fallados > 0 ? 1 : 0);