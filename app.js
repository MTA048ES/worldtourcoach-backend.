const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

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

// ─── CONFIGURACIÓN ───
const CONFIG = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
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
  }
};

// ─── SUPABASE ───
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qhtwueashkqbqytfwpwi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_mPhJsgW-V7n6TJs6-RLoWQ_Qk68d5qQ';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── VARIABLES GLOBALES (SIMULAN ScriptProperties) ───
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

// ─── FUNCIONES AUXILIARES ───
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

// ─── TELEGRAM ───
async function sendTelegram(text) {
  if (!CONFIG.TELEGRAM_TOKEN || !CONFIG.CHAT_ID) {
    console.log('[sendTelegram] ERROR: Falta TOKEN o CHAT_ID');
    return;
  }

  const safeText = (typeof text === 'string' && text.length > 0) ? text : '(mensaje vacio)';
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`;

  try {
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

    if (!response.ok) {
      // Reintentar sin Markdown
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CONFIG.CHAT_ID,
          text: safeText.replace(/[*_`\[\]]/g, ''),
        })
      });
    }
  } catch(e) {
    console.log('[sendTelegram] ERROR:', e.toString());
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

// ─── INTERVALS.ICU API ───
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

async function fetchWeather() {
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(CONFIG.CITY)}&appid=${CONFIG.WEATHER_API_KEY}&units=metric&lang=es`;
    const response = await fetch(url, { timeout: 10000 });
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
    return { temp: 'N/D', wind: 0, rain: 0, description: 'Sin datos' };
  }

  let temp = 'N/D';
  if (weatherResponse.main && typeof weatherResponse.main === 'object') {
    const tempVal = weatherResponse.main.temp;
    if (tempVal !== undefined && tempVal !== null && !isNaN(tempVal)) temp = Math.round(tempVal);
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

  return { temp, wind, rain, description };
}

// ─── FUNCIONES DE ESTADO ───
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
    const activities = await fetchActivities(7);
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

function calcularEstadoSistema(datos) {
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
  const now = Date.now();

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

  let readiness = 70;
  if (tsb < -20) readiness -= 20;
  else if (tsb < -10) readiness -= 10;
  if (hrv < 40) readiness -= 15;
  else if (hrv < 50) readiness -= 5;
  if (sleepQuality === 1) readiness -= 20;
  else if (sleepQuality === 2) readiness -= 5;
  if (pasos > 15000) readiness -= 5;
  else if (pasos > 20000) readiness -= 10;
  if (sleepQuality === 3) readiness += 10;
  if (hrv > 60) readiness += 10;
  if (tsb > 10) readiness += 10;
  readiness = Math.max(10, Math.min(100, Math.round(readiness)));

  let factorCalor = 1.0;
  let haceCalor = false;
  let tempActual = 25;

  if (datos.weather && typeof datos.weather === 'object') {
    const temp = datos.weather.temp;
    if (typeof temp === 'number') {
      tempActual = temp;
      if (temp > 38) { factorCalor = 0.7; haceCalor = true; }
      else if (temp > 35) { factorCalor = 0.8; haceCalor = true; }
      else if (temp > 32) { factorCalor = 0.85; haceCalor = true; }
      else if (temp > 28) { factorCalor = 0.9; haceCalor = true; }
      else if (temp > 25) { factorCalor = 0.95; haceCalor = true; }
    }
  }

  let tendencia = 'estable';
  if (tsb < -15) tendencia = 'fatiga_acumulada';
  else if (tsb > 10) tendencia = 'descansado';

  const acwr = calcularACWR();

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
    weeklyTss,
    weeklyHours,
    weeklySessions,
    tendencia,
    acwr: acwr.ratio,
    recuperacionNecesaria,
    pasos,
    factorCalor,
    tempActual,
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

function calcularACWR() {
  return { ratio: 1.0 };
}

// ─── DECISION TRACE LAYER ───
function crearTraza() {
  return {
    timestamp: new Date().toISOString(),
    inputs: {},
    reglasActivadas: [],
    conflictos: [],
    decision: null,
    alternativas: [],
    version: '9.1'
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

    console.log('[guardarTraza] Traza guardada correctamente. ID:', traza.timestamp);
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

// ─── CONFLICT RESOLVER ───
function resolverConflictos(estado, restricciones, decision, traza) {
  const resultado = JSON.parse(JSON.stringify(decision));

  // NIVEL 1: SEGURIDAD (NO NEGOCIABLE)
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

  // NIVEL 2: CLIMA EXTREMO
  if (estado.tempActual > 38) {
    registrarConflictoTraza(traza, 'Calor extremo vs plan de calidad', 'CLIMA gana - Reducción 40%');
    registrarDecisionTraza(traza, 'z2 reducido por calor', 'NIVEL 2 - CLIMA EXTREMO');
    resultado.durMin = Math.round((resultado.durMin || 60) * 0.6);
    resultado.intensidad = Math.round((resultado.intensidad || 0.65) * 0.85 * 100) / 100;
    if (resultado.durMin < 20) resultado.durMin = 20;
    if (resultado.tipo !== 'descanso') resultado.tipo = 'z2';
    resultado.reps = 1;
    resultado.recSec = 0;
    resultado.motivo = (resultado.motivo || '') + ` | 🔥 Calor extremo (${estado.tempActual}°C) - duración -40%, intensidad -15%`;
    resultado.notaHidratacion = '💧 1L/hora + electrolitos obligatorios (calor extremo)';
    return resultado;
  }

  if (estado.tempActual > 35) {
    registrarConflictoTraza(traza, 'Calor muy alto vs plan normal', 'CLIMA gana - Reducción 25%');
    registrarDecisionTraza(traza, 'z2 reducido por calor', 'NIVEL 2 - CLIMA EXTREMO');
    resultado.durMin = Math.round((resultado.durMin || 60) * 0.75);
    resultado.intensidad = Math.round((resultado.intensidad || 0.65) * 0.92 * 100) / 100;
    if (resultado.durMin < 20) resultado.durMin = 20;
    if (resultado.tipo !== 'descanso') resultado.tipo = 'z2';
    resultado.reps = 1;
    resultado.recSec = 0;
    resultado.motivo = (resultado.motivo || '') + ` | 🌡️ Calor muy alto (${estado.tempActual}°C) - duración -25%, intensidad -8%`;
    resultado.notaHidratacion = '💧 1L/hora + electrolitos';
    return resultado;
  }

  if (estado.tempActual > 32) {
    registrarConflictoTraza(traza, 'Calor alto vs plan normal', 'CLIMA gana - Reducción 15%');
    registrarDecisionTraza(traza, 'z2 reducido por calor', 'NIVEL 2 - CLIMA');
    resultado.durMin = Math.round((resultado.durMin || 60) * 0.85);
    if (resultado.durMin < 20) resultado.durMin = 20;
    if (resultado.tipo !== 'descanso') resultado.tipo = 'z2';
    resultado.reps = 1;
    resultado.recSec = 0;
    resultado.motivo = (resultado.motivo || '') + ` | ☀️ Calor alto (${estado.tempActual}°C) - duración -15%`;
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
  if (estado.tsb > -5 && estado.readiness > 80 && estado.hrv > 50 && estado.tempActual < 32) {
    registrarConflictoTraza(traza, 'Ventana de calidad vs plan base', 'OBJETIVO gana - Calidad recomendada');
    registrarDecisionTraza(traza, 'calidad', 'NIVEL 5 - OBJETIVO 296W');
    if (resultado.tipo === 'z2' && estado.ctl > 60) {
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

// ─── LEARNING FILTER ───
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

// ─── FUNCIONES DE RESTRICCIONES Y DECISIONES ───
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

  if (estado.haceCalor && estado.tempActual > 38) {
    restricciones.intensidadMax = 0.90;
    restricciones.volumenMax = 0.7;
    restricciones.factorCalorAplicado = 0.7;
    restricciones.zonasPermitidas = ['z1', 'z2'];
    restricciones.motivo.push(`🔥 Calor extremo (${estado.tempActual}°C) - Reducción 30%`);
  } else if (estado.haceCalor && estado.tempActual > 35) {
    restricciones.intensidadMax = 0.95;
    restricciones.volumenMax = 0.8;
    restricciones.factorCalorAplicado = 0.8;
    restricciones.motivo.push(`🔥 Calor muy alto (${estado.tempActual}°C) - Reducción 20%`);
  } else if (estado.haceCalor && estado.tempActual > 32) {
    restricciones.volumenMax = 0.85;
    restricciones.factorCalorAplicado = 0.85;
    restricciones.motivo.push(`🌡️ Calor alto (${estado.tempActual}°C) - Reducción 15%`);
  } else if (estado.haceCalor && estado.tempActual > 28) {
    restricciones.volumenMax = 0.9;
    restricciones.factorCalorAplicado = 0.9;
    restricciones.motivo.push(`🌤️ Calor moderado (${estado.tempActual}°C) - Reducción 10%`);
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

function decidirEntrenamiento(estado, restricciones) {
  if (restricciones.forzarDescanso) {
    return {
      tipo: 'descanso',
      reps: 0,
      durMin: 0,
      recSec: 0,
      intensidad: 0,
      prioridad: 'recuperacion_obligatoria',
      motivo: restricciones.motivo.join(' | ')
    };
  }

  const tsb = estado.tsb;
  const readiness = estado.readiness;
  const weeklyTss = estado.weeklyTss;
  const tssMax = restricciones.tssMaxSemanal;
  const tssRestante = tssMax - weeklyTss;

  if (tssRestante < 30 && !restricciones.forzarZ2) {
    return {
      tipo: 'z2',
      reps: 1,
      durMin: 30,
      recSec: 0,
      intensidad: 0.65,
      prioridad: 'mantenimiento',
      motivo: `Límite semanal alcanzado (${Math.round(tssRestante)} TSS restante) - Duración mínima 30 min`
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
    if (estado.haceCalor && estado.tempActual > 35) {
      decision = {
        tipo: 'sweetspot',
        reps: 2,
        durMin: 6,
        recSec: 120,
        intensidad: 0.88,
        prioridad: 'calidad_controlada',
        motivo: 'Calor extremo - SweetSpot reducido'
      };
    } else if (restricciones.zonasRestringidas.indexOf('vo2') === -1 && restricciones.intensidadMax > 0.9) {
      decision = {
        tipo: 'vo2',
        reps: 4,
        durMin: 3,
        recSec: 180,
        intensidad: 1.12,
        prioridad: 'calidad_alta',
        motivo: 'Ventana de intensidad óptima'
      };
    } else {
      decision = {
        tipo: 'ftp',
        reps: 4,
        durMin: 4,
        recSec: 150,
        intensidad: 0.97,
        prioridad: 'calidad_alta',
        motivo: 'Desarrollo FTP'
      };
    }
  } else if (tsb >= 0 && tsb <= 10) {
    decision = {
      tipo: 'sweetspot',
      reps: 3,
      durMin: 8,
      recSec: 120,
      intensidad: 0.88,
      prioridad: 'desarrollo',
      motivo: 'Estado equilibrado'
    };
  } else if (tsb >= -10 && tsb < 0) {
    let duracion = 75;
    if (estado.haceCalor && estado.tempActual > 35) duracion = 50;
    else if (estado.haceCalor && estado.tempActual > 32) duracion = 60;
    else if (estado.haceCalor && estado.tempActual > 28) duracion = 65;
    if (estado.sleepQuality === 1) duracion = 50;

    decision = {
      tipo: 'z2',
      reps: 1,
      durMin: duracion,
      recSec: 0,
      intensidad: 0.65,
      prioridad: 'base',
      motivo: 'Construcción aeróbica' + (estado.haceCalor ? ' (con calor)' : '')
    };
  } else if (tsb >= -20 && tsb < -10) {
    decision = {
      tipo: 'z2',
      reps: 1,
      durMin: 50,
      recSec: 0,
      intensidad: 0.60,
      prioridad: 'recuperacion_activa',
      motivo: 'Asimilación de carga'
    };
  } else {
    decision = {
      tipo: 'z1',
      reps: 1,
      durMin: 35,
      recSec: 0,
      intensidad: 0.45,
      prioridad: 'recuperacion_obligatoria',
      motivo: 'Fatiga severa'
    };
  }

  if (restricciones.forzarZ2) {
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
    decision.motivo = 'Zona restringida - Fallback a Z2';
  }

  if (estado.haceCalor) {
    decision.motivo += ` | 🌡️ ${estado.tempActual}°C`;
  }

  if (decision.tipo === 'z2') {
    const tssRestanteFinal = restricciones.tssMaxSemanal - estado.weeklyTss;
    if (tssRestanteFinal > 100) {
      decision.durMin = Math.max(45, decision.durMin);
      decision.motivo += ` | TSS disponible: ${Math.round(tssRestanteFinal)} - duración ampliada a 45 min`;
    } else {
      decision.durMin = Math.max(30, decision.durMin);
      decision.motivo += ' | Duración mínima asegurada (30 min)';
    }
  }

  if (decision.tipo === 'z1') {
    decision.durMin = Math.max(20, decision.durMin);
    decision.motivo += ' | Duración mínima asegurada (20 min)';
  }

  if ((decision.tipo === 'sweetspot' || decision.tipo === 'ftp' || decision.tipo === 'vo2')) {
    decision.durMin = Math.max(15, decision.durMin);
    decision.motivo += ' | Duración mínima asegurada (15 min)';
  }

  return decision;
}

function aplicarFactorClima(decision, temp) {
  if (!temp || typeof temp !== 'number') {
    return decision;
  }

  if (decision.tipo === 'descanso' || decision.tipo === 'z1') {
    return decision;
  }

  let factorDuracion = 1.0;
  let factorIntensidad = 1.0;
  let notaClima = '';

  if (temp > 38) {
    factorDuracion = 0.7;
    factorIntensidad = 0.90;
    notaClima = `🔥 ${temp}°C - Reduce duración 30% e intensidad 10%`;
  } else if (temp > 35) {
    factorDuracion = 0.8;
    factorIntensidad = 0.95;
    notaClima = `🌡️ ${temp}°C - Reduce duración 20% e intensidad 5%`;
  } else if (temp > 32) {
    factorDuracion = 0.85;
    factorIntensidad = 0.97;
    notaClima = `☀️ ${temp}°C - Reduce duración 15%`;
  } else if (temp > 28) {
    factorDuracion = 0.9;
    factorIntensidad = 0.98;
    notaClima = `🌤️ ${temp}°C - Reduce duración 10%`;
  } else if (temp < 5) {
    factorDuracion = 0.9;
    notaClima = `❄️ ${temp}°C - Calienta bien y protege extremidades`;
  } else {
    notaClima = `✅ ${temp}°C - Clima ideal`;
  }

  decision.durMin = Math.round(decision.durMin * factorDuracion);
  if (decision.durMin < 20) decision.durMin = 20;

  decision.intensidad = Math.round((decision.intensidad * factorIntensidad) * 100) / 100;

  if (decision.intensidad < 0.75 && decision.tipo === 'vo2') decision.tipo = 'ftp';
  if (decision.intensidad < 0.85 && decision.tipo === 'ftp') decision.tipo = 'sweetspot';
  if (decision.intensidad < 0.75 && decision.tipo === 'sweetspot') decision.tipo = 'z2';

  decision.motivo += ' | ' + notaClima;

  if (temp > 35) {
    decision.notaHidratacion = '💧 1L/hora + electrolitos (calor extremo)';
  } else if (temp > 30) {
    decision.notaHidratacion = '💧 1L/hora + electrolitos';
  } else if (temp > 25) {
    decision.notaHidratacion = '💧 750ml/hora';
  } else {
    decision.notaHidratacion = '💧 500ml/hora';
  }

  if (decision.tipo === 'z2' && decision.durMin < 30) {
    decision.durMin = 30;
    decision.motivo += ' | Duración mínima asegurada (30 min)';
  }

  return decision;
}

function generarEntrenamiento(tipo, reps, durMin, recSec) {
  const ftp = CONFIG.FTP || 240;

  if (!tipo) {
    tipo = 'z2';
    reps = reps || 1;
    durMin = durMin || 60;
    recSec = recSec || 0;
  }

  const pcts = {
    sweetspot: { low: 0.88, high: 0.93 },
    vo2: { low: 1.10, high: 1.20 },
    ftp: { low: 0.95, high: 1.00 },
    z2: { low: 0.60, high: 0.70 },
    z1: { low: 0.40, high: 0.55 },
    z3: { low: 0.75, high: 0.87 }
  };

  const tipoLimpio = tipo.toLowerCase().trim();
  const zona = pcts[tipoLimpio] || pcts.z2;
  const wLow = Math.round(ftp * zona.low);
  const wHigh = Math.round(ftp * zona.high);
  const wAvg = (wLow + wHigh) / 2;

  const wuDur = tipoLimpio === 'vo2' ? 900 : 600;
  const wuPct = tipoLimpio === 'vo2' ? 0.60 : 0.55;

  const duracionTotalSec = wuDur + (reps * durMin * 60) + (reps > 1 ? (reps - 1) * recSec : 0) + 600;
  const duracionTotalMin = Math.round(duracionTotalSec / 60);

  let tssAcumulado = 0;
  tssAcumulado += (wuDur / 3600) * Math.pow(wuPct, 2) * 100;
  tssAcumulado += ((reps * durMin * 60) / 3600) * Math.pow((wAvg / ftp), 2) * 100;
  if (reps > 1) {
    tssAcumulado += (((reps - 1) * recSec) / 3600) * Math.pow(0.50, 2) * 100;
  }
  tssAcumulado += (600 / 3600) * Math.pow(0.45, 2) * 100;

  const tssEsperado = Math.round(tssAcumulado);
  const ifEsperado = (wAvg / ftp).toFixed(2);

  const wMediosEstimados = ((wuDur * (ftp * wuPct)) + ((reps * durMin * 60) * wAvg) + (600 * (ftp * 0.45))) / duracionTotalSec;
  const kjEsperados = Math.round((wMediosEstimados * duracionTotalSec) / 1000);

  const eficienciaMetabolica = 0.22;
  const kcalTotales = kjEsperados / (eficienciaMetabolica * 4.184);
  let pctCarbs = 0.50;
  if (ifEsperado > 0.85) pctCarbs = 0.85;
  else if (ifEsperado > 0.75) pctCarbs = 0.70;

  const carbsEsperados = Math.round((kcalTotales * pctCarbs) / 4);

  return {
    tipo: tipo.toUpperCase(),
    reps,
    durMin,
    recSec,
    titulo: `AI-${tipo.toUpperCase()} ${reps}x${durMin}m`,
    wLow,
    wHigh,
    wRec: Math.round(ftp * 0.50),
    wWU: Math.round(ftp * wuPct),
    wCD: Math.round(ftp * 0.45),
    wuDur,
    ifEsperado,
    tssEsperado,
    kjEsperados,
    carbsEsperados,
    duracionTotalMin
  };
}

function construirEntrenamiento(decision, ftp) {
  if (decision.tipo === 'descanso') {
    return {
      tipo: 'DESCANSO',
      duracion: 0,
      mensaje: `🧠 *DESCANSO OBLIGATORIO*\n━━━━━━━━━━━━━━━━━━━━━━\nMotivo: ${decision.motivo}\n\nRecomendación: Movilidad suave o descanso total.`
    };
  }

  const entreno = generarEntrenamiento(
    decision.tipo,
    decision.reps || 1,
    decision.durMin || 60,
    decision.recSec || 0
  );

  entreno.prioridad = decision.prioridad;
  entreno.motivo = decision.motivo;
  entreno.intensidadObjetivo = decision.intensidad;
  entreno.notaHidratacion = decision.notaHidratacion || '💧 Hidratación normal';

  return entreno;
}

// ─── FUNCIONES UNIFICADAS ───
function calcularNutricionUnificada(estado, entreno) {
  try {
    const peso = CONFIG.WEIGHT_KG || 64;
    const edad = CONFIG.AGE_YEARS || 43;
    const pasos = estado.pasos || 0;
    const haceCalor = estado.haceCalor || false;
    const temp = estado.tempActual || 25;
    const kj = entreno && entreno.kjEsperados ? entreno.kjEsperados : 0;

    let tmb = 1650;
    if (edad > 40) tmb *= 0.95;
    if (edad > 45) tmb *= 0.93;

    const neat = pasos > 0 ? Math.round(pasos * 0.04) : 300;
    const kcalGastoTotal = Math.round(tmb + neat + kj);

    let ratioBase = kj > 0 ? 6.0 : 4.0;
    if (edad > 40) ratioBase += 0.5;
    if (haceCalor && temp > 30) ratioBase += 0.5;

    const chTotalDia = Math.round(peso * ratioBase);
    const protTotalDia = Math.round(peso * 1.8 + (edad > 40 ? 10 : 0));
    const grasaDiaria = Math.round((kcalGastoTotal * 0.25) / 9);

    let chInmediato = 0;
    if (kj > 0) {
      if (kj > 1200) chInmediato = 110;
      else if (kj >= 800) chInmediato = 90;
      else if (kj >= 500) chInmediato = 60;
      else chInmediato = 40;
    }

    const chRestante = chTotalDia - chInmediato;
    let chCena = kj > 0 ? Math.round(chRestante * 0.65) : Math.round(chRestante * 0.50);
    if (chCena < 40) chCena = 40;

    let hidratacion = (Math.round(peso * 35) / 1000).toFixed(1) + 'L base';
    if (haceCalor && temp > 30) hidratacion += ' + 0.5L extra por calor';
    if (haceCalor && temp > 35) hidratacion += ' + electrolitos obligatorios';

    return {
      chTotalDia,
      protTotalDia,
      grasaDiaria,
      chInmediato,
      chCena,
      hidratacion,
      kcalGastoTotal,
      esDiaDescanso: kj === 0,
      esDiaIntenso: kj > 800,
      haceCalor,
      temp
    };
  } catch(e) {
    return {
      chTotalDia: 300,
      protTotalDia: 120,
      grasaDiaria: 60,
      chInmediato: 40,
      chCena: 200,
      hidratacion: '2L base',
      kcalGastoTotal: 2000,
      esDiaDescanso: true,
      esDiaIntenso: false,
      haceCalor: false,
      temp: 25
    };
  }
}

function calcularFuerzaUnificada(estado) {
  try {
    const tsb = estado.tsb || 0;
    let nivel, recomendacion, ejercicios = [];

    if (tsb < -20) {
      nivel = 'Recuperación Activa';
      recomendacion = 'NO hagas fuerza con peso. Prioriza movilidad y estiramientos.';
      ejercicios = [
        'Plancha frontal: 3x30"',
        'Plancha lateral: 3x20" c/lado',
        'Bird-dog: 3x10 c/lado',
        'Glute bridge: 3x12',
        'Dead bug: 3x8 c/lado'
      ];
    } else if (tsb < -10) {
      nivel = 'Ligera-Moderada';
      recomendacion = 'Fuerza ligera para mantener tono. Sin fallo muscular.';
      ejercicios = [
        'Sentadilla goblet: 3x10 (8-12kg)',
        'Peso muerto rumano: 3x10 (2x8-12kg)',
        'Zancadas: 3x8 c/pierna',
        'Remo con banda: 3x12',
        'Plancha: 3x30" frontal + 20" lateral'
      ];
    } else if (tsb < 5) {
      nivel = 'Completa';
      recomendacion = 'Fuerza completa con buena intensidad.';
      ejercicios = [
        'Sentadilla: 4x8 (12-16kg)',
        'Peso muerto: 4x8 (14-18kg)',
        'Zancadas: 3x8 c/pierna (2x8-12kg)',
        'Hip thrust: 3x12 (10-15kg)',
        'Remo: 3x10 c/brazo (10-14kg)',
        'Core: 3x10 rueda o 3x45" plancha'
      ];
    } else {
      nivel = 'Intensa';
      recomendacion = 'Estás muy fresco. Aprovecha para fuerza máxima.';
      ejercicios = [
        'Sentadilla: 5x5 (25-35kg)',
        'Peso muerto: 4x5 (30-40kg)',
        'Zancada búlgara: 3x6-8 c/pierna',
        'Hip thrust pesado: 4x8 (15-20kg)',
        'Remo pesado: 4x6 (16-20kg)',
        'Core avanzado: 3x6-8 dragon flag'
      ];
    }

    return {
      nivel,
      recomendacion,
      ejercicios,
      duracion: tsb < -20 ? '15-20 min' : tsb < -10 ? '25-30 min' : tsb < 5 ? '35-45 min' : '45-50 min',
      recomendado: tsb < -15 ? false : true
    };
  } catch(e) {
    return {
      nivel: 'Básico',
      recomendacion: 'Rutina ligera',
      ejercicios: [],
      duracion: '20 min',
      recomendado: true
    };
  }
}

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

    if (estado.haceCalor && estado.tempActual > 35) {
      consejos.push('🔥 *Calor extremo.* No entrenes al aire libre. Rodillo con ventilador.');
    } else if (estado.haceCalor && estado.tempActual > 30) {
      consejos.push('🌡️ *Calor alto.* Salida controlada, hidratación extra.');
    }

    if (estado.sleepQuality === 1) consejos.push('😴 *Has dormido mal.* Reduce intensidad hoy.');
    if (estado.weeklyTss > 750) consejos.push('📊 *Carga semanal alta.* Considera un día extra de descanso.');
    if (CONFIG.AGE_YEARS > 40) consejos.push('🧠 *Master 40+.* Recuerda: la recuperación es clave.');

    consejos.sort((a, b) => {
      const pA = (a.includes('🔴') || a.includes('🔥')) ? 0 : 1;
      const pB = (b.includes('🔴') || b.includes('🔥')) ? 0 : 1;
      return pA - pB;
    });

    return consejos.slice(0, 3);
  } catch(e) {
    return ['✅ Sigue tu plan.'];
  }
}

// ─── ORQUESTADOR CENTRAL ───
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
    registrarInputTraza(traza, 'pasos', estado.pasos, 'Pasos diarios');
    console.log('[getAthleteState] 3. Estado OK. TSB:', estado.tsb);

    const restricciones = aplicarRestriccionesGlobales(estado, CONFIG.AGE_YEARS || 43);
    if (!restricciones || typeof restricciones !== 'object') {
      console.log('[getAthleteState] ❌ restricciones inválidas');
      return null;
    }
    console.log('[getAthleteState] 4. Restricciones OK.');

    let decision = decidirEntrenamiento(estado, restricciones);
    if (!decision || typeof decision !== 'object' || !decision.tipo) {
      console.log('[getAthleteState] ❌ decision inválida o sin tipo');
      return null;
    }
    console.log('[getAthleteState] 5. Decision OK. Tipo:', decision.tipo);

    let decisionClima = aplicarFactorClima(decision, estado.tempActual);
    if (!decisionClima || typeof decisionClima !== 'object' || !decisionClima.tipo) {
      console.log('[getAthleteState] ❌ decisionClima inválida');
      return null;
    }
    decision = decisionClima;
    console.log('[getAthleteState] 6. Factor clima aplicado. Nuevo tipo:', decision.tipo);

    const decisionResuelta = resolverConflictos(estado, restricciones, decision, traza);
    if (decisionResuelta && typeof decisionResuelta === 'object' && decisionResuelta.tipo) {
      decision = decisionResuelta;
      console.log('[getAthleteState] 7. Conflict Resolver aplicado. Tipo:', decision.tipo);
    } else {
      console.log('[getAthleteState] ⚠️ Conflict Resolver no devolvió decisión válida. Usando decision original.');
    }

    if (!decision.reps) decision.reps = 1;
    if (!decision.durMin) decision.durMin = 45;
    if (!decision.recSec) decision.recSec = 0;
    if (!decision.intensidad) decision.intensidad = 0.65;
    if (!decision.motivo) decision.motivo = 'Plan base';

    const entreno = construirEntrenamiento(decision, CONFIG.FTP);
    if (!entreno || typeof entreno !== 'object') {
      console.log('[getAthleteState] ❌ entreno inválido');
      return null;
    }
    console.log('[getAthleteState] 8. Entreno OK.');

    const nutricion = calcularNutricionUnificada(estado, entreno);
    const fuerza = calcularFuerzaUnificada(estado);
    const consejo = generarConsejoUnificado(estado, decision, restricciones);

    const stats = getEstadisticasAgregadas();
    const probabilidad = calcularProbabilidadAvanzada(decision, estado);

    registrarDecisionTraza(traza, decision.tipo, decision.prioridad || 'NIVEL 4 - PLAN');
    guardarTraza(traza);

    console.log('[getAthleteState] ✅ Todo OK. Devolviendo state.');

    return {
      timestamp: new Date(),
      datos,
      estado,
      restricciones,
      decision,
      entreno,
      nutricion,
      fuerza,
      consejo,
      traza,
      aprendizaje: {
        stats,
        probabilidad
      },
      tsb: estado.tsb,
      readiness: estado.readiness,
      tempActual: estado.tempActual,
      haceCalor: estado.haceCalor
    };

  } catch (err) {
    console.log('[getAthleteState] ❌ ERROR:', err.toString());
    console.log('[getAthleteState] Stack:', err.stack);
    return null;
  }
}

// ─── ESTADÍSTICAS ───
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

// ─── HISTORIAL ───
function obtenerHistorial() {
  try {
    const historial = getProperty('historial_entrenos');
    return historial ? JSON.parse(historial) : [];
  } catch (err) {
    console.log('[Historial] ERROR:', err.toString());
    return [];
  }
}

function guardarEntrenoHistorial(entreno, feedback) {
  try {
    const historial = obtenerHistorial();
    historial.push({
      fecha: new Date().toISOString(),
      entreno,
      feedback,
      resultado: calcularResultadoFeedback(feedback),
      peso: 1.0,
      validado: false
    });

    if (historial.length > CONFIG.MAX_HISTORIAL) {
      historial.splice(0, historial.length - CONFIG.MAX_HISTORIAL);
    }

    setProperty('historial_entrenos', JSON.stringify(historial));
    deleteProperty('stats_agregadas');
    console.log('[Historial] Feedback guardado');
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

// ─── COMANDOS PRINCIPALES ───
async function cmdStart() {
  const msg = `🌍 *WORLD TOUR COACH v9.1 - SISTEMA AUTOCONSCIENTE*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nHola Manu. Sistema con trazabilidad de decisiones.\n🎯 Objetivo: Recuperar ${CONFIG.FTP_HISTORICO.valor}W\n\n*📋 COMANDOS PRINCIPALES (UX SIMPLIFICADO)*\n/hoy - Resumen COMPLETO del día ⭐\n/hoy --estado - Estado completo\n/hoy --plan - Plan del día\n/hoy --clima - Clima + factor\n/hoy --nutricion - Nutrición + recetas\n/hoy --objetivo - Plan para 296W\n/hoy --ayuda - Ayuda de subcomandos\n\n*🧠 COMANDOS AVANZADOS*\n/traza - Ver última decisión con explicación ⭐\n/analizar - Análisis del entreno\n/progreso - Evolución anual\n/prediccion - Rendimiento esperado\n/fatiga - Análisis de fatiga\n/recuperacion - Tiempos de recuperación\n/alerta - Detección de sobreentrenamiento\n/tendencias - Evolución 90 días\n/semana - Resumen semanal\n/historial - 5 años optimizado\n/objetivo - Plan para 296W\n/aprender - Qué he aprendido\n\n*🛠️ HERRAMIENTAS*\n/zwo - Archivo rodillo\n/garmin - Subir a Intervals\n/exportar - Exportar datos\n/densidad - Densidad de carga\n/debug - Datos técnicos\n\nFTP: ${CONFIG.FTP}W | Peso: ${CONFIG.WEIGHT_KG}kg | Edad: ${CONFIG.AGE_YEARS} años\n🧠 v9.1: Decision Trace + Conflict Resolver + Learning Filter`;

  await sendTelegram(msg);
}

async function cmdHoy(chatId) {
  try {
    const state = await getAthleteState();
    if (!state) {
      await sendTelegram('Sin datos.');
      return;
    }

    let msg = '🌅 *WORLD TOUR COACH v9.1 - HOY*\n';
    msg += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

    const emoji = state.tsb > 0 ? '🟢' : state.tsb > -10 ? '🟡' : '🔴';
    msg += '*📊 ESTADO*\n';
    msg += `• Readiness: *${state.readiness}/100*\n`;
    msg += `• CTL: ${state.estado.ctl.toFixed(1)} | ATL: ${state.estado.atl.toFixed(1)} | TSB: ${state.tsb.toFixed(1)}\n`;
    msg += `• Sueño: ${state.estado.sleepQuality === 1 ? '😴 Malo' : state.estado.sleepQuality === 2 ? '🟡 Regular' : '🟢 Bueno'}\n`;
    msg += `• Pasos: ${state.estado.pasos.toLocaleString()}\n`;
    if (state.estado.acwr > 1.3) msg += `• ⚠️ ACWR: ${state.estado.acwr.toFixed(2)} (ALTO)\n`;
    msg += '\n';

    const ftpHistorico = CONFIG.FTP_HISTORICO || { valor: 296 };
    const diffFTP = ftpHistorico.valor - CONFIG.FTP;
    if (diffFTP > 0) {
      msg += `*🎯 OBJETIVO: ${ftpHistorico.valor}W*\n`;
      msg += `• Te faltan *${diffFTP}W* para tu mejor momento\n`;
      msg += '• Usa /objetivo para ver el plan completo\n\n';
    }

    if (state.decision.tipo === 'descanso') {
      msg += '*🧘 HOY TOCA: DESCANSO TOTAL*\n';
      msg += `Motivo: ${state.decision.motivo}\n\n`;
    } else {
      msg += '*🚴 HOY TOCA*\n';
      msg += `• ${state.decision.tipo.toUpperCase()}`;
      if (state.decision.reps > 0) msg += ` ${state.decision.reps}x${state.decision.durMin}min\n`;
      else msg += ` ${state.decision.durMin}min\n`;
      msg += `• Intensidad: ${(state.decision.intensidad * 100).toFixed(0)}% FTP\n`;
      msg += `• Vatios: ${state.entreno.wLow}-${state.entreno.wHigh}W\n`;
      if (state.entreno && state.entreno.tssEsperado) {
        msg += `• TSS: ${state.entreno.tssEsperado} | IF: ${state.entreno.ifEsperado}\n`;
      }
      if (state.decision.notaHidratacion) msg += `• ${state.decision.notaHidratacion}\n`;
      msg += '\n';
    }

    if (state.datos.weather && typeof state.datos.weather === 'object') {
      const w = state.datos.weather;
      const temp = w.temp || 'N/D';
      const wind = w.wind || 0;
      const rain = w.rain || 0;
      const desc = w.description || 'Sin datos';
      const tempEmoji = typeof temp === 'number' ? (temp > 35 ? '🔥' : temp > 30 ? '🌡️' : temp > 25 ? '☀️' : '✅') : '🌤️';
      msg += '*🌤️ CLIMA*\n';
      msg += `• ${tempEmoji} ${temp}°C | Viento ${wind} km/h\n`;
      msg += `• ${desc}${rain > 0 ? ' | 🌧️ Lluvia' : ''}\n`;
      if (state.decision.tipo !== 'descanso') {
        if (typeof temp === 'number' && temp > 35) msg += '• ⚠️ Calor extremo - Rodillo recomendado\n';
        else if (typeof temp === 'number' && temp > 30) msg += '• ⚠️ Calor alto - Salida controlada\n';
        else msg += '• ✅ Condiciones favorables\n';
      }
      msg += '\n';
    }

    if (state.decision.tipo !== 'descanso' && state.entreno && state.entreno.carbsEsperados) {
      msg += '*🍏 NUTRICIÓN*\n';
      msg += `• CH durante entreno: ${state.entreno.carbsEsperados}g\n`;
      msg += `• Post-entreno: ${Math.round(state.entreno.carbsEsperados * 0.8)}g CH + 30g Proteína\n`;
      msg += `• ${state.nutricion.hidratacion}\n\n`;

      msg += '🍳 *Receta rápida post-entreno*\n';
      msg += 'Batido recuperador:\n';
      msg += '• 300ml leche o bebida vegetal\n';
      msg += '• 1 plátano\n';
      msg += `• ${Math.round(state.entreno.carbsEsperados * 0.6)}g avena o miel\n`;
      msg += '• 30g proteína de suero\n';
      msg += '• Hielo al gusto\n\n';
    } else {
      msg += '*🍏 NUTRICIÓN*\n';
      msg += '• Día de descanso: Prioriza proteína y vegetales\n';
      msg += `• ${state.nutricion.hidratacion}\n\n`;
    }

    msg += '*🏋️ FUERZA*\n';
    if (state.fuerza.recomendado) {
      msg += `• ${state.fuerza.nivel} (${state.fuerza.duracion})\n`;
      msg += `• ${state.fuerza.ejercicios.slice(0, 3).join(' | ')}\n`;
    } else {
      msg += '• No recomendada hoy (fatiga alta)\n';
      msg += '• Haz solo movilidad y estiramientos\n';
    }
    msg += '\n';

    if (state.aprendizaje && state.aprendizaje.probabilidad) {
      const p = state.aprendizaje.probabilidad;
      msg += `*📊 PROBABILIDAD DE ÉXITO*\n`;
      msg += `• ${p.nivel} (${p.probabilidad}%)\n`;
      msg += `• ${p.base}\n\n`;
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

    msg += '*💡 CONSEJO DEL DÍA*\n';
    state.consejo.forEach((c) => { msg += `• ${c}\n`; });

    msg += '\n*🧠 MÁXIMA DEL COACH*\n';
    if (state.decision.tipo === 'descanso') {
      msg += '_La mejor sesión de hoy es la que no haces. Recupera para rendir mañana._';
    } else if (state.haceCalor && state.tempActual > 35) {
      msg += `_Con ${state.tempActual}°C, la calidad se reduce. Mejor intensidad controlada que volumen vacío._`;
    } else if (state.tsb > 10 && state.readiness > 80) {
      msg += '_Hoy tienes ventana de calidad. Aprovecha, pero escucha a tu cuerpo._';
    } else {
      msg += '_Consistencia > Intensidad. Un día a la vez, siempre con propósito._';
    }

    const hora = new Date().getHours();
    if (hora >= 6 && hora < 14) {
      msg += '\n\n⏰ *Estás en horario laboral (6:00-14:00)*\nTu entreno será después de las 14:00.';
    } else {
      msg += '\n\n⏰ *Fuera de horario laboral* - Puedes entrenar ahora.';
    }

    msg += '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    msg += '📱 *Subcomandos:* /hoy --estado | --plan | --clima | --nutricion | --objetivo | --ayuda';
    msg += '\n🧠 *Ver traza completa:* /traza';

    await sendTelegramLong(msg);
  } catch (err) {
    console.log('[cmdHoy] ERROR:', err.toString());
    await sendTelegram(`Error en /hoy: ${err.message}`);
  }
}

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
    msg += `📌 *Versión:* ${traza.version || '9.1'}\n\n`;

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

// ─── COMANDO ZWO ───
async function cmdZwo(args) {
  try {
    if (!args || typeof args !== 'object') {
      args = [];
    }

    const state = await getAthleteState();
    if (!state || state.decision.tipo === 'descanso') {
      await sendTelegram('⚠️ No hay plan de entreno activo o es día de descanso.');
      return;
    }

    const tipo = args[0] ? args[0].toLowerCase().trim() : state.decision.tipo || 'z2';
    let reps = args[1] ? parseInt(args[1], 10) : (state.decision.reps || 3);
    let dur = args[2] ? parseInt(args[2], 10) : (state.decision.durMin || 8);
    let rec = args[3] ? parseInt(args[3], 10) : (state.decision.recSec || 120);

    if (isNaN(reps)) reps = 3;
    if (isNaN(dur)) dur = 8;
    if (isNaN(rec)) rec = 120;

    const entreno = generarEntrenamiento(tipo, reps, dur, rec);
    if (!entreno) {
      await sendTelegram('❌ No se pudo generar el entreno.');
      return;
    }

    let msg = '📄 *ARCHIVO ZWO PARA RODILLO*\n';
    msg += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    msg += `*Tipo:* ${tipo.toUpperCase()}\n`;
    msg += `*Estructura:* ${reps}x${dur} min\n`;
    if (rec > 0) msg += `*Recuperación:* ${rec} seg\n`;
    msg += `*Duración total:* ${entreno.duracionTotalMin} min\n\n`;
    msg += '*📊 MÉTRICAS*\n';
    msg += `• TSS estimado: ${entreno.tssEsperado}\n`;
    msg += `• IF esperado: ${entreno.ifEsperado}\n`;
    msg += `• KJ esperados: ${entreno.kjEsperados}\n\n`;
    msg += '*💻 CÓDIGO ZWO (copia y pega en Zwift/TR)*\n';
    msg += '```\n';
    const wu = entreno.wWU;
    const wLow = entreno.wLow;
    const wHigh = entreno.wHigh;
    const wRec = entreno.wRec;
    const wCD = entreno.wCD;
    msg += `WU: ${wu - 10} - ${wu + 10}W (10min)\n`;
    for (let i = 1; i <= reps; i++) {
      msg += `Rep ${i}: ${wLow - 5} - ${wHigh + 5}W (${dur}min)\n`;
      if (i < reps && rec > 0) {
        msg += `Rec: ${wRec - 10} - ${wRec + 10}W (${(rec / 60).toFixed(1)}min)\n`;
      }
    }
    msg += `CD: ${wCD - 10} - ${wCD + 10}W (10min)\n`;
    msg += '```\n';
    msg += '\n⚠️ *Ajusta los vatios según tu percepción.*';

    await sendTelegramLong(msg);
  } catch (err) {
    console.log('[cmdZwo] ERROR:', err.toString());
    await sendTelegram(`❌ Error en /zwo: ${err.message}`);
  }
}

