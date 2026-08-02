const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const motorIntencion = require('./motorIntencion');
require('dotenv').config({ path: 'ENV' });

// ═══════════════════════════════════════════════════════════════
// 🔧 POLYFILLS PARA NODE.JS (RAILWAY)
// ═══════════════════════════════════════════════════════════════
const fetch = require('node-fetch');
const FormData = require('form-data');
const { Blob } = require('buffer');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ───
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── RUTAS DE PRUEBA ───
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    version: 'v9.5',
    name: 'World Tour Coach API',
    message: 'Servidor funcionando correctamente en Railway',
    timestamp: new Date().toISOString(),
    endpoints: {
      'GET /': 'Información del servidor',
      'GET /health': 'Estado de salud',
      'GET /ping': 'Mantener activo',
      'POST /webhook': 'Webhook para Telegram',
      'GET /api/estado': 'Estado del atleta',
      'POST /api/comando': 'Ejecutar comandos',
      'GET /api/config': 'Configuración del sistema'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: 'v9.5',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/ping', (req, res) => {
  res.json({
    status: 'pong',
    timestamp: new Date().toISOString()
  });
});

// ═══════════════════════════════════════════════════════════════
// 📋 CONFIGURACIÓN COMPLETA
// ═══════════════════════════════════════════════════════════════
const CONFIG = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN,
  CHAT_ID: process.env.CHAT_ID,
  INTERVALS_API_KEY: process.env.INTERVALS_API_KEY,
  ATHLETE_ID: process.env.ATHLETE_ID,
  WEATHER_API_KEY: process.env.WEATHER_API_KEY,
  CITY: 'Villargordo,ES',
  TIMEZONE: 'Europe/Madrid',
  FTP: parseInt(process.env.FTP) || 240,
  WEIGHT_KG: parseInt(process.env.WEIGHT_KG) || 64,
  AGE_YEARS: parseInt(process.env.AGE_YEARS) || 43,
  HEIGHT_CM: parseInt(process.env.HEIGHT_CM) || 173,
  TIME_LIMIT_OUTDOOR_MIN: 240,
  TIME_LIMIT_INDOOR_MIN: 55,
  SPREADSHEET_ID: '1P42T10C4BKkLF5TXqKLGlku4DnQGPhh0sCAiA0w9PFY',
  SHEET_NAME: 'FeedbackEntrenos',
  HORA_TRABAJO_INICIO: 6,
  HORA_TRABAJO_FIN: 14,
  MAX_HISTORIAL: 300,
  FTP_HISTORICO: {
    fecha: '2022',
    valor: 296,
    peso: 60,
    wattsPorKg: 4.93
  },
  LEARNING: {
    minMuestras: 20,
    pesoReciente: 0.7,
    filtroCoherencia: true,
    validarRPE: true,
    pesoMinimo: 0.3,
    maxDiasAntiguos: 90
  },
  
  // ─── PERIODIZACIÓN ESTRUCTURAL ───────────────────────────────
  PERIODO: {
    fase: 'base',
    semana: 1,
    semanasFase: 4,
    tssObjetivoSemanal: {
      base: 450,
      desarrollo: 550,
      especificidad: 500,
      taper: 350
    },
    maxSesionesCalidad: {
      base: 1,
      desarrollo: 2,
      especificidad: 2,
      taper: 0
    }
  },
  
  // ─── NUTRICIÓN AVANZADA ──────────────────────────────────────
  NUTRICION: {
    proteinaPostMaster: 40,
    sodioPorLitro: 500,
    omega3: '3g/día',
    vitaminaD: '2000 UI/día',
    magnesio: '400mg/día (en calor)',
    creatina: '5g/día (para mantener masa muscular)'
  },
  
  // ─── CLIMA WBGT ──────────────────────────────────────────────
  CLIMA: {
    diasAclimatacion: 10,
    factorReduccionBase: 0.85
  },
  
  // ─── OPENROUTER AI ───────────────────────────────────────────
  OPENROUTER: {
    API_KEY: process.env.OPENROUTER_API_KEY,
    // Lista de modelos gratuitos ACTUALIZADA (verificada vía API OpenRouter)
    MODELS: [
      'google/gemma-4-31b-it:free',
      'google/gemma-4-26b-a4b-it:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'nvidia/nemotron-3-nano-30b-a3b:free',
      'nvidia/nemotron-nano-9b-v2:free',
      'openai/gpt-oss-20b:free',
      'inclusionai/ling-3.0-flash:free',
      'poolside/laguna-s-2.1:free',
      'poolside/laguna-xs-2.1:free',
      'cohere/north-mini-code:free',
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      'nvidia/nemotron-nano-12b-v2-vl:free',
      'nvidia/nemotron-3.5-content-safety:free'
    ],
    MAX_TOKENS: 2000,
    TEMPERATURE: 0.7,
    ENABLED: false // Se activa cuando hay API key configurada
  }
};

console.log('🔑 Telegram Token:', CONFIG.TELEGRAM_TOKEN ? '✅ Configurado' : '❌ FALTA');
console.log('📱 CHAT_ID:', CONFIG.CHAT_ID || '❌ FALTA');
console.log('📊 FTP:', CONFIG.FTP, 'W');
console.log('🌍 CIUDAD:', CONFIG.CITY);
console.log('📅 FASE:', CONFIG.PERIODO.fase.toUpperCase(), '| Semana', CONFIG.PERIODO.semana);

// ─── SUPABASE ───
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qhtwueashkqbqytfwpwi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_mPhJsgW-V7n6TJs6-RLoWQ_Qk68d5qQ';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ═══════════════════════════════════════════════════════════════
// 📊 SUPABASE - PERSISTENCIA DE DATOS
// ═══════════════════════════════════════════════════════════════

// ─── GUARDAR ENTRENO EN SUPABASE ──────────────────────────────
async function guardarEntrenoSupabase(entreno, feedback, contexto) {
  try {
    const data = {
      fecha: new Date().toISOString(),
      tipo: entreno.tipo || 'desconocido',
      reps: entreno.reps || 0,
      durmin: entreno.durMin || 0,
      tss: entreno.tss || 0,
      intensidad: entreno.intensidad || 0,
      rpe: feedback.rpe || 5,
      watts: feedback.watts || 'si',
      piernas: feedback.piernas || 2,
      stress: feedback.stress || 2,
      sleep: feedback.sleep || 2,
      resultado: calcularResultadoFeedback(feedback),
      momento_dia: contexto.momentoDia || 'desconocido',
      comio_antes: contexto.comioAntes || 'no',
      user_id: CONFIG.CHAT_ID || 'default'
    };
    
    const { error } = await supabase
      .from('historial_entrenos')
      .insert([data]);
      
    if (error) {
      console.log('[guardarEntrenoSupabase] Error:', error);
      return { guardado: false, error: error.message };
    }
    
    console.log('[guardarEntrenoSupabase] ✅ Historial guardado en Supabase');
    return { guardado: true };
    
  } catch (err) {
    console.log('[guardarEntrenoSupabase] ERROR:', err);
    return { guardado: false, error: err.message };
  }
}

// ─── OBTENER HISTORIAL DE SUPABASE ─────────────────────────────
async function obtenerHistorialSupabase(limit = 100) {
  try {
    const { data, error } = await supabase
      .from('historial_entrenos')
      .select('*')
      .eq('user_id', CONFIG.CHAT_ID || 'default')
      .order('fecha', { ascending: false })
      .limit(limit);
      
    if (error) {
      console.log('[obtenerHistorialSupabase] Error:', error);
      return [];
    }
    
    return data || [];
    
  } catch (err) {
    console.log('[obtenerHistorialSupabase] ERROR:', err);
    return [];
  }
}
// ─── OBTENER HISTORIAL ──────────────────────────────────────────
function obtenerHistorial() {
  // Intentar obtener de memoria primero (rápido)
  try {
    const historial = getProperty('historial_entrenos');
    if (historial) {
      return JSON.parse(historial);
    }
  } catch (err) {
    console.log('[Historial] Error en memoria:', err);
  }
  
  // Si no hay en memoria, devolver array vacío
  return [];
}

// ─── CARGAR HISTORIAL COMPLETO DESDE SUPABASE ─────────────────
async function cargarHistorialCompleto() {
  try {
    // 1. Cargar actividades guardadas (de Intervals.icu)
    const { data: actividades, error: errAct } = await supabase
      .from('actividades_guardadas')
      .select('*')
      .eq('user_id', CONFIG.CHAT_ID || 'default')
      .order('Fecha', { ascending: false })
      .limit(100);
    
    // 2. Cargar historial de entrenos (con feedback)
    const { data: entrenos, error: errEnt } = await supabase
      .from('historial_entrenos')
      .select('*')
      .eq('user_id', CONFIG.CHAT_ID || 'default')
      .order('fecha', { ascending: false })
      .limit(100);
    
    let historial = [];
    
    // Convertir actividades de Intervals al formato del historial
    if (actividades && actividades.length > 0) {
      actividades.forEach(act => {
        const np = safeNum(act.np, 0);
        const tss = safeNum(act.tss, 0);
        const ifVal = (act.if_value && act.if_value > 0) ? act.if_value : (np > 0 ? np / CONFIG.FTP : 0);
        historial.push({
          fecha: act.Fecha || new Date().toISOString(),
          entreno: {
            tipo: 'actividad',
            tss: tss,
            np: np,
            intensidad: ifVal,
            durMin: 0
          },
          feedback: { rpe: 5, watts: 'si', piernas: 2, stress: 2, sleep: 2 },
          resultado: 70,
          peso: 1.0,
          contexto: {}
        });
      });
    }
    
    // Añadir entrenos con feedback (tienen prioridad)
    if (entrenos && entrenos.length > 0) {
      entrenos.forEach(ent => {
        historial.push({
          fecha: ent.fecha || new Date().toISOString(),
          entreno: {
            tipo: ent.tipo || 'desconocido',
            tss: ent.tss || 0,
            intensidad: ent.intensidad || 0,
            durMin: ent.durmin || 0,
            reps: ent.reps || 0
          },
          feedback: {
            rpe: ent.rpe || 5,
            watts: ent.watts || 'si',
            piernas: ent.piernas || 2,
            stress: ent.stress || 2,
            sleep: ent.sleep || 2
          },
          resultado: ent.resultado || 70,
          peso: 1.0,
          contexto: {
            momentoDia: ent.momento_dia || 'desconocido',
            comioAntes: ent.comio_antes || 'no'
          }
        });
      });
    }
    
    // Guardar en memoria para futuros accesos rápidos
    if (historial.length > 0) {
      setProperty('historial_entrenos', JSON.stringify(historial));
      console.log('[cargarHistorialCompleto] ✅ Cargados', historial.length, 'registros desde Supabase');
    }
    
    return historial;
  } catch (err) {
    console.log('[cargarHistorialCompleto] ERROR:', err);
    return [];
  }
}

// ─── OBTENER HISTORIAL DE SUPABASE (ASÍNCRONO) ──────────────────
async function obtenerHistorialAsync() {
  try {
    // Primero intentar Supabase
    const historialSupabase = await obtenerHistorialSupabase();
    if (historialSupabase && historialSupabase.length > 0) {
      // Guardar en memoria para futuros accesos rápidos
      setProperty('historial_entrenos', JSON.stringify(historialSupabase));
      return historialSupabase;
    }
  } catch (e) {
    console.log('[obtenerHistorialAsync] Error en Supabase:', e);
  }
  
  // Fallback a memoria
  try {
    const historial = getProperty('historial_entrenos');
    return historial ? JSON.parse(historial) : [];
  } catch (err) {
    console.log('[obtenerHistorialAsync] ERROR:', err);
    return [];
  }
}
// ─── GUARDAR ACTIVIDAD EN SUPABASE ─────────────────────────────
async function guardarActividadSupabase(actividad) {
  try {
    const data = {
      actividad_id: actividad.id,
      Fecha: actividad.start_date_local || actividad.start_date,
      tss: Number(actividad.icu_training_load || 0),
      np: Number(actividad.icu_weighted_avg_watts || 0),
      ap: Number(actividad.icu_average_watts || 0),
      if_value: Number(actividad.if || 0),
      kj: Number(actividad.icu_kilojoules || actividad.kilojoules || 0),
      Distancia: Number(actividad.distance || 0),
      elevacion: Number(actividad.elevation_gain || 0),
      user_id: CONFIG.CHAT_ID || 'default'
    };
    
    const { error } = await supabase
      .from('actividades_guardadas')
      .upsert([data], { onConflict: 'actividad_id' });
      
    if (error) {
      console.log('[guardarActividadSupabase] Error:', error);
      return { guardado: false };
    }
    
    console.log('[guardarActividadSupabase] ✅ Actividad guardada:', actividad.id);
    return { guardado: true };
    
  } catch (err) {
    console.log('[guardarActividadSupabase] ERROR:', err);
    return { guardado: false };
  }
}

// ─── OBTENER ACTIVIDAD DE SUPABASE ─────────────────────────────
async function obtenerActividadSupabase(actividadId) {
  try {
    const { data, error } = await supabase
      .from('actividades_guardadas')
      .select('*')
      .eq('actividad_id', actividadId)
      .eq('user_id', CONFIG.CHAT_ID || 'default')
      .single();
      
    if (error) return null;
    return data;
    
  } catch (err) {
    console.log('[obtenerActividadSupabase] ERROR:', err);
    return null;
  }
}

// ─── SINCORNIZAR ACTIVIDADES DE INTERVALS A SUPABASE ──────────
async function sincronizarActividadesSupabase(limit = 10) {
  try {
    console.log('[sincronizarActividadesSupabase] Iniciando sincronización...');
    
    const activities = await fetchActivities(limit);
    if (!activities || activities.length === 0) {
      return { sincronizado: false, mensaje: 'No hay actividades' };
    }
    
    let guardadas = 0;
    let errores = 0;
    for (const act of activities) {
      try {
        const detalle = await fetchIntervalsActivity(act.id);
        if (detalle) {
          const resultado = await guardarActividadSupabase(detalle);
          if (resultado && resultado.guardado) {
            guardadas++;
          } else {
            errores++;
            console.log('[sincronizarActividadesSupabase] ❌ No se guardó actividad', act.id, resultado?.error || 'error desconocido');
          }
        }
      } catch (e) {
        errores++;
        console.log('[sincronizarActividadesSupabase] Error con actividad', act.id, e.message);
      }
    }
    
    if (errores > 0) {
      console.log(`[sincronizarActividadesSupabase] ⚠️ ${errores} actividades no se pudieron guardar`);
    }
    
    console.log(`[sincronizarActividadesSupabase] ✅ ${guardadas} actividades sincronizadas`);
    return { sincronizado: true, total: guardadas };
    
  } catch (err) {
    console.log('[sincronizarActividadesSupabase] ERROR:', err);
    return { sincronizado: false, error: err.message };
  }
}

// ─── VARIABLES GLOBALES ───
const scriptProperties = {
  data: {},
  userProperties: {}
};

function getProperty(key) {
  return scriptProperties.data[key] || null;
}

function setProperty(key, value) {
  scriptProperties.data[key] = value;
}

function deleteProperty(key) {
  delete scriptProperties.data[key];
}

function getUserProperty(key) {
  return scriptProperties.userProperties[key] || null;
}

function setUserProperty(key, value) {
  scriptProperties.userProperties[key] = value;
}

function deleteUserProperty(key) {
  delete scriptProperties.userProperties[key];
}

// ─── ZONAS DE POTENCIA ───
const POWER_ZONES = [
  { id: 1, name: 'Recuperacion', min: 0, max: 0.55 },
  { id: 2, name: 'Base / Z2', min: 0.55, max: 0.75 },
  { id: 3, name: 'Tempo', min: 0.75, max: 0.87 },
  { id: 4, name: 'Sweet Spot', min: 0.87, max: 0.95 },
  { id: 5, name: 'Umbral (FTP)', min: 0.95, max: 1.05 },
  { id: 6, name: 'VO2 Max', min: 1.05, max: 1.20 },
  { id: 7, name: 'Anaerobico', min: 1.20, max: 99 }
];

const FEEDBACK_KEY = 'feedback_estado';
const API_BASE = `https://intervals.icu/api/v1/athlete/${CONFIG.ATHLETE_ID}`;

// ═══════════════════════════════════════════════════════════════
// 📋 FUNCIONES AUXILIARES
// ═══════════════════════════════════════════════════════════════

function safeNum(val, fallback = 0) {
  const n = Number(val);
  return (isNaN(n) || val === null || val === undefined) ? fallback : n;
}

function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(d, days) {
  const nd = new Date(d.getTime());
  nd.setDate(nd.getDate() + days);
  return nd;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════
// 🆕 FUNCIONES DE PERIODIZACIÓN
// ═══════════════════════════════════════════════════════════════

function getFaseActual() {
  return CONFIG.PERIODO.fase;
}

function getSemanaActual() {
  return CONFIG.PERIODO.semana;
}

function getTssObjetivoSemanal() {
  const fase = getFaseActual();
  return CONFIG.PERIODO.tssObjetivoSemanal[fase] || 500;
}

function getMaxSesionesCalidad() {
  const fase = getFaseActual();
  return CONFIG.PERIODO.maxSesionesCalidad[fase] || 2;
}

function getSemanasFase() {
  return CONFIG.PERIODO.semanasFase || 4;
}

function getNombreFase() {
  const fases = {
    'base': '🏗️ Base Aeróbica',
    'desarrollo': '📈 Desarrollo FTP',
    'especificidad': '🎯 Especificidad',
    'taper': '🧘 Taper / Recuperación'
  };
  return fases[getFaseActual()] || 'Base';
}

function contarSesionesCalidadSemana() {
  const historial = obtenerHistorial();
  const ahora = new Date();
  const diaSemana = ahora.getDay();
  const diasDesdeLunes = diaSemana === 0 ? 6 : diaSemana - 1;
  const lunesEstaSemana = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - diasDesdeLunes);
  const lunesStr = formatDate(lunesEstaSemana);
  const domingoEstaSemana = new Date(lunesEstaSemana.getTime() + 6 * 86400000);
  const domingoStr = formatDate(domingoEstaSemana);
  
  let contador = 0;
  historial.forEach(h => {
    const fecha = new Date(h.fecha);
    const fechaStr = formatDate(fecha);
    if (fechaStr >= lunesStr && fechaStr <= domingoStr) {
      const intensidad = h.entreno?.intensidad || 0;
      if (intensidad > 0.85) contador++;
    }
  });
  
  return contador;
}

function puedeHacerCalidad(estado, restricciones) {
  if (restricciones.prohibirIntensidad || restricciones.forzarZ2) return false;
  
  const maxCalidad = getMaxSesionesCalidad();
  const sesionesCalidad = contarSesionesCalidadSemana();
  
  if (sesionesCalidad >= maxCalidad) return false;
  if (getFaseActual() === 'base' && estado.tsb < 15) return false;
  if (getFaseActual() === 'taper') return false;
  
  return true;
}

// ═══════════════════════════════════════════════════════════════
// 🆕 PREDICCIÓN DE FTP (COGGAN)
// ═══════════════════════════════════════════════════════════════

function calcularFTPEstimado() {
  const historial = obtenerHistorial();
  if (historial.length < 5) return CONFIG.FTP;
  
  // Calcular semanas de entrenamiento consistentes
  // Master 40+: mejora realista ~1.5W por mes de entrenamiento estructurado
  const semanasEntrenando = Math.min(Math.round(historial.length / 3.5), 48); // ~3.5 sesiones/semana, max 48 semanas
  const mejoraMensual = CONFIG.AGE_YEARS > 40 ? 1.5 : 3.0;
  const mesesEntrenando = Math.max(1, Math.round(semanasEntrenando / 4));
  const incremento = Math.round(mejoraMensual * mesesEntrenando);
  
  // Limitar por el TSS acumulado real (no puede mejorar sin carga)
  let tssTotal = 0;
  historial.forEach(h => { tssTotal += h.entreno?.tss || 0; });
  const factorCarga = Math.min(tssTotal / 1000, 1.0); // Necesita ~1000 TSS para empezar a ver mejora
  const ftpEstimado = Math.round(CONFIG.FTP + (incremento * factorCarga));
  
  // No puede superar el histórico ni bajar del FTP inicial
  return Math.min(Math.max(ftpEstimado, CONFIG.FTP), CONFIG.FTP_HISTORICO.valor);
}

function calcularProyeccionObjetivo() {
  const ftpActual = CONFIG.FTP;
  const ftpObjetivo = CONFIG.FTP_HISTORICO.valor || 296;
  const ftpEstimado = calcularFTPEstimado();
  const diff = ftpObjetivo - ftpEstimado;
  
  if (diff <= 0) {
    return { semanas: 0, alcanzado: true, mensaje: '🎯 ¡Objetivo alcanzado!' };
  }
  
  const ritmoMejora = CONFIG.AGE_YEARS > 40 ? 2.0 : 3.0;
  const semanas = Math.ceil(diff / ritmoMejora);
  
  return {
    semanas: semanas,
    alcanzado: false,
    mensaje: `📈 Al ritmo actual (${ritmoMejora}W/semana), alcanzarás ${ftpObjetivo}W en ${semanas} semanas (${Math.ceil(semanas/4)} meses)`
  };
}

// ═══════════════════════════════════════════════════════════════
// 🆕 RECUPERACIÓN PREDICTIVA
// ═══════════════════════════════════════════════════════════════

function calcularHorasRecuperacion(tss, edad, sleepQuality) {
  let horas = tss / 10;
  horas += Math.max(0, (edad - 30) * 0.2);
  if (sleepQuality === 1) horas *= 1.3;
  else if (sleepQuality === 2) horas *= 1.1;
  
  return Math.round(horas);
}

function calcularSiguienteEntreno(horasRecuperacion) {
  const ahora = new Date();
  const siguiente = new Date(ahora.getTime() + horasRecuperacion * 60 * 60 * 1000);
  const hora = siguiente.getHours();
  const min = String(siguiente.getMinutes()).padStart(2, '0');
  const fecha = siguiente.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  
  return `📅 ${fecha} a las ${hora}:${min}h`;
}

// ═══════════════════════════════════════════════════════════════
// 🆕 CLIMA WBGT (Heat Index)
// ═══════════════════════════════════════════════════════════════

function calcularHeatIndex(temp, humedad) {
  if (!temp || typeof temp !== 'number') return temp;
  if (!humedad || typeof humedad !== 'number') humedad = 50;
  
  // La fórmula de Heat Index (NOAA) usa Fahrenheit.
  // Convertimos Celsius → Fahrenheit, calculamos, y volvemos a Celsius.
  const T = (temp * 9/5) + 32;
  const RH = humedad;
  
  const HI_F = -42.379 + 2.04901523*T + 10.14333127*RH - 0.22475541*T*RH 
            - 0.00683783*T*T - 0.05481717*RH*RH + 0.00122874*T*T*RH 
            + 0.00085282*T*RH*RH - 0.00000199*T*T*RH*RH;
  
  // Convertir de vuelta a Celsius
  return Math.round((HI_F - 32) * 5/9);
}

function getDiasAclimatados() {
  const dias = getProperty('dias_calor') || 0;
  return Math.min(dias, CONFIG.CLIMA.diasAclimatacion);
}

function estaAclimatado() {
  return getDiasAclimatados() >= CONFIG.CLIMA.diasAclimatacion;
}

// ═══════════════════════════════════════════════════════════════
// 🤖 OPENROUTER AI - CHAT CON IA
// ═══════════════════════════════════════════════════════════════

// Cache simple para consultas repetidas
const cacheIA = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

async function chatConIA(prompt, contexto = '') {
  try {
    // Verificar cache primero
    const cacheKey = prompt.trim().toLowerCase();
    const cached = cacheIA.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('[OpenRouter] 📦 Respuesta desde cache');
      return cached.result;
    }

    // Verificar si OpenRouter está configurado
    if (!CONFIG.OPENROUTER.API_KEY) {
      console.log('[OpenRouter] ❌ API_KEY no configurada en CONFIG');
      return {
        success: false,
        mensaje: '⚠️ OpenRouter no configurado.\n\nPara activar la IA:\n1. Obtén tu API key en https://openrouter.ai/keys\n2. Agrégala al archivo ENV: OPENROUTER_API_KEY=tu-key\n3. Reinicia el servidor'
      };
    }

    // Activar OpenRouter si hay API key
    CONFIG.OPENROUTER.ENABLED = true;
    console.log('[OpenRouter] ✅ API_KEY detectada. Modelos disponibles:', CONFIG.OPENROUTER.MODELS.length);

    // ─── OBTENER CONTEXTO REAL DEL SISTEMA ──────────────────────
    let contextoSistema = '';
    try {
      const state = await getAthleteState();
      if (state) {
        const e = state.estado;
        const n = state.nutricion;
        const w = state.workout;
        
        contextoSistema = `
CONTEXTO REAL DEL SISTEMA (DATOS DE HOY):
══════════════════════════════════━━════

📊 ESTADO DE ENTRENAMIENTO:
• FTP: ${CONFIG.FTP}W | Objetivo: 296W
• Fase: ${getNombreFase()} (Semana ${getSemanaActual()}/${getSemanasFase()})
• CTL: ${e.ctl.toFixed(1)} | ATL: ${e.atl.toFixed(1)} | TSB: ${e.tsb.toFixed(1)}
• Readiness: ${state.readiness}/100
• HRV: ${e.hrv || 'N/D'}
• Sueño: ${e.sleepQuality === 1 ? 'Malo' : e.sleepQuality === 2 ? 'Regular' : 'Bueno'}
• ACWR: ${e.acwr.toFixed(2)}
• TSS semanal: ${Math.round(e.weeklyTss)} / ${state.restricciones.tssMaxSemanal}
• Sesiones esta semana: ${e.weeklySessions}

🚴 ENTRENO DE HOY:
• Tipo: ${w ? w.tipo.toUpperCase() : 'N/D'}
• ${w && w.reps > 0 ? `Estructura: ${w.reps}x${w.durMin}min` : `Duración: ${w ? w.durMin : 'N/D'}min`}
• Vatios: ${w ? w.vatios.low + '-' + w.vatios.high + 'W' : 'N/D'}
• IF: ${w ? w.ifEsperado : 'N/D'} | TSS: ${w ? w.tssEsperado : 'N/D'}
• KJ: ${w ? w.kjEsperados : 'N/D'} | CH: ${w ? w.carbsEsperados : 'N/D'}g

🥗 NUTRICIÓN DE HOY:
• Calorías objetivo: ${n.kcalGastoTotal} kcal
• Carbohidratos: ${n.chTotalDia}g (Inmediato: ${n.chInmediato}g | Durante: ${n.chDuranteEntreno}g | Resto: ${n.chCena}g)
• Proteína: ${n.protTotalDia}g (Post-entreno: ${n.protPost}g)
• Grasas: ${n.grasaDiaria}g
• Hidratación: ${n.hidratacion}
• ${n.haceCalor ? '🔥 Calor: HI ' + n.heatIndex + '°C' : '✅ Sin calor extremo'}

🌡️ CLIMA:
• Temperatura: ${state.tempActual}°C (Heat Index: ${state.heatIndex}°C)
• ${state.haceCalor ? '⚠️ Calor detectado - adaptaciones activas' : '✅ Condiciones normales'}

🎯 OBJETIVO:
• FTP actual: ${CONFIG.FTP}W → Objetivo: 296W (faltan ${296 - CONFIG.FTP}W)
• ${state.proyeccion ? state.proyeccion.mensaje : ''}

════════════════════════════════════════`;
      }
    } catch (ctxErr) {
      console.log('[chatConIA] Error obteniendo contexto:', ctxErr.message);
    }

    const systemPrompt = `Eres el asistente de World Tour Coach, un sistema avanzado de entrenamiento de ciclismo para Manu (43 años, Master 40+).

${contextoSistema}

PERFIL DEL ATLETA:
• Edad: ${CONFIG.AGE_YEARS} años (Master 40+)
• Peso: ${CONFIG.WEIGHT_KG}kg
• Altura: ${CONFIG.HEIGHT_CM}cm
• FTP: ${CONFIG.FTP}W
• Objetivo: Recuperar 296W de FTP

CAPACIDADES:
- Periodización de entrenamiento (Base, Desarrollo, Especificidad, Taper)
- Nutrición avanzada para ciclistas (con recetas personalizadas)
- Análisis de fatiga y recuperación
- Planificación de fuerza y movilidad
- Adaptación al clima (Heat Index)
- Análisis de métricas (TSS, IF, NP, AP, VI, EF)

INSTRUCCIONES:
- Responde en español, de forma concisa y práctica
- Usa emojis para hacer los mensajes más claros
- Si no tienes información suficiente, pide más detalles
- Enfócate en consejos prácticos y accionables
- Considera que es Master 40+ (recuperación más lenta)
- Personaliza las respuestas según el CONTEXTO REAL del sistema
- Si te dan ingredientes para una receta, calcula los macros y ajusta a los objetivos del día
- Si te preguntan sobre entrenamiento, usa el TSB, CTL y readiness actual
- Máximo 800 caracteres por respuesta`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(contexto ? [{ role: 'assistant', content: contexto }] : []),
      { role: 'user', content: prompt }
    ];

    // ─── PROBAR TODOS LOS MODELOS GRATUITOS HASTA QUE UNO FUNCIONE ───
    const modelos = CONFIG.OPENROUTER.MODELS;
    const maxModelos = Math.min(5, modelos.length);
    let errores = [];

    for (let i = 0; i < maxModelos; i++) {
      const modelo = modelos[i];
      try {
        console.log(`[OpenRouter] 📤 Intentando modelo ${i+1}/${maxModelos}: ${modelo}`);
        
        const fetchWithTimeout = Promise.race([
          fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${CONFIG.OPENROUTER.API_KEY}`,
              'HTTP-Referer': 'https://worldtourcoach.com',
              'X-Title': 'World Tour Coach'
            },
            body: JSON.stringify({
              model: modelo,
              messages: messages,
              max_tokens: CONFIG.OPENROUTER.MAX_TOKENS,
              temperature: CONFIG.OPENROUTER.TEMPERATURE
            })
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 10s')), 10000))
        ]);
        const response = await fetchWithTimeout;

        console.log(`[OpenRouter] 📥 Response status (${modelo}):`, response.status);

        if (response.ok) {
          const data = await response.json();
          const respuesta = data.choices?.[0]?.message?.content || 'Sin respuesta';
          console.log(`[OpenRouter] ✅ ¡ÉXITO con modelo: ${modelo}`);
          
          const result = {
            success: true,
            mensaje: respuesta,
            modelo: modelo
          };
          
          // Guardar en cache
          cacheIA.set(cacheKey, {
            timestamp: Date.now(),
            result: result
          });
          
          // Limitar tamaño del cache (50 entradas)
          if (cacheIA.size > 50) {
            const firstKey = cacheIA.keys().next().value;
            cacheIA.delete(firstKey);
          }
          
          return result;
        } else {
          const errorText = await response.text();
          console.log(`[OpenRouter] ❌ Falló modelo ${modelo}: ${response.status}`);
          errores.push(`${modelo}: ${response.status}`);
          // Continuar con el siguiente modelo
        }
      } catch (modelError) {
        console.log(`[OpenRouter] ❌ Error con modelo ${modelo}:`, modelError.message);
        errores.push(`${modelo}: ${modelError.message}`);
        // Continuar con el siguiente modelo
      }
    }

    // Si todos los modelos fallaron
    console.log('[OpenRouter] ❌ Todos los modelos fallaron');
    return {
      success: false,
      mensaje: `❌ Todos los modelos de IA están saturados ahora mismo.\n\nSe probaron ${maxModelos} modelos y todos fallaron.\n\nIntenta de nuevo en unos minutos.`
    };

  } catch (error) {
    console.log('[OpenRouter] ERROR:', error);
    return {
      success: false,
      mensaje: `❌ Error: ${error.message}\n\nVerifica tu conexión e intenta de nuevo.`
    };
  }
}

// ─── COMANDO IA ───────────────────────────────────────────────
async function cmdIA(args) {
  try {
    const prompt = args.join(' ');
    
    if (!prompt || prompt.length === 0) {
      await sendTelegram(`🤖 *WORLD TOUR COACH - ASISTENTE IA*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`);
      await sendTelegram(`La IA conoce tu estado real: TSB, CTL, readiness, nutrición, clima y fase de entrenamiento.\n\n`);
      await sendTelegram(`*🏋️ ENTRENAMIENTO:*\n• /ia Según mi entrenamiento, ¿cómo puedo mejorar mi VO2max?\n• /ia ¿Qué tipo de entreno me conviene hoy con mi TSB?\n• /ia ¿Cuántas series de SweetSpot debería hacer?\n• /ia ¿Es buen día para entrenar intensidad?\n\n`);
      await sendTelegram(`*🥗 NUTRICIÓN Y RECETAS:*\n• /ia Tengo arroz, pollo y brócoli, ¿creas una receta con mis macros?\n• /ia ¿Cómo debo alimentarme antes de una salida de 3h?\n• /ia ¿Qué comer post-entreno hoy?\n• /ia Calcula los macros de: 100g pasta + 150g salmón + aceite\n\n`);
      await sendTelegram(`*🧠 RECUPERACIÓN Y SALUD:*\n• /ia Tengo fatiga acumulada, ¿qué hago?\n• /ia ¿Cómo mejoro mi recuperación siendo Master 40+?\n• /ia ¿Cuánto descanso necesito después de un TSS de 150?\n• /ia ¿Qué suplementos me convienen?\n\n`);
      await sendTelegram(`💡 *La IA usa tus datos reales:* FTP, peso, fase, TSB, nutrición del día, clima, etc.`);
      return;
    }

    // DEBUG: Verificar si la API key está cargada
    console.log('[cmdIA] 🔍 DEBUG - OPENROUTER_API_KEY:', CONFIG.OPENROUTER.API_KEY ? '✅ Presente' : '❌ AUSENTE');
    console.log('[cmdIA] 🔍 DEBUG - process.env.OPENROUTER_API_KEY:', process.env.OPENROUTER_API_KEY ? '✅ Presente' : '❌ AUSENTE');
    
    await sendTelegram('🤔 *Pensando...*\nConsultando a la IA...');

    const resultado = await chatConIA(prompt);
    
    if (resultado.success) {
      let msg = `🤖 *RESPUESTA IA*\n`;
      msg += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
      msg += resultado.mensaje;
      msg += '\n\n';
      if (resultado.modelo) {
        msg += `_Modelo: ${resultado.modelo}_`;
      }
      await sendTelegramLong(msg);
    } else {
      await sendTelegram(resultado.mensaje);
    }

  } catch (error) {
    console.log('[cmdIA] ERROR:', error);
    await sendTelegram(`❌ Error al procesar tu pregunta: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 📋 TELEGRAM
// ═══════════════════════════════════════════════════════════════

async function sendTelegram(text) {
  if (!CONFIG.TELEGRAM_TOKEN || !CONFIG.CHAT_ID) {
    console.log('[sendTelegram] ❌ ERROR: Falta TOKEN o CHAT_ID');
    console.log('[sendTelegram] TOKEN:', CONFIG.TELEGRAM_TOKEN ? '✅ Presente' : '❌ Falta');
    console.log('[sendTelegram] CHAT_ID:', CONFIG.CHAT_ID || '❌ Falta');
    return { success: false, error: 'Falta configuración' };
  }

  const safeText = (typeof text === 'string' && text.length > 0) ? text : '(mensaje vacio)';
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`;

  try {
    console.log(`[sendTelegram] 📤 Enviando mensaje (${safeText.length} chars)...`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.CHAT_ID,
        text: safeText,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      })
    });

    const responseText = await response.text();
    console.log(`[sendTelegram] 📥 Response status: ${response.status}`);
    console.log(`[sendTelegram] 📥 Response body: ${responseText.substring(0, 200)}`);

    if (!response.ok) {
      console.log('[sendTelegram] ⚠️ Primer intento falló, reintentando sin Markdown...');
      const response2 = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CONFIG.CHAT_ID,
          text: safeText.replace(/[*_`\[\]]/g, ''),
        })
      });
      
      const response2Text = await response2.text();
      console.log(`[sendTelegram] 📥 Segundo intento status: ${response2.status}`);
      console.log(`[sendTelegram] 📥 Segundo intento body: ${response2Text.substring(0, 200)}`);
      
      if (response2.ok) {
        console.log('[sendTelegram] ✅ Segundo intento exitoso');
        return { success: true, retry: true };
      } else {
        console.log('[sendTelegram] ❌ Segundo intento también falló');
        return { success: false, error: response2Text };
      }
    }
    
    console.log('[sendTelegram] ✅ Mensaje enviado exitosamente');
    return { success: true };
    
  } catch(e) {
    console.log('[sendTelegram] ❌ ERROR de red:', e.toString());
    return { success: false, error: e.toString() };
  }
}

