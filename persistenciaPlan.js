// ═══════════════════════════════════════════════════════════════
// 💾 PERSISTENCIA PLAN — única capa de acceso a datos para la
//    memoria de planificación V10 (SPEC_V10_F1 §3.2, §3.3, §5).
//
// Responsabilidad EXCLUSIVA: hablar con Supabase para
//   - plan_previsto_diario   (lo PLANIFICADO, 1 fila/día/atleta)
//   - registro_sustituciones (la SUSTITUCIÓN, relación prevista↔realizada)
// Lo REALIZADO sigue en actividades_guardadas / historial_entrenos.
//
// REGLAS (aprobadas por Manu, fase P1/P2):
//   C1. registro_sustituciones es la ÚNICA fuente de verdad del contador semanal.
//   C2. Error de Supabase al leer el contador → null, NUNCA 0.
//   C3. (la llamadas a registrarSustitucion las hace el pipeline SOLO tras
//        evaluacionSustitucion.aplicada === true y el re-gate de validarSeguridad;
//        este módulo además revalida plan existente y límite < 3 antes de insertar)
//   C4. Ninguna escritura aquí se dispara en operaciones de lectura/evaluación.
//   C5. El plan no se inventa: sin decisión válida (o SIN_DATOS) no se congela.
//   C6. substitutionEngine / trainingNeed / seguridad permanecen puros: NUNCA
//       requieren este módulo.
//   C7. index.js sigue siendo orquestador: ninguna query de plan/sustituciones
//       inline; todo pasa por aquí.
//   C8. Si Supabase falla, nada lanza: lectura → null, escritura → {ok:false}.
//       /hoy nunca se bloquea por I/O.
//   C10. NO crea tablas ni ejecuta migraciones (eso es de Manu en Supabase).
//
// Este módulo NO imprime ni gestiona secretos: lee SUPABASE_URL /
// SUPABASE_ANON_KEY de process.env (ya cargadas por dotenv en index.js).
// ═══════════════════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

const TABLA_PLAN = 'plan_previsto_diario';
const TABLA_SUSTITUCIONES = 'registro_sustituciones';
const FUENTES_VALIDAS = ['scheduler', 'hoy', 'sync', 'cron'];
const LIMITE_SUSTITUCIONES_SEMANA = 3;

let cliente = null;
let clienteExterno = false; // true cuando los tests inyectan/desactivan el cliente

function getCliente() {
  if (clienteExterno) return cliente; // puede ser null → modo degradado forzado
  if (cliente) return cliente;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.log('[persistenciaPlan] Sin credenciales Supabase: modo degradado (lecturas null, escrituras rechazadas)');
    return null;
  }
  try {
    cliente = createClient(url, key);
  } catch (err) {
    console.log('[persistenciaPlan] Error creando cliente Supabase:', err && err.message);
    return null;
  }
  return cliente;
}

// Inyección para tests. __setCliente(null) fuerza modo degradado determinista.
function __setCliente(c) { cliente = c; clienteExterno = true; }
function __resetCliente() { cliente = null; clienteExterno = false; }

// ─── FECHAS (mismo criterio que contarSesionesCalidadSemana, index.js:892) ───
// Local time, sin UTC. Replicado AQUÍ una única vez para toda la memoria V10.

function formatFecha(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// fechaISO 'YYYY-MM-DD' → { lunes: 'YYYY-MM-DD', domingo: 'YYYY-MM-DD' } | null
function fechaSemanaDe(fechaISO) {
  try {
    if (!fechaISO || typeof fechaISO !== 'string') return null;
    const partes = fechaISO.split('-');
    if (partes.length !== 3) return null;
    const fecha = new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]));
    if (isNaN(fecha.getTime())) return null;
    // JS Date normaliza fechas imposibles (2026-02-30 → 02-mar): validación de ida y vuelta.
    if (formatFecha(fecha) !== fechaISO) return null;
    const diaSemana = fecha.getDay(); // 0=domingo ... 6=sábado (local)
    const diasDesdeLunes = diaSemana === 0 ? 6 : diaSemana - 1;
    const lunes = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() - diasDesdeLunes);
    const domingo = new Date(lunes.getTime() + 6 * 86400000);
    return { lunes: formatFecha(lunes), domingo: formatFecha(domingo) };
  } catch (err) {
    console.log('[persistenciaPlan] fechaSemanaDe:', err && err.message);
    return null;
  }
}