// ─── COMANDO GARMIN ───
async function cmdGarmin(args) {
  if (!args || !Array.isArray(args)) { args = []; }

  const props = {
    plan_tipo: getProperty('plan_tipo'),
    plan_reps: getProperty('plan_reps'),
    plan_durMin: getProperty('plan_durMin'),
    plan_recSec: getProperty('plan_recSec')
  };

  const tipo = args[0] ? args[0].toLowerCase().trim() : props.plan_tipo;
  let reps = args[1] ? parseInt(args[1], 10) : parseInt(props.plan_reps);
  let durMin = args[2] ? parseInt(args[2], 10) : parseInt(props.plan_durMin);
  let recSec = args[3] ? parseInt(args[3], 10) : parseInt(props.plan_recSec);

  if (isNaN(reps)) reps = 1;
  if (isNaN(durMin)) durMin = 45;
  if (isNaN(recSec)) recSec = 0;

  let entreno;
  if (!tipo) {
    entreno = generarEntrenamiento(null, null, null, null);
  } else {
    const validos = ['sweetspot', 'vo2', 'ftp', 'z2'];
    if (validos.indexOf(tipo.toLowerCase()) === -1) {
      await sendTelegram('Tipo inválido. Usa: sweetspot | vo2 | ftp | z2');
      return;
    }
    entreno = generarEntrenamiento(tipo, reps, durMin, recSec);
  }

  try {
    const hoy = formatDate(new Date());
    const ftp = CONFIG.FTP;

    const wuLowW = Math.round(ftp * 0.40);
    const wuHighW = Math.round(ftp * 0.55);
    let textoIntervals = `- Warmup ${Math.round(entreno.wuDur / 60)}m ${wuLowW}-${wuHighW}w\n\n`;

    const mainW = Math.round(entreno.wLow);
    const mainLow = Math.round(mainW * 0.95);
    const mainHigh = Math.round(mainW * 1.05);

    for (let i = 0; i < entreno.reps; i++) {
      textoIntervals += `- ${entreno.durMin}m ${mainLow}-${mainHigh}w\n`;
      if (entreno.recSec > 0 && i < entreno.reps - 1) {
        const recW = Math.round(ftp * 0.45);
        textoIntervals += `- ${Math.round(entreno.recSec / 60)}m ${recW}w\n`;
      }
    }

    const cdLowW = Math.round(ftp * 0.40);
    const cdHighW = Math.round(ftp * 0.50);
    textoIntervals += `\n- Cooldown 10m ${cdLowW}-${cdHighW}w`;

    const payloadIntervals = {
      category: 'WORKOUT',
      type: 'Ride',
      name: entreno.titulo,
      start_date_local: hoy + 'T08:00:00',
      description: textoIntervals
    };

    await postIntervals('/events', payloadIntervals);
    console.log('[cmdGarmin] Enviado con éxito a Intervals.');

    const msg = `*🚀 ¡ENTRENO ENVIADO A INTERVALS.ICU!*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n• *Título:* ${entreno.titulo}\n• *Fecha:* ${hoy}\n• *Métricas:* IF ${entreno.ifEsperado} | TSS ${entreno.tssEsperado}\n\n_Subido correctamente con intensidades corregidas._`;
    await sendTelegram(msg);

  } catch (err) {
    console.log('[cmdGarmin] Error:', err.toString());
    await sendTelegram(`❌ Error: ${err.message}`);
  }
}