async function sendTelegramLong(text) {
  const safeText = (typeof text === 'string' && text.length > 0) ? text : 'Error interno.';
  const MAX = 3800;

  if (safeText.length <= MAX) {
    await sendTelegram(safeText);
    return;
  }

  let remaining = safeText;
  let part = 1;

  while (remaining.length > 0) {
    let chunk;
    if (remaining.length <= MAX) {
      chunk = remaining;
      remaining = '';
    } else {
      let cut = remaining.lastIndexOf('\n', MAX);
      if (cut <= 0) cut = MAX;
      chunk = remaining.substring(0, cut);
      remaining = remaining.substring(cut).replace(/^\n/, '');
    }
    if (part > 1) await sleep(600);
    await sendTelegram(chunk);
    part++;
  }
}

// ═══════════════════════════════════════════════════════════════
// 📋 INTERVALS.ICU API
// ═══════════════════════════════════════════════════════════════

async function fetchIntervals(endpoint) {
  const auth = Buffer.from(`API_KEY:${CONFIG.INTERVALS_API_KEY}`).toString('base64');
  const url = API_BASE + endpoint;

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Basic ${auth}` }
  });

  if (!response.ok) throw new Error(`Intervals API HTTP ${response.status}`);
  return response.json();
}

async function postIntervals(endpoint, payload) {
  const auth = Buffer.from(`API_KEY:${CONFIG.INTERVALS_API_KEY}`).toString('base64');
  const url = API_BASE + endpoint;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok && response.status !== 201) {
    throw new Error(`Intervals API POST HTTP ${response.status}`);
  }
  return response.json();
}

// ─── NUEVA FUNCIÓN: ACTIVITY DETAIL (ENDPOINT CORRECTO) ──────
async function fetchIntervalsActivity(activityId) {
  const auth = Buffer.from(`API_KEY:${CONFIG.INTERVALS_API_KEY}`).toString('base64');
  const url = `https://intervals.icu/api/v1/activity/${activityId}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Basic ${auth}` }
  });

  if (!response.ok) throw new Error(`Intervals API HTTP ${response.status}`);
  return response.json();
}

async function fetchWellness(days) {
  const end = formatDate(new Date());
  const start = formatDate(addDays(new Date(), -days));
  return fetchIntervals(`/wellness?oldest=${start}&newest=${end}`);
}

async function fetchActivities(limit) {
  const end = formatDate(new Date());
  const start = formatDate(addDays(new Date(), -90));
  return fetchIntervals(`/activities?oldest=${start}&newest=${end}&limit=${limit}`);
}

// ─── POWER CURVE ──────────────────────────────────────────────
async function fetchPowerCurve(activityId) {
  try {
    const auth = Buffer.from(`API_KEY:${CONFIG.INTERVALS_API_KEY}`).toString('base64');
    const url = `https://intervals.icu/api/v1/activity/${activityId}/powercurve`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Basic ${auth}` }
    });
    if (!response.ok) return null;
    return response.json();
  } catch (e) {
    console.log('[fetchPowerCurve] Error:', e.message);
    return null;
  }
}

// ─── WEATHER ───
async function fetchWeather() {
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(CONFIG.CITY)}&appid=${CONFIG.WEATHER_API_KEY}&units=metric&lang=es`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    return safeWeatherData(data);
  } catch (err) {
    console.log('[fetchWeather] ERROR:', err.toString());
    return null;
  }
}

function safeWeatherData(weatherResponse) {
  if (!weatherResponse || typeof weatherResponse !== 'object') {
    return { temp: 'N/D', wind: 0, rain: 0, description: 'Sin datos', humidity: 50 };
  }

  let temp = 'N/D';
  let humidity = 50;
  if (weatherResponse.main && typeof weatherResponse.main === 'object') {
    const tempVal = weatherResponse.main.temp;
    if (tempVal !== undefined && tempVal !== null && !isNaN(tempVal)) temp = Math.round(tempVal);
    const humVal = weatherResponse.main.humidity;
    if (humVal !== undefined && humVal !== null && !isNaN(humVal)) humidity = Math.round(humVal);
  }

  let wind = 0;
  if (weatherResponse.wind && typeof weatherResponse.wind === 'object') {
    const windVal = weatherResponse.wind.speed;
    if (windVal !== undefined && windVal !== null && !isNaN(windVal)) wind = Math.round(windVal * 3.6);
  }

  let rain = 0;
  if (weatherResponse.rain && typeof weatherResponse.rain === 'object') {
    const rainVal = weatherResponse.rain['1h'] || weatherResponse.rain['3h'] || 0;
    if (rainVal !== undefined && rainVal !== null && !isNaN(rainVal)) rain = Math.round(rainVal * 10) / 10;
  }

  let description = 'Sin datos';
  if (weatherResponse.weather && Array.isArray(weatherResponse.weather) && weatherResponse.weather.length > 0) {
    const firstWeather = weatherResponse.weather[0];
    if (firstWeather && typeof firstWeather === 'object') {
      description = firstWeather.description || 'Sin descripción';
    }
  }

  return { temp, wind, rain, description, humidity };
}

// ═══════════════════════════════════════════════════════════════
// 📋 FUNCIONES DE ESTADO
// ═══════════════════════════════════════════════════════════════

async function fetchWellnessSafe(days) {
  try { return await fetchWellness(days); } catch(e) { return null; }
}

async function fetchWeatherSafe() {
  try { return await fetchWeather(); } catch(e) { return null; }
}

async function obtenerDatosCompletos() {
  try {
    const wellness = await fetchWellnessSafe(7);
    const today = (wellness && wellness.length > 0) ? wellness[wellness.length - 1] : null;
    const activities = await fetchActivities(28);
    const weather = await fetchWeatherSafe();
    const pasos = today ? safeNum(today.steps) || safeNum(today.stepsCount) || 0 : 0;
    const sueño = today ? safeNum(today.sleepQuality) || 2 : 2;
    const hrv = today ? safeNum(today.hrv) || 50 : 50;

    return {
      wellness,
      today,
      activities,
      weather,
      pasos,
      sueño,
      hrv,
      ctl: today ? safeNum(today.ctl, 50) : 50,
      atl: today ? safeNum(today.atl, 50) : 50,
      tsb: today ? (safeNum(today.ctl, 50) - safeNum(today.atl, 50)) : 0
    };
  } catch (err) {
    console.log('[obtenerDatosCompletos] ERROR:', err.toString());
    return null;
  }
}

async function calcularEstadoSistema(datos) {
  if (!datos || !datos.today) {
    return {
      ctl: 50,
      atl: 50,
      tsb: 0,
      hrv: 50,
      sleepQuality: 2,
      readiness: 50,
      weeklyTss: 0,
      weeklyHours: 0,
      weeklySessions: 0,
      tendencia: 'estable',
      acwr: 1.0,
      recuperacionNecesaria: 'normal',
      pasos: 0,
      factorCalor: 1.0,
      tempActual: 25,
      heatIndex: 25,
      humidity: 50,
      haceCalor: false,
      flags: {
        estaFatigado: false,
        estaMuyFatigado: false,
        estaDescansado: false,
        sobreCargaSemanal: false,
        necesitaRecuperacion: false,
        haceCalor: false
      }
    };
  }

  const today = datos.today;
  const ctl = safeNum(today.ctl, 50);
  const atl = safeNum(today.atl, 50);
  const tsb = ctl - atl;
  const hrv = safeNum(today.hrv, 50);
  const sleepQuality = safeNum(today.sleepQuality, 2);
  const pasos = safeNum(today.steps) || safeNum(today.stepsCount) || 0;

  let weeklyTss = 0;
  let weeklyHours = 0;
  let weeklySessions = 0;

  const diaSemana = new Date().getDay();
  const diasDesdeLunes = diaSemana === 0 ? 6 : diaSemana - 1;
  const lunesEstaSemana = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - diasDesdeLunes);
  const lunesStr = formatDate(lunesEstaSemana);
  const domingoEstaSemana = new Date(lunesEstaSemana.getTime() + 6 * 86400000);
  const domingoStr = formatDate(domingoEstaSemana);

  (datos.activities || []).forEach((a) => {
    const d = new Date(a.start_date_local || a.start_date || '');
    const fechaStr = formatDate(d);
    if (fechaStr >= lunesStr && fechaStr <= domingoStr) {
      weeklyTss += safeNum(a.icu_training_load, 0);
      weeklyHours += safeNum(a.moving_time, 0) / 3600;
      weeklySessions++;
    }
  });

  // ─── READINESS CON TENDENCIAS Y APRENDIZAJE ─────────────────
  const historialParaReadiness = await obtenerHistorialAsync();
  const readinessResult = calcularReadinessConTendencia({
    tsb,
    hrv,
    sleepQuality,
    pasos,
    weeklyTss
  }, historialParaReadiness);
  
  let readiness = readinessResult.readiness;
  let readinessAlertas = [];
  let readinessTendencias = null;
  
  // Añadir alertas al estado si hay
  if (readinessResult.alertas && readinessResult.alertas.length > 0) {
    readinessAlertas = readinessResult.alertas;
  }
  
  // Guardar tendencias para debugging
  if (readinessResult.tendencias) {
    readinessTendencias = readinessResult.tendencias;
  }

  let factorCalor = 1.0;
  let haceCalor = false;
  let tempActual = 25;
  let heatIndex = 25;
  let humidity = 50;

  if (datos.weather && typeof datos.weather === 'object') {
    const temp = datos.weather.temp;
    const hum = datos.weather.humidity || 50;
    humidity = hum;
    
    if (typeof temp === 'number') {
      tempActual = temp;
      heatIndex = calcularHeatIndex(temp, hum);
      
      const aclimatado = estaAclimatado();
      
      if (heatIndex > 40) {
        factorCalor = 0.70;
        haceCalor = true;
      } else if (heatIndex > 38) {
        factorCalor = aclimatado ? 0.85 : 0.80;
        haceCalor = true;
      } else if (heatIndex > 35) {
        factorCalor = aclimatado ? 0.90 : 0.85;
        haceCalor = true;
      } else if (heatIndex > 32) {
        factorCalor = aclimatado ? 0.95 : 0.90;
        haceCalor = true;
      } else if (heatIndex > 28) {
        factorCalor = aclimatado ? 0.98 : 0.95;
        haceCalor = true;
      }
      
      if (temp > 28) {
        const dias = getDiasAclimatados() + 1;
        setProperty('dias_calor', Math.min(dias, 30));
      }
    }
  }

  let tendencia = 'estable';
  if (tsb < -15) tendencia = 'fatiga_acumulada';
  else if (tsb > 10) tendencia = 'descansado';

  const acwr = calcularACWR(datos.activities || []);

  let recuperacionNecesaria = 'normal';
  if (tsb < -20 || readiness < 40) recuperacionNecesaria = 'critica';
  else if (tsb < -10 || readiness < 60) recuperacionNecesaria = 'prioritaria';

  return {
    ctl,
    atl,
    tsb,
    hrv,
    sleepQuality,
    readiness,
    readinessAlertas,
    readinessTendencias,
    weeklyTss,
    weeklyHours,
    weeklySessions,
    tendencia,
    acwr: acwr.ratio,
    recuperacionNecesaria,
    pasos,
    factorCalor,
    tempActual,
    heatIndex,
    humidity,
    haceCalor,
    flags: {
      estaFatigado: tsb < -15,
      estaMuyFatigado: tsb < -25,
      estaDescansado: tsb > 10,
      sobreCargaSemanal: weeklyTss > 750,
      necesitaRecuperacion: readiness < 55 || tsb < -15,
      haceCalor
    }
  };
}

function calcularACWR(activities) {
  if (!activities || !Array.isArray(activities) || activities.length === 0) {
    return { ratio: 1.0 };
  }
  const ahora = new Date();
  let tss7dias = 0;
  let tss28dias = 0;
  activities.forEach(a => {
    const fecha = new Date(a.start_date_local || a.start_date || '');
    const diff = (ahora - fecha) / (1000 * 60 * 60 * 24);
    const tss = safeNum(a.icu_training_load, 0);
    if (diff <= 7) tss7dias += tss;
    if (diff <= 28) tss28dias += tss;
  });
  const cargaAguda = tss7dias / 7;
  const cargaCronica = tss28dias / 28;
  if (cargaCronica === 0) return { ratio: 1.0 };
  return { ratio: Math.round((cargaAguda / cargaCronica) * 100) / 100 };
}

// ═══════════════════════════════════════════════════════════════
// 📋 DECISION TRACE LAYER
// ═══════════════════════════════════════════════════════════════

function crearTraza() {
  return {
    timestamp: new Date().toISOString(),
    inputs: {},
    reglasActivadas: [],
    conflictos: [],
    decision: null,
    alternativas: [],
    version: '9.5'
  };
}

function registrarInputTraza(traza, clave, valor, descripcion) {
  if (!traza.inputs) traza.inputs = {};
  traza.inputs[clave] = { valor, descripcion };
}

function registrarReglaTraza(traza, nivel, regla, accion) {
  if (!traza.reglasActivadas) traza.reglasActivadas = [];
  traza.reglasActivadas.push({ nivel, regla, accion });
}

function registrarConflictoTraza(traza, entre, resolucion) {
  if (!traza.conflictos) traza.conflictos = [];
  traza.conflictos.push({ entre, resolucion });
}

function registrarDecisionTraza(traza, decision, prioridad) {
  traza.decision = { tipo: decision, prioridad };
}

function registrarAlternativaTraza(traza, tipo, motivo) {
  if (!traza.alternativas) traza.alternativas = [];
  traza.alternativas.push({ tipo, motivo });
}

function guardarTraza(traza) {
  try {
    setProperty('ultima_traza', JSON.stringify(traza));
    const historialTraza = getProperty('historial_trazas');
    let data = historialTraza ? JSON.parse(historialTraza) : [];
    data.push(traza);
    if (data.length > 100) data = data.slice(-100);
    setProperty('historial_trazas', JSON.stringify(data));
    console.log('[guardarTraza] Traza guardada. ID:', traza.timestamp);
  } catch(e) {
    console.log('[guardarTraza] ERROR:', e.toString());
  }
}