// ─── PLAN PREVISTO (lectura) ────────────────────────────────────

// → fila de plan_previsto_diario | null (también null en error: nunca se inventa)
async function getPlanPrevistoDia(userId, fecha) {
  try {
    const c = getCliente();
    if (!c || !userId || !fecha) return null;
    const { data, error } = await c
      .from(TABLA_PLAN)
      .select('*')
      .eq('user_id', userId)
      .eq('fecha', fecha)
      .maybeSingle();
    if (error) {
      console.log('[persistenciaPlan] getPlanPrevistoDia:', error.message);
      return null;
    }
    return data || null;
  } catch (err) {
    console.log('[persistenciaPlan] getPlanPrevistoDia (excepción):', err && err.message);
    return null;
  }
}

// ─── PLAN PREVISTO (congelación, SPEC §3.2) ─────────────────────
// upsert con ignoreDuplicates: solo la primera decisión válida del día congela;
// siguientes llamadas son no-op (el plan no se toca). /hoy repetido no re-congela.

async function congelarPlanPrevisto(fila) {
  try {
    const c = getCliente();
    if (!c) return { ok: false, motivo: 'sin_cliente' };
    if (!fila || typeof fila !== 'object') return { ok: false, motivo: 'fila_invalida' };
    if (!fila.user_id || !fila.fecha) return { ok: false, motivo: 'fila_invalida' };
    // C5: el plan no se inventa. Requiere decisión y workout reales del día.
    if (fila.estado === 'SIN_DATOS') return { ok: false, motivo: 'sin_datos' };
    if (!fila.decision || !fila.workout) return { ok: false, motivo: 'sin_datos' };
    if (!fila.fuente || FUENTES_VALIDAS.indexOf(fila.fuente) === -1) {
      return { ok: false, motivo: 'fuente_invalida' };
    }

    // Allowlist explícita de columnas: nunca se propagan claves desconocidas.
    const payload = {
      user_id: fila.user_id,
      fecha: fila.fecha,
      tipo_previsto: fila.tipo_previsto != null ? fila.tipo_previsto : null,
      duracion_prevista_min: fila.duracion_prevista_min != null ? fila.duracion_prevista_min : null,
      tss_previsto: fila.tss_previsto != null ? fila.tss_previsto : null,
      intensidad_prevista: fila.intensidad_prevista != null ? fila.intensidad_prevista : null,
      es_calidad: typeof fila.es_calidad === 'boolean' ? fila.es_calidad : null,
      decision: fila.decision,
      workout: fila.workout,
      training_need: fila.training_need != null ? fila.training_need : null,
      fuente: fila.fuente,
      estado: fila.estado || 'VIGENTE'
    };

    const { error } = await c
      .from(TABLA_PLAN)
      .upsert([payload], { onConflict: 'user_id,fecha', ignoreDuplicates: true });
    if (error) {
      console.log('[persistenciaPlan] congelarPlanPrevisto:', error.message);
      return { ok: false, motivo: 'error' };
    }
    return { ok: true };
  } catch (err) {
    console.log('[persistenciaPlan] congelarPlanPrevisto (excepción):', err && err.message);
    return { ok: false, motivo: 'error' };
  }
}

// ─── CONTADOR SEMANAL (C1 + C2) ─────────────────────────────────
// Fuente de verdad: COUNT de 'aceptadas' en registro_sustituciones.
// Error → null (NUNCA 0): un dato desconocido no debe desbloquear sustituciones.

async function getSustitucionesSemana(userId, fechaRef) {
  try {
    const c = getCliente();
    const semana = fechaSemanaDe(fechaRef);
    if (!c || !userId || !semana) return null;
    const { count, error } = await c
      .from(TABLA_SUSTITUCIONES)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('decision', 'aceptada')
      .gte('fecha', semana.lunes)
      .lte('fecha', semana.domingo);
    if (error) {
      console.log('[persistenciaPlan] getSustitucionesSemana:', error.message);
      return null; // C2
    }
    return typeof count === 'number' ? count : null;
  } catch (err) {
    console.log('[persistenciaPlan] getSustitucionesSemana (excepción):', err && err.message);
    return null; // C2
  }
}