// ─── WEBHOOK PRINCIPAL ───
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    const message = body.message || body.edited_message || body.channel_post;

    if (!message) return res.json({ ok: true });
    if (message.from && message.from.is_bot) return res.json({ ok: true });

    const chatId = (message.chat && message.chat.id) ? message.chat.id.toString() : '';
    const rawText = (message.text || '').trim();

    if (!chatId || chatId !== CONFIG.CHAT_ID.toString()) {
      console.log('[Webhook] Chat no autorizado');
      return res.json({ ok: true });
    }

    const uniqueKey = chatId + '_' + (message.message_id || '');
    const lastKey = getProperty('last_msg_key');
    if (lastKey === uniqueKey) return res.json({ ok: true });
    setProperty('last_msg_key', uniqueKey);

    if (!rawText) return res.json({ ok: true });

    if (await procesarMensajeFeedback(rawText, chatId)) {
      return res.json({ ok: true });
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
      return res.json({ ok: true });
    }

    switch (cmd) {
      case '/start': await cmdStart(); break;
      case '/plan': await cmdPlan(); break;
      case '/estado': await cmdEstado(); break;
      case '/analizar': await cmdAnalizar(); break;
      case '/clima': await cmdClima(); break;
      case '/ajuste': await cmdAjuste(); break;
      case '/nutricion': await cmdNutricion(); break;
      case '/fuerza': await cmdFuerza(); break;
      case '/semana': await cmdSemana(); break;
      case '/semanapasada': await cmdSemanaPasada(); break;
      case '/consejo': await cmdConsejo(); break;
      case '/resumen': await cmdResumen(); break;
      case '/fatiga': await cmdFatiga(); break;
      case '/aprender': await cmdAprender(); break;
      case '/aprender-validar': await cmdAprenderValidar(); break;
      case '/tendencias': await cmdTendencias(); break;
      case '/recuperacion': await cmdRecuperacion(); break;
      case '/prediccion': await cmdPrediccion(); break;
      case '/progreso': await cmdProgreso(); break;
      case '/alerta': await cmdAlerta(); break;
      case '/densidad': await cmdDensidad(); break;
      case '/exportar': await cmdExportar(); break;
      case '/objetivo': await cmdObjetivo(); break;
      case '/historial': await cmdHistorial(); break;
      case '/zwo': await cmdZwo(args); break;
      case '/garmin': await cmdGarmin(args); break;
      case '/debug': await cmdDebug(); break;
      case '/traza': await cmdTraza(); break;
      default:
        await sendTelegram('Comando no reconocido.\nEscribe /start para ver el menu.');
    }

    res.json({ ok: true });
  } catch (err) {
    console.log('[Webhook] ERROR:', err.toString());
    res.status(500).json({ error: err.message });
  }
});

