// ═══════════════════════════════════════════════════════════════
// 🧪 TESTS — ajustarPlanAutomaticamente() (no-mutación de la decisión)
// Ejecutar: node tests/test_ajustarPlanAutomaticamente.js
// Sin framework: el proyecto no tiene ninguno instalado.
//
// index.js NO es importable (arranca app.listen al requerirse, igual
// que se documenta en test_validarSeguridad.js). Para testear el
// código REAL de producción y no una copia, extraemos la función
// directamente del fuente de index.js y la evaluamos con stubs de
// obtenerHistorial() y getProperty().
// ═══════════════════════════════════════════════════════════════
const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

// ─── EXTRAER LA FUNCIÓN REAL DE index.js ───────────────────────
const srcIndex = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const INI = 'function ajustarPlanAutomaticamente';
const FIN = '// ─── OBTENER ESTADO CON AJUSTE AUTOMÁTICO + MOTOR DE INTENCIÓN ─';
const idxIni = srcIndex.indexOf(INI);
const idxFin = srcIndex.indexOf(FIN);
assert.ok(idxIni !== -1, 'No se encontró "function ajustarPlanAutomaticamente" en index.js');
assert.ok(idxFin !== -1 && idxFin > idxIni, 'No se encontró el marcador de fin de la función en index.js');
const fnSrc = srcIndex.slice(idxIni, idxFin);

// Fábrica: construye la función real con stubs inyectados como closure.
function crearAjustarPlan(historial, aprendizajes) {
  const obtenerHistorial = () => historial;
  const getProperty = (k) =>
    k === 'aprendizaje_desviaciones' ? JSON.stringify(aprendizajes) : null;
  // Evalúa el fuente REAL de index.js. `arguments` dentro de la función
  // se resuelve sobre la propia función extraída (function declaration).
  const fabrica = new Function('obtenerHistorial', 'getProperty', 'return (' + fnSrc + ');');
  return fabrica(obtenerHistorial, getProperty);
}

// ─── DATOS QUE FUERZAN EL CAMINO DE MUTACIÓN (tasa > 60%, grupeta) ───
// historial: 10 entrenos de tipo 'vo2' → totalTipo = 10
// aprendizajes: 8 desviaciones de planTipo 'vo2' → tasa = 80% > 60%
//               categoria 'grupeta' → rama grupeta (6859-6866 aprox.)
const historialVo2 = Array.from({ length: 10 }, () => ({ entreno: { tipo: 'vo2' } }));
const aprendizajesGrupeta = Array.from({ length: 8 }, () => ({
  categoria: 'grupeta',
  desviacion: { planTipo: 'vo2', fecha: '2026-08-01T10:00:00Z' }
}));

// ─── M1. MUTACIÓN: la decisión ORIGINAL queda intacta ──────────
test('M1. ajustarPlanAutomaticamente aplica el ajuste en una COPIA: la decisión original no se muta', () => {
  const ajustar = crearAjustarPlan(historialVo2, aprendizajesGrupeta);
  const decision = {
    tipo: 'vo2', reps: 5, durMin: 60, recSec: 120, intensidad: 0.95,
    motivo: 'Plan | VO2max'
  };
  const snapshot = JSON.parse(JSON.stringify(decision));

  const resultado = ajustar(decision);

  // 1) El objeto original NO cambió (regresión del bug de mutación).
  assert.deepStrictEqual(decision, snapshot,
    'la decisión original fue mutada por ajustarPlanAutomaticamente');
  assert.strictEqual(decision.tipo, 'vo2');
  assert.strictEqual(decision.durMin, 60);
  assert.strictEqual(decision.intensidad, 0.95);
  assert.strictEqual(decision.motivo, 'Plan | VO2max');
  assert.strictEqual(decision.ajusteAutomatico, undefined);
  assert.strictEqual(decision.razonAjuste, undefined);

  // 2) El ajuste SÍ se aplica (no se rompió la funcionalidad).
  assert.strictEqual(resultado.tipo, 'z2');
  assert.strictEqual(resultado.durMin, 48); // Math.round(60 * 0.8)
  assert.strictEqual(resultado.intensidad, 0.65);
  assert.strictEqual(resultado.ajusteAutomatico, true);
  assert.strictEqual(resultado.razonAjuste, 'grupeta');
  assert.ok(resultado.motivo.includes('| Ajustado: Históricamente cambias por grupeta'));

  // 3) Nuevo contrato: al haber ajuste, se devuelve una referencia distinta.
  assert.notStrictEqual(resultado, decision,
    'con ajuste aplicado debe devolverse una copia, no la misma referencia');
});