// ─── REGISTRO DE SUSTITUCIÓN ────────────────────────────────────
// El pipeline llama SOLO con evaluacionSustitucion.aplicada === true (C3/C4).
// Aquí se revalida: plan existente (C-sin_plan) y contador < 3 (doble seguro).
// Idempotencia: índice único parcial (user_id, fecha) WHERE decision='aceptada'
// en la BD; un 23505 se mapea a {ok:false, motivo:'duplicada'} sin lanzar (C8).

async function registrarSustitucion(registro) {
  try {
    const c = getCliente();
    if (!c) return { ok: false, motivo: 'sin_cliente' };
    if (!registro || typeof registro !== 'object') return { ok: false, motivo: 'registro_invalido' };
    if (!registro.user_id || !registro.fecha) return { ok: false, motivo: 'registro_invalido' };

    const decision = registro.decision || 'aceptada';
    // P1/P2: solo se registran sustituciones ACEPTADAS (las rechazadas no se persisten aún).
    if (decision !== 'aceptada') return { ok: false, motivo: 'solo_aceptadas' };

    // Campos NOT NULL del esquema: la sustitución exige expectativa conocida.
    if (!registro.prevista_tipo) return { ok: false, motivo: 'registro_invalido' };
    if (typeof registro.prevista_tss !== 'number') return { ok: false, motivo: 'registro_invalido' };
    if (typeof registro.prevista_es_calidad !== 'boolean') return { ok: false, motivo: 'registro_invalido' };
    if (!registro.sustituta_tipo) return { ok: false, motivo: 'registro_invalido' };
    if (typeof registro.sustituta_es_calidad !== 'boolean') return { ok: false, motivo: 'registro_invalido' };

    // Sin plan previsto no hay sustitución (la FK lo impediría; comprobación amable).
    const plan = await getPlanPrevistoDia(registro.user_id, registro.fecha);
    if (!plan) return { ok: false, motivo: 'sin_plan' };

    // Doble seguro del límite semanal (el motor ya rechaza con >=3, S5).
    const contador = await getSustitucionesSemana(registro.user_id, registro.fecha);
    if (contador === null) return { ok: false, motivo: 'error' }; // C2: contador desconocido → no insertar
    if (contador >= LIMITE_SUSTITUCIONES_SEMANA) return { ok: false, motivo: 'limite_alcanzado' };

    // Allowlist explícita de columnas.
    const payload = {
      user_id: registro.user_id,
      fecha: registro.fecha,
      prevista_tipo: registro.prevista_tipo,
      prevista_tss: registro.prevista_tss,
      prevista_duracion_min: registro.prevista_duracion_min != null ? registro.prevista_duracion_min : null,
      prevista_es_calidad: registro.prevista_es_calidad,
      sustituta_tipo: registro.sustituta_tipo,
      sustituta_tss: registro.sustituta_tss != null ? registro.sustituta_tss : null,
      sustituta_duracion_min: registro.sustituta_duracion_min != null ? registro.sustituta_duracion_min : null,
      sustituta_es_calidad: registro.sustituta_es_calidad,
      tss_real: typeof registro.tss_real === 'number' ? registro.tss_real : null,
      categoria: registro.categoria != null ? registro.categoria : null,
      decision: 'aceptada',
      motivo: registro.motivo != null ? registro.motivo : null,
      training_need_congelado: registro.training_need_congelado != null ? registro.training_need_congelado : null
    };

    const { data, error } = await c
      .from(TABLA_SUSTITUCIONES)
      .insert([payload])
      .select('id');
    if (error) {
      const esDuplicado = error.code === '23505' || /duplicate key|unique constraint/i.test(error.message || '');
      if (esDuplicado) return { ok: false, motivo: 'duplicada' };
      console.log('[persistenciaPlan] registrarSustitucion:', error.message);
      return { ok: false, motivo: 'error' };
    }
    const id = data && data[0] && typeof data[0].id === 'number' ? data[0].id : null;
    return { ok: true, id };
  } catch (err) {
    console.log('[persistenciaPlan] registrarSustitucion (excepción):', err && err.message);
    return { ok: false, motivo: 'error' };
  }
}

// ─── EXPORTS ────────────────────────────────────────────────────

module.exports = {
  getPlanPrevistoDia,
  congelarPlanPrevisto,
  getSustitucionesSemana,
  registrarSustitucion,
  fechaSemanaDe,
  __setCliente,
  __resetCliente
};