// ─── PROCESAR MENSAJE FEEDBACK ───
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
      await sendTelegram('*2/5 - Cumpliste los vatios objetivo?*\nResponde: si / parcial / no');
      break;

    case 2:
      estado.watts = (t === 'si') ? 'si' : (t === 'parcial' ? 'parcial' : 'no');
      estado.paso = 3;
      await sendTelegram('*3/5 - Sensacion de piernas (1-3)*\n1 = pesadas · 2 = normales · 3 = ligeras');
      break;

    case 3:
      estado.piernas = Math.min(3, Math.max(1, parseInt(t) || 2));
      estado.paso = 4;
      await sendTelegram('*4/5 - Estres / carga laboral hoy (1-3)*\n1 = bajo · 2 = normal · 3 = alto');
      break;

    case 4:
      estado.stress = Math.min(3, Math.max(1, parseInt(t) || 2));
      estado.paso = 5;
      await sendTelegram('*5/5 - Calidad del sueno anoche (1-3)*\n1 = mal · 2 = regular · 3 = bien');
      break;

    case 5:
      estado.sleep = Math.min(3, Math.max(1, parseInt(t) || 2));

      const datos = await obtenerDatosCompletos();
      const hoy = datos ? datos.today : {};
      const ctl = safeNum(hoy.ctl, 50);
      const atl = safeNum(hoy.atl, 50);
      const tsb = ctl - atl;
      const acwr = calcularACWR();

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
        `Sueno: ${buildTextoSleep(estado.sleep)}\n\n` +
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

      guardarEntrenoHistorial(entrenoActual, feedback);

      deleteUserProperty(FEEDBACK_KEY);
      return true;
  }

  setUserProperty(FEEDBACK_KEY, JSON.stringify(estado));
  return true;
}