// ─── M2. SALIDA TEMPRANA (sin aprendizajes): identidad preservada ───
test('M2. Sin datos suficientes (aprendizajes < 2): devuelve el MISMO objeto sin mutarlo', () => {
  const ajustar = crearAjustarPlan(historialVo2, []);
  const decision = { tipo: 'ftp', reps: 4, durMin: 50, recSec: 90, intensidad: 0.92, motivo: 'Plan | FTP' };
  const snapshot = JSON.parse(JSON.stringify(decision));

  const resultado = ajustar(decision);

  assert.strictEqual(resultado, decision, 'en salida temprana debe preservarse la identidad (contrato previo)');
  assert.deepStrictEqual(decision, snapshot, 'la decisión original no debe mutarse');
});

// ─── M3. SALIDA TEMPRANA (historial corto): identidad preservada ───
test('M3. Sin datos suficientes (historial < 5): devuelve el MISMO objeto sin mutarlo', () => {
  const ajustar = crearAjustarPlan(historialVo2.slice(0, 3), aprendizajesGrupeta);
  const decision = { tipo: 'sweetspot', reps: 3, durMin: 70, recSec: 60, intensidad: 0.88, motivo: 'Plan | SS' };
  const snapshot = JSON.parse(JSON.stringify(decision));

  const resultado = ajustar(decision);

  assert.strictEqual(resultado, decision);
  assert.deepStrictEqual(decision, snapshot, 'la decisión original no debe mutarse');
});

// ─── M4. OTRA RAMA DE MUTACIÓN (imposibilidad): original intacto ───
test('M4. Rama "imposibilidad": la copia se reduce (durMin*0.7) y la original queda intacta', () => {
  const aprendizajesImposibilidad = Array.from({ length: 8 }, () => ({
    categoria: 'imposibilidad',
    desviacion: { planTipo: 'vo2', fecha: '2026-08-01T10:00:00Z' }
  }));
  const ajustar = crearAjustarPlan(historialVo2, aprendizajesImposibilidad);
  const decision = { tipo: 'vo2', reps: 5, durMin: 60, recSec: 120, intensidad: 0.95, motivo: 'Plan | VO2max' };
  const snapshot = JSON.parse(JSON.stringify(decision));

  const resultado = ajustar(decision);

  // Original intacto
  assert.deepStrictEqual(decision, snapshot,
    'la decisión original fue mutada por la rama imposibilidad');
  // Ajuste en la copia: 60*0.7 = 42 ; 0.95*0.9 = 0.855 → redondeo a 0.86
  assert.strictEqual(resultado.durMin, 42);
  assert.strictEqual(resultado.intensidad, 0.86);
  assert.strictEqual(resultado.razonAjuste, 'imposibilidad');
  assert.notStrictEqual(resultado, decision);
});

// ─── M5. EL CALLER REAL NO DEPENDE DE LA MUTACIÓN (index.js 6938-6941) ───
// Replica del flujo: adaptarDecisionParaIntencion (clona) → ajustarPlanAutomaticamente.
// Garantiza que las propiedades que el caller lee (ajusteAutomatico / razonAjuste)
// siguen llegando en el objeto DEVUELTO, no por efecto lateral sobre la entrada.
test('M5. Flujo del caller (getAthleteStateConAjuste): el ajuste llega por el valor devuelto', () => {
  const ajustar = crearAjustarPlan(historialVo2, aprendizajesGrupeta);
  const decisionEntrante = { tipo: 'vo2', reps: 5, durMin: 60, recSec: 120, intensidad: 0.95, motivo: 'Plan | VO2max' };
  const snapshot = JSON.parse(JSON.stringify(decisionEntrante));

  // Patrón del caller: reasignación con el retorno (NO cuenta con la mutación).
  let decisionAjustada = decisionEntrante;
  decisionAjustada = ajustar(decisionAjustada);

  assert.strictEqual(decisionAjustada.ajusteAutomatico, true, 'el caller debe ver ajusteAutomatico en el objeto devuelto');
  assert.strictEqual(decisionAjustada.razonAjuste, 'grupeta');
  assert.deepStrictEqual(decisionEntrante, snapshot,
    'la decisión de partida (state.decision en producción) debe seguir intacta');
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`RESULTADO: ${pasados} pasados, ${fallados} fallados`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
process.exit(fallados > 0 ? 1 : 0);