function obtenerUltimaTraza() {
  try {
    const ultimaTraza = getProperty('ultima_traza');
    if (!ultimaTraza) return null;
    return JSON.parse(ultimaTraza);
  } catch(e) {
    console.log('[obtenerUltimaTraza] ERROR:', e.toString());
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// 📋 CONFLICT RESOLVER
// ═══════════════════════════════════════════════════════════════

function resolverConflictos(estado, restricciones, decision, traza) {
  const resultado = JSON.parse(JSON.stringify(decision));

  // NIVEL 1: SEGURIDAD
  if (estado.tsb < -30) {
    registrarConflictoTraza(traza, 'TSB extremo vs cualquier plan', 'SEGURIDAD gana - Descanso obligatorio');
    registrarDecisionTraza(traza, 'descanso', 'NIVEL 1 - SEGURIDAD');
    return {
      tipo: 'descanso',
      reps: 0,
      durMin: 0,
      recSec: 0,
      intensidad: 0,
      motivo: `🔴 SEGURIDAD: TSB extremo (${estado.tsb.toFixed(1)}). Descanso obligatorio.`,
      override: true
    };
  }

  if (estado.readiness < 30) {
    registrarConflictoTraza(traza, 'Readiness bajo vs cualquier plan', 'SEGURIDAD gana - Descanso obligatorio');
    registrarDecisionTraza(traza, 'descanso', 'NIVEL 1 - SEGURIDAD');
    return {
      tipo: 'descanso',
      reps: 0,
      durMin: 0,
      recSec: 0,
      intensidad: 0,
      motivo: `🔴 SEGURIDAD: Readiness muy bajo (${estado.readiness}/100). Descanso obligatorio.`,
      override: true
    };
  }

  if (estado.acwr > 1.5) {
    registrarConflictoTraza(traza, 'ACWR alto vs plan normal', 'SEGURIDAD gana - Reducción obligatoria');
    registrarDecisionTraza(traza, 'z2 reducido', 'NIVEL 1 - SEGURIDAD');
    resultado.durMin = Math.min(resultado.durMin || 30, 25);
    resultado.motivo = (resultado.motivo || '') + ` | 🔴 ACWR alto (${estado.acwr.toFixed(2)}) - Reducción obligatoria`;
    resultado.tipo = 'z2';
    resultado.intensidad = 0.60;
    resultado.reps = 1;
    resultado.recSec = 0;
    return resultado;
  }

  // NIVEL 2: CLIMA (con WBGT)
  if (estado.heatIndex > 40) {
    registrarConflictoTraza(traza, 'Heat Index >40°C vs plan normal', 'CLIMA gana - Descanso obligatorio');
    registrarDecisionTraza(traza, 'descanso', 'NIVEL 2 - CLIMA EXTREMO');
    return {
      tipo: 'descanso',
      reps: 0,
      durMin: 0,
      recSec: 0,
      intensidad: 0,
      motivo: `🔥 Calor extremo (Heat Index ${estado.heatIndex}°C) - Descanso obligatorio por seguridad.`,
      override: true
    };
  }

  if (estado.heatIndex > 38) {
    const aclimatado = estaAclimatado();
    const factor = aclimatado ? 0.85 : 0.80;
    registrarConflictoTraza(traza, 'Heat Index >38°C vs plan', 'CLIMA gana - Reducción');
    registrarDecisionTraza(traza, 'z2 reducido por calor', 'NIVEL 2 - CLIMA');
    resultado.durMin = Math.round((resultado.durMin || 60) * factor);
    resultado.intensidad = Math.round((resultado.intensidad || 0.65) * 0.95 * 100) / 100;
    if (resultado.durMin < 20) resultado.durMin = 20;
    if (resultado.tipo !== 'descanso') resultado.tipo = 'z2';
    resultado.reps = 1;
    resultado.recSec = 0;
    resultado.motivo = (resultado.motivo || '') + ` | 🌡️ Heat Index ${estado.heatIndex}°C - duración -${Math.round((1-factor)*100)}%${aclimatado ? ' (aclimatado)' : ''}`;
    resultado.notaHidratacion = '💧 1L/hora + electrolitos obligatorios';
    return resultado;
  }

  if (estado.heatIndex > 35) {
    const aclimatado = estaAclimatado();
    const factor = aclimatado ? 0.90 : 0.85;
    registrarConflictoTraza(traza, 'Heat Index >35°C vs plan', 'CLIMA gana - Reducción');
    registrarDecisionTraza(traza, 'z2 reducido por calor', 'NIVEL 2 - CLIMA');
    resultado.durMin = Math.round((resultado.durMin || 60) * factor);
    if (resultado.durMin < 20) resultado.durMin = 20;
    if (resultado.tipo !== 'descanso') resultado.tipo = 'z2';
    resultado.reps = 1;
    resultado.recSec = 0;
    resultado.motivo = (resultado.motivo || '') + ` | ☀️ Heat Index ${estado.heatIndex}°C - duración -${Math.round((1-factor)*100)}%`;
    resultado.notaHidratacion = '💧 1L/hora + electrolitos';
    return resultado;
  }

  if (estado.heatIndex > 32) {
    registrarConflictoTraza(traza, 'Heat Index >32°C vs plan', 'CLIMA gana - Reducción 5%');
    registrarDecisionTraza(traza, 'z2 reducido por calor', 'NIVEL 2 - CLIMA');
    resultado.durMin = Math.round((resultado.durMin || 60) * 0.95);
    if (resultado.durMin < 20) resultado.durMin = 20;
    if (resultado.tipo !== 'descanso') resultado.tipo = 'z2';
    resultado.reps = 1;
    resultado.recSec = 0;
    resultado.motivo = (resultado.motivo || '') + ` | 🌤️ Heat Index ${estado.heatIndex}°C - duración -5%`;
    resultado.notaHidratacion = '💧 750ml/hora + electrolitos';
    return resultado;
  }

  // NIVEL 3: FATIGA AGUDA
  if (estado.tsb < -20) {
    registrarConflictoTraza(traza, 'TSB bajo vs plan intenso', 'FATIGA gana - Cambio a SweetSpot');
    registrarDecisionTraza(traza, 'sweetspot reducido', 'NIVEL 3 - FATIGA AGUDA');
    if (resultado.tipo === 'vo2' || resultado.tipo === 'ftp') {
      resultado.tipo = 'sweetspot';
      resultado.reps = Math.max(2, Math.round((resultado.reps || 3) * 0.7));
      resultado.motivo = (resultado.motivo || '') + ' | 🧠 TSB < -20 - VO2/FTP → SweetSpot reducido';
    }
    if (resultado.durMin > 45) {
      resultado.durMin = 45;
      resultado.motivo = (resultado.motivo || '') + ' | 🧠 TSB < -20 - Duración máxima 45 min';
    }
    resultado.intensidad = 0.85;
    return resultado;
  }

  if (estado.hrv < 40) {
    registrarConflictoTraza(traza, 'HRV bajo vs intensidad', 'FATIGA gana - Reducción intensidad');
    registrarDecisionTraza(traza, 'intensidad reducida', 'NIVEL 3 - FATIGA AGUDA');
    resultado.intensidad = Math.round((resultado.intensidad || 0.65) * 0.8 * 100) / 100;
    if (resultado.tipo === 'vo2' || resultado.tipo === 'ftp') {
      resultado.tipo = 'sweetspot';
      resultado.reps = Math.max(2, Math.round((resultado.reps || 3) * 0.7));
    }
    resultado.motivo = (resultado.motivo || '') + ` | 🧠 HRV bajo (${estado.hrv}) - Intensidad -20%`;
    return resultado;
  }

  if (estado.sleepQuality === 1) {
    registrarConflictoTraza(traza, 'Sueño malo vs intensidad', 'FATIGA gana - Reducción intensidad');
    registrarDecisionTraza(traza, 'intensidad reducida por sueño', 'NIVEL 3 - FATIGA AGUDA');
    resultado.intensidad = Math.round((resultado.intensidad || 0.65) * 0.85 * 100) / 100;
    if (resultado.tipo === 'vo2' || resultado.tipo === 'ftp') {
      resultado.tipo = 'sweetspot';
      resultado.reps = Math.max(2, Math.round((resultado.reps || 3) * 0.7));
    }
    resultado.motivo = (resultado.motivo || '') + ' | 😴 Sueño malo - Intensidad -15%';
    return resultado;
  }

  // NIVEL 4: PLAN ESTRUCTURAL
  if (estado.ctl < 50) {
    registrarConflictoTraza(traza, 'CTL bajo vs plan intenso', 'PLAN gana - Priorizar base');
    registrarDecisionTraza(traza, 'z2', 'NIVEL 4 - PLAN ESTRUCTURAL');
    if (resultado.tipo === 'vo2' || resultado.tipo === 'ftp') {
      resultado.tipo = 'z2';
      resultado.reps = 1;
      resultado.durMin = Math.max(resultado.durMin || 45, 50);
      resultado.recSec = 0;
      resultado.motivo = (resultado.motivo || '') + ` | 📊 CTL bajo (${estado.ctl.toFixed(1)}) - Priorizar base aeróbica`;
    }
    resultado.intensidad = 0.65;
    return resultado;
  }

  if (estado.acwr > 1.3) {
    registrarConflictoTraza(traza, 'ACWR alto vs volumen', 'PLAN gana - Reducción volumen');
    registrarDecisionTraza(traza, 'volumen reducido', 'NIVEL 4 - PLAN ESTRUCTURAL');
    resultado.durMin = Math.round((resultado.durMin || 60) * 0.85);
    if (resultado.durMin < 20) resultado.durMin = 20;
    if (resultado.tipo !== 'descanso' && resultado.tipo !== 'z1') {
      resultado.tipo = 'z2';
      resultado.reps = 1;
      resultado.recSec = 0;
    }
    resultado.motivo = (resultado.motivo || '') + ` | 📊 ACWR ${estado.acwr.toFixed(2)} - Volumen -15%`;
    return resultado;
  }

  // NIVEL 5: OBJETIVO (296W)
  if (estado.tsb > -5 && estado.readiness > 80 && estado.hrv > 50 && estado.heatIndex < 32) {
    registrarConflictoTraza(traza, 'Ventana de calidad vs plan base', 'OBJETIVO gana - Calidad recomendada');
    registrarDecisionTraza(traza, 'calidad', 'NIVEL 5 - OBJETIVO 296W');
    if (resultado.tipo === 'z2' && estado.ctl > 60 && getFaseActual() !== 'base') {
      resultado.tipo = 'sweetspot';
      resultado.reps = Math.max(3, resultado.reps || 3);
      resultado.durMin = Math.max(resultado.durMin || 8, 8);
      resultado.intensidad = 0.88;
      resultado.motivo = (resultado.motivo || '') + ' | 🎯 Ventana de calidad para objetivo 296W';
    }
    return resultado;
  }

  if (!resultado.tipo) {
    resultado.tipo = 'z2';
    resultado.reps = 1;
    resultado.durMin = 60;
    resultado.recSec = 0;
    resultado.intensidad = 0.65;
    resultado.motivo = 'Plan base por defecto';
  }

  registrarDecisionTraza(traza, resultado.tipo, 'NIVEL 4 - PLAN ESTRUCTURAL (sin conflictos)');
  return resultado;
}

// ═══════════════════════════════════════════════════════════════
// 📋 LEARNING FILTER
// ═══════════════════════════════════════════════════════════════

function validarFeedback(feedback, estado) {
  const resultado = { valido: true, peso: 1.0, motivo: 'Feedback válido' };

  if (!estado) {
    console.log('[validarFeedback] ⚠️ Sin estado - usando valores por defecto');
    return resultado;
  }

  if (CONFIG.LEARNING.validarRPE) {
    if (feedback.rpe >= 8 && estado.tsb > 0) {
      resultado.valido = false;
      resultado.motivo = 'RPE alto con TSB positivo → posible sesgo';
      return resultado;
    }
    if (feedback.rpe <= 3 && estado.tsb < -15) {
      resultado.valido = false;
      resultado.motivo = 'RPE bajo con TSB muy negativo → posible sesgo';
      return resultado;
    }
  }

  if (feedback.rpe >= 8 && estado.sleepQuality === 3) {
    resultado.peso = 0.6;
    resultado.motivo = 'RPE alto con sueño bueno → posible sesgo, peso reducido';
  }

  if (feedback.rpe >= 8 && estado.tempActual > 35) {
    resultado.peso = 0.8;
    resultado.motivo = 'RPE alto justificado por calor, peso moderado';
  }

  if (feedback.stress === 3 && feedback.rpe >= 8) {
    resultado.peso = 0.5;
    resultado.motivo = 'Estrés laboral + RPE alto → no es fisiológico, peso reducido';
  }

  if (feedback.piernas === 1 && feedback.rpe <= 4) {
    resultado.peso = 0.5;
    resultado.motivo = 'Piernas pesadas con RPE bajo → inconsistente, peso reducido';
  }

  if (resultado.peso < CONFIG.LEARNING.pesoMinimo) {
    resultado.valido = false;
    resultado.motivo = `Peso muy bajo (${resultado.peso.toFixed(2)}) < mínimo (${CONFIG.LEARNING.pesoMinimo})`;
  }

  return resultado;
}

// ═══════════════════════════════════════════════════════════════
// 🆕 GUARDAR FEEDBACK CONTEXTUAL
// ═══════════════════════════════════════════════════════════════

function guardarFeedbackContextual(feedback, contexto) {
  try {
    const historial = obtenerHistorial();
    if (historial.length === 0) return;
    
    const ultimo = historial[historial.length - 1];
    ultimo.contexto = {
      hora: contexto.hora || 'desconocida',
      comioAntes: contexto.comioAntes || 'no',
      momentoDia: contexto.momentoDia || 'desconocido'
    };
    
    setProperty('historial_entrenos', JSON.stringify(historial));
    console.log('[guardarFeedbackContextual] Contexto guardado');
  } catch(e) {
    console.log('[guardarFeedbackContextual] ERROR:', e.toString());
  }
}

function analizarAprendizajeContextual() {
  const historial = obtenerHistorial();
  if (historial.length < 10) return null;
  
  let resultados = {
    manana: { total: 0, exito: 0 },
    tarde: { total: 0, exito: 0 },
    noche: { total: 0, exito: 0 },
    conComida: { total: 0, exito: 0 },
    sinComida: { total: 0, exito: 0 }
  };
  
  historial.forEach(h => {
    const contexto = h.contexto || {};
    const exito = (h.resultado || 0) >= 70;
    
    if (contexto.momentoDia === 'manana') { resultados.manana.total++; if (exito) resultados.manana.exito++; }
    if (contexto.momentoDia === 'tarde') { resultados.tarde.total++; if (exito) resultados.tarde.exito++; }
    if (contexto.momentoDia === 'noche') { resultados.noche.total++; if (exito) resultados.noche.exito++; }
    if (contexto.comioAntes === 'si') { resultados.conComida.total++; if (exito) resultados.conComida.exito++; }
    if (contexto.comioAntes === 'no') { resultados.sinComida.total++; if (exito) resultados.sinComida.exito++; }
  });
  
  return resultados;
}

// ═══════════════════════════════════════════════════════════════
// 📋 FUNCIONES DE RESTRICCIONES Y DECISIONES
// ═══════════════════════════════════════════════════════════════

function getMasterAgeModifiers(age) {
  if (!age || age < 18) age = 43;

  if (age >= 40 && age < 45) {
    return {
      recoveryMultiplier: 1.35,
      intensityLimit: 0.92,
      volumeZ2Multiplier: 1.5,
      vo2MaxDecay: 0.05,
      weeklyMaxTSS: 750,
      weeklyIdealTSS: 500,
      minRecoveryDays: 2,
      nombre: 'Master 40-45'
    };
  } else if (age >= 45 && age < 50) {
    return {
      recoveryMultiplier: 1.5,
      intensityLimit: 0.85,
      volumeZ2Multiplier: 1.7,
      vo2MaxDecay: 0.10,
      weeklyMaxTSS: 680,
      weeklyIdealTSS: 450,
      minRecoveryDays: 2,
      nombre: 'Master 45-50'
    };
  } else if (age >= 50) {
    return {
      recoveryMultiplier: 1.7,
      intensityLimit: 0.80,
      volumeZ2Multiplier: 2.0,
      vo2MaxDecay: 0.15,
      weeklyMaxTSS: 600,
      weeklyIdealTSS: 400,
      minRecoveryDays: 3,
      nombre: 'Master 50+'
    };
  }

  return {
    recoveryMultiplier: 1.0,
    intensityLimit: 1.0,
    volumeZ2Multiplier: 1.0,
    vo2MaxDecay: 0.0,
    weeklyMaxTSS: 850,
    weeklyIdealTSS: 600,
    minRecoveryDays: 1,
    nombre: 'General'
  };
}

function aplicarRestriccionesGlobales(estado, age) {
  const ageMods = getMasterAgeModifiers(age || 43);

  const restricciones = {
    intensidadMax: 1.0,
    volumenMax: 1.0,
    recuperacionExtra: false,
    forzarDescanso: false,
    forzarZ2: false,
    prohibirIntensidad: false,
    tssMaxSemanal: ageMods.weeklyMaxTSS,
    sesionesMaxSemana: 5,
    diasOffObligatorios: ageMods.minRecoveryDays,
    zonasPermitidas: ['z1', 'z2', 'z3', 'sweetspot', 'ftp', 'vo2'],
    zonasRestringidas: [],
    factorCalorAplicado: estado.factorCalor || 1.0,
    motivo: []
  };

  if (estado.flags.estaMuyFatigado || estado.readiness < 30) {
    restricciones.forzarDescanso = true;
    restricciones.prohibirIntensidad = true;
    restricciones.zonasPermitidas = ['z1'];
    restricciones.motivo.push('🔴 Fatiga crítica detectada');
    return restricciones;
  }

  if (estado.weeklyTss > ageMods.weeklyMaxTSS) {
    restricciones.forzarZ2 = true;
    restricciones.prohibirIntensidad = true;
    restricciones.volumenMax = 0.7;
    restricciones.zonasPermitidas = ['z1', 'z2'];
    restricciones.motivo.push(`⚠️ Sobrecarga semanal (${Math.round(estado.weeklyTss)} TSS)`);
  }

  if (estado.flags.estaFatigado && estado.readiness < 60) {
    restricciones.forzarZ2 = true;
    restricciones.intensidadMax = 0.75;
    restricciones.zonasPermitidas = ['z1', 'z2', 'z3'];
    restricciones.motivo.push(`🟡 Fatiga acumulada (TSB ${estado.tsb.toFixed(1)})`);
  }

  if (ageMods.recoveryMultiplier > 1.3) {
    restricciones.recuperacionExtra = true;
    restricciones.volumenMax = 0.85;
    restricciones.zonasRestringidas.push('vo2');
    restricciones.motivo.push(`🧠 Factor edad: ${ageMods.nombre}`);
  }

  if (estado.haceCalor && estado.heatIndex > 38) {
    restricciones.intensidadMax = 0.90;
    restricciones.volumenMax = 0.85;
    restricciones.factorCalorAplicado = 0.85;
    restricciones.zonasPermitidas = ['z1', 'z2'];
    restricciones.motivo.push(`🔥 Heat Index ${estado.heatIndex}°C - Reducción 15%`);
  } else if (estado.haceCalor && estado.heatIndex > 35) {
    restricciones.intensidadMax = 0.95;
    restricciones.volumenMax = 0.90;
    restricciones.factorCalorAplicado = 0.90;
    restricciones.motivo.push(`🌡️ Heat Index ${estado.heatIndex}°C - Reducción 10%`);
  } else if (estado.haceCalor && estado.heatIndex > 32) {
    restricciones.volumenMax = 0.95;
    restricciones.factorCalorAplicado = 0.95;
    restricciones.motivo.push(`☀️ Heat Index ${estado.heatIndex}°C - Reducción 5%`);
  }

  if (estado.acwr > 1.3) {
    restricciones.volumenMax = Math.min(restricciones.volumenMax || 1.0, 0.8);
    restricciones.intensidadMax = Math.min(restricciones.intensidadMax || 1.0, 0.9);
    restricciones.motivo.push(`📊 ACWR ${estado.acwr.toFixed(2)} - Reducción de carga`);
    if (estado.acwr > 1.5) {
      restricciones.forzarZ2 = true;
      restricciones.prohibirIntensidad = true;
      restricciones.motivo.push('🚨 ACWR crítico - Solo Z2');
    }
  }

  if (estado.sleepQuality === 1) {
    restricciones.intensidadMax = Math.min(restricciones.intensidadMax || 1.0, 0.8);
    restricciones.volumenMax = Math.min(restricciones.volumenMax || 1.0, 0.8);
    restricciones.motivo.push('😴 Sueño malo - Recuperación prioritaria');
  }

  return restricciones;
}

// ═══════════════════════════════════════════════════════════════
// 🆕 DECIDIR ENTRENAMIENTO CON PERIODIZACIÓN
// ═══════════════════════════════════════════════════════════════

function decidirEntrenamiento(estado, restricciones) {
  // ─── APLICAR PERIODIZACIÓN ──────────────────────────────────────
  const fase = getFaseActual();
  const tssObjetivo = getTssObjetivoSemanal();
  
  if (restricciones.forzarDescanso) {
    return {
      tipo: 'descanso',
      reps: 0,
      durMin: 0,
      recSec: 0,
      intensidad: 0,
      prioridad: 'recuperacion_obligatoria',
      motivo: restricciones.motivo.join(' | ') + ` | 📅 Fase: ${fase.toUpperCase()}`
    };
  }
  
  let faseRestringida = false;
  let motivoFase = '';
  let calidadPermitida = puedeHacerCalidad(estado, restricciones);
  
  if (fase === 'base') {
    if (estado.tsb < 15 || estado.readiness < 80) {
      restricciones.forzarZ2 = true;
      faseRestringida = true;
      motivoFase = '🏗️ Fase Base - Priorizar construcción aeróbica';
    } else {
      restricciones.zonasRestringidas.push('vo2');
      restricciones.zonasRestringidas.push('ftp');
      motivoFase = '🏗️ Fase Base - Solo SweetSpot con alta frescura';
    }
  }
  
  if (fase === 'desarrollo') {
    if (estado.tsb < 5 || estado.readiness < 75) {
      restricciones.zonasRestringidas.push('vo2');
      faseRestringida = true;
      motivoFase = '📈 Fase Desarrollo - VO2 solo con alta frescura';
    }
    if (!calidadPermitida && estado.tsb < 10) {
      restricciones.forzarZ2 = true;
      faseRestringida = true;
      motivoFase = '📈 Fase Desarrollo - Límite de calidad semanal alcanzado';
    }
  }
  
  if (fase === 'especificidad') {
    if (!calidadPermitida) {
      restricciones.forzarZ2 = true;
      faseRestringida = true;
      motivoFase = '🎯 Fase Especificidad - Límite de calidad semanal alcanzado';
    }
  }
  
  if (fase === 'taper') {
    restricciones.volumenMax = 0.7;
    restricciones.forzarZ2 = true;
    faseRestringida = true;
    motivoFase = '🧘 Fase Taper - Reducción de carga y prioridad a frescura';
  }
  
  const tssRestante = tssObjetivo - estado.weeklyTss;
  if (tssRestante < 50 && !restricciones.forzarZ2 && fase !== 'taper') {
    restricciones.volumenMax = Math.min(restricciones.volumenMax || 1.0, 0.8);
    faseRestringida = true;
    motivoFase = '📊 TSS semanal casi alcanzado';
  }
  
  // ─── LÓGICA ORIGINAL ────────────────────────────────────────────
  const tsb = estado.tsb;
  const readiness = estado.readiness;
  const weeklyTss = estado.weeklyTss;
  const tssMax = restricciones.tssMaxSemanal;
  const tssRestanteOriginal = tssMax - weeklyTss;

  if (tssRestanteOriginal < 30 && !restricciones.forzarZ2) {
    return {
      tipo: 'z2',
      reps: 1,
      durMin: 30,
      recSec: 0,
      intensidad: 0.65,
      prioridad: 'mantenimiento',
      motivo: `Límite semanal alcanzado (${Math.round(tssRestanteOriginal)} TSS restante) - Duración mínima 30 min${motivoFase ? ' | ' + motivoFase : ''}`
    };
  }

  let decision = {
    tipo: 'z2',
    reps: 1,
    durMin: 60,
    recSec: 0,
    intensidad: 0.65,
    prioridad: 'base',
    motivo: 'Estado operativo'
  };

  if (tsb > 10 && readiness > 70) {
    if (calidadPermitida) {
      if (estado.haceCalor && estado.heatIndex > 35) {
        decision = {
          tipo: 'sweetspot',
          reps: 2,
          durMin: 6,
          recSec: 120,
          intensidad: 0.88,
          prioridad: 'calidad_controlada',
          motivo: 'Calor extremo - SweetSpot reducido'
        };
      } else if (restricciones.zonasRestringidas.indexOf('vo2') === -1 && restricciones.intensidadMax > 0.9 && fase !== 'base') {
        decision = {
          tipo: 'vo2',
          reps: 4,
          durMin: 3,
          recSec: 180,
          intensidad: 1.12,
          prioridad: 'calidad_alta',
          motivo: 'Ventana de intensidad óptima - VO2 Max'
        };
      } else if (restricciones.zonasRestringidas.indexOf('ftp') === -1 && restricciones.intensidadMax > 0.9) {
        decision = {
          tipo: 'ftp',
          reps: 4,
          durMin: 4,
          recSec: 150,
          intensidad: 0.97,
          prioridad: 'calidad_alta',
          motivo: 'Desarrollo FTP'
        };
      } else {
        decision = {
          tipo: 'sweetspot',
          reps: 3,
          durMin: 8,
          recSec: 120,
          intensidad: 0.88,
          prioridad: 'desarrollo',
          motivo: 'SweetSpot - Equilibrio carga/recuperación'
        };
      }
    } else {
      decision = {
        tipo: 'z2',
        reps: 1,
        durMin: 75,
        recSec: 0,
        intensidad: 0.65,
        prioridad: 'base_extendida',
        motivo: `Ventana de frescura pero restricción de fase - Z2 extendido${motivoFase ? ' (' + motivoFase + ')' : ''}`
      };
    }
  } else if (tsb >= 0 && tsb <= 10) {
    if (calidadPermitida && fase !== 'base') {
      decision = {
        tipo: 'sweetspot',
        reps: 3,
        durMin: 8,
        recSec: 120,
        intensidad: 0.88,
        prioridad: 'desarrollo',
        motivo: 'Estado equilibrado - SweetSpot'
      };
    } else {
      let duracion = 70;
      if (estado.haceCalor && estado.heatIndex > 35) duracion = 55;
      decision = {
        tipo: 'z2',
        reps: 1,
        durMin: duracion,
        recSec: 0,
        intensidad: 0.65,
        prioridad: 'base',
        motivo: `Construcción aeróbica${estado.haceCalor ? ' (con calor)' : ''}${motivoFase ? ' | ' + motivoFase : ''}`
      };
    }
  } else if (tsb >= -10 && tsb < 0) {
    let duracion = 70;
    if (estado.haceCalor && estado.heatIndex > 35) duracion = 55;
    else if (estado.haceCalor && estado.heatIndex > 32) duracion = 60;
    if (estado.sleepQuality === 1) duracion = 50;

    decision = {
      tipo: 'z2',
      reps: 1,
      durMin: duracion,
      recSec: 0,
      intensidad: 0.65,
      prioridad: 'base',
      motivo: 'Construcción aeróbica' + (estado.haceCalor ? ' (con calor)' : '') + (motivoFase ? ' | ' + motivoFase : '')
    };
  } else if (tsb >= -20 && tsb < -10) {
    decision = {
      tipo: 'z2',
      reps: 1,
      durMin: 50,
      recSec: 0,
      intensidad: 0.60,
      prioridad: 'recuperacion_activa',
      motivo: `Asimilación de carga${motivoFase ? ' | ' + motivoFase : ''}`
    };
  } else {
    decision = {
      tipo: 'z1',
      reps: 1,
      durMin: 35,
      recSec: 0,
      intensidad: 0.45,
      prioridad: 'recuperacion_obligatoria',
      motivo: `Fatiga severa${motivoFase ? ' | ' + motivoFase : ''}`
    };
  }

  if (restricciones.forzarZ2 && decision.tipo !== 'z1') {
    decision.tipo = 'z2';
    decision.intensidad = Math.min(0.70, decision.intensidad || 0.65);
    decision.reps = 1;
    decision.durMin = Math.round(decision.durMin * 0.8);
    decision.recSec = 0;
    decision.motivo = 'Restricción: ' + decision.motivo;
  }

  if (restricciones.intensidadMax < 1.0) {
    const maxInt = restricciones.intensidadMax;
    if (decision.intensidad > maxInt) {
      decision.intensidad = maxInt;
      if (decision.tipo === 'vo2' && maxInt < 1.05) decision.tipo = 'ftp';
      if (decision.tipo === 'ftp' && maxInt < 0.92) decision.tipo = 'sweetspot';
      if (decision.tipo === 'sweetspot' && maxInt < 0.82) decision.tipo = 'z2';
    }
  }

  if (restricciones.volumenMax < 1.0) {
    decision.durMin = Math.round(decision.durMin * restricciones.volumenMax);
  }

  const tipoValido = restricciones.zonasPermitidas.indexOf(decision.tipo) !== -1;
  if (!tipoValido) {
    decision.tipo = 'z2';
    decision.intensidad = 0.65;
    decision.durMin = 45;
    decision.reps = 1;
    decision.recSec = 0;
    decision.motivo = 'Zona restringida - Fallback a Z2' + (motivoFase ? ' | ' + motivoFase : '');
  }

  if (estado.haceCalor) {
    decision.motivo += ` | 🌡️ ${estado.tempActual}°C (Heat Index ${estado.heatIndex}°C)`;
  }

  if (motivoFase && !decision.motivo.includes('Fase')) {
    decision.motivo += ` | ${motivoFase}`;
  }

  if (decision.tipo === 'z1') decision.durMin = Math.max(decision.durMin, 20);
  else if (decision.tipo === 'z2') decision.durMin = Math.max(decision.durMin, 30);
  else decision.durMin = Math.max(decision.durMin, 15);

  return decision;
}

// ═══════════════════════════════════════════════════════════════
// 📋 GENERAR WORKOUT (SINGLE SOURCE OF TRUTH)
// ═══════════════════════════════════════════════════════════════

function generateWorkout(state, restricciones, decision, traza) {
  if (!state || !decision) {
    console.warn('[generateWorkout] Datos insuficientes, usando fallback');
    return createFallbackWorkout();
  }

  const ftp = CONFIG.FTP || 240;
  const tipo = decision.tipo || 'z2';
  const reps = decision.reps || 1;
  const durMin = decision.durMin || 45;
  const recSec = decision.recSec || 0;
  const intensidad = decision.intensidad || 0.65;

  const bloques = generarBloques(tipo, reps, durMin, recSec, ftp, intensidad);
  const metricas = calcularMetricas(bloques, ftp);

  const workout = {
    fecha: new Date().toISOString(),
    tipo: tipo,
    objetivo: decision.prioridad || 'base',
    bloques: bloques,
    reps: reps,
    durMin: durMin,
    recSec: recSec,
    duracionTotalMin: bloques.reduce((sum, b) => sum + b.duracionMin, 0),
    intensidadFTP: intensidad,
    ftp: ftp,
    vatios: {
      low: Math.round(ftp * intensidad * 0.92),
      high: Math.round(ftp * intensidad * 1.08),
      avg: Math.round(ftp * intensidad)
    },
    ifEsperado: metricas.if,
    tssEsperado: metricas.tss,
    kjEsperados: metricas.kj,
    carbsEsperados: metricas.carbs,
    motivo: decision.motivo || 'Plan base',
    prioridad: decision.prioridad || 'base',
    notaHidratacion: decision.notaHidratacion || '💧 500ml/hora',
    cadenciaRecomendada: tipo === 'vo2' ? '100-110 rpm' : tipo === 'sweetspot' ? '85-95 rpm' : '80-90 rpm',
    nutricion: {
      chTotalDia: state.nutricion?.chTotalDia || 300,
      protTotalDia: state.nutricion?.protTotalDia || 120,
      grasaDiaria: state.nutricion?.grasaDiaria || 60,
      hidratacion: state.nutricion?.hidratacion || '2L base'
    },
    fuerza: state.fuerza || { nivel: 'Básico', ejercicios: [], recomendado: true },
    decisionTrace: traza || null,
    estado: {
      tsb: state.tsb || 0,
      readiness: state.readiness || 50,
      ctl: state.estado?.ctl || 50,
      atl: state.estado?.atl || 50,
      sleepQuality: state.estado?.sleepQuality || 2,
      hrv: state.estado?.hrv || 50
    },
    meta: {
      objetivo: CONFIG.FTP_HISTORICO.valor || 296,
      diff: (CONFIG.FTP_HISTORICO.valor || 296) - ftp
    },
    fase: {
      nombre: getNombreFase(),
      semana: getSemanaActual(),
      totalSemanas: getSemanasFase()
    }
  };

  console.log('[generateWorkout] ✅ Workout generado:', workout.tipo, workout.reps + 'x' + workout.durMin + 'min');
  return workout;
}

function generarBloques(tipo, reps, durMin, recSec, ftp, intensidad) {
  const bloques = [];
  
  bloques.push({
    tipo: 'warmup',
    nombre: 'Calentamiento',
    duracionMin: 10,
    vatios: { low: Math.round(ftp * 0.45), high: Math.round(ftp * 0.55) },
    intensidad: 0.50,
    cadencia: '85-95 rpm'
  });

  const tipoLimpio = tipo.toLowerCase().trim();
  const pcts = {
    sweetspot: { low: 0.88, high: 0.93 },
    vo2: { low: 1.10, high: 1.20 },
    ftp: { low: 0.95, high: 1.00 },
    z2: { low: 0.60, high: 0.70 },
    z1: { low: 0.40, high: 0.55 },
    z3: { low: 0.75, high: 0.87 },
    grupeta: { low: 0.75, high: 0.95 },
    salida_tranquila: { low: 0.50, high: 0.65 }
  };

  const zona = pcts[tipoLimpio] || pcts.z2;
  const wLow = Math.round(ftp * zona.low);
  const wHigh = Math.round(ftp * zona.high);

  let cadenciaMain = '85-95 rpm';
  if (tipoLimpio === 'vo2') cadenciaMain = '100-110 rpm';
  else if (tipoLimpio === 'sweetspot') cadenciaMain = '85-95 rpm';
  else if (tipoLimpio === 'ftp') cadenciaMain = '90-100 rpm';
  else if (tipoLimpio === 'z2') cadenciaMain = '80-90 rpm';
  else if (tipoLimpio === 'z1') cadenciaMain = '75-85 rpm';
  else if (tipoLimpio === 'grupeta') cadenciaMain = '80-95 rpm (según terreno)';
  else if (tipoLimpio === 'salida_tranquila') cadenciaMain = '75-85 rpm';

  for (let i = 0; i < reps; i++) {
    const nombre = reps > 1 ? `Repetición ${i+1}` : 'Bloque principal';
    bloques.push({
      tipo: 'main',
      nombre: nombre,
      duracionMin: durMin,
      vatios: { low: Math.round(wLow * 0.95), high: Math.round(wHigh * 1.05) },
      intensidad: intensidad,
      cadencia: cadenciaMain
    });
    if (i < reps - 1 && recSec > 0) {
      bloques.push({
        tipo: 'recovery',
        nombre: 'Recuperación',
        duracionMin: Math.round(recSec / 60),
        vatios: { low: Math.round(ftp * 0.40), high: Math.round(ftp * 0.50) },
        intensidad: 0.45,
        cadencia: '80-90 rpm'
      });
    }
  }

  bloques.push({
    tipo: 'cooldown',
    nombre: 'Vuelta a la calma',
    duracionMin: 10,
    vatios: { low: Math.round(ftp * 0.35), high: Math.round(ftp * 0.45) },
    intensidad: 0.40,
    cadencia: '75-85 rpm'
  });

  return bloques;
}

function calcularMetricas(bloques, ftp) {
  let tssTotal = 0;
  let kjTotal = 0;
  let duracionTotalSeg = 0;
  let potenciaMedia = 0;

  bloques.forEach(bloque => {
    const durSeg = bloque.duracionMin * 60;
    const wAvg = (bloque.vatios.low + bloque.vatios.high) / 2;
    const ifFactor = wAvg / ftp;
    tssTotal += (durSeg / 3600) * Math.pow(ifFactor, 2) * 100;
    kjTotal += (wAvg * durSeg) / 1000;
    duracionTotalSeg += durSeg;
    potenciaMedia += wAvg * durSeg;
  });

  potenciaMedia = duracionTotalSeg > 0 ? potenciaMedia / duracionTotalSeg : 0;
  const ifEsperado = ftp > 0 ? (potenciaMedia / ftp) : 0.65;

  const eficienciaMetabolica = 0.22;
  const kcalTotales = kjTotal / (eficienciaMetabolica * 4.184);
  let pctCarbs = 0.50;
  if (ifEsperado > 0.85) pctCarbs = 0.85;
  else if (ifEsperado > 0.75) pctCarbs = 0.70;
  const carbsEsperados = Math.round((kcalTotales * pctCarbs) / 4);

  return {
    tss: Math.round(tssTotal),
    if: ifEsperado.toFixed(2),
    kj: Math.round(kjTotal),
    carbs: carbsEsperados
  };
}

function createFallbackWorkout() {
  const ftp = CONFIG.FTP || 240;
  return {
    fecha: new Date().toISOString(),
    tipo: 'z2',
    objetivo: 'base',
    bloques: [
      { tipo: 'warmup', nombre: 'Calentamiento', duracionMin: 10, vatios: { low: 120, high: 140 }, intensidad: 0.55, cadencia: '85-95 rpm' },
      { tipo: 'main', nombre: 'Bloque principal', duracionMin: 45, vatios: { low: 150, high: 170 }, intensidad: 0.65, cadencia: '80-90 rpm' },
      { tipo: 'cooldown', nombre: 'Vuelta a la calma', duracionMin: 10, vatios: { low: 100, high: 120 }, intensidad: 0.45, cadencia: '75-85 rpm' }
    ],
    reps: 1,
    durMin: 45,
    recSec: 0,
    duracionTotalMin: 65,
    intensidadFTP: 0.65,
    ftp: ftp,
    vatios: { low: 150, high: 170, avg: 160 },
    ifEsperado: '0.65',
    tssEsperado: 80,
    kjEsperados: 400,
    carbsEsperados: 50,
    motivo: 'Plan base por defecto (fallback)',
    prioridad: 'base',
    notaHidratacion: '💧 500ml/hora',
    cadenciaRecomendada: '80-90 rpm',
    nutricion: { chTotalDia: 300, protTotalDia: 120, grasaDiaria: 60, hidratacion: '2L base' },
    fuerza: { nivel: 'Básico', ejercicios: ['Plancha: 3x30"', 'Sentadilla: 3x10'], recomendado: true },
    decisionTrace: null,
    estado: { tsb: 0, readiness: 50, ctl: 50, atl: 50, sleepQuality: 2, hrv: 50 },
    meta: { objetivo: CONFIG.FTP_HISTORICO?.valor || 296, diff: (CONFIG.FTP_HISTORICO?.valor || 296) - ftp },
    fase: { nombre: 'Base', semana: 1, totalSemanas: 4 }
  };
}

// ═══════════════════════════════════════════════════════════════
// 🆕 NUTRICIÓN AVANZADA
// ═══════════════════════════════════════════════════════════════

function calcularNutricionUnificada(estado, entreno) {
  try {
    const peso = CONFIG.WEIGHT_KG || 64;
    const edad = CONFIG.AGE_YEARS || 43;
    const altura = CONFIG.HEIGHT_CM || 173;
    const pasos = estado.pasos || 0;
    const haceCalor = estado.haceCalor || false;
    const temp = estado.tempActual || 25;
    const heatIndex = estado.heatIndex || 25;
    const kj = entreno && entreno.kjEsperados ? entreno.kjEsperados : 0;
    const ifValor = entreno && entreno.ifEsperado ? entreno.ifEsperado : 0;
    const duracionMin = entreno && entreno.duracionTotalMin ? entreno.duracionTotalMin : 0;
    const tipo = entreno && entreno.tipo ? entreno.tipo.toLowerCase() : 'descanso';
    const tsb = estado.tsb || 0;
    const fase = getFaseActual();

    // Mifflin-St Jeor para hombres: 10*peso + 6.25*altura - 5*edad + 5
    let tmb = 10 * peso + 6.25 * altura - 5 * edad + 5;

    const neat = pasos > 0 ? Math.round(pasos * 0.04) : 300;
    const kcalGastoTotal = Math.round(tmb + neat + kj);

    // ─── PERIODIZACIÓN DE CARBOHIDRATOS SEGÚN FASE ───────────
    let ratioBaseCH, ratioProteina, ratioGrasa;

    switch (fase) {
      case 'base':
        // Base: más carbohidratos para volumen Z2
        ratioBaseCH = 6.0; ratioProteina = 1.8; ratioGrasa = 0.25;
        break;
      case 'desarrollo':
        // Desarrollo: equilibrio para calidad
        ratioBaseCH = 5.5; ratioProteina = 2.0; ratioGrasa = 0.25;
        break;
      case 'especificidad':
        // Especificidad: menos carbohidratos, más proteína
        ratioBaseCH = 5.0; ratioProteina = 2.2; ratioGrasa = 0.30;
        break;
      case 'taper':
        // Taper: reducción de carbohidratos
        ratioBaseCH = 4.0; ratioProteina = 2.0; ratioGrasa = 0.30;
        break;
      default:
        ratioBaseCH = 5.0; ratioProteina = 1.8; ratioGrasa = 0.25;
    }

    // Ajuste por edad Master 40+
    if (edad > 40) { ratioProteina += 0.2; ratioBaseCH += 0.5; }

    // Ajuste por calor
    if (haceCalor && heatIndex > 35) ratioBaseCH += 0.5;
    else if (haceCalor && heatIndex > 30) ratioBaseCH += 0.3;

    const chTotalDia = Math.round(peso * ratioBaseCH);
    const protTotalDia = Math.round(peso * ratioProteina);
    const grasaDiaria = Math.round((kcalGastoTotal * ratioGrasa) / 9);

    // ─── CH DURANTE ENTRENO (según tipo e IF) ──────────────
    let chDuranteEntreno = 0;
    let recomendacionDurante = '';

    if (kj > 0 && tipo !== 'descanso') {
      if (ifValor > 0.85) {
        chDuranteEntreno = Math.round(duracionMin * 0.8);
        recomendacionDurante = `⚡ Alta intensidad: ${chDuranteEntreno}g CH durante (${Math.round(chDuranteEntreno / (duracionMin / 60))}g/hora)`;
      } else if (ifValor > 0.65) {
        chDuranteEntreno = Math.round(duracionMin * 1.0);
        recomendacionDurante = `🚴 Moderada intensidad: ${chDuranteEntreno}g CH durante (${Math.round(chDuranteEntreno / (duracionMin / 60))}g/hora)`;
      } else {
        chDuranteEntreno = Math.round(duracionMin * 0.5);
        recomendacionDurante = `🌱 Z2 suave: ${chDuranteEntreno}g CH durante (${Math.round(chDuranteEntreno / (duracionMin / 60))}g/hora)`;
      }
    }

    // ─── ESTRATEGIA "FUEL FOR THE WORK REQUIRED" ───────────
    let chInmediato = 0;
    if (kj > 0) {
      if (kj > 1200) chInmediato = 110;
      else if (kj >= 800) chInmediato = 90;
      else if (kj >= 500) chInmediato = 60;
      else chInmediato = 40;
    }

    // Ajuste post-entreno según intensidad
    let protPost = CONFIG.NUTRICION.proteinaPostMaster || 40;
    if (ifValor > 0.85) protPost += 10;

    const chRestante = chTotalDia - chInmediato - chDuranteEntreno;
    let chCena = kj > 0 ? Math.round(chRestante * 0.65) : Math.round(chRestante * 0.50);
    if (chCena < 40) chCena = 40;

    // ─── HIDRATACIÓN CON TASA DE SUDOR APRENDIDA ────────────
    let tasaSudor = getProperty('tasa_sudor') ? parseFloat(getProperty('tasa_sudor')) : 0.5;

    if (haceCalor && heatIndex > 35) tasaSudor = Math.max(tasaSudor, 1.0);
    else if (haceCalor && heatIndex > 32) tasaSudor = Math.max(tasaSudor, 0.8);
    else if (haceCalor && heatIndex > 28) tasaSudor = Math.max(tasaSudor, 0.6);

    if (kj > 800) tasaSudor += 0.2;

    const sodioMg = Math.round(tasaSudor * CONFIG.NUTRICION.sodioPorLitro);
    const salGramos = (sodioMg / 1000 * 0.4).toFixed(1);

    let hidratacion = (Math.round(peso * 35) / 1000).toFixed(1) + 'L base';
    if (haceCalor && heatIndex > 35) {
      hidratacion += ' + 0.5L extra por calor extremo';
      hidratacion += ` | 🧂 ${sodioMg}mg Sodio/hora (${salGramos}g sal)`;
    } else if (haceCalor && heatIndex > 30) {
      hidratacion += ' + 0.3L extra por calor';
      hidratacion += ` | 🧂 ${sodioMg}mg Sodio/hora (${salGramos}g sal)`;
    }

    // ─── SUPLEMENTACIÓN ESTACIONAL Y POR FASE ───────────────
    let suplementacion = [];
    const mes = new Date().getMonth() + 1; // 1-12

    if (edad > 40) {
      // Omega-3: dosis según inflamación (TSB bajo = más inflamación)
      const omegaDosis = tsb < -15 ? '4g/día' : '3g/día';
      suplementacion.push(`Omega-3: ${omegaDosis} (${tsb < -15 ? 'dosis antiinflamatoria' : 'mantenimiento'})`);

      // Vitamina D: estacional
      const vitDDosis = (mes >= 11 || mes <= 3) ? '4000 UI/día' : '2000 UI/día';
      suplementacion.push(`Vitamina D: ${vitDDosis} (${(mes >= 11 || mes <= 3) ? 'invierno - dosis alta' : 'verano - dosis mantenimiento'})`);
    }

    if (haceCalor && heatIndex > 30) {
      suplementacion.push(`Magnesio: ${CONFIG.NUTRICION.magnesio} (por calor)`);
    }

    // Creatina: siempre recomendada para Master 40+
    if (edad > 40) {
      suplementacion.push(`Creatina: ${CONFIG.NUTRICION.creatina || '5g/día'}`);
    }

    // ─── CONSEJOS ESPECÍFICOS POR FASE ──────────────────────
    let consejosExtra = [];
    if (fase === 'base' && kj > 800) {
      consejosExtra.push('🍝 Fase Base: Asegura 6-7g CH/kg/día para reponer glucógeno');
    }
    if (fase === 'especificidad' && ifValor > 0.85) {
      consejosExtra.push('⚡ Fase Especificidad: Carga de CH 2h antes del entreno (1-2g/kg)');
    }
    if (fase === 'taper') {
      consejosExtra.push('🧘 Taper: Reduce CH totales 20-30% para adaptación metabólica');
    }
    if (tsb < -15) {
      consejosExtra.push('🔴 Fatiga alta: Aumenta proteína a 2.2g/kg y prioriza recuperación');
    }

    return {
      chTotalDia,
      protTotalDia,
      grasaDiaria,
      chInmediato,
      chDuranteEntreno,
      chCena,
      hidratacion,
      kcalGastoTotal,
      esDiaDescanso: kj === 0,
      esDiaIntenso: kj > 800,
      haceCalor,
      temp,
      heatIndex,
      tasaSudor,
      sodioMg,
      suplementacion,
      protPost,
      recomendacionDurante,
      consejosExtra,
      fase,
      estrategiaCH: fase === 'taper' ? 'Periodización baja en CH' : 'Carga completa'
    };
  } catch(e) {
    return {
      chTotalDia: 300,
      protTotalDia: 120,
      grasaDiaria: 60,
      chInmediato: 40,
      chDuranteEntreno: 0,
      chCena: 200,
      hidratacion: '2L base',
      kcalGastoTotal: 2000,
      esDiaDescanso: true,
      esDiaIntenso: false,
      haceCalor: false,
      temp: 25,
      heatIndex: 25,
      tasaSudor: 0.5,
      sodioMg: 250,
      suplementacion: [],
      protPost: 40,
      recomendacionDurante: '',
      consejosExtra: [],
      fase: 'base',
      estrategiaCH: 'Carga completa'
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// 🆕 FUERZA PERIODIZADA
// ═══════════════════════════════════════════════════════════════

function calcularFuerzaUnificada(estado) {
  try {
    const tsb = estado.tsb || 0;
    const readiness = estado.readiness || 50;
    const fase = getFaseActual();
    const semana = getSemanaActual();
    const semanasEnFase = getSemanasFase();

    // ─── SINCRONIZAR FUERZA CON LA FASE DE ENTRENAMIENTO ──────
    const faseFuerza = {
      'base': {
        nombre: '🏗️ Mantenimiento + Resistencia',
        enfoque: 'Preparación física general, Core + Estabilidad',
        seriesReps: semana <= 2 ? '3x12-15' : '3x10-12',
        rpe: 'RPE 6-7 (2-3 repes en reserva)'
      },
      'desarrollo': {
        nombre: '📈 Hipertrofia + Fuerza Resistencia',
        enfoque: 'Trabajo unilateral + Core avanzado',
        seriesReps: semana <= 2 ? '4x10-12' : '3x8-10',
        rpe: 'RPE 7-8 (1-2 repes en reserva)'
      },
      'especificidad': {
        nombre: '🎯 Fuerza Máxima + Potencia',
        enfoque: 'Cargas altas, pocas repeticiones, reclutamiento neuronal',
        seriesReps: semana <= 2 ? '5x5' : '4x6-8',
        rpe: 'RPE 8-9 (0-1 repes en reserva)'
      },
      'taper': {
        nombre: '🧘 Descarga + Mantenimiento',
        enfoque: 'Mantenimiento sin fatiga, movilidad',
        seriesReps: '2x10-12',
        rpe: 'RPE 5-6 (fácil)'
      }
    };

    const faseActual = faseFuerza[fase] || faseFuerza.base;

    // ─── EJERCICIOS BASE POR CATEGORÍA ───────────────────────
    const ejerciciosBase = {
      general: [
        { nombre: 'Sentadilla', variantes: ['Goblet', 'Barra', 'Búlgara'], peso: '8-40kg' },
        { nombre: 'Peso muerto', variantes: ['Rumano', 'Convencional', 'A una pierna'], peso: '10-45kg' },
        { nombre: 'Zancadas', variantes: ['Estáticas', 'Búlgaras', 'Laterales'], peso: '8-20kg' },
        { nombre: 'Hip thrust', variantes: ['Bilateral', 'Unilateral', 'A una pierna'], peso: '10-25kg' },
        { nombre: 'Remo', variantes: ['Con mancuerna', 'Con barra', 'Máquina'], peso: '8-22kg' }
      ],
      core: [
        'Plancha: 3x30-60"',
        'Dead bug: 3x10-15 c/lado',
        'Bird-dog: 3x10-15 c/lado',
        'Rueda abdominal: 3x8-12',
        'Dragon flag: 3x6-8'
      ],
      prevencion: [
        '🦶 Step-up lateral: 3x10-12 c/pierna (PREVENCIÓN RODILLA)',
        '🦶 Estiramiento cuádriceps: 3x30" c/pierna',
        '🦶 Copenhague plank: 3x20-30" c/lado (PREVENCIÓN ISQUIOS)',
        '🦶 Talón-glúteo dinámico: 3x15 c/pierna',
        '🦶 Rotación externa cadera con banda: 3x15 c/pierna',
        '🦶 Elevación de talón excéntrica: 3x15 (PREVENCIÓN AQUILES)'
      ]
    };

    // ─── ADAPTACIÓN POR FATIGA ───────────────────────────────
    let nivel, recomendacion, ejercicios = [];
    const isFatigado = tsb < -15 || readiness < 50;
    const isModeradamenteFatigado = tsb < -5 || readiness < 65;
    const esSemanaMaxima = fase === 'especificidad' && semana <= 2;

    if (tsb < -20 || readiness < 40) {
      nivel = '🔴 Recuperación Activa - NO HAGAS FUERZA CON PESO';
      recomendacion = 'Prioriza movilidad, activación y prevención de lesiones';
      ejercicios = [
        ...ejerciciosBase.prevencion.slice(0, 3),
        ...ejerciciosBase.core.slice(0, 2),
        'Glute bridge: 3x15',
        'Clamshell con banda: 3x15 c/lado'
      ];
    } else if (tsb < -10 || readiness < 55) {
      nivel = `🟡 ${faseActual.nombre} - Versión suave`;
      const rpeBase = parseInt(faseActual.rpe.split('-')[0]) - 2;
      const rpeMax = parseInt(faseActual.rpe.split('-')[1]) - 2;
      recomendacion = `Fase: ${fase}. Sin fallo muscular. RPE ${rpeBase}-${rpeMax}`;
      ejercicios = [
        `${ejerciciosBase.general[0].nombre} (${ejerciciosBase.general[0].variantes[0]}): ${faseActual.seriesReps} (${ejerciciosBase.general[0].peso.split('-')[0]}-${Math.round(parseInt(ejerciciosBase.general[0].peso.split('-')[1]) * 0.7)}kg)`,
        `${ejerciciosBase.general[4].nombre}: ${faseActual.seriesReps}`,
        ...ejerciciosBase.core.slice(0, 2),
        ...ejerciciosBase.prevencion.slice(0, 2)
      ];
    } else {
      nivel = `🟢 ${faseActual.nombre}`;
      recomendacion = `${faseActual.enfoque} | ${faseActual.rpe}`;

      if (esSemanaMaxima) {
        ejercicios = [
          `${ejerciciosBase.general[0].nombre} (${ejerciciosBase.general[0].variantes[1]}): ${faseActual.seriesReps} (${ejerciciosBase.general[0].peso})`,
          `${ejerciciosBase.general[1].nombre} (${ejerciciosBase.general[1].variantes[1]}): ${faseActual.seriesReps} (${ejerciciosBase.general[1].peso})`,
          `${ejerciciosBase.general[2].nombre} (${ejerciciosBase.general[2].variantes[1]}): ${faseActual.seriesReps} (${ejerciciosBase.general[2].peso})`,
          ...ejerciciosBase.core.slice(1, 3),
          ...ejerciciosBase.prevencion.slice(0, 1)
        ];
      } else {
        ejercicios = [
          `${ejerciciosBase.general[0].nombre} (${ejerciciosBase.general[0].variantes[0]}): ${faseActual.seriesReps} (${ejerciciosBase.general[0].peso})`,
          `${ejerciciosBase.general[1].nombre} (${ejerciciosBase.general[1].variantes[2]}): ${faseActual.seriesReps} (${ejerciciosBase.general[1].peso})`,
          `${ejerciciosBase.general[2].nombre} (${ejerciciosBase.general[2].variantes[2]}): ${faseActual.seriesReps} (${ejerciciosBase.general[2].peso})`,
          ...ejerciciosBase.core,
          ...ejerciciosBase.prevencion.slice(0, 2)
        ];
      }
    }

    // ─── MOVILIDAD OBLIGATORIA ───────────────────────────────
    const movilidadObjetivo = calcularMovilidadAdaptativa(estado);

    return {
      nivel,
      recomendacion,
      ejercicios: ejercicios.slice(0, 6),
      movilidadBase: movilidadObjetivo.ejercicios,
      duracion: isFatigado ? '15-20 min' : isModeradamenteFatigado ? '25-30 min' : '35-45 min',
      recomendado: !isFatigado,
      faseFuerza: faseActual.nombre,
      semanaFuerza: semana,
      prevencion: ejerciciosBase.prevencion.slice(0, 3)
    };
  } catch(e) {
    return {
      nivel: 'Básico',
      recomendacion: 'Rutina ligera',
      ejercicios: [],
      movilidadBase: ['Estiramientos básicos'],
      duracion: '20 min',
      recomendado: true,
      faseFuerza: 'Básico',
      semanaFuerza: 1,
      prevencion: []
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// 📋 GENERAR CONSEJOS
// ═══════════════════════════════════════════════════════════════

function generarConsejoUnificado(estado, decision, restricciones) {
  try {
    const consejos = [];

    if (decision.tipo === 'descanso') {
      consejos.push('🧘 *Descanso total hoy.* La recuperación es parte del entrenamiento.');
    } else if (estado.tsb > 10 && estado.readiness > 80) {
      consejos.push('🟢 *¡Ventana de calidad!* Aprovecha para entrenar con intensidad.');
    } else if (estado.tsb < -15) {
      consejos.push('🟡 *Fatiga acumulada.* Prioriza Z2 suave y descanso.');
    } else {
      consejos.push('✅ *Día normal.* Sigue tu plan con consistencia.');
    }

    if (estado.haceCalor && estado.heatIndex > 38) {
      consejos.push(`🔥 *Calor extremo (HI ${estado.heatIndex}°C).* No entrenes al aire libre. Rodillo con ventilador.`);
    } else if (estado.haceCalor && estado.heatIndex > 35) {
      consejos.push(`🌡️ *Calor muy alto (HI ${estado.heatIndex}°C).* Salida controlada, hidratación extra.`);
    } else if (estado.haceCalor && estado.heatIndex > 32) {
      consejos.push(`☀️ *Calor alto (HI ${estado.heatIndex}°C).* Hidratación extra.`);
    }

    if (estado.sleepQuality === 1) consejos.push('😴 *Has dormido mal.* Reduce intensidad hoy.');
    if (estado.weeklyTss > 750) consejos.push('📊 *Carga semanal alta.* Considera un día extra de descanso.');
    if (CONFIG.AGE_YEARS > 40) consejos.push('🧠 *Master 40+.* Recuerda: la recuperación es clave.');
    
    const horasRec = calcularHorasRecuperacion(estado.weeklyTss || 0, CONFIG.AGE_YEARS, estado.sleepQuality);
    if (horasRec > 12) {
      consejos.push(`⏰ *Recuperación larga:* ${horasRec}h. Tu próximo entreno de calidad será mañana.`);
    }

    consejos.sort((a, b) => {
      const pA = (a.includes('🔴') || a.includes('🔥')) ? 0 : 1;
      const pB = (b.includes('🔴') || b.includes('🔥')) ? 0 : 1;
      return pA - pB;
    });

    return consejos.slice(0, 4);
  } catch(e) {
    return ['✅ Sigue tu plan.'];
  }
}

// ═══════════════════════════════════════════════════════════════
// 📋 ORQUESTADOR CENTRAL
// ═══════════════════════════════════════════════════════════════

async function getAthleteState() {
  try {
    const traza = crearTraza();

    console.log('[getAthleteState] 1. Obteniendo datos...');
    const datos = await obtenerDatosCompletos();
    if (!datos || !datos.today) {
      console.log('[getAthleteState] ❌ Sin datos o today');
      return null;
    }

    registrarInputTraza(traza, 'fecha', new Date().toISOString(), 'Fecha del estado');
    console.log('[getAthleteState] 2. Datos OK. Calculando estado...');

    const estado = calcularEstadoSistema(datos);
    if (!estado || typeof estado !== 'object') {
      console.log('[getAthleteState] ❌ estado inválido');
      return null;
    }

    registrarInputTraza(traza, 'tsb', estado.tsb, 'Training Stress Balance');
    registrarInputTraza(traza, 'ctl', estado.ctl, 'Chronic Training Load');
    registrarInputTraza(traza, 'atl', estado.atl, 'Acute Training Load');
    registrarInputTraza(traza, 'readiness', estado.readiness, 'Readiness del día');
    registrarInputTraza(traza, 'hrv', estado.hrv, 'Heart Rate Variability');
    registrarInputTraza(traza, 'sleepQuality', estado.sleepQuality, 'Calidad de sueño');
    registrarInputTraza(traza, 'weeklyTss', estado.weeklyTss, 'TSS de la semana');
    registrarInputTraza(traza, 'acwr', estado.acwr, 'ACWR (carga aguda/crónica)');
    registrarInputTraza(traza, 'tempActual', estado.tempActual, 'Temperatura actual');
    registrarInputTraza(traza, 'heatIndex', estado.heatIndex, 'Heat Index');
    registrarInputTraza(traza, 'pasos', estado.pasos, 'Pasos diarios');
    console.log('[getAthleteState] 3. Estado OK. TSB:', estado.tsb);

    console.log('[getAthleteState] 4. Aplicando restricciones...');
    const restricciones = aplicarRestriccionesGlobales(estado, CONFIG.AGE_YEARS || 43);
    if (!restricciones || typeof restricciones !== 'object') {
      console.log('[getAthleteState] ❌ restricciones inválidas');
      return null;
    }

    console.log('[getAthleteState] 5. Decidiendo entrenamiento...');
    let decision = decidirEntrenamiento(estado, restricciones);
    if (!decision || typeof decision !== 'object' || !decision.tipo) {
      console.log('[getAthleteState] ❌ decision inválida o sin tipo');
      return null;
    }
    console.log('[getAthleteState] 6. Decision OK. Tipo:', decision.tipo);

    console.log('[getAthleteState] 7. Resolviendo conflictos...');

    const decisionResuelta = resolverConflictos(estado, restricciones, decision, traza);
    if (decisionResuelta && typeof decisionResuelta === 'object' && decisionResuelta.tipo) {
      decision = decisionResuelta;
      console.log('[getAthleteState] 8. Conflict Resolver aplicado. Tipo:', decision.tipo);
    }

    if (!decision.reps) decision.reps = 1;
    if (!decision.durMin) decision.durMin = 45;
    if (!decision.recSec) decision.recSec = 0;
    if (!decision.intensidad) decision.intensidad = 0.65;
    if (!decision.motivo) decision.motivo = 'Plan base';

    console.log('[getAthleteState] 9. Generando Workout...');
    const workout = generateWorkout(estado, restricciones, decision, traza);

    const entreno = {
      tipo: workout.tipo.toUpperCase(),
      reps: workout.reps,
      durMin: workout.durMin,
      recSec: workout.recSec,
      wLow: workout.vatios.low,
      wHigh: workout.vatios.high,
      wRec: Math.round(workout.ftp * 0.50),
      wWU: workout.bloques.find(b => b.tipo === 'warmup')?.vatios?.low || Math.round(workout.ftp * 0.55),
      wCD: workout.bloques.find(b => b.tipo === 'cooldown')?.vatios?.low || Math.round(workout.ftp * 0.45),
      ifEsperado: workout.ifEsperado,
      tssEsperado: workout.tssEsperado,
      kjEsperados: workout.kjEsperados,
      carbsEsperados: workout.carbsEsperados,
      duracionTotalMin: workout.duracionTotalMin,
      wuDur: 600,
      titulo: `AI-${workout.tipo.toUpperCase()} ${workout.reps}x${workout.durMin}m`,
      intensidad: workout.intensidadFTP
    };

    const nutricion = calcularNutricionUnificada(estado, entreno);
    const fuerza = calcularFuerzaUnificada(estado);
    const consejo = generarConsejoUnificado(estado, decision, restricciones);

    const stats = getEstadisticasAgregadas();
    const probabilidad = calcularProbabilidadAvanzada(decision, estado);

    registrarDecisionTraza(traza, decision.tipo, decision.prioridad || 'NIVEL 4 - PLAN');
    guardarTraza(traza);

    console.log('[getAthleteState] ✅ Todo OK. Devolviendo state con Workout.');

    const ftpEstimado = calcularFTPEstimado();
    const proyeccion = calcularProyeccionObjetivo();

    const horasRec = calcularHorasRecuperacion(estado.weeklyTss || 0, CONFIG.AGE_YEARS, estado.sleepQuality);
    const proximoEntreno = calcularSiguienteEntreno(horasRec);

    return {
      timestamp: new Date(),
      datos,
      estado,
      restricciones,
      decision,
      workout: workout,
      entreno: entreno,
      nutricion,
      fuerza,
      consejo,
      traza,
      tsb: estado.tsb,
      readiness: estado.readiness,
      tempActual: estado.tempActual,
      heatIndex: estado.heatIndex,
      haceCalor: estado.haceCalor,
      fase: getFaseActual(),
      semana: getSemanaActual(),
      ftpEstimado: ftpEstimado,
      proyeccion: proyeccion,
      horasRecuperacion: horasRec,
      proximoEntreno: proximoEntreno,
      aprendizaje: { stats, probabilidad }
    };

  } catch (err) {
    console.log('[getAthleteState] ❌ ERROR:', err.toString());
    console.log('[getAthleteState] Stack:', err.stack);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// 📋 ESTADÍSTICAS
// ═══════════════════════════════════════════════════════════════

function getEstadisticasAgregadas() {
  try {
    const historial = obtenerHistorial();
    if (historial.length < 3) return { suficiente: false, total: historial.length };

    const stats = {
      fecha: new Date().toISOString(),
      suficiente: true,
      total: historial.length,
      porTipo: {}
    };

    historial.forEach((h) => {
      const tipo = h.entreno.tipo || 'desconocido';
      const resultado = h.resultado || 50;

      if (!stats.porTipo[tipo]) {
        stats.porTipo[tipo] = { total: 0, exitos: 0 };
      }

      stats.porTipo[tipo].total++;
      if (resultado >= 70) stats.porTipo[tipo].exitos++;
    });

    Object.keys(stats.porTipo).forEach((tipo) => {
      const d = stats.porTipo[tipo];
      d.tasa = d.total > 0 ? Math.round((d.exitos / d.total) * 100) : 0;
    });

    return stats;
  } catch (err) {
    console.log('[Estadisticas] ERROR:', err.toString());
    return { suficiente: false, total: 0 };
  }
}

function calcularProbabilidadAvanzada(decision, estado) {
  try {
    const stats = getEstadisticasAgregadas();
    let prob = 50;
    const tipo = decision.tipo || 'z2';

    if (stats && stats.porTipo && stats.porTipo[tipo]) {
      const d = stats.porTipo[tipo];
      if (d.total >= 3) {
        prob = d.tasa;
      }
    }

    prob = Math.round(Math.max(5, Math.min(95, prob)));
    const nivel = prob >= 80 ? '🟢 ALTA' : prob >= 60 ? '🟡 MEDIA' : '🔴 BAJA';
    const base = 'Basado en datos disponibles';

    return { probabilidad: prob, nivel, base };
  } catch(err) {
    console.log('[calcularProbabilidadAvanzada] ERROR:', err.toString());
    return { probabilidad: 50, nivel: '🟡 MEDIA', base: 'Error en cálculo' };
  }
}

// ─── GUARDAR ENTRENO EN HISTORIAL ──────────────────────────────
function guardarEntrenoHistorial(entreno, feedback, contexto = {}) {
  try {
    // ─── GUARDAR EN SUPABASE (en segundo plano) ──────────────────
    guardarEntrenoSupabase(entreno, feedback, contexto)
      .then(result => {
        if (result.guardado) {
          console.log('[Historial] ✅ Guardado en Supabase');
        } else {
          console.log('[Historial] ⚠️ Error en Supabase:', result.error);
        }
      })
      .catch(err => {
        console.log('[Historial] Error en guardarEntrenoSupabase:', err);
      });
    
    // ─── GUARDAR EN MEMORIA (siempre) ────────────────────────────
    const historial = obtenerHistorial();
    historial.push({
      fecha: new Date().toISOString(),
      entreno: entreno,
      feedback: feedback,
      resultado: calcularResultadoFeedback(feedback),
      peso: 1.0,
      validado: false,
      contexto: contexto || {}
    });

    // Limitar tamaño del historial
    if (historial.length > CONFIG.MAX_HISTORIAL) {
      historial.splice(0, historial.length - CONFIG.MAX_HISTORIAL);
    }

    setProperty('historial_entrenos', JSON.stringify(historial));
    deleteProperty('stats_agregadas');
    
    console.log('[Historial] Feedback guardado (local)');
    return { guardado: true, peso: 1.0 };
    
  } catch (err) {
    console.log('[Historial] ERROR:', err.toString());
    return { guardado: false, motivo: err.toString() };
  }
}

function calcularResultadoFeedback(feedback) {
  try {
    let score = 70;
    if (feedback.rpe <= 4) score += 10;
    else if (feedback.rpe >= 8) score -= 15;
    else if (feedback.rpe >= 7) score -= 5;
    if (feedback.piernas === 3) score += 10;
    else if (feedback.piernas === 1) score -= 15;
    if (feedback.watts === 'si') score += 10;
    else if (feedback.watts === 'no') score -= 10;
    return Math.max(0, Math.min(100, score));
  } catch(e) {
    return 50;
  }
}
// ═══════════════════════════════════════════════════════════════
// 📋 TODOS LOS COMANDOS
// ═══════════════════════════════════════════════════════════════

async function cmdStart() {
  const fase = getFaseActual();
  const semana = getSemanaActual();
  const ftpEstimado = calcularFTPEstimado();
  const proy = calcularProyeccionObjetivo();
  
  const msg = `🌍 *WORLD TOUR COACH v9.5 - DEFINITIVO*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Hola Manu. Sistema unificado con periodización real.
🎯 Objetivo: Recuperar ${CONFIG.FTP_HISTORICO.valor}W

📅 ESTADO ACTUAL
• Fase: ${getNombreFase()} (Semana ${semana}/${getSemanasFase()})
• FTP estimado: ${ftpEstimado}W
• ${proy.mensaje}

📋 COMANDOS PRINCIPALES
/hoy - Resumen COMPLETO del día ⭐
/hoy --estado - Estado completo
/hoy --plan - Plan detallado
/hoy --clima - Clima + adaptación
/hoy --nutricion - Nutrición + recetas
/hoy --objetivo - Plan para 296W
/nutricion - Nutrición detallada + recetas ⭐

🧠 COMANDOS AVANZADOS
/traza - Ver última decisión
/analizar - Análisis de entreno (último o con ID)
/fatiga - Análisis de fatiga
/alerta - Detección de sobreentrenamiento
/semana - Resumen semanal
/semanapasada - Resumen semana anterior
/aprender - Qué he aprendido
/aprendervalidar - Validación del aprendizaje
/progreso - Evolución anual
/prediccion - Rendimiento esperado
/recuperacion - Tiempos de recuperación
/tendencias - Evolución 90 días
/historial - Historial de entrenos

🛠️ HERRAMIENTAS
/zwo - Archivo rodillo (con cadencia)
/garmin - Subir a Intervals
/exportar - Exportar datos
/densidad - Densidad de carga
/debug - Datos técnicos
/movilidad - Rutina de movilidad diaria
/sync - Sincronizar con Supabase ⭐ NUEVO

FTP: ${CONFIG.FTP}W | Peso: ${CONFIG.WEIGHT_KG}kg | Edad: ${CONFIG.AGE_YEARS} años
🧠 v9.5: Periodización + Predicción FTP + Nutrición avanzada + Movilidad`;

  await sendTelegram(msg);
}

async function cmdHoy(chatId) {
  try {
    const state = await getAthleteStateConAjuste();
    if (!state) {
      await sendTelegram('Sin datos.');
      return;
    }

    const workout = state.workout;
    const e = state.estado;
    const n = state.nutricion;
    const f = state.fuerza;

    let msg = '🌅 *WORLD TOUR COACH v9.5 - HOY*\n';
    msg += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

    msg += `*📅 FASE:* ${getNombreFase()} (Semana ${getSemanaActual()}/${getSemanasFase()})\n`;
    msg += `• Calidad semanal: ${contarSesionesCalidadSemana()}/${getMaxSesionesCalidad()}\n`;
    msg += `• TSS objetivo: ${getTssObjetivoSemanal()} | Actual: ${Math.round(e.weeklyTss)}\n\n`;

    const emoji = state.tsb > 0 ? '🟢' : state.tsb > -10 ? '🟡' : '🔴';
    msg += '*📊 ESTADO*\n';
    msg += `• Readiness: *${state.readiness}/100*\n`;
    msg += `• CTL: ${e.ctl.toFixed(1)} | ATL: ${e.atl.toFixed(1)} | TSB: ${state.tsb.toFixed(1)}\n`;
    msg += `• Sueño: ${e.sleepQuality === 1 ? '😴 Malo' : e.sleepQuality === 2 ? '🟡 Regular' : '🟢 Bueno'}\n`;
    msg += `• Pasos: ${e.pasos.toLocaleString()}\n`;
    if (e.acwr > 1.3) msg += `• ⚠️ ACWR: ${e.acwr.toFixed(2)} (ALTO)\n`;
    msg += '\n';

    if (state.ftpEstimado) {
      const diff = CONFIG.FTP_HISTORICO.valor - state.ftpEstimado;
      msg += `*🎯 OBJETIVO: ${CONFIG.FTP_HISTORICO.valor}W*\n`;
      msg += `• FTP estimado: *${state.ftpEstimado}W* (${diff > 0 ? `faltan ${diff}W` : '✅ SUPERADO'})\n`;
      if (state.proyeccion && !state.proyeccion.alcanzado) {
        msg += `• ${state.proyeccion.mensaje}\n`;
      }
      msg += '\n';
    }

    if (state.horasRecuperacion) {
      msg += `*⏰ RECUPERACIÓN:* ${state.horasRecuperacion}h\n`;
      msg += `• Próximo entreno de calidad: ${state.proximoEntreno}\n\n`;
    }

    if (workout.tipo === 'descanso') {
      msg += '*🧘 HOY TOCA: DESCANSO TOTAL*\n';
      msg += `Motivo: ${workout.motivo}\n\n`;
    } else {
      msg += '*🚴 HOY TOCA*\n';
      msg += `• ${workout.tipo.toUpperCase()}`;
      if (workout.reps > 0) msg += ` ${workout.reps}x${workout.durMin}min\n`;
      else msg += ` ${workout.durMin}min\n`;
      msg += `• Intensidad: ${(workout.intensidadFTP * 100).toFixed(0)}% FTP\n`;
      msg += `• Vatios: ${workout.vatios.low}-${workout.vatios.high}W\n`;
      msg += `• Cadencia: ${workout.cadenciaRecomendada || '80-90 rpm'}\n`;
      if (workout.tssEsperado) {
        msg += `• TSS: ${workout.tssEsperado} | IF: ${workout.ifEsperado}\n`;
      }
      if (workout.notaHidratacion) msg += `• ${workout.notaHidratacion}\n`;

      if (workout.bloques && workout.bloques.length > 0) {
        msg += '\n*📋 ESTRUCTURA DEL ENTRENO*\n';
        workout.bloques.forEach(bloque => {
          const emoji2 = bloque.tipo === 'warmup' ? '🔥' : bloque.tipo === 'main' ? '⚡' : bloque.tipo === 'recovery' ? '💨' : '❄️';
          const cad = bloque.cadencia ? ` (${bloque.cadencia})` : '';
          msg += `• ${emoji2} ${bloque.nombre}: ${bloque.vatios.low}-${bloque.vatios.high}W${cad} (${bloque.duracionMin}min)\n`;
        });
      }
      msg += '\n';
    }

    if (state.datos.weather && typeof state.datos.weather === 'object') {
      const w = state.datos.weather;
      const temp = w.temp || 'N/D';
      const wind = w.wind || 0;
      const rain = w.rain || 0;
      const desc = w.description || 'Sin datos';
      const hi = state.heatIndex || temp;
      const tempEmoji = typeof temp === 'number' ? (temp > 35 ? '🔥' : temp > 30 ? '🌡️' : temp > 25 ? '☀️' : '✅') : '🌤️';
      msg += '*🌤️ CLIMA*\n';
      msg += `• ${tempEmoji} ${temp}°C (Heat Index ${hi}°C) | Viento ${wind} km/h\n`;
      msg += `• ${desc}${rain > 0 ? ' | 🌧️ Lluvia' : ''}\n`;
      if (workout.tipo !== 'descanso') {
        if (typeof temp === 'number' && state.heatIndex > 35) msg += '• ⚠️ Calor intenso - Rodillo recomendado\n';
        else if (typeof temp === 'number' && state.heatIndex > 30) msg += '• ⚠️ Calor alto - Salida controlada\n';
        else msg += '• ✅ Condiciones favorables\n';
      }
      msg += '\n';
    }

    if (workout.tipo !== 'descanso' && workout.carbsEsperados) {
      msg += '*🍏 NUTRICIÓN*\n';
      msg += `• CH durante entreno: ${workout.carbsEsperados}g\n`;
      msg += `• Post-entreno: ${Math.round(workout.carbsEsperados * 0.8)}g CH + ${CONFIG.NUTRICION.proteinaPostMaster}g Proteína\n`;
      msg += `• ${n.hidratacion || workout.nutricion.hidratacion}\n`;
      if (n.sodioMg) msg += `• 🧂 Sodio: ${n.sodioMg}mg/hora\n`;
      if (n.suplementacion && n.suplementacion.length > 0) {
        msg += `• 💊 Suplementación: ${n.suplementacion.join(', ')}\n`;
      }
      msg += '\n';
    } else {
      msg += '*🍏 NUTRICIÓN*\n';
      msg += '• Día de descanso: Prioriza proteína y vegetales\n';
      msg += `• ${n.hidratacion || workout.nutricion.hidratacion}\n\n`;
    }

    msg += '*🏋️ FUERZA*\n';
    if (f.recomendado) {
      msg += `• ${f.nivel} (${f.duracion}) - Fase: ${f.faseFuerza || 'Básica'}\n`;
      msg += `• ${f.ejercicios.slice(0, 3).join(' | ')}\n`;
    } else {
      msg += '• No recomendada hoy (fatiga alta)\n';
      msg += '• Haz solo movilidad y estiramientos\n';
    }
    msg += '\n';

    if (f.movilidadBase && f.movilidadBase.length > 0) {
      msg += '*🧘 MOVILIDAD DIARIA*\n';
      msg += `• ${f.movilidadBase.slice(0, 3).join(' | ')}\n\n`;
    }

    if (state.aprendizaje && state.aprendizaje.probabilidad && workout.tipo !== 'descanso') {
      const p = state.aprendizaje.probabilidad;
      msg += `*📊 PROBABILIDAD DE ÉXITO*\n`;
      msg += `• ${p.nivel} (${p.probabilidad}%)\n\n`;
    }

    if (state.traza && state.traza.reglasActivadas && state.traza.reglasActivadas.length > 0) {
      msg += '*🧠 DECISIÓN EXPLICADA*\n';
      state.traza.reglasActivadas.slice(0, 3).forEach((r) => {
        msg += `• ${r.nivel}: ${r.regla} → ${r.accion}\n`;
      });
      if (state.traza.conflictos && state.traza.conflictos.length > 0) {
        state.traza.conflictos.slice(0, 2).forEach((c) => {
          msg += `• ⚖️ Conflicto: ${c.entre} → ${c.resolucion}\n`;
        });
      }
      msg += '\n';
    }

    msg += '*💡 CONSEJOS*\n';
    state.consejo.forEach((c) => { msg += `• ${c}\n`; });

    msg += '\n📱 *Subcomandos:* /hoy --estado | --plan | --clima | --nutricion | --objetivo | --ayuda';
    msg += '\n🧠 *Ver traza completa:* /traza';

    await sendTelegramLong(msg);
  } catch (err) {
    console.log('[cmdHoy] ERROR:', err.toString());
    await sendTelegram(`Error en /hoy: ${err.message}`);
  }
}
// ═══════════════════════════════════════════════════════════════
// 📋 ANÁLISIS DE ENTRENO (portado de Apps Script a Node.js)
// ═══════════════════════════════════════════════════════════════

function buildAnalisisEntrenoManu(act, powerCurve) {
  if (typeof act === 'string') { try { act = JSON.parse(act); } catch (e) {} }
  let data = act;
  if (act && act.activity) data = act.activity;
  else if (act && act.icu) data = act.icu;

  // ─── TRABAJO MECÁNICO (KJ) - CORREGIDO ────────────────────────
  // Buscar primero en kilojulios (valor correcto de Intervals)
  let kj = safeNum(data.icu_kilojoules, 0) || safeNum(data.kilojoules, 0) || safeNum(act.icu_kilojoules, 0) || safeNum(act.kilojoules, 0);
  
  // Si no hay kilojulios, intentar con julios y dividir
  if (kj === 0) {
    const joules = safeNum(data.icu_joules, 0) || safeNum(data.joules, 0) || safeNum(act.icu_joules, 0) || safeNum(act.joules, 0);
    if (joules > 0) {
      kj = Math.round(joules / 1000);
    }
  }

  const realCarbs = safeNum(data.carbs_used, 0) || safeNum(act.carbs_used, 0);
  let np = safeNum(data.icu_weighted_avg_watts, 0);
  const duration = safeNum(data.moving_time, 0) || safeNum(data.elapsed_time, 0);
  let ap = safeNum(data.icu_average_watts, 0) || (kj > 0 && duration > 0 ? Math.round((kj * 1000) / duration) : 0);
  if (np === 0 && ap > 0) np = ap;

  const ftp = CONFIG.FTP || 240;
  const ifFactor = (np > 0 && ftp > 0) ? (np / ftp) : 0;
  const tss = safeNum(data.icu_training_load, 0) || ((duration > 0 && np > 0) ? ((duration * np * ifFactor) / (ftp * 3600)) * 100 : 0);

  const hrAvg = safeNum(data.average_heartrate, 0);
  const hrMax = safeNum(data.max_heartrate, 0);
  const cadAvg = safeNum(data.average_cadence, 0);
  const dist = safeNum(data.distance, 0);
  const distKm = dist > 0 ? (dist / 1000).toFixed(1) : '0.0';
  const elev = safeNum(data.elevation_gain, 0) || safeNum(data.total_elevation_gain, 0);
  const name = data.name || act.name || 'Entrenamiento sin nombre';
  const durationMin = duration > 0 ? Math.round(duration / 60) : 0;
  const speedMs = safeNum(data.average_speed, 0);
  const speed = speedMs > 0 ? (speedMs > 10 ? speedMs.toFixed(1) : (speedMs * 3.6).toFixed(1)) : null;
  const calories = safeNum(data.calories, 0) || safeNum(data.kilojoules, 0) || (kj > 0 ? kj : null);
  const dateStr = (data.start_date_local || '').substring(0, 10);
  const hayPotencia = np > 0 || ap > 0;
  const hayFC = hrAvg > 0;

  let tipo = 'Sin datos de potencia';
  if (hayPotencia) {
    if (ifFactor > 1.05) tipo = 'Anaeróbico / VO2 Max';
    else if (ifFactor > 0.95) tipo = 'Umbral (FTP)';
    else if (ifFactor > 0.87) tipo = 'Sweet Spot';
    else if (ifFactor > 0.75) tipo = 'Tempo / Z3';
    else if (ifFactor > 0.55) tipo = 'Base / Z2';
    else tipo = 'Recuperación activa';
  } else if (speed) {
    const spd = parseFloat(speed);
    if (spd > 38) tipo = 'Alta intensidad estimada';
    else if (spd > 32) tipo = 'Tempo / Ritmo medio';
    else if (spd > 26) tipo = 'Base aeróbica estimada';
    else tipo = 'Rodaje suave';
  }

  let msg = `*ANÁLISIS: ${name} (MÉTRICAS V2)*\n`;
  msg += '━━━━━━━━━━━━━━━━━━━━━━\n';
  msg += `${dateStr}  ${durationMin} min\n\n`;

  if (hayPotencia) {
    const vi = (ap > 0 && np > 0) ? (np / ap) : 1;
    msg += '*Potencia*\n';
    msg += `NP: ${Math.round(np)}W  |  AP: ${Math.round(ap)}W\n`;
    msg += `IF: ${ifFactor.toFixed(3)}  |  TSS: ${Math.round(tss)}\n`;
    msg += `VI: ${vi.toFixed(2)} ${vi > 1.05 ? '(intermitente)' : '(constante)'}\n\n`;
  }

  if (hayFC) {
    let deriva = 'N/D';
    if (hrMax > 0 && hrAvg > 0) {
      const ratioFC = hrMax / hrAvg;
      deriva = ratioFC > 1.25 ? `Alta (${ratioFC.toFixed(2)})`
        : ratioFC > 1.15 ? `Moderada (${ratioFC.toFixed(2)})`
        : `Baja (${ratioFC.toFixed(2)})`;
    }
    msg += '*Frecuencia Cardiaca*\n';
    msg += `Media: ${Math.round(hrAvg)} ppm  |  Max: ${Math.round(hrMax)} ppm\n`;
    msg += `Deriva: ${deriva}\n\n`;
  }

  if (cadAvg > 0) {
    msg += `Cadencia: ${Math.round(cadAvg)} rpm ${cadAvg >= 85 ? 'OK' : cadAvg >= 75 ? 'Aceptable' : 'Baja'}\n\n`;
  }

  msg += '*Volumen*\n';
  msg += `Distancia: ${distKm} km  |  Desnivel: ${Math.round(elev)}m\n`;
  if (speed) msg += `Velocidad media: ${speed} km/h\n`;
  if (calories) msg += `Calorías: ${Math.round(calories)} kcal\n`;
  msg += `\nTipo detectado: ${tipo}\n`;

  if (hayPotencia) {
    msg += `\n*Zonas de potencia para ${ftp}W:*\n`;
    msg += `  Z1: <${Math.round(ftp * 0.55)}W | Z2: ${Math.round(ftp * 0.55)}-${Math.round(ftp * 0.75)}W | Z3: ${Math.round(ftp * 0.75)}-${Math.round(ftp * 0.87)}W\n`;
    msg += `  Z4: ${Math.round(ftp * 0.87)}-${Math.round(ftp * 1.05)}W | Z5: >${Math.round(ftp * 1.05)}W\n`;
  }

  let evalTexto = 'Sesión completada a ritmo controlado.';
  if (hayPotencia && ifFactor > 0.78 && ifFactor <= 0.90) evalTexto = 'Buen entrenamiento en SweetSpot/Tempo.';
  else if (hayPotencia && ifFactor > 0.85) evalTexto = 'Entrenamiento de alta calidad.';
  else if (hayPotencia && ifFactor < 0.65) evalTexto = 'Sesión de base aeróbica.';
  msg += `\n*Conclusión:*\n${evalTexto}`;

  if (kj > 0 || realCarbs > 0) {
    msg += '\n\n📊 *MÉTRICAS METABÓLICAS REALES*\n';
    msg += '━━━━━━━━━━━━━━━━━━━━━━\n';
    msg += `• Trabajo mecánico: ${Math.round(kj)} kJ (≈ ${Math.round(kj * 0.239)} kcal)\n`;
    msg += `• Carbohidratos oxidados: ${Math.round(realCarbs)}g\n`;
    msg += `• Recarga post-esfuerzo: Aporta ${Math.round(realCarbs * 1.2)}g CH\n`;
    if (realCarbs > 0 && durationMin > 0) {
      const chPorHora = realCarbs / (durationMin / 60);
      msg += `• Tasa oxidación CH: ${chPorHora.toFixed(1)}g/hora\n`;
    }
  } else {
    msg += '\n\n📊 *MÉTRICAS METABÓLICAS*\n';
    msg += '━━━━━━━━━━━━━━━━━━━━━━\n';
    msg += '• _Sin potenciómetro o datos en proceso de cálculo_';
  }

  return msg;
}
// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO ANALIZAR (v9.6 - CON ANÁLISIS COMPLETO)
// ═══════════════════════════════════════════════════════════════

async function cmdAnalizar(args) {
  try {
    let activityId = args && args.length > 0 ? args[0] : null;
    let activity = null;
    
    // ─── SI NO HAY ID, BUSCAR LA ÚLTIMA ACTIVIDAD ──────────────────
    if (!activityId) {
      await sendTelegram('🔍 *BUSCANDO ÚLTIMA ACTIVIDAD...*\n━━━━━━━━━━━━━━━━━━━━━━\n\nObteniendo tu última actividad de Intervals.icu...');
      
      try {
        const activities = await fetchActivities(10);
        if (!activities || activities.length === 0) {
          await sendTelegram('❌ No se encontraron actividades recientes.\n\nUsa: `/analizar [ID]` con un ID específico.');
          return;
        }
        
        // Buscar actividad con datos (más permisivo)
        let candidata = null;
        for (const act of activities) {
          const duration = safeNum(act.moving_time, 0);
          if (duration > 60) {
            candidata = act;
            break;
          }
        }
        
        if (!candidata) {
          await sendTelegram('❌ No se encontraron actividades con duración > 1 min.\n\nUsa: `/analizar [ID]` con un ID específico.');
          return;
        }
        
        activityId = candidata.id;
        const fecha = new Date(candidata.start_date_local);
        await sendTelegram(`📌 Analizando actividad ID: *${activityId}*\n📅 ${fecha.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}`);
        
        // Obtener detalle de la actividad
        activity = await fetchIntervalsActivity(activityId);
        
      } catch (err) {
        await sendTelegram(`❌ Error al obtener la última actividad: ${err.message}\n\nUsa: \`/analizar [ID]\` con un ID específico.`);
        return;
      }
    } else {
      // Obtener actividad por ID
      try {
        activity = await fetchIntervalsActivity(activityId);
      } catch (err) {
        await sendTelegram(`❌ No se encontró la actividad con ID ${activityId}\n\nVerifica que el ID sea correcto.`);
        return;
      }
    }
    
    if (!activity) {
      await sendTelegram(`❌ No se encontró la actividad con ID ${activityId}`);
      return;
    }
    
    // ─── VERIFICAR QUE LA ACTIVIDAD TIENE DATOS ────────────────────
    const tssCheck = safeNum(activity.icu_training_load, 0);
    const npCheck = safeNum(activity.icu_weighted_avg_watts, 0);
    const durationCheck = safeNum(activity.moving_time, 0);
    
    if (tssCheck === 0 && npCheck === 0 && durationCheck < 60) {
      await sendTelegram(`⚠️ *ACTIVIDAD SIN DATOS*\n━━━━━━━━━━━━━━━━━━━━━━\n\nLa actividad con ID ${activityId} no tiene datos de potencia registrados.\n\nUsa: \`/analizar\` sin ID para buscar la última actividad con datos.`);
      return;
    }
    
    // ─── OBTENER CURVA DE POTENCIA ─────────────────────────────────
    let powerCurve = null;
    try {
      powerCurve = await fetchPowerCurve(activityId);
    } catch (e) {
      // La curva de potencia no es crítica, continuamos
      console.log('[cmdAnalizar] No se pudo obtener power curve:', e.message);
    }
    
    // ─── CONSTRUIR ANÁLISIS COMPLETO ──────────────────────────────
    const analysisMsg = buildAnalisisEntrenoManu(activity, powerCurve);
    
    // ─── OBTENER ACTIVIDADES PARA COMPARATIVA ─────────────────────
    let comparativa = null;
    try {
      const activities = await fetchActivities(5);
      if (activities && activities.length > 1) {
        comparativa = compararUltimasSesiones(activities);
      }
    } catch (e) {
      console.log('[cmdAnalizar] No se pudo obtener comparativa:', e.message);
    }
    
    // ─── AÑADIR COMPARATIVA AL MENSAJE ────────────────────────────
    let msgFinal = analysisMsg;
    if (comparativa && comparativa.ultimas >= 2) {
      msgFinal += '\n━━━━━━━━━━━━━━━━━━━━━━\n';
      msgFinal += `*📊 COMPARATIVA ÚLTIMAS ${comparativa.ultimas} SESIONES*\n`;
      msgFinal += `• TSS medio: *${comparativa.avgTss}* (max ${comparativa.maxTss})\n`;
      msgFinal += `• IF medio: *${comparativa.avgIf}*\n`;
      msgFinal += `• Duración media: *${comparativa.avgDur} min*\n`;
      msgFinal += `• Tendencia: ${comparativa.tendencia}\n`;
      
      // Consejo basado en tendencia
      if (comparativa.tendencia.includes('⬆️') && comparativa.avgTss > 550) {
        msgFinal += '\n⚠️ *Carga en aumento.* Asegura recuperación adecuada.';
      } else if (comparativa.tendencia.includes('⬇️') && comparativa.avgTss < 300) {
        msgFinal += '\n📈 *Carga baja.* Puedes aumentar intensidad gradualmente.';
      }
    }
    
    await sendTelegramLong(msgFinal);
    
  } catch (err) {
    console.log('[cmdAnalizar] ERROR:', err);
    await sendTelegram(`❌ Error al analizar la actividad: ${err.message}`);
  }
}
// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO TRAZA
// ═══════════════════════════════════════════════════════════════

async function cmdTraza() {
  try {
    const traza = obtenerUltimaTraza();
    if (!traza) {
      await sendTelegram('⚠️ No hay traza de decisión disponible.\n\nEjecuta /plan o /hoy primero para generar una traza.');
      return;
    }

    let msg = '🧠 *DECISION TRACE - ÚLTIMA DECISIÓN*\n';
    msg += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    msg += `📅 *Timestamp:* ${traza.timestamp}\n`;
    msg += `📌 *Versión:* ${traza.version || '9.5'}\n\n`;

    msg += '*📊 INPUTS USADOS*\n';
    const inputs = traza.inputs || {};
    if (Object.keys(inputs).length === 0) {
      msg += '• No hay inputs registrados.\n';
    } else {
      Object.keys(inputs).forEach((k) => {
        const d = inputs[k];
        if (d && typeof d === 'object') {
          msg += `• ${k}: *${d.valor}* (${d.descripcion || ''})\n`;
        } else {
          msg += `• ${k}: ${d}\n`;
        }
      });
    }
    msg += '\n';

    msg += '*⚡ REGLAS ACTIVADAS*\n';
    const reglas = traza.reglasActivadas || [];
    if (reglas.length === 0) {
      msg += '• No se activaron reglas específicas.\n';
    } else {
      reglas.forEach((r, idx) => {
        msg += `${idx + 1}. ${r.nivel} → ${r.regla}\n`;
        msg += `   Acción: ${r.accion}\n`;
      });
    }
    msg += '\n';

    msg += '*⚖️ CONFLICTOS DETECTADOS*\n';
    const conflictos = traza.conflictos || [];
    if (conflictos.length === 0) {
      msg += '• No hubo conflictos entre reglas.\n';
    } else {
      conflictos.forEach((c, idx) => {
        msg += `${idx + 1}. Conflicto entre: ${c.entre}\n`;
        msg += `   Resolución: ${c.resolucion}\n`;
      });
    }
    msg += '\n';

    msg += '*🎯 DECISIÓN FINAL*\n';
    if (traza.decision) {
      msg += `• Tipo: *${traza.decision.tipo}*\n`;
      msg += `• Prioridad: ${traza.decision.prioridad || 'N/A'}\n`;
    } else {
      msg += '• No hay decisión registrada.\n';
    }
    msg += '\n';

    msg += '*📋 ALTERNATIVAS DESCARTADAS*\n';
    const alternativas = traza.alternativas || [];
    if (alternativas.length === 0) {
      msg += '• No se consideraron alternativas.\n';
    } else {
      alternativas.forEach((a, idx) => {
        msg += `${idx + 1}. ${a.tipo} → descartada por: ${a.motivo}\n`;
      });
    }

    msg += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    msg += '📱 *Comandos:* /hoy | /plan | /estado';

    await sendTelegramLong(msg);
  } catch (err) {
    console.log('[cmdTraza] ERROR:', err.toString());
    await sendTelegram(`❌ Error en /traza: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO PROGRESO
// ═══════════════════════════════════════════════════════════════

async function cmdProgreso() {
  await cargarHistorialCompleto();
  const historial = obtenerHistorial();
  if (historial.length < 5) {
    await sendTelegram('📊 *PROGRESO*\n━━━━━━━━━━━━━━━━━━━━━━\n\nNecesito al menos 5 entrenos para mostrar tendencias.');
    return;
  }
  
  let msg = '📊 *PROGRESO - EVOLUCIÓN*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  
  const ftpActual = CONFIG.FTP;
  const ftpEstimado = calcularFTPEstimado();
  const diff = ftpEstimado - ftpActual;
  
  msg += `*🚴 FTP ESTIMADO*\n`;
  msg += `• FTP base: ${ftpActual}W\n`;
  msg += `• FTP estimado actual: *${ftpEstimado}W*\n`;
  msg += `• Variación: ${diff > 0 ? '+' : ''}${diff}W\n\n`;
  
  const proy = calcularProyeccionObjetivo();
  msg += `*🎯 PROYECCIÓN*\n`;
  msg += `• ${proy.mensaje}\n\n`;
  
  const ultimos = historial.slice(-10);
  msg += `*📈 ÚLTIMOS 10 ENTRENOS*\n`;
  ultimos.forEach((h, idx) => {
    const fecha = new Date(h.fecha);
    const fechaStr = `${String(fecha.getDate()).padStart(2, '0')}/${String(fecha.getMonth() + 1).padStart(2, '0')}`;
    const tipo = h.entreno.tipo || 'N/A';
    const tss = h.entreno.tss || 0;
    const resultado = h.resultado || 0;
    const emoji = resultado >= 80 ? '🟢' : resultado >= 60 ? '🟡' : '🔴';
    msg += `• ${emoji} ${fechaStr} | ${tipo.toUpperCase()} | TSS:${tss} | ${resultado}%\n`;
  });
  
  await sendTelegramLong(msg);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO PREDICCION
// ═══════════════════════════════════════════════════════════════

async function cmdPrediccion() {
  const state = await getAthleteStateConAjuste();
  if (!state) {
    await sendTelegram('Sin datos disponibles.');
    return;
  }
  
  const ftpEstimado = state.ftpEstimado || CONFIG.FTP;
  const proy = state.proyeccion || calcularProyeccionObjetivo();
  
  let msg = '🔮 *PREDICCIÓN DE RENDIMIENTO*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  msg += `*📊 FTP ACTUAL*\n`;
  msg += `• FTP de entrada: ${CONFIG.FTP}W\n`;
  msg += `• FTP estimado actual: *${ftpEstimado}W*\n\n`;
  
  msg += `*🎯 OBJETIVO: ${CONFIG.FTP_HISTORICO.valor}W*\n`;
  msg += `• ${proy.mensaje}\n\n`;
  
  const pcts = [0.85, 0.95, 1.05, 1.15];
  const nombres = ['SweetSpot', 'FTP', 'VO2', 'Anaerobic'];
  msg += `*⚡ RENDIMIENTO ESTIMADO*\n`;
  pcts.forEach((pct, idx) => {
    const w = Math.round(ftpEstimado * pct);
    msg += `• ${nombres[idx]}: ${w}W (${(pct*100).toFixed(0)}% FTP)\n`;
  });
  
  msg += '\n💡 *Para mejorar:* Mantén consistencia y prioriza recuperación.';
  
  await sendTelegramLong(msg);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO FATIGA
// ═══════════════════════════════════════════════════════════════

async function cmdFatiga() {
  const state = await getAthleteStateConAjuste();
  if (!state) { await sendTelegram('Sin datos.'); return; }
  let msg = '🔬 *ANÁLISIS DE FATIGA*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  msg += '*📊 MÉTRICAS ACTUALES*\n';
  msg += `• TSB: *${state.tsb.toFixed(1)}* `;
  if (state.tsb > 0) msg += '🟢 (Fresco)';
  else if (state.tsb > -10) msg += '🟡 (Equilibrado)';
  else if (state.tsb > -20) msg += '🟠 (Fatigado)';
  else msg += '🔴 (Fatiga extrema)';
  msg += '\n';
  msg += `• Readiness: *${state.readiness}/100* `;
  if (state.readiness > 70) msg += '🟢 (Alta)';
  else if (state.readiness > 50) msg += '🟡 (Media)';
  else msg += '🔴 (Baja)';
  msg += '\n';
  msg += `• HRV: ${state.estado.hrv || 'N/D'}\n`;
  msg += `• ACWR: ${state.estado.acwr.toFixed(2)} ${state.estado.acwr > 1.3 ? '⚠️ ALTO' : '✅ OK'}\n`;
  msg += `• Sueño: ${state.estado.sleepQuality === 1 ? '⚠️ Malo' : state.estado.sleepQuality === 2 ? '🟡 Regular' : '🟢 Bueno'}\n`;
  msg += `• Calor: ${state.haceCalor ? `🔥 ${state.heatIndex}°C` : '✅ Normal'}\n\n`;
  
  if (state.horasRecuperacion) {
    msg += `*⏰ RECUPERACIÓN ESTIMADA*\n`;
    msg += `• ${state.horasRecuperacion}h hasta próximo entreno de calidad\n`;
    msg += `• Próximo entreno: ${state.proximoEntreno}\n\n`;
  }
  
  msg += '*💡 RECOMENDACIÓN*\n';
  if (state.tsb < -20 || state.readiness < 40) {
    msg += '🔴 *DESCANSO TOTAL OBLIGATORIO*\n• Haz solo movilidad suave\n• Prioriza dormir 8+ horas\n';
  } else if (state.tsb < -10 || state.readiness < 55) {
    msg += '🟡 *RECUPERACIÓN ACTIVA*\n• Z1-Z2 suave (30-45 min)\n• Evita intensidad\n';
  } else if (state.tsb < 0 || state.readiness < 70) {
    msg += '🟢 *ENTRENO CONTROLADO*\n• Z2 o SweetSpot ligero\n• Controla la intensidad\n';
  } else {
    msg += '🟢 *VENTANA DE CALIDAD*\n• Puedes entrenar con intensidad\n• Aprovecha el buen estado\n';
  }
  await sendTelegramLong(msg);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO RECUPERACION
// ═══════════════════════════════════════════════════════════════

async function cmdRecuperacion() {
  const state = await getAthleteStateConAjuste();
  if (!state) {
    await sendTelegram('Sin datos disponibles.');
    return;
  }
  
  const horas = state.horasRecuperacion || 8;
  const proximo = state.proximoEntreno || 'Mañana';
  
  let msg = '⏳ *RECUPERACIÓN PREDICTIVA*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  msg += `*📊 FACTORES CONSIDERADOS*\n`;
  msg += `• Edad: ${CONFIG.AGE_YEARS} años\n`;
  msg += `• TSS semanal: ${Math.round(state.estado.weeklyTss)}\n`;
  msg += `• Calidad de sueño: ${state.estado.sleepQuality === 1 ? 'Mala' : state.estado.sleepQuality === 2 ? 'Regular' : 'Buena'}\n`;
  msg += `• Estado actual: ${state.tsb > 0 ? 'Fresco' : state.tsb > -10 ? 'Equilibrado' : 'Fatigado'}\n\n`;
  
  msg += `*⏰ TIEMPO ESTIMADO*\n`;
  msg += `• ${horas}h de recuperación necesarias\n`;
  msg += `• Próximo entreno de calidad: ${proximo}\n\n`;
  
  msg += `*💡 CONSEJOS DE RECUPERACIÓN*\n`;
  if (horas > 12) {
    msg += '• 🔴 Prioriza descanso absoluto\n';
    msg += '• 🛌 Dormir 8+ horas\n';
    msg += '• 🥤 Hidratación con electrolitos\n';
  } else if (horas > 8) {
    msg += '• 🟡 Recuperación activa (Z1 suave)\n';
    msg += '• 🛌 Dormir 7-8 horas\n';
    msg += '• 🥤 Hidratación adecuada\n';
  } else {
    msg += '• 🟢 Puedes entrenar con normalidad\n';
    msg += '• 🛌 Mantén buena higiene de sueño\n';
  }
  
  await sendTelegramLong(msg);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO ALERTA
// ═══════════════════════════════════════════════════════════════

async function cmdAlerta() {
  const state = await getAthleteStateConAjuste();
  if (!state) { await sendTelegram('Sin datos.'); return; }
  let msg = '🚨 *ALERTA DE SOBREENTRENAMIENTO*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  const riesgos = [];
  if (state.tsb < -25) riesgos.push(`🔴 TSB extremo (${state.tsb.toFixed(1)})`);
  else if (state.tsb < -15) riesgos.push(`🟠 TSB bajo (${state.tsb.toFixed(1)})`);
  if (state.readiness < 40) riesgos.push(`🔴 Readiness muy bajo (${state.readiness}/100)`);
  else if (state.readiness < 55) riesgos.push(`🟠 Readiness bajo (${state.readiness}/100)`);
  if (state.estado.acwr > 1.5) riesgos.push(`🔴 ACWR muy alto (${state.estado.acwr.toFixed(2)})`);
  else if (state.estado.acwr > 1.3) riesgos.push(`🟠 ACWR alto (${state.estado.acwr.toFixed(2)})`);
  if (state.estado.sleepQuality === 1) riesgos.push('🟠 Sueño malo');
  if (state.estado.hrv < 40) riesgos.push('🟠 HRV bajo');
  if (state.estado.weeklyTss > state.restricciones.tssMaxSemanal) {
    riesgos.push(`🔴 Sobrecarga semanal (${Math.round(state.estado.weeklyTss)} TSS)`);
  }
  msg += '*📊 ANÁLISIS DE RIESGOS*\n';
  if (riesgos.length === 0) {
    msg += '✅ No se detectan riesgos de sobreentrenamiento.\n• Estado: 🟢 Controlado.\n';
  } else {
    riesgos.forEach((r) => { msg += `• ${r}\n`; });
  }
  msg += '\n*💡 RECOMENDACIÓN*\n';
  if (riesgos.length >= 3) {
    msg += '🔴 *ALTO RIESGO DE SOBREENTRENAMIENTO*\n• Descanso total 2-3 días.\n• Consulta con un profesional si es necesario.\n';
  } else if (riesgos.length >= 2) {
    msg += '🟡 *RIESGO MODERADO*\n• Reduce carga e intensidad.\n• Prioriza descanso y recuperación.\n';
  } else if (riesgos.length >= 1) {
    msg += '🟡 *RIESGO BAJO*\n• Controla la carga hoy.\n• Escucha a tu cuerpo.\n';
  }
  await sendTelegramLong(msg);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO TENDENCIAS
// ═══════════════════════════════════════════════════════════════

async function cmdTendencias() {
  await cargarHistorialCompleto();
  const historial = obtenerHistorial();
  if (historial.length < 10) {
    await sendTelegram('📈 *TENDENCIAS*\n━━━━━━━━━━━━━━━━━━━━━━\n\nNecesito al menos 10 entrenos para mostrar tendencias.');
    return;
  }
  
  let msg = '📈 *TENDENCIAS - 90 DÍAS*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  
  let totalTSS = 0, totalRPE = 0, totalReadiness = 0;
  historial.slice(-20).forEach(h => {
    totalTSS += h.entreno?.tss || 0;
    totalRPE += h.feedback?.rpe || 5;
    totalReadiness += h.entreno?.readiness || 50;
  });
  const n = Math.min(historial.length, 20);
  
  msg += `*📊 MEDIAS (últimos ${n} entrenos)*\n`;
  msg += `• TSS medio: ${Math.round(totalTSS/n)}\n`;
  msg += `• RPE medio: ${(totalRPE/n).toFixed(1)}\n`;
  msg += `• Readiness media: ${Math.round(totalReadiness/n)}/100\n\n`;
  
  const recientes = historial.slice(-10);
  const antiguos = historial.slice(-20, -10);
  const tssRec = recientes.reduce((sum, h) => sum + (h.entreno?.tss || 0), 0) / 10;
  const tssAnt = antiguos.reduce((sum, h) => sum + (h.entreno?.tss || 0), 0) / 10;
  
  msg += `*📈 TENDENCIA DE CARGA*\n`;
  if (tssRec > tssAnt * 1.2) msg += '• ⬆️ Carga AUMENTANDO - Vigila fatiga\n';
  else if (tssRec < tssAnt * 0.8) msg += '• ⬇️ Carga DISMINUYENDO - Posible descanso\n';
  else msg += '• ➡️ Carga ESTABLE - Buen ritmo\n';
  
  await sendTelegramLong(msg);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO SEMANA
// ═══════════════════════════════════════════════════════════════

async function cmdSemana() {
  const state = await getAthleteStateConAjuste();
  if (!state) { await sendTelegram('Sin datos.'); return; }
  const e = state.estado;
  const fase = getFaseActual();
  const semana = getSemanaActual();
  const tssObj = getTssObjetivoSemanal();
  const calidad = contarSesionesCalidadSemana();
  const maxCalidad = getMaxSesionesCalidad();
  
  let msg = '📊 *RESUMEN SEMANAL*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  msg += `*📅 FASE:* ${getNombreFase()} (Semana ${semana}/${getSemanasFase()})\n`;
  msg += `*📈 CARGA*\n`;
  msg += `• TSS acumulado: ${Math.round(e.weeklyTss)} / ${tssObj}\n`;
  msg += `• Sesiones: ${e.weeklySessions}\n`;
  msg += `• Media TSS/sesión: ${e.weeklySessions > 0 ? Math.round(e.weeklyTss / e.weeklySessions) : 0}\n`;
  msg += `• Calidad: ${calidad}/${maxCalidad} sesiones\n\n`;
  
  msg += `*💪 ESTADO ACTUAL*\n`;
  msg += `• CTL: ${e.ctl.toFixed(1)}\n`;
  msg += `• ATL: ${e.atl.toFixed(1)}\n`;
  msg += `• TSB: ${e.tsb.toFixed(1)}\n\n`;
  
  msg += `*📊 ACWR:* ${e.acwr.toFixed(2)}\n`;
  if (e.acwr > 1.3) msg += '⚠️ ACWR alto - Reduce carga esta semana\n';
  else if (e.acwr < 0.8) msg += '📈 ACWR bajo - Puedes aumentar carga\n';
  else msg += '✅ ACWR en rango óptimo\n';
  
  if (state.horasRecuperacion) {
    msg += `\n*⏰ RECUPERACIÓN:* ${state.horasRecuperacion}h hasta próximo entreno de calidad.`;
  }
  
  await sendTelegramLong(msg);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO SEMANA PASADA
// ═══════════════════════════════════════════════════════════════

async function cmdSemanaPasada() {
  try {
    await sendTelegram('🔍 *BUSCANDO DATOS DE LA SEMANA PASADA...*\n━━━━━━━━━━━━━━━━━━━━━━\n\nConsultando actividades de lunes a domingo...');
    
    // Calcular fechas de la semana pasada (lunes a domingo)
    const hoy = new Date();
    const diaSemana = hoy.getDay();
    const diasDesdeLunes = diaSemana === 0 ? 6 : diaSemana - 1;
    const lunesEstaSemana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - diasDesdeLunes);
    const lunesSemanaPasada = new Date(lunesEstaSemana.getTime() - 7 * 86400000);
    const domingoSemanaPasada = new Date(lunesSemanaPasada.getTime() + 6 * 86400000);
    
    const lunesStr = formatDate(lunesSemanaPasada);
    const domingoStr = formatDate(domingoSemanaPasada);
    
    // Intentar obtener de Supabase primero
    let actividades = [];
    try {
      const { data, error } = await supabase
        .from('actividades_guardadas')
        .select('*')
        .eq('user_id', CONFIG.CHAT_ID || 'default')
        .gte('Fecha', lunesStr)
        .lte('Fecha', domingoStr)
        .order('Fecha', { ascending: true });
      
      if (!error && data && data.length > 0) {
        actividades = data;
      }
    } catch (e) {
      console.log('[cmdSemanaPasada] Error en Supabase:', e);
    }
    
    // Si no hay en Supabase, buscar en memoria/historial
    if (actividades.length === 0) {
      const historial = obtenerHistorial();
      historial.forEach(h => {
        const fecha = new Date(h.fecha);
        const fechaStr = formatDate(fecha);
        if (fechaStr >= lunesStr && fechaStr <= domingoStr) {
          actividades.push({
            Fecha: h.fecha,
            tss: h.entreno?.tss || 0,
            np: h.entreno?.np || 0,
            if_value: h.entreno?.intensidad || 0,
            kj: h.entreno?.kj || 0,
            tipo: h.entreno?.tipo || 'desconocido'
          });
        }
      });
    }
    
    // Si aún no hay datos, buscar en Intervals.icu
    if (actividades.length === 0) {
      try {
        const activities = await fetchActivities(7);
        if (activities && activities.length > 0) {
          activities.forEach(act => {
            const fecha = new Date(act.start_date_local || act.start_date || '');
            const fechaStr = formatDate(fecha);
            if (fechaStr >= lunesStr && fechaStr <= domingoStr) {
              actividades.push({
                Fecha: act.start_date_local || act.start_date,
                tss: safeNum(act.icu_training_load, 0),
                np: safeNum(act.icu_weighted_avg_watts, 0),
                if_value: safeNum(act.if, 0),
                kj: safeNum(act.icu_kilojoules, 0) || safeNum(act.kilojoules, 0),
                tipo: 'actividad'
              });
            }
          });
        }
      } catch (e) {
        console.log('[cmdSemanaPasada] Error en Intervals:', e);
      }
    }
    
    // Construir mensaje
    let msg = '📊 *RESUMEN SEMANA PASADA*\n';
    msg += '━━━━━━━━━━━━━━━━━━━━━━\n\n';
    msg += `📅 *Periodo:* ${lunesSemanaPasada.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}\n`;
    msg += `        hasta ${domingoSemanaPasada.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}\n\n`;
    
    if (actividades.length === 0) {
      msg += '😴 *Sin actividades registradas*\n\n';
      msg += 'No se encontraron entrenos en esta semana.\n';
      msg += '• Revisa que hayas sincronizado con /sync\n';
      msg += '• O registra tus entrenos en Intervals.icu\n';
    } else {
      // Estadísticas generales
      const tssTotal = actividades.reduce((sum, act) => sum + (safeNum(act.tss, 0)), 0);
      const kjTotal = actividades.reduce((sum, act) => sum + (safeNum(act.kj, 0)), 0);
      const npPromedio = actividades.length > 0 
        ? Math.round(actividades.reduce((sum, act) => sum + (safeNum(act.np, 0)), 0) / actividades.length)
        : 0;
      
      msg += `*📈 RESUMEN*\n`;
      msg += `• Sesiones: *${actividades.length}*\n`;
      msg += `• TSS total: *${Math.round(tssTotal)}*\n`;
      msg += `• KJ total: *${Math.round(kjTotal)}* (${Math.round(kjTotal * 0.239)} kcal)\n`;
      if (npPromedio > 0) {
        msg += `• NP promedio: *${npPromedio}W*\n`;
      }
      msg += '\n';
      
      // Detalle de cada actividad
      msg += '*📋 DETALLE DE ACTIVIDADES*\n';
      msg += '━━━━━━━━━━━━━━━━━━━━━━\n\n';
      
      actividades.forEach((act, idx) => {
        const fecha = new Date(act.Fecha || act.fecha);
        const fechaStr = fecha.toLocaleDateString('es-ES', { 
          weekday: 'short', 
          day: 'numeric', 
          month: 'short' 
        });
        
        const tss = safeNum(act.tss, 0);
        const np = safeNum(act.np, 0);
        const kj = safeNum(act.kj, 0);
        const ifVal = safeNum(act.if_value, 0);
        
        // Determinar tipo de entreno
        let tipo = 'Z2';
        if (np > 0 && CONFIG.FTP > 0) {
          const ifCalc = np / CONFIG.FTP;
          if (ifCalc > 1.05) tipo = 'VO2 Max';
          else if (ifCalc > 0.95) tipo = 'FTP';
          else if (ifCalc > 0.87) tipo = 'SweetSpot';
          else if (ifCalc > 0.75) tipo = 'Tempo';
          else if (ifCalc > 0.55) tipo = 'Base';
        }
        
        // Emoji según TSS
        const emoji = tss > 150 ? '🔥' : tss > 100 ? '⚡' : tss > 50 ? '✅' : '🟢';
        
        msg += `${idx + 1}. ${emoji} *${fechaStr}*\n`;
        msg += `   ${tipo}`;
        if (tss > 0) msg += ` | TSS: ${tss}`;
        if (np > 0) msg += ` | NP: ${np}W`;
        if (kj > 0) msg += ` | ${Math.round(kj)} kJ`;
        msg += '\n';
      });
      
      msg += '\n';
      
      // Análisis de la semana
      msg += '*💡 ANÁLISIS*\n';
      
      if (actividades.length >= 5) {
        msg += '• 🟢 Excelente volumen de entrenamiento\n';
        msg += '• Semana de alta carga - Asegura recuperación\n';
      } else if (actividades.length >= 3) {
        msg += '• 🟡 Volumen moderado\n';
        msg += '• Buen ritmo, mantén la consistencia\n';
      } else if (actividades.length >= 1) {
        msg += '• 📈 Semana de carga baja\n';
        msg += '• Puedes aumentar gradualmente\n';
      }
      
      // Promedio TSS por sesión
      if (actividades.length > 0) {
        const tssPromedio = Math.round(tssTotal / actividades.length);
        msg += `• TSS promedio/sesión: ${tssPromedio}\n`;
        
        if (tssPromedio > 100) {
          msg += '• Carga por sesión: Alta\n';
        } else if (tssPromedio > 60) {
          msg += '• Carga por sesión: Moderada\n';
        } else {
          msg += '• Carga por sesión: Baja\n';
        }
      }
      
      // Comparación con objetivo
      const tssObjetivo = getTssObjetivoSemanal();
      const diferencia = Math.round(tssTotal) - tssObjetivo;
      if (diferencia > 0) {
        msg += `\n• ✅ Superaste objetivo en ${diferencia} TSS\n`;
      } else if (diferencia < 0) {
        msg += `\n• 📈 Te faltaron ${Math.abs(diferencia)} TSS para el objetivo\n`;
      } else {
        msg += `\n• 🎯 Objetivo semanal alcanzado\n`;
      }
    }
    
    msg += '\n📱 *Comandos:* /semana | /semanapasada | /historial';
    
    await sendTelegramLong(msg);
    
  } catch (err) {
    console.log('[cmdSemanaPasada] ERROR:', err);
    await sendTelegram(`❌ Error al obtener semana pasada: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO HISTORIAL - VER ACTIVIDADES GUARDADAS
// ═══════════════════════════════════════════════════════════════

async function cmdHistorial() {
  try {
    // Obtener actividades de Supabase
    const { data, error } = await supabase
      .from('actividades_guardadas')
      .select('*')
      .eq('user_id', CONFIG.CHAT_ID || 'default')
      .order('Fecha', { ascending: false })
      .limit(20);
      
    if (error) {
      console.log('[cmdHistorial] Error:', error);
      await sendTelegram(`❌ Error al obtener las actividades: ${error.message}`);
      return;
    }
    
    if (!data || data.length === 0) {
      await sendTelegram('📊 *HISTORIAL DE ACTIVIDADES*\n━━━━━━━━━━━━━━━━━━━━━━\n\nNo hay actividades guardadas en Supabase.\n\nEjecuta `/sync` para sincronizar actividades de Intervals.icu.');
      return;
    }
    
    let msg = '📊 *HISTORIAL DE ACTIVIDADES*\n';
    msg += '━━━━━━━━━━━━━━━━━━━━━━\n\n';
    msg += `📋 *Total en BD:* ${data.length} mostradas\n\n`;
    
    data.forEach((act, idx) => {
      const fecha = act.Fecha ? new Date(act.Fecha).toLocaleDateString('es-ES') : 'Sin fecha';
      const tss = (act.tss != null && act.tss !== undefined) ? act.tss : 'N/A';
      const np = (act.np != null && act.np !== undefined && act.np > 0) ? act.np : 'N/A';
      // Calcular IF = NP / FTP si no existe
      let ifVal = 'N/A';
      if (act.if_value && act.if_value > 0) {
        ifVal = (act.if_value * 100).toFixed(0) + '%';
      } else if (np !== 'N/A' && np > 0) {
        ifVal = ((np / CONFIG.FTP) * 100).toFixed(0) + '%';
      }
      const id = act.actividad_id || 'Sin ID';
      
      const tssNum = typeof tss === 'number' ? tss : 0;
      const emoji = tssNum > 150 ? '🔥' : tssNum > 80 ? '✅' : '🟢';
      msg += `${idx + 1}. ${emoji} *${fecha}* | TSS: ${tss} | NP: ${np}W | IF: ${ifVal}\n`;
      msg += `   ID: \`${id}\`\n`;
    });
    
    msg += '\n📱 *Usa /analizar [ID] para ver detalles de una actividad.*';
    
    await sendTelegramLong(msg);
    
  } catch (err) {
    console.log('[cmdHistorial] ERROR:', err);
    await sendTelegram(`❌ Error: ${err.message}`);
  }
}
// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO OBJETIVO
// ═══════════════════════════════════════════════════════════════

async function cmdObjetivo() {
  const state = await getAthleteStateConAjuste();
  if (!state) { await sendTelegram('Sin datos.'); return; }
  const ftpHistorico = CONFIG.FTP_HISTORICO || { valor: 296, peso: 60 };
  const diffFTP = ftpHistorico.valor - CONFIG.FTP;
  const pesoDiff = CONFIG.WEIGHT_KG - ftpHistorico.peso;
  const workout = state.workout;
  const ftpEstimado = state.ftpEstimado || CONFIG.FTP;
  const proy = state.proyeccion || calcularProyeccionObjetivo();

  let msg = `🎯 *PLAN PARA RECUPERAR LOS ${ftpHistorico.valor}W*\n`;
  msg += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  msg += '*📊 SITUACIÓN ACTUAL*\n';
  msg += `• FTP actual: *${CONFIG.FTP}W*\n`;
  msg += `• FTP estimado: *${ftpEstimado}W*\n`;
  msg += `• Mejor histórico: *${ftpHistorico.valor}W* (${ftpHistorico.fecha})\n`;
  msg += `• Diferencia: *${diffFTP}W* a recuperar\n\n`;
  
  msg += `*📈 PROYECCIÓN*\n`;
  msg += `• ${proy.mensaje}\n\n`;

  if (diffFTP > 0) {
    msg += '*📈 PLAN DE 12 SEMANAS*\n';
    msg += `• Fase 1 (semanas 1-4): 🏗️ Base Aeróbica (Z2-Z3)\n`;
    msg += `  → 3-4 sesiones/semana, 60-90 min\n`;
    msg += `  → Incluye fuerza general\n`;
    msg += `• Fase 2 (semanas 5-8): 📈 Desarrollo FTP (SweetSpot + Tempo)\n`;
    msg += `  → 1-2 sesiones de calidad/semana\n`;
    msg += `  → Fuerza Máxima (Semanas 1-3) / Resistencia (2-4)\n`;
    msg += `• Fase 3 (semanas 9-12): 🎯 Especificidad (VO2 Max + Umbral)\n`;
    msg += `  → 2 sesiones de calidad/semana\n\n`;
    msg += '*📊 OBJETIVOS DE CARGA*\n';
    msg += '• TSS semanal: 450-650\n';
    msg += '• Horas semanales: 6-9h\n';
    msg += '• Sesiones de calidad: 2-3/semana\n\n';
    msg += '*💪 FUERZA RECOMENDADA*\n';
    msg += '• 2 sesiones/semana (30-45 min)\n';
    msg += '• Enfoque: Sentadilla, peso muerto, zancadas\n';
    msg += '• Periodización: 2 semanas Máxima + 2 semanas Resistencia\n\n';
    msg += `*🎯 META INTERMEDIA (6 semanas)*\n`;
    msg += `• Objetivo: ${Math.round(CONFIG.FTP + diffFTP * 0.4)}W\n`;
    msg += '• TSS acumulado: 3000-3500\n';

    if (pesoDiff > 0) {
      msg += '\n*📉 PESO RECOMENDADO*\n';
      msg += `• Peso actual: ${CONFIG.WEIGHT_KG}kg\n`;
      msg += `• Peso objetivo: ${ftpHistorico.peso}kg\n`;
      msg += `• Diferencia: ${pesoDiff}kg a perder\n`;
      msg += '   → 0.2-0.3kg/semana de forma saludable\n';
    }

    msg += '\n*💡 RECOMENDACIONES*\n';
    msg += '• Usa /plan para ver el entreno de hoy\n';
    msg += '• Usa /semana para ver el progreso semanal\n';
    msg += '• La consistencia es la clave\n';

    if (workout && workout.tipo !== 'descanso') {
      msg += '\n*📊 CÓMO AYUDA EL ENTRENO DE HOY*\n';
      msg += `• Tipo: ${workout.tipo.toUpperCase()} (Intensidad: ${(workout.intensidadFTP * 100).toFixed(0)}% FTP)\n`;
      msg += `• TSS de hoy: ${workout.tssEsperado} → contribuye a la carga crónica (CTL)\n`;
      msg += `• IF: ${workout.ifEsperado} → calidad del estímulo\n`;
      msg += `• Objetivo a ${ftpHistorico.valor}W: ${diffFTP > 0 ? '📈 Te acercas cada día' : '🎯 ¡Objetivo alcanzado!'}\n`;
    }
  } else {
    msg += '🎉 *¡Estás en tu mejor momento!*\n';
    msg += '• Mantén la forma y busca nuevos retos\n';
    msg += '• Prueba a aumentar el volumen o la intensidad\n';
  }

  await sendTelegramLong(msg);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO APRENDER - DASHBOARD COMPLETO
// ═══════════════════════════════════════════════════════════════

async function cmdAprender() {
  await cargarHistorialCompleto();
  const state = await getAthleteStateConAjuste();
  if (!state) { await sendTelegram('Sin datos.'); return; }
  const stats = state.aprendizaje.stats;
  let msg = '🧠 *WORLD TOUR COACH - DASHBOARD DE APRENDIZAJE*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  
  if (!stats.suficiente) {
    msg += '📊 *No tengo suficientes datos aún.*\n\n';
    msg += '💡 Sigue entrenando y dando feedback con /analizar.\n';
    msg += `   Necesito mínimo 5 entrenos para empezar a aprender.\n   (Tienes ${stats.total} registrados)\n`;
    await sendTelegramLong(msg);
    return;
  }
  
  msg += `📊 *Entrenamientos analizados:* ${stats.total}\n\n`;
  
  // ─── SECCIÓN 1: TASA DE ÉXITO POR TIPO ────────────────────────
  msg += '*📈 TASA DE ÉXITO POR TIPO DE ENTRENO*\n';
  const tipos = Object.keys(stats.porTipo || {});
  tipos.sort((a, b) => (stats.porTipo[b].tasa || 0) - (stats.porTipo[a].tasa || 0));
  tipos.forEach((tipo) => {
    const d = stats.porTipo[tipo];
    const emoji = d.tasa >= 80 ? '🟢' : d.tasa >= 60 ? '🟡' : '🔴';
    msg += `• ${emoji} ${tipo.toUpperCase()}: ${d.tasa}% éxito (${d.total} entrenos)\n`;
  });
  if (tipos.length > 0) {
    const mejor = tipos[0];
    const dMejor = stats.porTipo[mejor];
    msg += `\n*🏆 MEJOR ENTRENO PARA TI*\n• ${mejor.toUpperCase()} con ${dMejor.tasa}% éxito\n`;
  }
  
  // ─── SECCIÓN 2: APRENDIZAJE CONTEXTUAL ────────────────────────
  const contexto = analizarAprendizajeContextual();
  if (contexto) {
    msg += '\n*🕐 APRENDIZAJE CONTEXTUAL*\n';
    if (contexto.manana.total > 0) {
      const tasa = Math.round((contexto.manana.exito / contexto.manana.total) * 100);
      msg += `• Mañana: ${tasa}% éxito (${contexto.manana.total} entrenos)\n`;
    }
    if (contexto.tarde.total > 0) {
      const tasa = Math.round((contexto.tarde.exito / contexto.tarde.total) * 100);
      msg += `• Tarde: ${tasa}% éxito (${contexto.tarde.total} entrenos)\n`;
    }
    if (contexto.conComida.total > 0) {
      const tasa = Math.round((contexto.conComida.exito / contexto.conComida.total) * 100);
      msg += `• Con comida previa: ${tasa}% éxito\n`;
    }
  }
  
  // ─── SECCIÓN 3: ANÁLISIS DE DESVIACIONES ──────────────────────
  const analisisDesviaciones = await analizarCumplimientoPlan();
  if (analisisDesviaciones.tieneDesviaciones) {
    msg += '\n*⚠️ DESVIACIONES RECIENTES*\n';
    msg += `• Cumplimiento global: ${analisisDesviaciones.porcentajeCumplimiento}%\n`;
    msg += `• Desviaciones detectadas: ${analisisDesviaciones.desviaciones.length}\n`;
    msg += `• ${analisisDesviaciones.recomendacion}\n`;
  } else {
    msg += '\n*🎯 CUMPLIMIENTO*\n';
    msg += '• Excelente! Estás cumpliendo al 100% con el plan.\n';
  }
  
  // ─── SECCIÓN 4: PATRONES TEMPORALES ───────────────────────────
  const patrones = detectarPatronesTemporales();
  if (patrones. patronesDetectados) {
    msg += '\n*📅 PATRONES TEMPORALES DETECTADOS*\n';
    if (patrones.diaSemana && patrones.diaSemana.length > 0) {
      msg += `• Días con más desviaciones: ${patrones.diaSemana.join(', ')}\n`;
    }
    if (patrones.horaPreferida) {
      msg += `• Hora preferida: ${patrones.horaPreferida}\n`;
    }
    if (patrones.conComidaExito) {
      msg += `• Con comida previa: ${patrones.conComidaExito}% éxito\n`;
    }
  }
  
  // ─── SECCIÓN 5: RECOMENDACIONES INTELIGENTES ──────────────────
  const recomendaciones = generarRecomendacionesInteligentes(stats, contexto, patrones);
  if (recomendaciones.length > 0) {
    msg += '\n*💡 RECOMENDACIONES INTELIGENTES*\n';
    recomendaciones.forEach(rec => {
      msg += `• ${rec}\n`;
    });
  }
  
  msg += '\n📱 *Comandos:* /hoy | /plan | /aprendervalidar | /sync';
  await sendTelegramLong(msg);
}

// ─── DETECTAR PATRONES TEMPORALES ──────────────────────────────
function detectarPatronesTemporales() {
  try {
    const historial = obtenerHistorial();
    if (historial.length < 5) {
      return { patronesDetectados: false };
    }
    
    const patrones = {
      patronesDetectados: false,
      diaSemana: [],
      horaPreferida: null,
      conComidaExito: 0
    };
    
    // Analizar por día de la semana
    const diasSemana = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const desviacionesPorDia = {};
    diasSemana.forEach(dia => desviacionesPorDia[dia] = 0);
    
    // Analizar por hora
    const horasExito = {};
    const horasTotal = {};
    
    // Analizar éxito con/sin comida
    let conComidaExito = 0;
    let conComidaTotal = 0;
    
    historial.forEach(h => {
      const fecha = new Date(h.fecha);
      const dia = diasSemana[fecha.getDay()];
      const hora = fecha.getHours();
      const contexto = h.contexto || {};
      const exito = (h.resultado || 0) >= 70;
      
      // Contar desviaciones por día (entrenos con resultado bajo)
      if (h.resultado < 60) {
        desviacionesPorDia[dia] = (desviacionesPorDia[dia] || 0) + 1;
      }
      
      // Contar éxitos por hora
      if (exito) {
        horasExito[hora] = (horasExito[hora] || 0) + 1;
      }
      horasTotal[hora] = (horasTotal[hora] || 0) + 1;
      
      // Analizar comida previa
      if (contexto.comioAntes === 'si') {
        conComidaTotal++;
        if (exito) conComidaExito++;
      }
    });
    
    // Detectar días con más desviaciones
    const diasOrdenados = Object.keys(desviacionesPorDia).sort((a, b) => 
      (desviacionesPorDia[b] || 0) - (desviacionesPorDia[a] || 0)
    );
    patrones.diaSemana = diasOrdenados.slice(0, 2);
    
    // Detectar hora preferida
    const mejorHora = Object.keys(horasExito).sort((a, b) => {
      const tasaA = horasExito[a] / (horasTotal[a] || 1);
      const tasaB = horasExito[b] / (horasTotal[b] || 1);
      return tasaB - tasaA;
    })[0];
    
    if (mejorHora && horasTotal[mejorHora] >= 3) {
      const tasa = Math.round((horasExito[mejorHora] / horasTotal[mejorHora]) * 100);
      patrones.horaPreferida = `${mejorHora}:00 (${tasa}% éxito)`;
    }
    
    // Calcular éxito con comida
    if (conComidaTotal >= 3) {
      patrones.conComidaExito = Math.round((conComidaExito / conComidaTotal) * 100);
    }
    
    patrones.patronesDetectados = true;
    return patrones;
  } catch (err) {
    console.log('[detectarPatronesTemporales] ERROR:', err);
    return { patronesDetectados: false };
  }
}

// ─── GENERAR RECOMENDACIONES INTELIGENTES ──────────────────────
function generarRecomendacionesInteligentes(stats, contexto, patrones) {
  const recomendaciones = [];
  
  try {
    // Recomendación basada en éxito por tipo
    if (stats.porTipo) {
      const tipos = Object.keys(stats.porTipo);
      const buenos = tipos.filter(t => stats.porTipo[t].tasa >= 80 && stats.porTipo[t].total >= 3);
      const malos = tipos.filter(t => stats.porTipo[t].tasa < 50 && stats.porTipo[t].total >= 3);
      
      if (buenos.length > 0) {
        recomendaciones.push(`✅ Prioriza: ${buenos.join(', ').toUpperCase()}`);
      }
      if (malos.length > 0) {
        recomendaciones.push(`⚠️ Evita: ${malos.join(', ').toUpperCase()}`);
      }
    }
    
    // Recomendación basada en contexto
    if (contexto) {
      if (contexto.manana.total >= 3) {
        const tasaManana = Math.round((contexto.manana.exito / contexto.manana.total) * 100);
        const tasaTarde = contexto.tarde.total > 0 ? Math.round((contexto.tarde.exito / contexto.tarde.total) * 100) : 0;
        if (tasaManana > tasaTarde + 20) {
          recomendaciones.push('🌅 Entrena por la mañana (mayor éxito)');
        }
      }
      
      if (contexto.conComida.total >= 3) {
        const tasaConComida = Math.round((contexto.conComida.exito / contexto.conComida.total) * 100);
        const tasaSinComida = contexto.sinComida.total > 0 ? Math.round((contexto.sinComida.exito / contexto.sinComida.total) * 100) : 0;
        if (tasaConComida > tasaSinComida + 20) {
          recomendaciones.push('🍽️ Come antes de entrenar (mejor rendimiento)');
        }
      }
    }
    
    // Recomendación basada en patrones temporales
    if (patrones.patronesDetectados && patrones.diaSemana.length > 0) {
      recomendaciones.push(`📅 Considera cambiar entrenamientos intensos de ${patrones.diaSemana[0]}`);
    }
    
    if (recomendaciones.length === 0) {
      recomendaciones.push('📊 Sigue entrenando para generar más recomendaciones');
    }
    
  } catch (err) {
    console.log('[generarRecomendacionesInteligentes] ERROR:', err);
  }
  
  return recomendaciones.slice(0, 5);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO APRENDER VALIDAR
// ═══════════════════════════════════════════════════════════════

async function cmdAprenderValidar() {
  await cargarHistorialCompleto();
  const historial = obtenerHistorial();
  const stats = getEstadisticasAgregadas();
  let msg = '🧠 *VALIDACIÓN DEL APRENDIZAJE*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  msg += `*📊 MUESTRA DISPONIBLE*\n• Entrenos con feedback: *${historial.length}*\n• Mínimo recomendado: *20*\n`;
  if (historial.length >= 20) msg += '• ✅ Muestra suficiente para aprendizaje fiable\n';
  else if (historial.length >= 10) msg += `• 🟡 Muestra parcial (${historial.length}/20) - Mejorable\n`;
  else msg += `• 🔴 Muestra insuficiente - Necesitas más datos\n`;
  msg += '\n*📈 PATRONES CONSISTENTES*\n';
  const tipos = Object.keys(stats.porTipo || {});
  let consistentes = 0, total = 0;
  tipos.forEach((tipo) => {
    const d = stats.porTipo[tipo];
    if (d.total >= 3) {
      total++;
      if (d.tasa >= 60) consistentes++;
      const emoji = d.tasa >= 80 ? '🟢' : d.tasa >= 60 ? '🟡' : '🔴';
      msg += `• ${emoji} ${tipo.toUpperCase()}: ${d.tasa}% éxito (${d.total} ent, ${d.tasa}% tasa)\n`;
    }
  });
  if (total === 0) msg += '• ⚠️ Aún no hay patrones claros. Sigue entrenando.\n';
  msg += '\n*🎯 RECOMENDACIONES CONFIABLES*\n';
  const recomendaciones = [];
  tipos.forEach((tipo) => {
    const d = stats.porTipo[tipo];
    if (d.total >= 5 && d.tasa >= 70) {
      recomendaciones.push(`${tipo.toUpperCase()} (${d.tasa}% éxito)`);
    }
  });
  if (recomendaciones.length > 0) {
    msg += `• ✅ ${recomendaciones.join(' | ')}\n   → Estos entrenos funcionan consistentemente bien contigo.\n`;
  } else {
    msg += `• ⚠️ Aún no hay recomendaciones con alta confianza.\n   → Necesitas más datos (${historial.length}/20).\n`;
  }
  msg += '\n*⚠️ QUÉ NO FUNCIONA (para evitar)*\n';
  const evitar = [];
  tipos.forEach((tipo) => {
    const d = stats.porTipo[tipo];
    if (d.total >= 3 && d.tasa < 50) {
      evitar.push(`${tipo.toUpperCase()} (${d.tasa}% éxito)`);
    }
  });
  if (evitar.length > 0) {
    msg += `• 🔴 ${evitar.join(' | ')}\n   → El sistema evitará recomendarte estos tipos.\n`;
  } else {
    msg += '• ✅ No hay patrones negativos claros.\n';
  }
  msg += '\n*💡 CONSEJO DEL SISTEMA*\n';
  if (historial.length < 5) {
    msg += '📊 Sigue entrenando y dando feedback con /analizar.\n   Necesito al menos 20 entrenos para aprender de verdad.\n';
  } else if (historial.length < 10) {
    msg += '📊 Buen comienzo. Necesito más datos para ser preciso.\n   Sigue con la consistencia y el feedback.\n';
  } else if (historial.length < 20) {
    msg += '📊 Estamos cerca. Sigue así, el sistema cada vez te conoce mejor.\n';
  } else {
    msg += '📊 ✅ El sistema te conoce. Las recomendaciones ya son fiables.\n   Sigue confiando en el feedback, ahora el sistema aprende contigo.\n';
  }
  await sendTelegramLong(msg);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO ZWO
// ═══════════════════════════════════════════════════════════════

async function cmdZwo() {
  const state = await getAthleteStateConAjuste();
  if (!state || !state.workout || state.workout.tipo === 'descanso') {
    await sendTelegram('⚠️ No hay entrenamiento activo o es día de descanso.');
    return;
  }
  const w = state.workout;
  let msg = '📄 *ARCHIVO ZWO PARA RODILLO*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  msg += `*Tipo:* ${w.tipo.toUpperCase()}\n`;
  msg += `*Estructura:* ${w.reps}x${w.durMin}min\n`;
  if (w.recSec > 0) msg += `*Recuperación:* ${w.recSec}s\n`;
  msg += `*Duración total:* ${w.duracionTotalMin}min\n`;
  msg += `*Cadencia recomendada:* ${w.cadenciaRecomendada || '80-90 rpm'}\n\n`;
  msg += '*📊 MÉTRICAS*\n';
  msg += `• TSS: ${w.tssEsperado}\n`;
  msg += `• IF: ${w.ifEsperado}\n`;
  msg += `• KJ: ${w.kjEsperados} kJ\n\n`;
  msg += '*💻 CÓDIGO ZWO*\n```\n';
  w.bloques.forEach(b => {
    const emoji2 = b.tipo === 'warmup' ? '🔥' : b.tipo === 'main' ? '⚡' : b.tipo === 'recovery' ? '💨' : '❄️';
    const cad = b.cadencia ? ` (${b.cadencia})` : '';
    msg += `${emoji2} ${b.nombre}: ${b.vatios.low}-${b.vatios.high}W${cad} (${b.duracionMin}min)\n`;
  });
  msg += '```\n';
  msg += '\n⚠️ *Ajusta los vatios según tu percepción.*';
  await sendTelegramLong(msg);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO GARMIN (CORREGIDO)
// ═══════════════════════════════════════════════════════════════

async function cmdGarmin() {
  const state = await getAthleteStateConAjuste();
  if (!state || !state.workout || state.workout.tipo === 'descanso') {
    await sendTelegram('⚠️ No hay entrenamiento activo o es día de descanso.');
    return;
  }
  const w = state.workout;
  const hoy = formatDate(new Date());
  const ftp = CONFIG.FTP || 240;

  // Formato que Intervals.icu puede parsear para generar la gráfica
  let descripcion = '';
  w.bloques.forEach(b => {
    const durMin = b.duracionMin;
    const wLow = b.vatios.low;
    const wHigh = b.vatios.high;
    if (b.tipo === 'warmup') {
      descripcion += `- Warmup ${durMin}m ${wLow}-${wHigh}w\n`;
    } else if (b.tipo === 'main') {
      descripcion += `- ${durMin}m ${wLow}-${wHigh}w\n`;
    } else if (b.tipo === 'recovery') {
      descripcion += `- ${durMin}m ${wLow}-${wHigh}w\n`;
    } else if (b.tipo === 'cooldown') {
      descripcion += `- Cooldown ${durMin}m ${wLow}-${wHigh}w\n`;
    }
  });
  descripcion += `\nGenerado por WorldTourCoach v9.5 | IF: ${w.ifEsperado} | TSS: ${w.tssEsperado} | Cadencia: ${w.cadenciaRecomendada || '80-90 rpm'}`;

  const steps = [];
  w.bloques.forEach(b => {
    const wAvg = Math.round((b.vatios.low + b.vatios.high) / 2);
    const duration = b.duracionMin * 60;
    
    let stepType = 'warmup';
    if (b.tipo === 'main') {
      stepType = 'steady_state';
    } else if (b.tipo === 'recovery') {
      stepType = 'recovery';
    } else if (b.tipo === 'cooldown') {
      stepType = 'cooldown';
    }
    
    steps.push({
      step_type: stepType,
      duration: duration,
      power: wAvg,
      name: b.nombre
    });
  });

  try {
    const payload = {
      category: 'WORKOUT',
      type: 'Ride',
      name: `AI-${w.tipo.toUpperCase()} ${w.reps}x${w.durMin}m`,
      start_date_local: hoy + 'T08:00:00',
      description: descripcion
    };
    
    console.log('[cmdGarmin] Enviando payload a Intervals.icu...');
    const response = await postIntervals('/events', payload);
    
    const msg = `*🚀 ¡ENTRENO ENVIADO A INTERVALS.ICU!*\n━━━━━━━━━━━━━━━━━━━━━━\n• *Título:* ${payload.name}\n• *Fecha:* ${hoy}\n• *Métricas:* IF ${w.ifEsperado} | TSS ${w.tssEsperado}\n• *Cadencia:* ${w.cadenciaRecomendada || '80-90 rpm'}\n\n_Subido correctamente a Intervals.icu. Desde allí se sincronizará con Garmin._`;
    await sendTelegram(msg);
    
  } catch (err) {
    console.log('[cmdGarmin] Error:', err);
    await sendTelegram(`❌ Error al subir a Intervals: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO EXPORTAR
// ═══════════════════════════════════════════════════════════════

async function cmdExportar() {
  await cargarHistorialCompleto();
  const historial = obtenerHistorial();
  if (historial.length === 0) {
    await sendTelegram('No hay datos para exportar.');
    return;
  }
  let msg = '📊 *EXPORTAR DATOS DEL SISTEMA*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  msg += `*📋 RESUMEN DE ${historial.length} ENTRENOS*\n\n`;
  const data = historial.slice(-10).map((h) => ({
    fecha: h.fecha,
    tipo: h.entreno.tipo,
    rpe: h.feedback.rpe,
    resultado: h.resultado,
    peso: h.peso || 1.0,
    contexto: h.contexto || {}
  }));
  msg += '*💾 DATOS COMPLETOS (JSON)*\n```\n' + JSON.stringify(data, null, 2) + '\n```\n';
  msg += '\n📱 *Usa /debug para ver más datos técnicos.*';
  await sendTelegramLong(msg);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO DENSIDAD
// ═══════════════════════════════════════════════════════════════

async function cmdDensidad() {
  await cargarHistorialCompleto();
  const historial = obtenerHistorial();
  if (historial.length < 3) {
    await sendTelegram('📊 *DENSIDAD DE CARGA*\n━━━━━━━━━━━━━━━━━━━━━━\n\nNecesito al menos 3 entrenos para calcular densidad.');
    return;
  }
  
  const ultimos = historial.slice(-10);
  let tssTotal = 0;
  let horasTotal = 0;
  
  ultimos.forEach(h => {
    tssTotal += h.entreno?.tss || 0;
    horasTotal += (h.entreno?.durMin || 0) / 60;
  });
  
  const densidad = horasTotal > 0 ? tssTotal / horasTotal : 0;
  const tssPorSemana = ultimos.length > 0 ? (tssTotal / ultimos.length) * 7 : 0;
  
  let msg = '📊 *DENSIDAD DE CARGA*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  msg += `*📈 DATOS (últimos ${ultimos.length} entrenos)*\n`;
  msg += `• TSS total: ${Math.round(tssTotal)}\n`;
  msg += `• Horas totales: ${horasTotal.toFixed(1)}h\n`;
  msg += `• Densidad: *${densidad.toFixed(1)} TSS/hora*\n\n`;
  
  msg += `*📊 INTERPRETACIÓN*\n`;
  if (densidad < 50) {
    msg += '• 🟢 Densidad baja - Entrenos de recuperación o base\n';
  } else if (densidad < 70) {
    msg += '• 🟡 Densidad moderada - Entrenos equilibrados\n';
  } else if (densidad < 90) {
    msg += '• 🟠 Densidad alta - Entrenos intensos\n';
  } else {
    msg += '• 🔴 Densidad muy alta - Riesgo de sobreentrenamiento\n';
  }
  
  msg += `\n*📅 PROYECCIÓN SEMANAL*\n`;
  msg += `• TSS estimado semanal: ${Math.round(tssPorSemana)}\n`;
  
  const fase = getFaseActual();
  const tssObj = getTssObjetivoSemanal();
  if (tssPorSemana > tssObj * 1.2) {
    msg += '• ⚠️ Carga semanal alta - Reduce intensidad\n';
  } else if (tssPorSemana < tssObj * 0.6) {
    msg += '• 📈 Carga semanal baja - Puedes aumentar\n';
  } else {
    msg += '• ✅ Carga semanal óptima\n';
  }
  
  await sendTelegramLong(msg);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO DEBUG
// ═══════════════════════════════════════════════════════════════

async function cmdDebug() {
  const state = await getAthleteStateConAjuste();
  if (!state) { await sendTelegram('Sin datos para debug.'); return; }
  let msg = '🔧 *DEBUG - DATOS TÉCNICOS*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  msg += '*📊 ESTADO*\n';
  msg += `• TSB: ${state.tsb.toFixed(1)}\n`;
  msg += `• CTL: ${state.estado.ctl.toFixed(1)}\n`;
  msg += `• ATL: ${state.estado.atl.toFixed(1)}\n`;
  msg += `• Readiness: ${state.readiness}/100\n`;
  msg += `• HRV: ${state.estado.hrv || 'N/D'}\n`;
  msg += `• Sueño: ${state.estado.sleepQuality}\n`;
  msg += `• ACWR: ${state.estado.acwr.toFixed(2)}\n`;
  msg += `• Temp: ${state.tempActual}°C (HI: ${state.heatIndex}°C)\n`;
  msg += '\n*📅 FASE*\n';
  msg += `• Fase: ${getFaseActual().toUpperCase()} (Semana ${getSemanaActual()}/${getSemanasFase()})\n`;
  msg += `• TSS objetivo: ${getTssObjetivoSemanal()}\n`;
  msg += `• Calidad: ${contarSesionesCalidadSemana()}/${getMaxSesionesCalidad()}\n`;
  msg += '\n*📈 SEMANA*\n';
  msg += `• TSS semanal: ${Math.round(state.estado.weeklyTss)}\n`;
  msg += `• Sesiones: ${state.estado.weeklySessions}\n`;
  msg += '\n*🚴 WORKOUT*\n';
  if (state.workout) {
    const w = state.workout;
    msg += `• Tipo: ${w.tipo.toUpperCase()}\n`;
    msg += `• Estructura: ${w.reps}x${w.durMin}min\n`;
    msg += `• IF: ${w.ifEsperado} | TSS: ${w.tssEsperado}\n`;
    msg += `• Vatios: ${w.vatios.low}-${w.vatios.high}W\n`;
    msg += `• Cadencia: ${w.cadenciaRecomendada || '80-90 rpm'}\n`;
    msg += `• Bloques: ${w.bloques.length}\n`;
  } else {
    msg += '• Workout: NO GENERADO\n';
  }
  msg += '\n*🔧 CONFIG*\n';
  msg += `• FTP: ${CONFIG.FTP}W\n`;
  msg += `• Peso: ${CONFIG.WEIGHT_KG}kg\n`;
  msg += `• Edad: ${CONFIG.AGE_YEARS} años\n`;
  msg += `• Objetivo: ${CONFIG.FTP_HISTORICO.valor}W\n`;
  msg += `• FTP estimado: ${state.ftpEstimado || CONFIG.FTP}W\n`;
  msg += '\n📱 *Versión: v9.5 (Periodización + Predicción + EF real)*';
  await sendTelegramLong(msg);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO CLIMA
// ═══════════════════════════════════════════════════════════════

async function cmdClima() {
  const state = await getAthleteStateConAjuste();
  if (!state) { await sendTelegram('Sin datos.'); return; }
  const weather = state.datos.weather;
  if (!weather || typeof weather !== 'object') {
    await sendTelegram('🌤️ *CLIMA - SIN DATOS*\n━━━━━━━━━━━━━━━━━━━━━━\nNo se pudo obtener información meteorológica.');
    return;
  }
  const temp = weather.temp || 'N/D';
  const wind = weather.wind || 0;
  const rain = weather.rain || 0;
  const desc = weather.description || 'Sin datos';
  const humidity = weather.humidity || 50;
  const tempNum = typeof temp === 'number' ? temp : 25;
  const heatIndex = calcularHeatIndex(tempNum, humidity);
  const aclimatado = estaAclimatado();

  let msg = '*🌤️ CLIMA + FACTOR DE AJUSTE*\n━━━━━━━━━━━━━━━━━━━━━━\n';
  msg += `📍 ${CONFIG.CITY}\n`;
  msg += `🌡️ ${temp}°C (Heat Index ${heatIndex}°C)\n`;
  msg += `💨 Viento: ${wind} km/h\n`;
  msg += `💧 Humedad: ${humidity}%\n`;
  msg += `🌧️ Lluvia: ${rain} mm\n`;
  msg += `☁️ ${desc}\n`;
  msg += `📊 TSB: ${state.tsb.toFixed(1)}\n`;
  msg += `🌡️ Aclimatación: ${aclimatado ? '✅ Aclimatado' : `🟡 ${getDiasAclimatados()}/${CONFIG.CLIMA.diasAclimatacion} días`}\n\n`;

  let recomendacion = '', hidratacion = '';
  if (heatIndex > 40) {
    recomendacion = '🔴 *CALOR EXTREMO* - Descanso obligatorio por seguridad';
    hidratacion = '💧 1L/hora + electrolitos obligatorios';
  } else if (heatIndex > 38) {
    recomendacion = `🟠 *CALOR MUY ALTO* - Reduce duración ${aclimatado ? '15%' : '20%'} e intensidad 5%`;
    hidratacion = '💧 1L/hora + electrolitos';
  } else if (heatIndex > 35) {
    recomendacion = `🟡 *CALOR ALTO* - Reduce duración ${aclimatado ? '10%' : '15%'} e intensidad 3%`;
    hidratacion = '💧 1L/hora + electrolitos';
  } else if (heatIndex > 32) {
    recomendacion = `🟡 *CALOR MODERADO* - Reduce duración ${aclimatado ? '5%' : '10%'}`;
    hidratacion = '💧 750ml/hora + electrolitos';
  } else if (heatIndex > 28) {
    recomendacion = `🟢 *CALOR LIGERO* - ${aclimatado ? 'Sin ajustes' : 'Reduce duración 5%'}`;
    hidratacion = '💧 750ml/hora';
  } else if (heatIndex < 5) {
    recomendacion = '❄️ *FRÍO* - Reduce duración 10%\n→ Protege extremidades';
    hidratacion = '💧 500ml/hora';
  } else {
    recomendacion = '✅ *TEMPERATURA IDEAL* - Sin ajustes';
    hidratacion = '💧 500ml/hora';
  }
  
  if (aclimatado && heatIndex > 28) {
    recomendacion += '\n✅ *Beneficio:* Estás aclimatado al calor, tu cuerpo responde mejor.';
  }

  msg += '*📊 FACTOR CLIMA APLICADO*\n' + recomendacion + '\n\n' + hidratacion + '\n\n';
  msg += '📱 *Comandos:* /plan | /ajuste | /hoy';
  await sendTelegramLong(msg);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO NUTRICION
// ═══════════════════════════════════════════════════════════════

async function cmdNutricion() {
  const state = await getAthleteStateConAjuste();
  if (!state) { await sendTelegram('Sin datos.'); return; }
  const n = state.nutricion;
  const workout = state.workout;
  const kj = workout?.kjEsperados || 0;

  let msg = '*🥗 NUTRICIÓN AVANZADA + RECETAS*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  
  // ─── SECCIÓN 1: MÉTRICAS DE DESGASTE ─────────────────────────
  if (workout && workout.tipo !== 'descanso') {
    msg += '*📊 MÉTRICAS DE DESGASTE*\n';
    msg += `• Entreno: ${workout.tipo.toUpperCase()}\n`;
    msg += `• KJ: *${kj} kJ* (${Math.round(kj * 0.239)} kcal)\n`;
    msg += `• CH oxidados: *${workout.carbsEsperados}g*\n`;
    msg += `• TSS: ${workout.tssEsperado} | IF: ${workout.ifEsperado}\n\n`;
  } else {
    msg += '*🧘 DÍA DE REPOSO*\n';
    msg += '• Enfoque: Mantenimiento y recuperación\n';
    msg += `• Gasto estimado: ~${n.kcalGastoTotal} kcal\n\n`;
  }

  // ─── SECCIÓN 2: BALANCE ENERGÉTICO ──────────────────────────
  msg += '*🔥 BALANCE ENERGÉTICO*\n';
  msg += `• Gasto total día: ~*${n.kcalGastoTotal} kcal*\n`;
  if (n.haceCalor && n.heatIndex > 30) {
    msg += `• 🌡️ Calor (HI ${n.heatIndex}°C): +${Math.round(CONFIG.WEIGHT_KG * 0.5 * 0.22 * 4.184)} kcal extra\n`;
  }
  msg += '\n';

  // ─── SECCIÓN 3: OBJETIVOS MACRO DIARIOS ──────────────────────
  msg += '*📊 OBJETIVOS MACRO DIARIOS*\n';
  if (n.fase) msg += `• 📅 Estrategia: ${n.estrategiaCH || 'Carga completa'} (Fase: ${n.fase})\n`;
  msg += `• 🍞 Carbohidratos: *${n.chTotalDia}g*\n`;
  msg += `  → Inmediato post-entreno: ${n.chInmediato}g\n`;
  if (n.chDuranteEntreno > 0) msg += `  → Durante entreno: ${n.chDuranteEntreno}g\n`;
  msg += `  → Resto del día: ${n.chCena}g\n`;
  msg += `• 🍗 Proteína: *${n.protTotalDia}g* (${n.protPost || CONFIG.NUTRICION.proteinaPostMaster}g post-entreno)\n`;
  msg += `• 🥑 Grasas: *${n.grasaDiaria}g*\n\n`;

  // ─── SECCIÓN 4: SUPLEMENTACIÓN ───────────────────────────────
  if (n.suplementacion && n.suplementacion.length > 0) {
    msg += '*💊 SUPLEMENTACIÓN*\n';
    n.suplementacion.forEach(s => msg += `• ${s}\n`);
    msg += '\n';
  }

  // ─── SECCIÓN 5: TIMING POST-ENTRENO ──────────────────────────
  if (workout && workout.tipo !== 'descanso') {
    if (n.recomendacionDurante) {
      msg += '*🚴 DURANTE EL ENTRENO*\n';
      msg += `• ${n.recomendacionDurante}\n\n`;
    }
    msg += '*⏳ TIMING POST-ENTRENO (VENTANA ANABÓLICA)*\n';
    msg += `🥤 *0-30 min:* ${n.chInmediato}g CH + ${CONFIG.NUTRICION.proteinaPostMaster}g Proteína\n`;
    msg += `   Ej: Batido recuperador (plátano + leche + suero)\n\n`;
    msg += `🍽️ *1-2h:* ${n.chCena}g CH + 40g Proteína\n`;
    msg += `   Ej: Arroz/pasta + pollo/atún + verduras\n\n`;
  }

  // ─── SECCIÓN 6: HIDRATACIÓN Y ELECTROLITOS ───────────────────
  msg += '*💧 HIDRATACIÓN*\n';
  msg += `• ${n.hidratacion}\n`;
  if (n.sodioMg) {
    msg += `• 🧂 Sodio: ${n.sodioMg}mg/hora (${(n.sodioMg/1000*0.4).toFixed(1)}g sal)\n`;
  }
  msg += '\n';

  // ─── SECCIÓN 7: RECETAS PERSONALIZADAS POR GASTO KJ ─────────
  msg += '🍳 *RECETAS SEGÚN GASTO ENERGÉTICO*\n';
  msg += '━━━━━━━━━━━━━━━━━━━━━━\n\n';

  if (workout && workout.tipo !== 'descanso') {
    // RECETA 1: Inmediata post-entreno
    msg += '*🥤 RECUPERACIÓN INMEDIATA (0-30 min)*\n';
    msg += `Objetivo: ${n.chInmediato}g CH + ${CONFIG.NUTRICION.proteinaPostMaster}g Proteína\n\n`;
    msg += '*Opción A - Batido:*\n';
    msg += `• 300ml leche/agua + ${CONFIG.NUTRICION.proteinaPostMaster}g suero\n`;
    msg += `• 1 plátano (${Math.round(100/4)}g CH)\n`;
    msg += `• 1 cucharada miel (${Math.round(20/4)}g CH)\n`;
    msg += `• Hielo al gusto\n\n`;
    msg += '*Opción B - Snack sólido:*\n';
    msg += '• 2 rebanadas pan integral + mermelada sin azúcar\n';
    msg += '• 1 yogur griego natural\n';
    msg += '• 1 puñado frutos secos (25g)\n\n';

    // RECETA 2: Comida principal (1-2h después)
    msg += '*🍽️ COMIDA PRINCIPAL (1-2h después)*\n';
    msg += `Objetivo: ${n.chCena}g CH + 40g Proteína + verduras\n\n`;
    
    if (kj > 1200) {
      // Entreno muy intenso
      msg += '*Alto gasto (>1200 kJ) - Recuperación máxima:*\n';
      msg += '• 200g arroz integral o pasta (80g CH)\n';
      msg += '• 200g pechuga pollo/salmón (40g Proteína)\n';
      msg += '• Brócoli + zanahoria al vapor\n';
      msg += '• 1 cucharada aceite oliva\n';
      msg += '• 1 fruta de postre\n\n';
    } else if (kj > 800) {
      // Entreno moderado-alto
      msg += '*Gasto alto (800-1200 kJ) - Recuperación completa:*\n';
      msg += '• 150g arroz integral o quinoa (60g CH)\n';
      msg += '• 180g pechuga pollo/atún (35g Proteína)\n';
      msg += '• Ensalada: tomate, lechuga, aceitunas\n';
      msg += '• 1 cucharada aceite oliva\n\n';
    } else if (kj > 500) {
      // Entreno moderado
      msg += '*Gasto moderado (500-800 kJ) - Recuperación estándar:*\n';
      msg += '• 120g patata/arroz (50g CH)\n';
      msg += '• 150g pescado/pollo (30g Proteína)\n';
      msg += '• Verduras al vapor o ensalada\n';
      msg += '• 1 yogur griego\n\n';
    } else {
      // Entreno ligero
      msg += '*Gasto ligero (<500 kJ) - Mantenimiento:*\n';
      msg += '• 100g arroz/pasta (40g CH)\n';
      msg += '• 120g pescado blanco/clara huevo (25g Proteína)\n';
      msg += '• Ensalada variada\n';
      msg += '• 1 fruta\n\n';
    }

    // RECETA 3: Snacks
    msg += '*🍎 SNACKS INTERMEDIOS (cada 3-4h)*\n';
    msg += '• 1 puñado frutos secos (25g) + 1 fruta\n';
    msg += '• 1 yogur griego + 1 cucharada avena\n';
    msg += '• 1 tostada pan integral + queso fresco\n\n';
  } else {
    // Día de descanso
    msg += '*🧘 DÍA DE DESCANSO - Mantenimiento*\n\n';
    msg += '*Desayuno:*\n';
    msg += '• Avena (50g) + leche + 1 fruta + café\n\n';
    msg += '*Comida:*\n';
    msg += '• 120g arroz/pasta + 150g legumbres/pescado\n';
    msg += '• Verduras + aceite oliva\n\n';
    msg += '*Cena:*\n';
    msg += '• Ensalada completa + 100g queso fresco/tempeh\n';
    msg += '• 1 pieza fruta\n\n';
  }

  // ─── SECCIÓN 8: CONSEJOS ESPECÍFICOS ─────────────────────────
  msg += '💡 *CONSEJOS NUTRICIONALES*\n';
  if (n.haceCalor && n.heatIndex > 35) {
    msg += '• 🔴 Prioriza comidas frías y ligeras\n';
    msg += '• Añade sal a las comidas para reponer electrolitos\n';
    msg += '• Evita comidas pesadas o muy calóricas\n';
  } else if (n.haceCalor && n.heatIndex > 30) {
    msg += '• 🟡 Prefiere comidas con alto contenido en agua\n';
    msg += '• Hidratación constante, no esperes a tener sed\n';
    msg += '• Frutas como sandía, naranja, melón\n';
  } else if (CONFIG.AGE_YEARS > 40) {
    msg += '• 🧠 Master 40+: Prioriza proteína en cada comida\n';
    msg += '• Omega-3 diario (3g) para recuperación articular\n';
    msg += '• Vitamina D (2000 UI) si hay poco sol\n';
  } else {
    msg += '• Come cada 3-4 horas para mantener energía\n';
    msg += '• Prioriza alimentos integrales y proteína magra\n';
  }
  // ─── SECCIÓN 9: CONSEJOS EXTRA POR FASE ──────────────────────
  if (n.consejosExtra && n.consejosExtra.length > 0) {
    msg += '\n🎯 *CONSEJOS ESPECÍFICOS POR FASE*\n';
    n.consejosExtra.forEach(consejo => { msg += `• ${consejo}\n`; });
    msg += '\n';
  }

  msg += `\n_📊 Edad: ${CONFIG.AGE_YEARS} años | Peso: ${CONFIG.WEIGHT_KG}kg | Fase: ${getNombreFase()}_`;
  await sendTelegramLong(msg);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO FUERZA
// ═══════════════════════════════════════════════════════════════

async function cmdFuerza() {
  const state = await getAthleteStateConAjuste();
  if (!state) { await sendTelegram('Sin datos.'); return; }
  const f = state.fuerza;
  let msg = '🏋️ *RUTINA DE FUERZA*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  msg += `*📊 ESTADO:* TSB ${state.tsb.toFixed(1)} | Readiness ${state.readiness}/100\n`;
  msg += `*📅 FASE DE FUERZA:* ${f.faseFuerza || 'Básica'} (Semana ${f.semanaFuerza || 1})\n`;
  msg += `*🎯 NIVEL:* ${f.nivel} (${f.duracion})\n\n`;
  if (!f.recomendado) msg += '⚠️ *NO recomendada hoy.* Haz solo movilidad y estiramientos.\n\n';
  msg += '*💪 EJERCICIOS*\n';
  f.ejercicios.forEach((ej, idx) => { msg += `${idx+1}. ${ej}\n`; });
  msg += `\n💡 *Consejo:* ${f.recomendacion}\n`;
  if (state.haceCalor && state.heatIndex > 30) {
    msg += '\n🌡️ *Con calor, alarga descansos y hidrata entre series.*\n';
  }
  
  if (f.movilidadBase && f.movilidadBase.length > 0) {
    msg += '\n*🧘 MOVILIDAD DIARIA OBLIGATORIA*\n';
    f.movilidadBase.forEach((ej, idx) => { msg += `${idx+1}. ${ej}\n`; });
  }
  
  if (f.prevencion && f.prevencion.length > 0) {
    msg += '\n*🛡️ PREVENCIÓN DE LESIONES*\n';
    f.prevencion.forEach((ej, idx) => { msg += `${idx+1}. ${ej}\n`; });
  }
  
  msg += '\n📱 *Comandos:* /hoy | /plan | /estado | /movilidad';
  await sendTelegramLong(msg);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO MOVILIDAD
// ═══════════════════════════════════════════════════════════════

async function cmdMovilidad() {
  const state = await getAthleteStateConAjuste();
  if (!state) { await sendTelegram('Sin datos.'); return; }
  const f = state.fuerza;
  
  let msg = '🧘 *RUTINA DE MOVILIDAD DIARIA*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  msg += '*📋 EJERCICIOS OBLIGATORIOS (15 min)*\n\n';
  
  if (f.movilidadBase && f.movilidadBase.length > 0) {
    f.movilidadBase.forEach((ej, idx) => {
      msg += `${idx+1}. ${ej}\n`;
    });
  } else {
    msg += '1. 🦵 Estiramiento isquios: 3x30"\n';
    msg += '2. 🦵 Estiramiento psoas: 3x30" c/lado\n';
    msg += '3. 🔄 Movilidad cadera: 3x15 c/lado\n';
    msg += '4. 🔄 Rotaciones cervicales y dorsales\n';
    msg += '5. 🧘 Foam rolling: 5 min (isquios, glúteos, dorsales)\n';
  }
  
  msg += '\n*💡 RECOMENDACIONES*\n';
  msg += '• Haz esto TODOS los días, incluso en días de descanso\n';
  msg += '• Ideal: por la mañana al despertar o antes de entrenar\n';
  msg += '• Si sientes dolor agudo, para y consulta a un profesional\n';
  
  await sendTelegramLong(msg);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO PLAN
// ═══════════════════════════════════════════════════════════════

async function cmdPlan() {
  const state = await getAthleteStateConAjuste();
  if (!state) { await sendTelegram('Sin datos.'); return; }
  const workout = state.workout;
  let msg = '*🧠 PLAN DEL DÍA (v9.5)*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  
  msg += `*📅 FASE:* ${getNombreFase()} (Semana ${getSemanaActual()}/${getSemanasFase()})\n`;
  msg += `• TSS objetivo semanal: ${getTssObjetivoSemanal()} | Actual: ${Math.round(state.estado.weeklyTss)}\n`;
  msg += `• Calidad semanal: ${contarSesionesCalidadSemana()}/${getMaxSesionesCalidad()}\n\n`;
  
  msg += '*📊 ESTADO*\n';
  msg += `• TSB: ${state.tsb.toFixed(1)} | Readiness: ${state.readiness}/100\n`;
  msg += `• Sueño: ${state.estado.sleepQuality === 1 ? '⚠️ Malo' : state.estado.sleepQuality === 2 ? '🟡 Regular' : '🟢 Bueno'}\n`;
  msg += `• TSS semanal: ${Math.round(state.estado.weeklyTss)} / ${state.restricciones.tssMaxSemanal}\n`;
  if (state.haceCalor) msg += `• 🌡️ ${state.tempActual}°C (HI: ${state.heatIndex}°C)\n`;
  msg += '\n';
  
  if (state.horasRecuperacion) {
    msg += `*⏰ RECUPERACIÓN:* ${state.horasRecuperacion}h | Próximo entreno: ${state.proximoEntreno}\n\n`;
  }

  if (state.restricciones.motivo && state.restricciones.motivo.length > 0) {
    msg += '*🔒 RESTRICCIONES*\n';
    state.restricciones.motivo.forEach((m) => { msg += `• ${m}\n`; });
    msg += '\n';
  }

  if (workout.tipo === 'descanso') {
    msg += '*🧘 DESCANSO TOTAL*\n';
    msg += `Motivo: ${workout.motivo}\n\n`;
    msg += '💡 *Recomendación:* Movilidad 15\' y foam rolling.';
  } else {
    msg += '*🚴 ENTRENO*\n';
    msg += `• Tipo: *${workout.tipo.toUpperCase()}*\n`;
    if (workout.reps > 0) {
      msg += `• Estructura: *${workout.reps}x${workout.durMin} min*\n`;
      if (workout.recSec > 0) msg += `• Recuperación: *${workout.recSec} seg*\n`;
    } else {
      msg += `• Duración: *${workout.durMin} min*\n`;
    }
    msg += `• Vatios: *${workout.vatios.low}-${workout.vatios.high}W*\n`;
    msg += `• Intensidad: ${(workout.intensidadFTP * 100).toFixed(0)}% FTP\n`;
    msg += `• Cadencia: ${workout.cadenciaRecomendada || '80-90 rpm'}\n`;
    msg += `• Prioridad: *${(workout.prioridad || 'base').replace('_', ' ').toUpperCase()}*\n`;
    if (workout.notaHidratacion) msg += `• ${workout.notaHidratacion}\n`;
    msg += '\n';

    if (workout.bloques && workout.bloques.length > 0) {
      msg += '*📋 ESTRUCTURA DETALLADA*\n';
      workout.bloques.forEach(bloque => {
        const emoji2 = bloque.tipo === 'warmup' ? '🔥' : bloque.tipo === 'main' ? '⚡' : bloque.tipo === 'recovery' ? '💨' : '❄️';
        const cad = bloque.cadencia ? ` (${bloque.cadencia})` : '';
        msg += `• ${emoji2} ${bloque.nombre}: ${bloque.vatios.low}-${bloque.vatios.high}W${cad} (${bloque.duracionMin}min)\n`;
      });
    }

    msg += '\n';
    if (workout.tssEsperado) {
      msg += '*📈 MÉTRICAS*\n';
      msg += `• TSS: *${workout.tssEsperado}*\n`;
      msg += `• IF: *${workout.ifEsperado}*\n`;
      msg += `• KJ: *${workout.kjEsperados} kJ*\n`;
      msg += `• CH: *${workout.carbsEsperados}g*\n\n`;
    }
  }

  if (state.aprendizaje && state.aprendizaje.probabilidad && workout.tipo !== 'descanso') {
    const p = state.aprendizaje.probabilidad;
    msg += `*📊 PROBABILIDAD DE ÉXITO*\n• ${p.nivel} (${p.probabilidad}%)\n\n`;
  }

  if (state.traza && state.traza.reglasActivadas && state.traza.reglasActivadas.length > 0) {
    msg += '*🧠 DECISIÓN EXPLICADA*\n';
    state.traza.reglasActivadas.slice(0, 3).forEach((r) => {
      msg += `• ${r.nivel}: ${r.regla} → ${r.accion}\n`;
    });
    msg += '\n';
  }

  msg += '📱 *Comandos:* /zwo | /garmin | /clima | /nutricion | /traza';
  await sendTelegramLong(msg);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO ESTADO
// ═══════════════════════════════════════════════════════════════

async function cmdEstado() {
  const state = await getAthleteStateConAjuste();
  if (!state) { await sendTelegram('Sin datos.'); return; }
  let msg = '*📊 ESTADO COMPLETO v9.5*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  msg += '*💪 MÉTRICAS DE CARGA*\n';
  msg += `• CTL: ${state.estado.ctl.toFixed(1)}\n`;
  msg += `• ATL: ${state.estado.atl.toFixed(1)}\n`;
  msg += `• TSB: *${state.tsb.toFixed(1)}* ${state.tsb > 0 ? '🟢' : state.tsb > -10 ? '🟡' : '🔴'}\n`;
  msg += `• Readiness: *${state.readiness}/100* ${state.readiness > 70 ? '🟢' : state.readiness > 50 ? '🟡' : '🔴'}\n\n`;
  msg += '*😴 RECUPERACIÓN*\n';
  msg += `• HRV: ${state.estado.hrv || 'N/D'}\n`;
  msg += `• Sueño: ${state.estado.sleepQuality === 1 ? '⚠️ Malo' : state.estado.sleepQuality === 2 ? '🟡 Regular' : '🟢 Bueno'}\n`;
  msg += `• Pasos: ${state.estado.pasos.toLocaleString()}\n`;
  if (state.horasRecuperacion) {
    msg += `• ⏰ Recuperación: ${state.horasRecuperacion}h\n`;
  }
  msg += '\n*📈 CARGA SEMANAL*\n';
  msg += `• TSS: ${Math.round(state.estado.weeklyTss)} / ${state.restricciones.tssMaxSemanal}\n`;
  msg += `• Sesiones: ${state.estado.weeklySessions}\n`;
  msg += `• ACWR: ${state.estado.acwr.toFixed(2)}${state.estado.acwr > 1.3 ? ' ⚠️ ALTO' : ' ✅ OK'}\n\n`;
  
  msg += `*📅 FASE:* ${getNombreFase()} (Semana ${getSemanaActual()}/${getSemanasFase()})\n`;
  msg += `• Calidad semanal: ${contarSesionesCalidadSemana()}/${getMaxSesionesCalidad()}\n\n`;

  if (state.haceCalor) {
    msg += '*🌡️ CLIMA*\n';
    msg += `• ${state.tempActual}°C (Heat Index ${state.heatIndex}°C)\n`;
    msg += `• Aclimatación: ${estaAclimatado() ? '✅ Aclimatado' : `${getDiasAclimatados()}/${CONFIG.CLIMA.diasAclimatacion} días`}\n\n`;
  }
  
  msg += `*🚴 FTP ESTIMADO:* ${state.ftpEstimado || CONFIG.FTP}W\n`;
  if (state.proyeccion && !state.proyeccion.alcanzado) {
    msg += `• ${state.proyeccion.mensaje}\n`;
  }
  
  await sendTelegramLong(msg);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO CONSEJO
// ═══════════════════════════════════════════════════════════════

async function cmdConsejo() {
  const state = await getAthleteStateConAjuste();
  if (!state) { await sendTelegram('Sin datos.'); return; }
  let msg = '🧠 *CONSEJO DEL DÍA*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  state.consejo.forEach((c) => { msg += `${c}\n\n`; });
  msg += '📱 *Comandos:* /hoy | /plan | /estado';
  await sendTelegramLong(msg);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO RESUMEN
// ═══════════════════════════════════════════════════════════════

async function cmdResumen() {
  const state = await getAthleteStateConAjuste();
  if (!state) { await sendTelegram('Sin datos.'); return; }
  let msg = '📋 *RESUMEN EJECUTIVO*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  const emoji = state.tsb > 0 ? '🟢' : state.tsb > -10 ? '🟡' : '🔴';
  msg += `*📊 ESTADO:* ${emoji} TSB ${state.tsb.toFixed(1)} | Readiness ${state.readiness}/100\n`;
  msg += `*😴 SUEÑO:* ${state.estado.sleepQuality === 1 ? 'Malo' : state.estado.sleepQuality === 2 ? 'Regular' : 'Bueno'}\n`;
  msg += `*🌡️ CLIMA:* ${state.tempActual}°C (HI: ${state.heatIndex}°C)${state.haceCalor ? ' 🔥' : ''}\n`;
  msg += `*📅 FASE:* ${getNombreFase()} (Semana ${getSemanaActual()})\n`;
  
  if (state.workout && state.workout.tipo === 'descanso') msg += '*🧘 PLAN:* DESCANSO TOTAL\n';
  else if (state.decision.tipo === 'descanso') msg += '*🧘 PLAN:* DESCANSO TOTAL\n';
  else {
    const w = state.workout || state.entreno;
    msg += '*🚴 PLAN:* ' + (w.tipo || w.tipo || '').toUpperCase();
    if (w.reps > 0) msg += ` ${w.reps}x${w.durMin}min`;
    else if (w.durMin) msg += ` ${w.durMin}min`;
    msg += ` | Cadencia: ${w.cadenciaRecomendada || '80-90 rpm'}\n`;
  }
  
  if (state.ftpEstimado) {
    msg += `*🚴 FTP estimado:* ${state.ftpEstimado}W\n`;
  }
  
  if (state.aprendizaje && state.aprendizaje.probabilidad && state.decision.tipo !== 'descanso') {
    const p = state.aprendizaje.probabilidad;
    msg += `\n📊 *Probabilidad de éxito:* ${p.nivel} (${p.probabilidad}%)\n`;
  }
  
  if (state.horasRecuperacion) {
    msg += `\n⏰ *Recuperación:* ${state.horasRecuperacion}h`;
  }
  
  msg += '\n\n📱 *Comandos:* /hoy | /plan | /estado | /clima';
  await sendTelegramLong(msg);
}

// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO AJUSTE
// ═══════════════════════════════════════════════════════════════

async function cmdAjuste() {
  await sendTelegram('🌡️ *FACTOR CLIMA APLICADO*\n━━━━━━━━━━━━━━━━━━━━━━\n\nUsa /clima para ver el factor de ajuste completo.');
}
// ═══════════════════════════════════════════════════════════════
// 📋 COMANDO SYNC - Sincronizar con Supabase + CEREBRO
// ═══════════════════════════════════════════════════════════════

async function cmdSync() {
  try {
    await sendTelegram('🔄 *SINCRONIZANDO CON SUPABASE...*\n━━━━━━━━━━━━━━━━━━━━━━\n\nCargando actividades de Intervals.icu...');
    
    const resultado = await sincronizarActividadesSupabase(10);
    
    if (resultado.sincronizado) {
      // Obtener actividades guardadas de Supabase (tabla correcta: actividades_guardadas)
      const { count, error: errAct } = await supabase
        .from('actividades_guardadas')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', CONFIG.CHAT_ID || 'default');
      const totalActividades = errAct ? 0 : (count || 0);
      
      // ─── CEREBRO: ANALIZAR CUMPLIMIENTO DEL PLAN ─────────────────
      const analisis = await analizarCumplimientoPlan();
      
      let msg = `✅ *SINCRONIZACIÓN COMPLETADA*\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      msg += `📊 *Actividades sincronizadas:* ${resultado.total}\n`;
      msg += `📋 *Total en BD:* ${totalActividades} actividades\n\n`;
      
      if (analisis.tieneDesviaciones) {
        msg += `🧠 *ANÁLISIS INTELIGENTE*\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        msg += `📊 *Cumplimiento del plan:* ${analisis.porcentajeCumplimiento}%\n\n`;
        
        if (analisis.desviaciones.length > 0) {
          msg += `⚠️ *DESVIACIONES DETECTADAS:*\n`;
          analisis.desviaciones.forEach((desv, idx) => {
            msg += `\n${idx + 1}. ${desv.fecha}\n`;
            msg += `   • Plan: ${desv.planTipo.toUpperCase()}\n`;
            msg += `   • Realizado: ${desv.realTipo.toUpperCase()}\n`;
            msg += `   • Diferencia TSS: ${desv.diferenciaTSS > 0 ? '+' : ''}${desv.diferenciaTSS}\n`;
            msg += `   • ${desv.motivo}\n`;
          });
          msg += '\n';
        }
        
        msg += `💡 *RECOMENDACIÓN DEL SISTEMA:*\n`;
        msg += `${analisis.recomendacion}\n\n`;
        
        // Preguntar al usuario sobre las desviaciones
        if (analisis.desviaciones.length > 0) {
          msg += `❓ *AYÚDAME A ENTENDER:*\n`;
          msg += `Responde con el número de la desviación y el motivo:\n`;
          msg += `1. Salida en grupeta\n`;
          msg += `2. Cambié el entreno por otro\n`;
          msg += `3. No pude cumplir el plan\n`;
          msg += `4. Otro motivo\n\n`;
          msg += `Ejemplo: "1 grupeta" o "2 preferí hacer FTP"`;
        }
      } else {
        msg += `🎯 *¡PERFECTO!*\n`;
        msg += `Estás cumpliendo al 100% con el plan.\n`;
        msg += `Sigue así, vas por muy buen camino. 🚴\n\n`;
      }
      
      msg += `\n🔄 Los datos ahora son persistentes.\n\n`;
      msg += `💡 *Usa /historial para ver tus entrenos guardados.*`;
      
      await sendTelegramLong(msg);
      
      // Guardar estado de análisis para procesar respuesta
      if (analisis.tieneDesviaciones && analisis.desviaciones.length > 0) {
        setProperty('analisis_desviaciones', JSON.stringify(analisis));
        setUserProperty('esperando_respuesta_desviacion', 'true');
      }
    } else {
      await sendTelegram(`❌ Error al sincronizar: ${resultado.error || 'Desconocido'}`);
    }
  } catch (err) {
    console.log('[cmdSync] ERROR:', err);
    await sendTelegram(`❌ Error: ${err.message}`);
  }
}

// ─── PREDICCIÓN DE DESVIACIONES ────────────────────────────────
function predecirDesviaciones(decision) {
  try {
    const historial = obtenerHistorial();
    if (historial.length < 5) return null;
    
    const tipo = decision.tipo || 'z2';
    const diaSemana = new Date().getDay();
    const diasSemana = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const hoy = diasSemana[diaSemana];
    
    // Buscar entrenamientos similares en el historial
    const similares = historial.filter(h => {
      return h.entreno?.tipo === tipo && (h.resultado || 0) < 60;
    });
    
    if (similares.length < 2) return null;
    
    // Calcular probabilidad de desviación
    const totalTipo = historial.filter(h => h.entreno?.tipo === tipo).length;
    const probabilidad = totalTipo > 0 ? Math.round((similares.length / totalTipo) * 100) : 0;
    
    if (probabilidad < 40) return null;
    
    // Analizar motivos de desviaciones anteriores
    const aprendizajes = getProperty('aprendizaje_desviaciones');
    const listaAprendizajes = aprendizajes ? JSON.parse(aprendizajes) : [];
    const desviacionesTipo = listaAprendizajes.filter(a => a.desviacion?.planTipo === tipo);
    
    let motivoComun = '';
    if (desviacionesTipo.length > 0) {
      const categorias = {};
      desviacionesTipo.forEach(d => {
        const cat = d.categoria || 'otro';
        categorias[cat] = (categorias[cat] || 0) + 1;
      });
      const categoriaMasComun = Object.keys(categorias).sort((a, b) => 
        (categorias[b] || 0) - (categorias[a] || 0)
      )[0];
      
      if (categoriaMasComun === 'grupeta') {
        motivoComun = 'Históricamente cambias este entreno por salidas en grupo';
      } else if (categoriaMasComun === 'imposibilidad') {
        motivoComun = 'No has podido cumplir este tipo de entreno anteriormente';
      }
    }
    
    return {
      probabilidad: probabilidad,
      motivo: motivoComun,
      sugerencia: `⚠️ Históricamente, los entrenamientos de ${tipo.toUpperCase()} los cambias el ${probabilidad}% de las veces. ${motivoComun}`
    };
  } catch (err) {
    console.log('[predecirDesviaciones] ERROR:', err);
    return null;
  }
}

// ─── ALERTAS INTELIGENTES EN TIEMPO REAL ───────────────────────
async function verificarDesviacionTiempoReal(activityId) {
  try {
    // Obtener la actividad
    const activity = await fetchIntervalsActivity(activityId);
    if (!activity) return null;
    
    const tss = safeNum(activity.icu_training_load, 0);
    const np = safeNum(activity.icu_weighted_avg_watts, 0);
    const fecha = new Date(activity.start_date_local || activity.start_date);
    const fechaStr = formatDate(fecha);
    
    // Buscar el plan de ese día
    const historial = obtenerHistorial();
    const planDia = historial.find(h => {
      const fechaHist = new Date(h.fecha);
      return formatDate(fechaHist) === fechaStr && h.entreno?.tipo;
    });
    
    if (!planDia || !planDia.entreno) return null;
    
    // Comparar con el plan
    const planTipo = planDia.entreno.tipo;
    const planTSS = planDia.entreno.tss || 0;
    
    let realTipo = 'z2';
    if (np > 0 && CONFIG.FTP > 0) {
      const ifCalc = np / CONFIG.FTP;
      if (ifCalc > 1.05) realTipo = 'vo2';
      else if (ifCalc > 0.95) realTipo = 'ftp';
      else if (ifCalc > 0.87) realTipo = 'sweetspot';
      else if (ifCalc > 0.75) realTipo = 'tempo';
    }
    
    const diferenciaTSS = tss - planTSS;
    const desviacionTSS = Math.abs(diferenciaTSS) > (planTSS * 0.3);
    const desviacionTipo = planTipo !== realTipo && planTipo !== 'z2';
    
    if (desviacionTSS || desviacionTipo) {
      let motivo = '';
      if (desviacionTSS && diferenciaTSS > 0) {
        motivo = `Hiciste ${Math.round(diferenciaTSS)} TSS más de lo planeado`;
      } else if (desviacionTSS && diferenciaTSS < 0) {
        motivo = `Hiciste ${Math.round(Math.abs(diferenciaTSS))} TSS menos de lo planeado`;
      }
      
      if (desviacionTipo) {
        motivo += ` | Tipo diferente: esperado ${planTipo.toUpperCase()}, realizado ${realTipo.toUpperCase()}`;
      }
      
      return {
        fecha: fecha.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }),
        planTipo: planTipo,
        realTipo: realTipo,
        diferenciaTSS: diferenciaTSS,
        motivo: motivo
      };
    }
    
    return null;
  } catch (err) {
    console.log('[verificarDesviacionTiempoReal] ERROR:', err);
    return null;
  }
}

// ─── ANÁLISIS DE PATRONES TEMPORALES (MEJORADO) ───────────────
function analizarPatronesTemporales() {
  try {
    const historial = obtenerHistorial();
    if (historial.length < 10) return null;
    
    const patrones = {
      diaSemana: {},
      hora: {},
      contexto: {}
    };
    
    const diasSemana = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    
    historial.forEach(h => {
      const fecha = new Date(h.fecha);
      const dia = diasSemana[fecha.getDay()];
      const hora = fecha.getHours();
      const contexto = h.contexto || {};
      const exito = (h.resultado || 0) >= 70;
      
      // Patrones por día
      if (!patrones.diaSemana[dia]) patrones.diaSemana[dia] = { total: 0, exitos: 0 };
      patrones.diaSemana[dia].total++;
      if (exito) patrones.diaSemana[dia].exitos++;
      
      // Patrones por hora
      if (!patrones.hora[hora]) patrones.hora[hora] = { total: 0, exitos: 0 };
      patrones.hora[hora].total++;
      if (exito) patrones.hora[hora].exitos++;
      
      // Patrones contextuales
      if (contexto.momentoDia) {
        if (!patrones.contexto[contexto.momentoDia]) patrones.contexto[contexto.momentoDia] = { total: 0, exitos: 0 };
        patrones.contexto[contexto.momentoDia].total++;
        if (exito) patrones.contexto[contexto.momentoDia].exitos++;
      }
    });
    
    // Calcular tasas de éxito
    Object.keys(patrones.diaSemana).forEach(dia => {
      const p = patrones.diaSemana[dia];
      p.tasa = p.total > 0 ? Math.round((p.exitos / p.total) * 100) : 0;
    });
    
    Object.keys(patrones.hora).forEach(hora => {
      const p = patrones.hora[hora];
      p.tasa = p.total > 0 ? Math.round((p.exitos / p.total) * 100) : 0;
    });
    
    Object.keys(patrones.contexto).forEach(ctx => {
      const p = patrones.contexto[ctx];
      p.tasa = p.total > 0 ? Math.round((p.exitos / p.total) * 100) : 0;
    });
    
    return patrones;
  } catch (err) {
    console.log('[analizarPatronesTemporales] ERROR:', err);
    return null;
  }
}

// ─── AJUSTE AUTOMÁTICO DEL PLAN ─────────────────────────────────
function ajustarPlanAutomaticamente(decision) {
  try {
    const historial = obtenerHistorial();
    const aprendizajes = getProperty('aprendizaje_desviaciones');
    const listaAprendizajes = aprendizajes ? JSON.parse(aprendizajes) : [];
    
    if (historial.length < 5 || listaAprendizajes.length < 2) {
      return decision; // No hay suficientes datos para ajustar
    }
    
    const tipo = decision.tipo || 'z2';
    const diaSemana = new Date().getDay();
    const diasSemana = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const hoy = diasSemana[diaSemana];
    
    // Analizar desviaciones del mismo tipo
    const desviacionesTipo = listaAprendizajes.filter(a => a.desviacion?.planTipo === tipo);
    
    if (desviacionesTipo.length < 2) return decision;
    
    // Calcular tasa de desviación
    const totalTipo = historial.filter(h => h.entreno?.tipo === tipo).length;
    const tasaDesviacion = totalTipo > 0 ? (desviacionesTipo.length / totalTipo) * 100 : 0;
    
    // Si la tasa de desviación es >60%, ajustar el plan
    if (tasaDesviacion > 60) {
      const categoriaMasComun = {};
      desviacionesTipo.forEach(d => {
        const cat = d.categoria || 'otro';
        categoriaMasComun[cat] = (categoriaMasComun[cat] || 0) + 1;
      });
      
      const categoriaPrincipal = Object.keys(categoriaMasComun).sort((a, b) => 
        (categoriaMasComun[b] || 0) - (categoriaMasComun[a] || 0)
      )[0];
      
      // Ajustar según la categoría principal
      if (categoriaPrincipal === 'grupeta') {
        // Si siempre hay grupeta, sugerir Z2 suave
        decision.tipo = 'z2';
        decision.intensidad = 0.65;
        decision.durMin = Math.round((decision.durMin || 60) * 0.8);
        decision.motivo += ' | Ajustado: Históricamente cambias por grupeta';
        decision.ajusteAutomatico = true;
        decision.razonAjuste = 'grupeta';
      } else if (categoriaPrincipal === 'imposibilidad') {
        // Si no puede cumplir, reducir carga
        decision.durMin = Math.round((decision.durMin || 60) * 0.7);
        decision.intensidad = Math.round((decision.intensidad || 0.65) * 0.9 * 100) / 100;
        decision.motivo += ' | Ajustado: Plan reducido por imposibilidad histórica';
        decision.ajusteAutomatico = true;
        decision.razonAjuste = 'imposibilidad';
      } else if (categoriaPrincipal === 'cambio_voluntario') {
        // Si prefiere otro tipo, cambiar a SweetSpot (más versátil)
        if (tipo === 'vo2' || tipo === 'ftp') {
          decision.tipo = 'sweetspot';
          decision.intensidad = 0.88;
          decision.motivo += ' | Ajustado: Cambiado a SweetSpot por preferencia';
          decision.ajusteAutomatico = true;
          decision.razonAjuste = 'preferencia';
        }
      }
    }
    
    // Analizar patrones por día de la semana
    const desviacionesPorDia = {};
    listaAprendizajes.forEach(a => {
      if (a.desviacion) {
        const fecha = new Date(a.desviacion.fecha);
        const dia = diasSemana[fecha.getDay()];
        desviacionesPorDia[dia] = (desviacionesPorDia[dia] || 0) + 1;
      }
    });
    
    // Si hoy es un día con muchas desviaciones, sugerir Z2
    const desviacionesHoy = desviacionesPorDia[hoy] || 0;
    const totalDias = Object.values(desviacionesPorDia).reduce((a, b) => a + b, 0);
    
    if (totalDias > 0 && desviacionesHoy > 0) {
      const porcentajeHoy = (desviacionesHoy / totalDias) * 100;
      if (porcentajeHoy > 30 && decision.tipo !== 'z2' && decision.tipo !== 'descanso') {
        decision.tipo = 'z2';
        decision.intensidad = 0.65;
        decision.durMin = Math.round((decision.durMin || 60) * 0.8);
        decision.motivo += ` | Ajustado: Los ${hoy} tienes ${desviacionesHoy} desviaciones históricas`;
        decision.ajusteAutomatico = true;
        decision.razonAjuste = 'patron_dia';
      }
    }
    
    return decision;
  } catch (err) {
    console.log('[ajustarPlanAutomaticamente] ERROR:', err);
    return decision;
  }
}

// ─── OBTENER ESTADO CON AJUSTE AUTOMÁTICO + MOTOR DE INTENCIÓN ─
async function getAthleteStateConAjuste() {
  try {
    const state = await getAthleteState();
    if (!state || !state.decision) return state;
    
    // ─── MOTOR DE INTENCIÓN: DETECTAR INTENCIÓN DEL DÍA ─────────
    const historial = obtenerHistorial();
    const intencion = motorIntencion.detectarIntencion(state.estado, historial);
    
    // Adaptar la decisión según la intención
    let decisionAjustada = motorIntencion.adaptarDecisionParaIntencion(
      state.decision, 
      intencion, 
      state.estado
    );
    
    // ─── AJUSTE AUTOMÁTICO (CEREBRO) ────────────────────────────
    // Solo aplicar si la intención no ha cambiado la decisión
    if (!decisionAjustada.esIntencion) {
      decisionAjustada = ajustarPlanAutomaticamente(decisionAjustada);
    }
    
    // ─── GENERAR CONSEJO ADAPTATIVO ─────────────────────────────
    const consejoAdaptativo = motorIntencion.generarConsejoAdaptativo(
      intencion, 
      state.estado, 
      decisionAjustada
    );
    
    // Si la intención cambió la decisión, regenerar workout
    if (decisionAjustada.esIntencion || decisionAjustada.ajusteAutomatico) {
      console.log('[getAthleteStateConAjuste] ✅ Decisión adaptada:', 
        decisionAjustada.esIntencion ? `intención: ${intencion.tipo}` : `ajuste: ${decisionAjustada.razonAjuste}`);
      
      // Regenerar workout con la decisión ajustada
      const workoutAjustado = generateWorkout(state.estado, state.restricciones, decisionAjustada, state.traza);
      
      return {
        ...state,
        decision: decisionAjustada,
        workout: workoutAjustado,
        entreno: {
          ...state.entreno,
          tipo: workoutAjustado.tipo.toUpperCase(),
          reps: workoutAjustado.reps,
          durMin: workoutAjustado.durMin,
          wLow: workoutAjustado.vatios.low,
          wHigh: workoutAjustado.vatios.high,
          tssEsperado: workoutAjustado.tssEsperado,
          ifEsperado: workoutAjustado.ifEsperado
        },
        intencion: intencion,
        consejo: consejoAdaptativo,
        ajusteAutomatico: {
          aplicado: true,
          razon: decisionAjustada.esIntencion ? `intencion_${intencion.tipo}` : decisionAjustada.razonAjuste,
          tipoOriginal: state.decision.tipo,
          tipoAjustado: decisionAjustada.tipo
        }
      };
    }
    
    // Si no hubo cambios, añadir intención y consejo adaptativo
    return {
      ...state,
      intencion: intencion,
      consejo: consejoAdaptativo
    };
  } catch (err) {
    console.log('[getAthleteStateConAjuste] ERROR:', err);
    return await getAthleteState();
  }
}

// ─── CEREBRO: ANALIZAR CUMPLIMIENTO DEL PLAN ────────────────────
async function analizarCumplimientoPlan() {
  try {
    // Obtener plan de la semana actual (desde el estado del sistema)
    const state = await getAthleteState();
    if (!state) {
      return { tieneDesviaciones: false, porcentajeCumplimiento: 100 };
    }
    
    // Obtener actividades sincronizadas de los últimos 7 días
    const { data: actividades, error } = await supabase
      .from('actividades_guardadas')
      .select('*')
      .eq('user_id', CONFIG.CHAT_ID || 'default')
      .order('Fecha', { ascending: false })
      .limit(7);
    
    if (error || !actividades || actividades.length === 0) {
      return { tieneDesviaciones: false, porcentajeCumplimiento: 100 };
    }
    
    // Obtener el plan generado para cada día (desde el historial de decisiones)
    const historial = obtenerHistorial();
    const desviaciones = [];
    
    // Comparar cada actividad con el plan esperado
    actividades.forEach(act => {
      const fechaAct = new Date(act.Fecha || act.fecha);
      const fechaStr = formatDate(fechaAct);
      
      // Buscar si hay un plan para esa fecha en el historial
      const planDia = historial.find(h => {
        const fechaHist = new Date(h.fecha);
        return formatDate(fechaHist) === fechaStr && h.entreno?.tipo;
      });
      
      if (planDia && planDia.entreno) {
        const planTipo = planDia.entreno.tipo;
        const planTSS = planDia.entreno.tss || 0;
        const realTSS = safeNum(act.tss, 0);
        const realNP = safeNum(act.np, 0);
        
        // Determinar tipo real basado en NP/FTP
        let realTipo = 'z2';
        if (realNP > 0 && CONFIG.FTP > 0) {
          const ifCalc = realNP / CONFIG.FTP;
          if (ifCalc > 1.05) realTipo = 'vo2';
          else if (ifCalc > 0.95) realTipo = 'ftp';
          else if (ifCalc > 0.87) realTipo = 'sweetspot';
          else if (ifCalc > 0.75) realTipo = 'tempo';
          else realTipo = 'z2';
        }
        
        // Detectar desviación
        const diferenciaTSS = realTSS - planTSS;
        const desviacionTSS = Math.abs(diferenciaTSS) > (planTSS * 0.3); // 30% de tolerancia
        const desviacionTipo = planTipo !== realTipo && planTipo !== 'z2';
        
        if (desviacionTSS || desviacionTipo) {
          let motivo = '';
          if (desviacionTSS && diferenciaTSS > 0) {
            motivo = `Hiciste ${Math.round(diferenciaTSS)} TSS más de lo planeado`;
          } else if (desviacionTSS && diferenciaTSS < 0) {
            motivo = `Hiciste ${Math.round(Math.abs(diferenciaTSS))} TSS menos de lo planeado`;
          }
          
          if (desviacionTipo) {
            motivo += ` | Tipo diferente: esperado ${planTipo.toUpperCase()}, realizado ${realTipo.toUpperCase()}`;
          }
          
          desviaciones.push({
            fecha: fechaAct.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }),
            planTipo: planTipo,
            realTipo: realTipo,
            planTSS: planTSS,
            realTSS: realTSS,
            diferenciaTSS: diferenciaTSS,
            motivo: motivo
          });
        }
      }
    });
    
    // Calcular porcentaje de cumplimiento
    const porcentajeCumplimiento = desviaciones.length === 0 ? 100 : 
      Math.round(((actividades.length - desviaciones.length) / actividades.length) * 100);
    
    // Generar recomendación
    let recomendacion = '';
    if (porcentajeCumplimiento >= 80) {
      recomendacion = 'Excelente cumplimiento. El plan se adapta bien a tu estilo.';
    } else if (porcentajeCumplimiento >= 60) {
      recomendacion = 'Buen cumplimiento, pero hay margen de mejora. ¿Quieres ajustar el plan?';
    } else {
      recomendacion = 'El plan no se ajusta a tu realidad. Necesitamos revisar la estrategia.';
    }
    
    return {
      tieneDesviaciones: desviaciones.length > 0,
      porcentajeCumplimiento: porcentajeCumplimiento,
      desviaciones: desviaciones,
      recomendacion: recomendacion
    };
    
  } catch (err) {
    console.log('[analizarCumplimientoPlan] ERROR:', err);
    return { tieneDesviaciones: false, porcentajeCumplimiento: 100 };
  }
}

// ─── PROCESAR RESPUESTA DE DESVIACIÓN ───────────────────────────
async function procesarRespuestaDesviacion(texto) {
  try {
    const analisisStr = getProperty('analisis_desviaciones');
    if (!analisisStr) return false;
    
    const analisis = JSON.parse(analisisStr);
    const t = texto.toLowerCase().trim();
    
    // Extraer número y motivo
    const partes = t.split(' ');
    const numDesviacion = parseInt(partes[0]) - 1;
    const motivo = partes.slice(1).join(' ') || 'otro';
    
    if (numDesviacion < 0 || numDesviacion >= analisis.desviaciones.length) {
      await sendTelegram('❌ Número de desviación no válido. Responde con el número (1, 2, 3...) y el motivo.');
      return true;
    }
    
    const desviacion = analisis.desviaciones[numDesviacion];
    
    // Clasificar el motivo
    let categoria = 'otro';
    if (motivo.includes('grupeta') || motivo.includes('grup') || motivo.includes('salida')) {
      categoria = 'grupeta';
    } else if (motivo.includes('cambie') || motivo.includes('cambié') || motivo.includes('preferi') || motivo.includes('preferí')) {
      categoria = 'cambio_voluntario';
    } else if (motivo.includes('pude') || motivo.includes('no pude') || motivo.includes('imposible')) {
      categoria = 'imposibilidad';
    } else if (motivo.includes('lesion') || motivo.includes('dolor') || motivo.includes('molestia')) {
      categoria = 'lesion';
    }
    
    // Guardar el aprendizaje
    await guardarAprendizajeDesviacion(desviacion, categoria, motivo);
    
    // Generar respuesta inteligente
    let respuesta = `✅ *ENTENDIDO*\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    respuesta += `📝 *Desviación registrada:*\n`;
    respuesta += `• ${desviacion.fecha}\n`;
    respuesta += `• Categoría: ${categoria.toUpperCase()}\n`;
    respuesta += `• Motivo: ${motivo}\n\n`;
    
    // Aprendizaje del sistema
    respuesta += `🧠 *APRENDIZAJE DEL SISTEMA:*\n`;
    if (categoria === 'grupeta') {
      respuesta += `• Detectado: Salida social sin control de intensidad\n`;
      respuesta += `• Aprendizaje: Las salidas en grupo aumentan el TSS un 40-60%\n`;
      respuesta += `• Acción: Considera hacer Z2 suave antes o después de la grupeta\n`;
    } else if (categoria === 'cambio_voluntario') {
      respuesta += `• Detectado: Preferiste otro tipo de entrenamiento\n`;
      respuesta += `• Aprendizaje: El plan actual no se ajusta a tus preferencias\n`;
      respuesta += `• Acción: Podemos ajustar el plan para incluir más variedad\n`;
    } else if (categoria === 'imposibilidad') {
      respuesta += `• Detectado: No pudiste cumplir el plan\n`;
      respuesta += `• Aprendizaje: El plan es demasiado ambicioso para tu situación\n`;
      respuesta += `• Acción: Reduciremos la carga o flexibilizaremos el horario\n`;
    } else if (categoria === 'lesion') {
      respuesta += `• Detectado: Problema físico\n`;
      respuesta += `• Aprendizaje: Necesitamos adaptar el plan a tu estado físico\n`;
      respuesta += `• Acción: Consulta con un profesional y ajustaremos el plan\n`;
    } else {
      respuesta += `• Categoría: Otro\n`;
      respuesta += `• Aprendizaje: Registrado para análisis futuro\n`;
    }
    
    respuesta += `\n📊 *Estadísticas actualizadas:*\n`;
    respuesta += `• Cumplimiento global: ${analisis.porcentajeCumplimiento}%\n`;
    respuesta += `• Desviaciones registradas: ${analisis.desviaciones.length}\n`;
    
    await sendTelegramLong(respuesta);
    
    // Limpiar estado
    deleteProperty('analisis_desviaciones');
    deleteUserProperty('esperando_respuesta_desviacion');
    
    return true;
  } catch (err) {
    console.log('[procesarRespuestaDesviacion] ERROR:', err);
    return false;
  }
}

// ─── GUARDAR APRENDIZAJE DE DESVIACIÓN ──────────────────────────
async function guardarAprendizajeDesviacion(desviacion, categoria, motivo) {
  try {
    const aprendizaje = {
      fecha: new Date().toISOString(),
      desviacion: desviacion,
      categoria: categoria,
      motivo: motivo,
      user_id: CONFIG.CHAT_ID || 'default'
    };
    
    // Guardar en Supabase
    const { error } = await supabase
      .from('aprendizaje_desviaciones')
      .insert([aprendizaje]);
    
    if (error) {
      console.log('[guardarAprendizajeDesviacion] Error:', error);
    } else {
      console.log('[guardarAprendizajeDesviacion] ✅ Aprendizaje guardado');
    }
    
    // También guardar en memoria
    const aprendizajes = getProperty('aprendizaje_desviaciones');
    const lista = aprendizajes ? JSON.parse(aprendizajes) : [];
    lista.push(aprendizaje);
    setProperty('aprendizaje_desviaciones', JSON.stringify(lista));
    
  } catch (err) {
    console.log('[guardarAprendizajeDesviacion] ERROR:', err);
  }
}
// ═══════════════════════════════════════════════════════════════
// 🔄 PROCESAMIENTO DE FEEDBACK
// ═══════════════════════════════════════════════════════════════

async function procesarMensajeFeedback(texto, chatId) {
  const raw = getUserProperty(FEEDBACK_KEY);
  if (!raw) return false;

  let estado = {};
  try { estado = JSON.parse(raw); } catch(e) { return false; }
  if (!estado.esperando) return false;

  const paso = estado.paso || 1;
  const t = texto.toLowerCase().trim();

  switch (paso) {
    case 1:
      estado.rpe = Math.min(10, Math.max(1, parseInt(t) || 5));
      estado.paso = 2;
      await sendTelegram('*2/7 - Cumpliste los vatios objetivo?*\nResponde: si / parcial / no');
      break;
    case 2:
      estado.watts = (t === 'si') ? 'si' : (t === 'parcial' ? 'parcial' : 'no');
      estado.paso = 3;
      await sendTelegram('*3/7 - Sensacion de piernas (1-3)*\n1 = pesadas · 2 = normales · 3 = ligeras');
      break;
    case 3:
      estado.piernas = Math.min(3, Math.max(1, parseInt(t) || 2));
      estado.paso = 4;
      await sendTelegram('*4/7 - Estres / carga laboral hoy (1-3)*\n1 = bajo · 2 = normal · 3 = alto');
      break;
    case 4:
      estado.stress = Math.min(3, Math.max(1, parseInt(t) || 2));
      estado.paso = 5;
      await sendTelegram('*5/7 - Calidad del sueno anoche (1-3)*\n1 = mal · 2 = regular · 3 = bien');
      break;
    case 5:
      estado.sleep = Math.min(3, Math.max(1, parseInt(t) || 2));
      estado.paso = 6;
      await sendTelegram('*6/7 - ¿A qué hora entrenaste?*\nResponde: mañana / tarde / noche');
      break;
    case 6:
      estado.momentoDia = t;
      estado.paso = 7;
      await sendTelegram('*7/7 - ¿Comiste algo antes de entrenar?*\nResponde: si / no / parcial');
      break;
    case 7:
      estado.comioAntes = t;
      
      const datos = await obtenerDatosCompletos();
      const hoy = datos ? datos.today : {};
      const ctl = safeNum(hoy.ctl, 50);
      const atl = safeNum(hoy.atl, 50);
      const tsb = ctl - atl;
      const acwr = calcularACWR(datos.activities || []);

      const readiness = calcularReadiness(estado.rpe, estado.piernas, estado.stress, estado.sleep, tsb, atl, ctl, estado.watts);
      const fatigaOculta = calcularFatigaOculta(estado.rpe, tsb, estado.piernas, estado.watts);
      const semaforo = getSemaforo(readiness);
      const zonaManana = calcularZonaRecomendada(readiness);
      const explicacion = buildExplicacionStaff(readiness, fatigaOculta, estado, tsb, acwr.ratio);

      let msg =
        '━━━━━━━━━━━━━━━━━━━━━━\n' +
        'ANALISIS DEL STAFF\n' +
        '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
        '*Estado general*\n' +
        `CTL: ${ctl.toFixed(1)}  ATL: ${atl.toFixed(1)}  TSB: ${tsb.toFixed(1)}\n` +
        `ACWR: ${acwr.ratio.toFixed(2)}\n\n` +
        `*Readiness: ${readiness}/100*\n` +
        `${semaforo}\n` +
        `Fatiga oculta: ${fatigaOculta}\n` +
        `Carga laboral: ${buildTextoStress(estado.stress)}\n` +
        `Sueno: ${buildTextoSleep(estado.sleep)}\n` +
        `Momento: ${estado.momentoDia || 'N/A'}\n` +
        `Comida previa: ${estado.comioAntes || 'N/A'}\n\n` +
        `*Recomendacion manana:*\n${zonaManana}\n\n` +
        `*Staff:*\n${explicacion}`;

      await sendTelegramLong(msg);

      const entrenoActual = {
        tipo: estado.tipo || 'desconocido',
        reps: 0,
        durMin: 0,
        intensidad: 0,
        tss: estado.tss || 0,
        tsb: tsb,
        readiness: readiness,
        temp: datos && datos.weather ? datos.weather.temp || 25 : 25,
        sleepQuality: estado.sleep || 2,
        hrv: datos && datos.today ? safeNum(datos.today.hrv, 50) : 50
      };

      const feedback = {
        rpe: estado.rpe,
        watts: estado.watts,
        piernas: estado.piernas,
        stress: estado.stress,
        sleep: estado.sleep
      };

      const contexto = {
        momentoDia: estado.momentoDia || 'desconocido',
        comioAntes: estado.comioAntes || 'no',
        hora: new Date().getHours().toString()
      };

      guardarEntrenoHistorial(entrenoActual, feedback, contexto);  // ← MODIFICADO
      guardarFeedbackContextual(feedback, contexto);

      deleteUserProperty(FEEDBACK_KEY);
      return true;
  }

  setUserProperty(FEEDBACK_KEY, JSON.stringify(estado));
  return true;
}

// ═══════════════════════════════════════════════════════════════
// 📋 FUNCIONES FALTANTES (IMPLEMENTADAS)
// ═══════════════════════════════════════════════════════════════

// ─── calcularReadiness() ────────────────────────────────────
function calcularReadiness(rpe, piernas, stress, sleep, tsb, atl, ctl, watts) {
  let readiness = 70;
  if (rpe >= 8) readiness -= 15;
  else if (rpe >= 7) readiness -= 5;
  else if (rpe <= 4) readiness += 10;
  if (piernas === 1) readiness -= 15;
  else if (piernas === 3) readiness += 10;
  if (stress === 3) readiness -= 15;
  else if (stress === 1) readiness += 5;
  if (sleep === 1) readiness -= 20;
  else if (sleep === 3) readiness += 10;
  if (tsb < -20) readiness -= 20;
  else if (tsb < -10) readiness -= 10;
  else if (tsb > 10) readiness += 10;
  if (watts === 'no') readiness -= 10;
  return Math.max(10, Math.min(100, readiness));
}

// ─── calcularFatigaOculta() ─────────────────────────────────
function calcularFatigaOculta(rpe, tsb, piernas, watts) {
  let fatiga = 0;
  if (rpe >= 7 && tsb > 0) fatiga += 1;
  if (rpe >= 8 && tsb > -5) fatiga += 1;
  if (piernas === 1 && tsb > -5) fatiga += 1;
  if (watts === 'no' && rpe <= 5) fatiga += 1;
  if (fatiga >= 3) return '🔴 Alta';
  if (fatiga >= 2) return '🟡 Media';
  return '🟢 Baja';
}

// ─── calcularZonaRecomendada() ──────────────────────────────
function calcularZonaRecomendada(readiness) {
  if (readiness < 30) return 'Descanso total';
  if (readiness < 45) return 'Z1 (Recuperación, <55% FTP)';
  if (readiness < 55) return 'Z2 (Base, 55-75% FTP)';
  if (readiness < 70) return 'Z2-Z3 (Base/Tempo, 55-87% FTP)';
  if (readiness < 85) return 'SweetSpot-FTP (88-105% FTP)';
  return 'VO2 Max (105-120% FTP)';
}

// ─── buildExplicacionStaff() ────────────────────────────────
function buildExplicacionStaff(readiness, fatigaOculta, estado, tsb, acwr) {
  let msg = '';
  if (readiness < 30) msg = '🔴 Descanso obligatorio. Tu cuerpo necesita recuperación.';
  else if (readiness < 50) msg = '🟠 Fatiga significativa. Entreno suave o descanso.';
  else if (readiness < 65) msg = '🟡 Estado aceptable. Entreno controlado.';
  else if (readiness < 80) msg = '🟢 Buen estado. Puedes entrenar con normalidad.';
  else msg = '🟢 Excelente estado. Ventana de calidad.';
  if (fatigaOculta === '🔴 Alta') msg += ' ⚠️ Fatiga oculta alta. Reduce intensidad.';
  if (acwr > 1.3) msg += ' 📊 ACWR elevado. Controla la carga.';
  return msg;
}

// ─── buildTextoStress() ─────────────────────────────────────
function buildTextoStress(stress) {
  if (stress === 1) return '🟢 Bajo';
  if (stress === 2) return '🟡 Normal';
  return '🔴 Alto';
}

// ─── buildTextoSleep() ──────────────────────────────────────
function buildTextoSleep(sleep) {
  if (sleep === 1) return '🔴 Malo';
  if (sleep === 2) return '🟡 Regular';
  return '🟢 Bueno';
}

// ─── getSemaforo() ──────────────────────────────────────────
function getSemaforo(readiness) {
  if (readiness < 30) return '🔴🔴🔴';
  if (readiness < 50) return '🟠🟠🟠';
  if (readiness < 65) return '🟡🟡🟡';
  if (readiness < 80) return '🟢🟢🟢';
  return '🟢🟢🟢✨';
}

// ─── compararUltimasSesiones() ──────────────────────────────
function compararUltimasSesiones(activities) {
  if (!activities || activities.length < 2) {
    return { ultimas: 0, avgTss: 0, maxTss: 0, avgIf: '0.00', avgDur: 0, tendencia: 'Sin datos' };
  }
  let tssTotal = 0, ifTotal = 0, durTotal = 0, maxTss = 0;
  activities.forEach(a => {
    const tss = safeNum(a.icu_training_load, 0);
    const np = safeNum(a.icu_weighted_avg_watts, 0);
    const ifVal = (np > 0 && CONFIG.FTP > 0) ? np / CONFIG.FTP : 0;
    const dur = safeNum(a.moving_time, 0) / 60;
    tssTotal += tss; ifTotal += ifVal; durTotal += dur;
    if (tss > maxTss) maxTss = tss;
  });
  const n = activities.length;
  const avgTss = Math.round(tssTotal / n);
  const avgIf = (ifTotal / n).toFixed(2);
  const avgDur = Math.round(durTotal / n);
  const mitad = Math.floor(n / 2);
  let tendencia = '➡️ Estable';
  if (mitad >= 1) {
    const tss1 = activities.slice(0, mitad).reduce((s, a) => s + safeNum(a.icu_training_load, 0), 0) / mitad;
    const tss2 = activities.slice(mitad).reduce((s, a) => s + safeNum(a.icu_training_load, 0), 0) / (n - mitad);
    if (tss2 > tss1 * 1.15) tendencia = '⬆️ Aumentando';
    else if (tss2 < tss1 * 0.85) tendencia = '⬇️ Disminuyendo';
  }
  return { ultimas: n, avgTss, maxTss, avgIf, avgDur, tendencia };
}

// ─── calcularMovilidadAdaptativa() ──────────────────────────
function calcularMovilidadAdaptativa(estado) {
  const tsb = estado.tsb || 0;
  const fase = getFaseActual();
  const sleepQuality = estado.sleepQuality || 2;
  const piernas = estado.piernas || 2;
  const ejercicios = {
    cadera: ['🔄 Círculos de cadera: 3x15 c/lado','🦵 Estiramiento psoas rodilla al pecho: 3x30" c/lado','🦵 Estiramiento piriformis: 3x30" c/lado','🔄 Movilidad cadera en 4 direcciones: 3x10 c/lado'],
    columna: ['🐱 Gato-vaca: 3x10 repeticiones lentas','🔄 Rotaciones torácicas sentado: 3x10 c/lado','🧘 Postura niño: 3x30"','🔄 Rotaciones cervicales: 3x10 c/lado'],
    tobillo: ['🦶 Círculos de tobillo: 3x15 c/lado','🦶 Estiramiento sóleo contra pared: 3x30" c/lado','🦶 Elevaciones de talón: 3x15'],
    isquios: ['🦵 Estiramiento isquios con banda: 3x30" c/lado','🦵 Peso muerto a una pierna (sin peso): 3x10 c/lado','🦵 Estiramiento isquios en V: 3x30"'],
    general: ['🧘 Foam rolling isquios: 2 min c/pierna','🧘 Foam rolling glúteos: 2 min c/lado','🧘 Foam rolling dorsales: 2 min c/lado','🧘 Liberación fascia plantar: 1 min c/pie'],
    activacion: ['🔥 Glute bridge: 3x15','🔥 Clamshell: 3x15 c/lado','🔥 Bird-dog: 3x10 c/lado']
  };
  let seleccionados = [], duracionEstimada = 15, enfasis = '';
  if (piernas === 1 || tsb < -10) {
    enfasis = '🔴 *Piernas pesadas* - Prioriza liberación y estiramientos suaves';
    seleccionados.push(...ejercicios.isquios.slice(0,2), ...ejercicios.cadera.slice(0,2), ...ejercicios.general.slice(0,2));
    duracionEstimada = 20;
  } else if (piernas === 2) {
    enfasis = '🟡 *Estado normal* - Movilidad completa pre-entreno';
    seleccionados.push(...ejercicios.cadera.slice(0,2), ...ejercicios.columna.slice(0,2), ...ejercicios.activacion.slice(0,2));
    duracionEstimada = 15;
  } else {
    enfasis = '🟢 *Piernas ligeras* - Enfoque en activación dinámica';
    seleccionados.push(...ejercicios.activacion, ...ejercicios.cadera.slice(0,1), ...ejercicios.tobillo.slice(0,2));
    duracionEstimada = 12;
  }
  if (fase === 'base') { seleccionados.push(...ejercicios.cadera.slice(2,4)); duracionEstimada += 5; }
  else if (fase === 'especificidad') { seleccionados.push(...ejercicios.tobillo); duracionEstimada += 3; }
  if (sleepQuality === 1) { seleccionados.unshift('😴 *Sueño malo* - Añade 5 min de respiración diafragmática'); duracionEstimada += 5; }
  return { ejercicios: seleccionados.slice(0,6), duracion: `${duracionEstimada} min`, enfasis, recomendado: true, momento: tsb < -15 ? 'Cualquier momento del día (recuperación)' : 'Antes de entrenar' };
}

// ─── calcularReadinessConTendencia() ────────────────────────
function calcularReadinessConTendencia(estado, historial) {
  const tsb = estado.tsb || 0; const hrv = estado.hrv || 50; const sleepQuality = estado.sleepQuality || 2; const pasos = estado.pasos || 0;
  let tendenciaHRV = 0, tendenciaSleep = 0, tendenciaTSB = 0;
  if (historial && historial.length >= 3) {
    const ultimos = historial.slice(-7);
    const hrvV = ultimos.filter(h => h.hrv).map(h => h.hrv); const sleepV = ultimos.filter(h => h.sleepQuality).map(h => h.sleepQuality); const tsbV = ultimos.filter(h => h.tsb !== undefined).map(h => h.tsb);
    if (hrvV.length >= 3) { const m = hrvV.reduce((a,b)=>a+b,0)/hrvV.length; if (hrv < m*0.9) tendenciaHRV = -10; else if (hrv > m*1.1) tendenciaHRV = 5; }
    if (sleepV.length >= 3) { const m = sleepV.reduce((a,b)=>a+b,0)/sleepV.length; if (sleepQuality < m-0.5) tendenciaSleep = -10; else if (sleepQuality > m+0.5) tendenciaSleep = 5; }
    if (tsbV.length >= 3) { const r = tsbV.slice(-3).reduce((a,b)=>a+b,0)/3; const a = tsbV.slice(0,3).reduce((a,b)=>a+b,0)/3; if (r < a-5) tendenciaTSB = -10; else if (r > a+5) tendenciaTSB = 5; }
  }
  let readiness = 70;
  if (tsb < -30) readiness -= 30; else if (tsb < -20) readiness -= 20; else if (tsb < -10) readiness -= 10; else if (tsb > 10) readiness += 10; else if (tsb > 5) readiness += 5;
  if (hrv < 30) readiness -= 20; else if (hrv < 40) readiness -= 15; else if (hrv < 50) readiness -= 5; else if (hrv > 65) readiness += 10; else if (hrv > 55) readiness += 5;
  if (sleepQuality === 1) readiness -= 20; else if (sleepQuality === 2) readiness -= 5; else if (sleepQuality === 3) readiness += 10;
  if (pasos > 20000) readiness -= 10; else if (pasos > 15000) readiness -= 5; else if (pasos < 5000 && tsb < -10) readiness += 5;
  readiness += tendenciaHRV + tendenciaSleep + tendenciaTSB;
  let clasificacion = '🟢 Normal', alertas = [];
  if (readiness < 30) { clasificacion = '🔴 Crítico'; alertas.push('🔴 Descanso obligatorio'); }
  else if (readiness < 45) { clasificacion = '🟠 Muy fatigado'; alertas.push('🟠 Solo Z1-Z2 suave'); }
  else if (readiness < 55) { clasificacion = '🟡 Fatigado'; alertas.push('🟡 Recuperación activa'); }
  else if (readiness < 70) { clasificacion = '🟡 Normal-fatiga'; alertas.push('🟡 Entreno controlado'); }
  else if (readiness > 85) { clasificacion = '🟢 Excelente'; alertas.push('🟢 Ventana de calidad'); }
  if (tendenciaHRV < 0) alertas.push('📉 HRV en descenso - Vigila recuperación');
  if (tendenciaSleep < 0) alertas.push('😴 Calidad de sueño empeorando');
  if (tendenciaTSB < 0) alertas.push('📉 TSB en descenso - Reduce carga');
  const diaSemana = new Date().getDay(); const patronFatiga = getProperty(`patron_fatiga_${diaSemana}`);
  if (patronFatiga) { const patron = JSON.parse(patronFatiga); if (patron.probabilidad > 0.6) { readiness -= 5; alertas.push(`📅 Los ${['domingo','lunes','martes','miércoles','jueves','viernes','sábado'][diaSemana]} sueles tener más fatiga (-5)`); } }
  return { readiness: Math.max(5, Math.min(100, Math.round(readiness))), clasificacion, alertas: alertas.slice(0,3), tendencias: { hrv: tendenciaHRV, sleep: tendenciaSleep, tsb: tendenciaTSB } };
}

// ═══════════════════════════════════════════════════════════════
// 🌐 WEBHOOK Y RUTAS API
// ═══════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════
// 🚦 SISTEMA DE COLA Y DEDUPLICACIÓN
// ═══════════════════════════════════════════════════════════════
let procesandoMensaje = false;
let colaMensajes = [];
let updateIdProcesando = null;

async function procesarSiguienteMensaje() {
  if (procesandoMensaje || colaMensajes.length === 0) {
    return;
  }
  
  procesandoMensaje = true;
  const { body, res } = colaMensajes.shift();
  
  try {
    await procesarWebhook(body, res);
  } catch (err) {
    console.log('[Cola] ERROR:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  } finally {
    procesandoMensaje = false;
    updateIdProcesando = null;
    // Procesar siguiente mensaje en cola
    setImmediate(() => procesarSiguienteMensaje());
  }
}

function encolarMensaje(body, res) {
  const updateId = body.update_id;
  
  // Si ya estamos procesando este update, ignorar
  if (updateIdProcesando === updateId) {
    console.log('[Cola] ⚠️ Update duplicado ignorado:', updateId);
    res.status(200).json({ ok: true, message: 'duplicate' });
    return false;
  }
  
  // Agregar a cola
  colaMensajes.push({ body, res });
  console.log('[Cola] 📥 Mensaje encolado. Total en cola:', colaMensajes.length);
  
  // Si no hay nada procesando, iniciar
  if (!procesandoMensaje) {
    procesarSiguienteMensaje();
  }
  
  return true;
}

app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    
    // ─── USAR SISTEMA DE COLA ────────────────────────────────────
    const encolado = encolarMensaje(body, res);
    if (!encolado) {
      return;
    }
    
    // No continuar aquí - el procesamiento se hace en procesarSiguienteMensaje()
    return;
  } catch (err) {
    console.log('[Webhook] ERROR:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

async function procesarWebhook(body, res) {
  try {
    const message = body.message || body.edited_message || body.channel_post;
    if (!message) return res.status(200).json({ ok: true });
    if (message.from && message.from.is_bot) return res.status(200).json({ ok: true });

    const chatId = (message.chat && message.chat.id) ? message.chat.id.toString() : '';
    if (!chatId || chatId !== CONFIG.CHAT_ID.toString()) {
      return res.status(200).json({ ok: true });
    }

    const rawText = (message.text || '').trim();
    if (!rawText) return res.status(200).json({ ok: true });
    console.log('[Webhook] Mensaje:', rawText);

    const esperandoDesviacion = getUserProperty('esperando_respuesta_desviacion');
    if (esperandoDesviacion === 'true') {
      const procesado = await procesarRespuestaDesviacion(rawText);
      if (procesado) {
        return res.status(200).json({ ok: true });
      }
    }

    if (await procesarMensajeFeedback(rawText, chatId)) {
      return res.status(200).json({ ok: true });
    }

    const parts = rawText.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    if (cmd === '/hoy') {
      if (args.length === 0) {
        await cmdHoy(chatId);
      } else {
        const sub = args[0].toLowerCase().replace('--', '');
        switch (sub) {
          case 'estado': await cmdEstado(); break;
          case 'plan': await cmdPlan(); break;
          case 'clima': await cmdClima(); break;
          case 'nutricion': await cmdNutricion(); break;
          case 'objetivo': await cmdObjetivo(); break;
          case 'ayuda':
            await sendTelegram('📋 *Subcomandos de /hoy:*\n/hoy --estado → Estado completo\n/hoy --plan → Plan del día\n/hoy --clima → Clima + factor\n/hoy --nutricion → Nutrición + recetas\n/hoy --objetivo → Plan para 296W\n/hoy (sin args) → Todo junto');
            break;
          default:
            await sendTelegram('Subcomando no reconocido. Usa /hoy --ayuda');
        }
      }
      return res.status(200).json({ ok: true });
    }

    // ─── SWITCH DE COMANDOS CON ALIAS ──────────────────────────────
    switch (cmd) {
      case '/start': await cmdStart(); break;
      case '/plan': await cmdPlan(); break;
      case '/estado': await cmdEstado(); break;
      case '/analizar': await cmdAnalizar(args); break;
      case '/clima': await cmdClima(); break;
      case '/ajuste': await cmdAjuste(); break;
      case '/nutricion': await cmdNutricion(); break;
      case '/fuerza': await cmdFuerza(); break;
      
      case '/semana': await cmdSemana(); break;
      case '/semana-pasada': 
      case '/semanapasada': 
        await cmdSemanaPasada(); 
        break;
      
      case '/consejo': await cmdConsejo(); break;
      case '/resumen': await cmdResumen(); break;
      case '/fatiga': await cmdFatiga(); break;
      
      case '/aprender': await cmdAprender(); break;
      case '/aprender-validar': 
      case '/aprendervalidar': 
        await cmdAprenderValidar(); 
        break;
      
      case '/tendencias': await cmdTendencias(); break;
      case '/recuperacion': await cmdRecuperacion(); break;
      case '/prediccion': await cmdPrediccion(); break;
      case '/progreso': await cmdProgreso(); break;
      case '/alerta': await cmdAlerta(); break;
      case '/densidad': await cmdDensidad(); break;
      case '/exportar': await cmdExportar(); break;
      case '/objetivo': await cmdObjetivo(); break;
      case '/historial': await cmdHistorial(); break;
      case '/zwo': await cmdZwo(); break;
      case '/garmin': await cmdGarmin(); break;
      case '/debug': await cmdDebug(); break;
      case '/traza': await cmdTraza(); break;
      case '/movilidad': await cmdMovilidad(); break;
      case '/sync': await cmdSync(); break;   // ← NUEVO COMANDO
      case '/ia': 
        // Procesar IA en segundo plano para no bloquear el webhook
        setImmediate(() => cmdIA(args).catch(err => console.log('[cmdIA bg]', err)));
        break;
      
      default:
        await sendTelegram('Comando no reconocido.\nEscribe /start para ver el menu.');
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.log('[Webhook] ERROR:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
};

// ─── RUTAS API ───
app.get('/api/estado', async (req, res) => {
  try {
    const state = await getAthleteState();
    if (!state) return res.status(404).json({ success: false, error: 'No data' });
    res.json({ success: true, ...state });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/comando', async (req, res) => {
  try {
    const { comando } = req.body;
    let respuesta = '';
    switch (comando) {
      case '/hoy':
        const state = await getAthleteState();
        if (state && state.workout.tipo !== 'descanso') {
          respuesta = `Entreno: ${state.workout.tipo.toUpperCase()} ${state.workout.reps}x${state.workout.durMin}min\nVatios: ${state.workout.vatios.low}-${state.workout.vatios.high}W\nTSS: ${state.workout.tssEsperado} | IF: ${state.workout.ifEsperado}\nCadencia: ${state.workout.cadenciaRecomendada || '80-90 rpm'}`;
        } else {
          respuesta = 'Hoy es día de descanso.';
        }
        break;
      default:
        respuesta = 'Comando no disponible desde la web.';
    }
    res.json({ success: true, respuesta });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    data: {
      ftp: CONFIG.FTP,
      weight: CONFIG.WEIGHT_KG,
      age: CONFIG.AGE_YEARS,
      city: CONFIG.CITY,
      objetivo: CONFIG.FTP_HISTORICO.valor,
      timezone: CONFIG.TIMEZONE,
      fase: getFaseActual(),
      semana: getSemanaActual()
    }
  });
});

// ─── MANEJO DE ERRORES ───
app.use((req, res) => {
  res.status(404).json({
    error: 'Ruta no encontrada',
    path: req.path,
    method: req.method,
    availableEndpoints: [
      '/',
      '/health',
      '/ping',
      '/webhook (POST)',
      '/api/estado',
      '/api/comando (POST)',
      '/api/config'
    ]
  });
});

app.use((err, req, res, next) => {
  console.error('❌ Error global:', err);
  res.status(500).json({
    error: 'Error interno del servidor',
    message: err.message
  });
});

// ─── INICIAR SERVIDOR ───
app.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ WORLD TOUR COACH v9.5 - DEFINITIVO`);
  console.log(`📡 Servidor corriendo en puerto ${PORT}`);
  console.log(`🔗 URL: http://localhost:${PORT}`);
  console.log(`🤖 Telegram Bot: ${CONFIG.TELEGRAM_TOKEN ? '✅ Configurado' : '⚠️ Sin token'}`);
  console.log(`📊 FTP: ${CONFIG.FTP}W | Peso: ${CONFIG.WEIGHT_KG}kg`);
  console.log(`🎯 Objetivo: ${CONFIG.FTP_HISTORICO.valor}W`);
  console.log(`📅 Fase: ${getFaseActual().toUpperCase()} | Semana ${getSemanaActual()}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📍 Endpoints disponibles:');
  console.log('  GET  /              - Información del servidor');
  console.log('  GET  /health        - Estado de salud');
  console.log('  GET  /ping          - Mantener activo');
  console.log('  POST /webhook       - Webhook Telegram');
  console.log('  GET  /api/estado    - Estado del atleta');
  console.log('  POST /api/comando   - Ejecutar comandos');
  console.log('  GET  /api/config    - Configuración del sistema');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧠 SINGLE SOURCE OF TRUTH: generateWorkout()');
  console.log('📋 TODOS los comandos originales RESTAURADOS');
  console.log('🆕 Periodización estructural (4 fases)');
  console.log('🆕 Predicción de FTP (Coggan)');
  console.log('🆕 Nutrición con sodio y electrolitos');
  console.log('🆕 Fuerza periodizada (Máxima/Resistencia)');
  console.log('🆕 Clima con Heat Index (WBGT)');
  console.log('🆕 Análisis VI/EF (Efficiency Factor REAL = NP/FC)');
  console.log('🆕 Recuperación predictiva');
  console.log('🆕 Aprendizaje contextual');
  console.log('🆕 Cadencia en ZWO y Garmin');
  console.log('🆕 Comando /movilidad');
  console.log('🆕 Alias sin guion para /semanapasada y /aprendervalidar');
  console.log('🆕 /densidad implementado');
  console.log('🆕 /garmin corregido (formato steps)');
  console.log('🆕 /analizar con endpoint correcto /activity/{id}');
  console.log('🆕 CEREBRO: Detección de desviaciones del plan');
  console.log('🆕 CEREBRO: Aprendizaje de motivos de desviaciones');
  console.log('🆕 CEREBRO: Ajuste automático del plan basado en historial');
  console.log('🆕 CEREBRO: Predicción de desviaciones');
  console.log('🆕 CEREBRO: Alertas inteligentes en tiempo real');
  console.log('🆕 CEREBRO: Análisis de patrones temporales');
  console.log('🆕 CEREBRO: Dashboard de aprendizaje completo');
  console.log('🆕 CEREBRO: Recomendaciones inteligentes');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