// ─── FUNCIONES AUXILIARES DE FEEDBACK ───
function calcularReadiness(rpe, legs, stress, sleep, tsb, atl, ctl, watts) {
  const safeRpe = safeNum(rpe, 5);
  const safeLegs = safeNum(legs, 2);
  const safeStress = safeNum(stress, 2);
  const safeSleep = safeNum(sleep, 2);
  const safeTsb = safeNum(tsb, 0);
  const safeAtl = safeNum(atl, 50);
  const safeCtl = safeNum(ctl, 50);
  const safeWatts = (typeof watts === 'string') ? watts : 'si';

  let score = 100;

  if (safeRpe >= 9) score -= 35;
  else if (safeRpe >= 8) score -= 25;
  else if (safeRpe >= 7) score -= 15;
  else if (safeRpe >= 5) score -= 5;

  if (safeLegs === 1) score -= 20;
  else if (safeLegs === 2) score -= 5;

  if (safeSleep === 1) score -= 20;
  else if (safeSleep === 2) score -= 5;

  if (safeStress === 3) score -= 15;
  else if (safeStress === 2) score -= 5;

  if (safeWatts === 'no') score -= 15;
  else if (safeWatts === 'parcial') score -= 7;

  if (safeTsb < -20) score -= 10;
  else if (safeTsb > 10) score += 5;

  const ratio = (safeCtl > 0) ? (safeAtl / safeCtl) : 1;
  if (ratio > 1.4) score -= 15;
  else if (ratio > 1.2) score -= 8;

  return Math.max(5, Math.min(100, Math.round(score)));
}

function calcularFatigaOculta(rpe, tsb, legs, watts) {
  const safeRpe = safeNum(rpe, 5);
  const safeTsb = safeNum(tsb, 0);
  const safeLegs = safeNum(legs, 2);
  const safeWatts = (typeof watts === 'string') ? watts : 'si';

  const rpeAltoTsbOk = safeRpe >= 7 && safeTsb > -5;
  const noAlcanzaVatios = safeWatts === 'no' || safeWatts === 'parcial';
  const piernasMalas = safeLegs === 1;

  if ((rpeAltoTsbOk && noAlcanzaVatios) || (piernasMalas && noAlcanzaVatios) || (safeRpe >= 8 && safeLegs === 1)) {
    return 'Alta';
  }
  if (rpeAltoTsbOk || piernasMalas || noAlcanzaVatios) {
    return 'Media';
  }
  return 'Baja';
}

function calcularZonaRecomendada(readiness) {
  const r = safeNum(readiness, 50);
  if (r < 35) return 'Descanso total';
  if (r < 50) return 'Z1 - Rodaje suave';
  if (r < 65) return 'Z2 - Base aerobica';
  if (r < 78) return 'Tempo / Sweet Spot';
  if (r < 90) return 'Sweet Spot / Umbral';
  return 'Umbral / VO2 Max';
}

function getSemaforo(readiness) {
  const r = safeNum(readiness, 50);
  if (r < 45) return 'ROJO - No cargar';
  if (r < 70) return 'AMARILLO - Precaucion';
  return 'VERDE - Adelante';
}

function buildTextoStress(s) {
  const n = safeNum(s, 2);
  return n === 1 ? 'Bajo' : n === 2 ? 'Medio' : 'Alto';
}

function buildTextoSleep(s) {
  const n = safeNum(s, 2);
  return n === 1 ? 'Malo' : n === 2 ? 'Regular' : 'Bien';
}

function buildExplicacionStaff(readiness, fatigaOculta, estado, tsb, acwr) {
  const r = safeNum(readiness, 50);
  const a = safeNum(acwr, 1.0);
  let texto = '';

  if (r < 40) {
    texto = '🔴 ROJO: Fatiga severa. Descanso total para absorber la carga.';
  } else if (r < 55) {
    texto = '🟠 NARANJA: Recuperación activa. El cuerpo pide Z2 suave o movilidad.';
  } else if (r < 70) {
    texto = '🟡 AMARILLO: Sistema disponible con reservas. Z2 controlada.';
  } else if (r < 85) {
    texto = '🟢 VERDE: Condición razonable para trabajo estructurado.';
  } else {
    texto = '🟢 VERDE: Readiness óptimo. Día ideal para calidad.';
  }

  if (fatigaOculta === 'Alta') texto += ' Hay fatiga oculta.';
  if (a > 1.5) texto += ` ACWR ${a.toFixed(2)}: reducción obligatoria.`;

  return texto;
}

// ─── COMANDOS SIMPLIFICADOS ───
async function cmdEstado() {
  try {
    const state = await getAthleteState();
    if (!state) { await sendTelegram('Sin datos.'); return; }

    let msg = '*📊 ESTADO COMPLETO v9.1*\n';
    msg += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    msg += '*💪 MÉTRICAS DE CARGA*\n';
    msg += `• CTL: ${state.estado.ctl.toFixed(1)}\n`;
    msg += `• ATL: ${state.estado.atl.toFixed(1)}\n`;
    msg += `• TSB: *${state.tsb.toFixed(1)}* ${state.tsb > 0 ? '🟢' : state.tsb > -10 ? '🟡' : '🔴'}\n`;
    msg += `• Readiness: *${state.readiness}/100* ${state.readiness > 70 ? '🟢' : state.readiness > 50 ? '🟡' : '🔴'}\n\n`;
    msg += '*😴 RECUPERACIÓN*\n';
    msg += `• HRV: ${state.estado.hrv || 'N/D'}\n`;
    msg += `• Sueño: ${state.estado.sleepQuality === 1 ? '⚠️ Malo' : state.estado.sleepQuality === 2 ? '🟡 Regular' : '🟢 Bueno'}\n`;
    msg += `• Pasos: ${state.estado.pasos.toLocaleString()}\n\n`;
    msg += '*📈 CARGA SEMANAL*\n';
    msg += `• TSS: ${Math.round(state.estado.weeklyTss)} / ${state.restricciones.tssMaxSemanal}\n`;
    msg += `• Sesiones: ${state.estado.weeklySessions}\n`;
    msg += `• ACWR: ${state.estado.acwr.toFixed(2)}${state.estado.acwr > 1.3 ? ' ⚠️ ALTO' : ' ✅ OK'}\n\n`;

    if (state.haceCalor) {
      msg += '*🌡️ CLIMA*\n';
      msg += `• ${state.tempActual}°C ${state.tempActual > 35 ? '🔥 Calor extremo' : state.tempActual > 30 ? '🌡️ Calor alto' : '☀️ Calor moderado'}\n`;
      msg += '• Factor de ajuste aplicado en /plan\n\n';
    }

    await sendTelegramLong(msg);
  } catch (err) {
    console.log('[cmdEstado] ERROR:', err.toString());
    await sendTelegram(`Error en /estado: ${err.message}`);
  }
}

async function cmdPlan() {
  try {
    const state = await getAthleteState();
    if (!state) { await sendTelegram('Sin datos.'); return; }

    let msg = '*🧠 PLAN DEL DÍA (v9.1)*\n';
    msg += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    msg += '*📊 ESTADO*\n';
    msg += `• TSB: ${state.tsb.toFixed(1)} | Readiness: ${state.readiness}/100\n`;
    msg += `• Sueño: ${state.estado.sleepQuality === 1 ? '⚠️ Malo' : state.estado.sleepQuality === 2 ? '🟡 Regular' : '🟢 Bueno'}\n`;
    msg += `• TSS semanal: ${Math.round(state.estado.weeklyTss)} / ${state.restricciones.tssMaxSemanal}\n`;
    if (state.haceCalor) msg += `• 🌡️ ${state.tempActual}°C (factor de ajuste aplicado)\n`;
    msg += '\n';

    if (state.restricciones.motivo && state.restricciones.motivo.length > 0) {
      msg += '*🔒 RESTRICCIONES*\n';
      state.restricciones.motivo.forEach((m) => { msg += `• ${m}\n`; });
      msg += '\n';
    }

    if (state.decision.tipo === 'descanso') {
      msg += '*🧘 DESCANSO TOTAL*\n';
      msg += `Motivo: ${state.decision.motivo}\n\n`;
      msg += '💡 *Recomendación:* Movilidad 15\' y foam rolling.';
    } else {
      msg += '*🚴 ENTRENO*\n';
      msg += `• Tipo: *${state.decision.tipo.toUpperCase()}*\n`;
      if (state.decision.reps > 0) {
        msg += `• Estructura: *${state.decision.reps}x${state.decision.durMin} min*\n`;
        if (state.decision.recSec > 0) msg += `• Recuperación: *${state.decision.recSec} seg*\n`;
      } else {
        msg += `• Duración: *${state.decision.durMin} min*\n`;
      }
      msg += `• Vatios: *${state.entreno.wLow}-${state.entreno.wHigh}W*\n`;
      msg += `• Prioridad: *${(state.decision.prioridad || 'base').replace('_', ' ').toUpperCase()}*\n`;
      if (state.decision.notaHidratacion) msg += `• ${state.decision.notaHidratacion}\n`;
      msg += '\n';
      if (state.entreno && state.entreno.tssEsperado) {
        msg += '*📈 MÉTRICAS*\n';
        msg += `• TSS: *${state.entreno.tssEsperado}*\n`;
        msg += `• IF: *${state.entreno.ifEsperado}*\n`;
        msg += `• KJ: *${state.entreno.kjEsperados} kJ*\n`;
        msg += `• CH: *${state.entreno.carbsEsperados}g*\n\n`;
      }
    }

    if (state.aprendizaje && state.aprendizaje.probabilidad && state.decision.tipo !== 'descanso') {
      const p = state.aprendizaje.probabilidad;
      msg += `*📊 PROBABILIDAD DE ÉXITO*\n`;
      msg += `• ${p.nivel} (${p.probabilidad}%)\n\n`;
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
  } catch (err) {
    console.log('[cmdPlan] ERROR:', err.toString());
    await sendTelegram(`Error en /plan: ${err.message}`);
  }
}

// ─── COMANDOS ADICIONALES (RESUMEN) ───
async function cmdClima() {
  try {
    const state = await getAthleteState();
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
    const tempNum = typeof temp === 'number' ? temp : 25;

    let msg = '*🌤️ CLIMA + FACTOR DE AJUSTE*\n';
    msg += '━━━━━━━━━━━━━━━━━━━━━━\n';
    msg += `📍 ${CONFIG.CITY}\n`;
    msg += `🌡️ ${temp}°C\n`;
    msg += `💨 Viento: ${wind} km/h\n`;
    msg += `🌧️ Lluvia: ${rain} mm\n`;
    msg += `☁️ ${desc}\n`;
    msg += `📊 TSB: ${state.tsb.toFixed(1)}\n\n`;

    let recomendacion = '', hidratacion = '';
    if (tempNum > 38) {
      recomendacion = '🔴 *CALOR EXTREMO* - Reduce duración 30% e intensidad 10%\n→ Rodillo o salida muy corta';
      hidratacion = '💧 1L/hora + electrolitos obligatorios';
    } else if (tempNum > 35) {
      recomendacion = '🟠 *CALOR MUY ALTO* - Reduce duración 20% e intensidad 5%\n→ Rodillo o salida corta';
      hidratacion = '💧 1L/hora + electrolitos';
    } else if (tempNum > 32) {
      recomendacion = '🟡 *CALOR ALTO* - Reduce duración 15%\n→ Salida controlada';
      hidratacion = '💧 750ml/hora + electrolitos';
    } else if (tempNum > 28) {
      recomendacion = '🟡 *CALOR MODERADO* - Reduce duración 10%\n→ Salida normal con hidratación extra';
      hidratacion = '💧 750ml/hora';
    } else if (tempNum > 25) {
      recomendacion = '🟢 *CALOR LIGERO* - Sin ajustes significativos';
      hidratacion = '💧 500ml/hora';
    } else if (tempNum < 5) {
      recomendacion = '❄️ *FRÍO* - Reduce duración 10%\n→ Protege extremidades';
      hidratacion = '💧 500ml/hora';
    } else {
      recomendacion = '✅ *TEMPERATURA IDEAL* - Sin ajustes';
      hidratacion = '💧 500ml/hora';
    }

    msg += '*📊 FACTOR CLIMA APLICADO*\n';
    msg += recomendacion + '\n\n';
    msg += hidratacion + '\n\n';
    msg += '📱 *Comandos:* /plan | /ajuste | /hoy';

    await sendTelegramLong(msg);
  } catch (err) {
    console.log('[cmdClima] ERROR:', err.toString());
    await sendTelegram(`Error en /clima: ${err.message}`);
  }
}

async function cmdNutricion() {
  try {
    const state = await getAthleteState();
    if (!state) { await sendTelegram('Sin datos.'); return; }
    const n = state.nutricion;

    let msg = '*🥗 NUTRICIÓN + RECETAS*\n';
    msg += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

    if (state.decision.tipo !== 'descanso') {
      msg += '*📊 MÉTRICAS DE DESGASTE*\n';
      msg += `• Entreno: ${state.decision.tipo.toUpperCase()}\n`;
      msg += `• KJ: *${state.entreno.kjEsperados} kJ* | CH oxidados: *${state.entreno.carbsEsperados}g*\n\n`;
    } else {
      msg += '*🧘 DÍA DE REPOSO*\n';
      msg += '• Enfoque: Mantenimiento y recuperación\n\n';
    }

    msg += '*🔥 BALANCE ENERGÉTICO*\n';
    msg += `• Gasto total: ~*${n.kcalGastoTotal} kcal*\n\n`;

    if (n.haceCalor && n.temp > 30) {
      msg += `🌡️ *CALOR DETECTADO (${n.temp}°C)*\n`;
      msg += '• CH extra por calor: +0.5g/kg\n';
      msg += '• Electrolitos extra\n\n';
    }

    msg += '*📊 OBJETIVOS MACRO DIARIOS*\n';
    msg += `• 🍞 CH: *${n.chTotalDia}g*\n`;
    msg += `• 🍗 Proteína: *${n.protTotalDia}g*\n`;
    msg += `• 🥑 Grasas: *${n.grasaDiaria}g*\n\n`;

    if (state.decision.tipo !== 'descanso') {
      msg += '*⏳ TIMING POST-ENTRENO*\n';
      msg += `🥤 *Inmediatamente después (15-30 min):*\n`;
      msg += `   → ${n.chInmediato}g CH + 30g Proteína\n`;
      msg += '   → Ejemplo: 2 plátanos + batido proteico\n\n';
      msg += `🍽️ *1-2 horas después:*\n`;
      msg += `   → ${n.chCena}g CH + 40g Proteína\n\n`;
    }

    msg += `💧 *HIDRATACIÓN:* ${n.hidratacion}\n\n`;

    msg += '🍳 *RECETAS RÁPIDAS*\n';
    msg += '━━━━━━━━━━━━━━━━━━━━━━\n\n';

    if (state.decision.tipo !== 'descanso') {
      msg += '*🥤 RECUPERACIÓN INMEDIATA*\n';
      msg += 'Batido recuperador:\n';
      msg += '• 300ml leche o bebida vegetal\n';
      msg += '• 1 plátano\n';
      msg += '• 30g proteína de suero\n';
      msg += '• 1 cucharada de miel\n\n';

      msg += '*🍽️ COMIDA PRINCIPAL*\n';
      if (n.haceCalor && n.temp > 35) {
        msg += 'Ensalada fría de pasta:\n';
        msg += '• 80g pasta integral (en frío)\n';
        msg += '• 150g atún o pollo\n';
        msg += '• Tomate cherry, aceitunas\n';
        msg += '• Aceite de oliva y orégano\n\n';
      } else {
        msg += 'Plato de recuperación:\n';
        msg += '• 200g arroz integral o quinoa\n';
        msg += '• 180g pechuga de pollo\n';
        msg += '• Brócoli y zanahoria al vapor\n';
        msg += '• 1 cucharada de aceite de oliva\n\n';
      }
    }

    msg += '*🍎 SNACKS SALUDABLES*\n';
    msg += '• 1 puñado de frutos secos (25g)\n';
    msg += '• 1 yogur griego natural\n';
    msg += '• 1 pieza de fruta\n\n';

    msg += '💡 *Consejos del chef:*\n';
    if (n.haceCalor && n.temp > 35) {
      msg += '• 🔴 Prioriza comidas frías y ligeras\n';
      msg += '• Añade sal a las comidas para reponer electrolitos\n';
    } else if (n.haceCalor && n.temp > 30) {
      msg += '• 🟡 Prefiere comidas con alto contenido en agua\n';
      msg += '• Hidratación constante, no esperes a tener sed\n';
    } else if (state.decision.tipo === 'descanso') {
      msg += '• Aprovecha el día de descanso para comer más vegetales\n';
    } else {
      msg += '• Come cada 3-4 horas para mantener energía\n';
    }

    msg += `\n_Edad: ${CONFIG.AGE_YEARS} años | Peso: ${CONFIG.WEIGHT_KG}kg_`;

    await sendTelegramLong(msg);
  } catch (err) {
    console.log('[cmdNutricion] ERROR:', err.toString());
    await sendTelegram(`Error en /nutricion: ${err.message}`);
  }
}

async function cmdFuerza() {
  try {
    const state = await getAthleteState();
    if (!state) { await sendTelegram('Sin datos.'); return; }
    const f = state.fuerza;

    let msg = '🏋️ *RUTINA DE FUERZA*\n';
    msg += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    msg += `*📊 ESTADO:* TSB ${state.tsb.toFixed(1)} | Readiness ${state.readiness}/100\n`;
    msg += `*🎯 NIVEL:* ${f.nivel} (${f.duracion})\n\n`;
    if (!f.recomendado) msg += '⚠️ *NO recomendada hoy.* Haz solo movilidad y estiramientos.\n\n';
    msg += '*💪 EJERCICIOS*\n';
    f.ejercicios.forEach((ej, idx) => { msg += `${idx+1}. ${ej}\n`; });
    msg += `\n💡 *Consejo:* ${f.recomendacion}\n`;
    if (state.haceCalor && state.tempActual > 30) {
      msg += '\n🌡️ *Con calor, alarga descansos y hidrata entre series.*\n';
    }
    msg += '\n📱 *Comandos:* /hoy | /plan | /estado';

    await sendTelegramLong(msg);
  } catch (err) {
    console.log('[cmdFuerza] ERROR:', err.toString());
    await sendTelegram(`Error en /fuerza: ${err.message}`);
  }
}

async function cmdObjetivo() {
  try {
    const state = await getAthleteState();
    if (!state) { await sendTelegram('Sin datos.'); return; }
    const ftpHistorico = CONFIG.FTP_HISTORICO || { valor: 296, peso: 60 };
    const diffFTP = ftpHistorico.valor - CONFIG.FTP;
    const pesoDiff = CONFIG.WEIGHT_KG - ftpHistorico.peso;

    let msg = `🎯 *PLAN PARA RECUPERAR LOS ${ftpHistorico.valor}W*\n`;
    msg += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    msg += '*📊 SITUACIÓN ACTUAL*\n';
    msg += `• FTP actual: *${CONFIG.FTP}W*\n`;
    msg += `• Mejor histórico: *${ftpHistorico.valor}W* (${ftpHistorico.fecha})\n`;
    msg += `• Diferencia: *${diffFTP}W* a recuperar\n\n`;

    if (diffFTP > 0) {
      msg += '*📈 PLAN DE 12 SEMANAS*\n';
      msg += '• Fase 1 (semanas 1-4): Base aeróbica (Z2-Z3)\n';
      msg += '  → 3-4 sesiones/semana, 60-90 min\n';
      msg += '  → Incluye fuerza general\n';
      msg += '• Fase 2 (semanas 5-8): Desarrollo FTP\n';
      msg += '  → SweetSpot + Tempo (Z3-Z4)\n';
      msg += '  → 1-2 sesiones de calidad/semana\n';
      msg += '• Fase 3 (semanas 9-12): Afinamiento\n';
      msg += '  → VO2 Max + Umbral\n';
      msg += '  → 2 sesiones de calidad/semana\n\n';
      msg += '*📊 OBJETIVOS DE CARGA*\n';
      msg += '• TSS semanal: 450-650\n';
      msg += '• Horas semanales: 6-9h\n';
      msg += '• Sesiones de calidad: 2-3/semana\n\n';
      msg += '*💪 FUERZA RECOMENDADA*\n';
      msg += '• 2 sesiones/semana (30-45 min)\n';
      msg += '• Enfoque: Sentadilla, peso muerto, zancadas\n';
      msg += '• Peso: 8-12 repeticiones, 3-4 series\n\n';
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
    } else {
      msg += '🎉 *¡Estás en tu mejor momento!*\n';
      msg += '• Mantén la forma y busca nuevos retos\n';
      msg += '• Prueba a aumentar el volumen o la intensidad\n';
    }

    await sendTelegramLong(msg);
  } catch (err) {
    console.log('[cmdObjetivo] ERROR:', err.toString());
    await sendTelegram(`Error en /objetivo: ${err.message}`);
  }
}

// ─── COMANDOS ADICIONALES SIMPLIFICADOS ───
async function cmdAnalizar() {
  await sendTelegram('📊 *ANÁLISIS DE ENTRENO*\n━━━━━━━━━━━━━━━━━━━━━━\n\nUsa /analizar con un ID de actividad:\n/analizar [activity_id]');
}

async function cmdAjuste() {
  await sendTelegram('🌡️ *FACTOR CLIMA APLICADO*\n━━━━━━━━━━━━━━━━━━━━━━\n\nUsa /clima para ver el factor de ajuste completo.');
}

async function cmdSemana() {
  await sendTelegram('📊 *RESUMEN SEMANAL*\n━━━━━━━━━━━━━━━━━━━━━━\n\nUsa /semanapasada para ver la semana anterior.');
}

async function cmdSemanaPasada() {
  await sendTelegram('📊 *RESUMEN SEMANA PASADA*\n━━━━━━━━━━━━━━━━━━━━━━\n\nFuncionalidad en desarrollo.');
}

async function cmdConsejo() {
  const state = await getAthleteState();
  if (!state) { await sendTelegram('Sin datos.'); return; }
  let msg = '🧠 *CONSEJO DEL DÍA*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  state.consejo.forEach((c) => { msg += `${c}\n\n`; });
  msg += '📱 *Comandos:* /hoy | /plan | /estado';
  await sendTelegramLong(msg);
}

async function cmdResumen() {
  const state = await getAthleteState();
  if (!state) { await sendTelegram('Sin datos.'); return; }
  let msg = '📋 *RESUMEN EJECUTIVO*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  const emoji = state.tsb > 0 ? '🟢' : state.tsb > -10 ? '🟡' : '🔴';
  msg += `*📊 ESTADO:* ${emoji} TSB ${state.tsb.toFixed(1)} | Readiness ${state.readiness}/100\n`;
  msg += `*😴 SUEÑO:* ${state.estado.sleepQuality === 1 ? 'Malo' : state.estado.sleepQuality === 2 ? 'Regular' : 'Bueno'}\n`;
  msg += `*🌡️ CLIMA:* ${state.tempActual}°C${state.haceCalor ? ' 🔥' : ''}\n`;
  if (state.decision.tipo === 'descanso') msg += '*🧘 PLAN:* DESCANSO TOTAL\n';
  else {
    msg += '*🚴 PLAN:* ' + state.decision.tipo.toUpperCase();
    if (state.decision.reps > 0) msg += ` ${state.decision.reps}x${state.decision.durMin}min`;
    else msg += ` ${state.decision.durMin}min`;
    msg += '\n';
  }
  if (state.aprendizaje && state.aprendizaje.probabilidad && state.decision.tipo !== 'descanso') {
    const p = state.aprendizaje.probabilidad;
    msg += `\n📊 *Probabilidad de éxito:* ${p.nivel} (${p.probabilidad}%)\n`;
  }
  msg += '\n📱 *Comandos:* /hoy | /plan | /estado | /clima';
  await sendTelegramLong(msg);
}

async function cmdFatiga() {
  const state = await getAthleteState();
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
  msg += `• HRV: *${state.estado.hrv || 'N/D'}*\n`;
  msg += `• ACWR: *${state.estado.acwr.toFixed(2)}* ${state.estado.acwr > 1.3 ? '⚠️ ALTO' : '✅ OK'}\n`;
  msg += `• Sueño: ${state.estado.sleepQuality === 1 ? '⚠️ Malo' : state.estado.sleepQuality === 2 ? '🟡 Regular' : '🟢 Bueno'}\n`;
  msg += `• Pasos: ${state.estado.pasos.toLocaleString()}\n\n`;
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
  msg += '\n📱 *Comandos:* /plan | /hoy | /consejo';
  await sendTelegramLong(msg);
}

async function cmdAprender() {
  const state = await getAthleteState();
  if (!state) { await sendTelegram('Sin datos.'); return; }
  const stats = state.aprendizaje.stats;
  let msg = '🧠 *WORLD TOUR COACH - APRENDIZAJES*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

  if (!stats.suficiente) {
    msg += '📊 *No tengo suficientes datos aún.*\n\n';
    msg += '💡 Sigue entrenando y dando feedback con /analizar.\n';
    msg += `   Necesito mínimo 5 entrenos para empezar a aprender.\n   (Tienes ${stats.total} registrados)\n`;
    await sendTelegramLong(msg);
    return;
  }

  msg += `📊 *Entrenamientos analizados:* ${stats.total}\n\n`;
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
  msg += '\n📱 *Comandos:* /hoy | /plan | /aprender-validar';
  await sendTelegramLong(msg);
}

async function cmdAprenderValidar() {
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

async function cmdTendencias() {
  await sendTelegram('📈 *TENDENCIAS*\n━━━━━━━━━━━━━━━━━━━━━━\n\nFuncionalidad en desarrollo. Próximamente disponible.');
}

async function cmdRecuperacion() {
  await sendTelegram('⏳ *RECUPERACIÓN*\n━━━━━━━━━━━━━━━━━━━━━━\n\nFuncionalidad en desarrollo. Próximamente disponible.');
}

async function cmdPrediccion() {
  await sendTelegram('🔮 *PREDICCIÓN*\n━━━━━━━━━━━━━━━━━━━━━━\n\nFuncionalidad en desarrollo. Próximamente disponible.');
}

async function cmdProgreso() {
  await sendTelegram('📊 *PROGRESO*\n━━━━━━━━━━━━━━━━━━━━━━\n\nFuncionalidad en desarrollo. Próximamente disponible.');
}

async function cmdAlerta() {
  const state = await getAthleteState();
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
  msg += '\n📱 *Comandos:* /estado | /fatiga | /recuperacion';
  await sendTelegramLong(msg);
}

async function cmdDensidad() {
  await sendTelegram('📊 *DENSIDAD DE CARGA*\n━━━━━━━━━━━━━━━━━━━━━━\n\nFuncionalidad en desarrollo. Próximamente disponible.');
}

async function cmdExportar() {
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
    peso: h.peso || 1.0
  }));
  msg += '*💾 DATOS COMPLETOS (JSON)*\n```\n' + JSON.stringify(data, null, 2) + '\n```\n';
  msg += '\n📱 *Usa /debug para ver más datos técnicos.*';
  await sendTelegramLong(msg);
}

async function cmdHistorial() {
  const historial = obtenerHistorial();
  if (historial.length === 0) {
    await sendTelegram('No hay datos de entrenos guardados.');
    return;
  }
  let msg = '📜 *HISTORIAL DE ENTRENOS*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  const ultimos = historial.slice(-10).reverse();
  ultimos.forEach((h, idx) => {
    const fecha = new Date(h.fecha);
    const fechaStr = `${String(fecha.getDate()).padStart(2, '0')}/${String(fecha.getMonth() + 1).padStart(2, '0')}/${String(fecha.getFullYear()).slice(-2)}`;
    const tipo = h.entreno.tipo.toUpperCase() || 'N/A';
    const rpe = h.feedback.rpe || '?';
    const resultado = h.resultado || 0;
    const emoji = resultado >= 80 ? '🟢' : resultado >= 60 ? '🟡' : '🔴';
    const peso = h.peso || 1.0;
    msg += `${idx + 1}. ${emoji} ${fechaStr} | ${tipo} | RPE ${rpe} | ${resultado}%`;
    if (peso < 1.0) msg += ` (peso: ${peso.toFixed(2)})`;
    msg += '\n';
  });
  msg += `\n📊 *Total: ${historial.length} entrenos*`;
  msg += '\n📱 *Usa /aprender para ver análisis.*';
  await sendTelegramLong(msg);
}

async function cmdDebug() {
  const state = await getAthleteState();
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
  msg += `• Temp: ${state.tempActual}°C\n`;
  msg += '\n*📈 SEMANA*\n';
  msg += `• TSS semanal: ${Math.round(state.estado.weeklyTss)}\n`;
  msg += `• Sesiones: ${state.estado.weeklySessions}\n`;
  msg += '\n*🚴 PLAN*\n';
  if (state.decision.tipo === 'descanso') {
    msg += '• Plan: DESCANSO\n';
  } else {
    msg += `• Tipo: ${state.decision.tipo.toUpperCase()}\n`;
    msg += `• Reps: ${state.decision.reps}\n`;
    msg += `• Dur: ${state.decision.durMin}min\n`;
    msg += `• Intensidad: ${(state.decision.intensidad * 100).toFixed(0)}%\n`;
  }
  msg += '\n*🔧 CONFIG*\n';
  msg += `• FTP: ${CONFIG.FTP}W\n`;
  msg += `• Peso: ${CONFIG.WEIGHT_KG}kg\n`;
  msg += `• Edad: ${CONFIG.AGE_YEARS} años\n`;
  msg += `• Objetivo: ${CONFIG.FTP_HISTORICO.valor}W\n`;
  msg += '\n📱 *Versión: v9.1*';
  await sendTelegramLong(msg);
}

// ─── RUTAS DE ESTADO ───
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: 'v9.1',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
    }
  });
});

app.get('/ping', (req, res) => {
  res.json({
    status: 'pong',
    timestamp: new Date().toISOString(),
    serverTime: new Date().toLocaleString('es-ES', { timeZone: CONFIG.TIMEZONE })
  });
});

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    version: 'v9.1',
    name: 'World Tour Coach API',
    description: 'Backend completo para el bot de entrenamiento World Tour Coach',
    endpoints: {
      'GET /': 'Información del servidor',
      'GET /health': 'Estado de salud del servidor',
      'GET /ping': 'Ping para mantener activo',
      'POST /webhook': 'Webhook para Telegram',
      'GET /webhook': 'Verificar configuración'
    },
    config: {
      ftp: CONFIG.FTP,
      weight: CONFIG.WEIGHT_KG,
      age: CONFIG.AGE_YEARS,
      objetivo: CONFIG.FTP_HISTORICO.valor
    },
    timestamp: new Date().toISOString()
  });
});

// ─── MANEJO DE ERRORES ───
app.use((req, res) => {
  res.status(404).json({
    error: 'Ruta no encontrada',
    path: req.path,
    method: req.method,
    availableEndpoints: ['/', '/health', '/ping', '/webhook (POST)']
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
  console.log(`✅ WORLD TOUR COACH v9.1 - NODE.JS`);
  console.log(`📡 Servidor corriendo en puerto ${PORT}`);
  console.log(`🔗 URL: http://localhost:${PORT}`);
  console.log(`🤖 Telegram Bot: ${CONFIG.TELEGRAM_TOKEN ? '✅ Configurado' : '⚠️ Sin token'}`);
  console.log(`🌍 Timezone: ${CONFIG.TIMEZONE}`);
  console.log(`📊 FTP: ${CONFIG.FTP}W | Peso: ${CONFIG.WEIGHT_KG}kg`);
  console.log(`🎯 Objetivo: ${CONFIG.FTP_HISTORICO.valor}W`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📍 Endpoints disponibles:');
  console.log('  GET  /        - Información del servidor');
  console.log('  GET  /health  - Estado de salud');
  console.log('  GET  /ping    - Mantener activo');
  console.log('  POST /webhook - Webhook Telegram');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
