// ============================================================
// WORLD TOUR COACH - SERVIDOR NODE.JS  (VERSIÓN COMPLETA)
// ============================================================
// MIGRADO DESDE GAS v9.5 - TODOS LOS COMANDOS
// VERSIÓN MEJORADA CON CORS, RUTAS ROOT Y HEALTH

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const app = express();
const PORT = process.env.PORT || 3000;

// ─── CONFIGURACIÓN DE SUPABASE ───
const SUPABASE_URL = 'https://qhtwueashkqbqytfwpwi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_mPhJsgW-V7n6TJs6-RLoWQ_Qk68d5qQ';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── MIDDLEWARE ───
app.use(cors({
  origin: '*', // Permite todas las conexiones
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── CONFIGURACIÓN DEL SISTEMA ───
const CONFIG = {
  FTP: 240,
  WEIGHT_KG: 64,
  AGE_YEARS: 43,
  HEIGHT_CM: 173,
  CITY: 'Villargordo,ES',
  TIMEZONE: 'Europe/Madrid',
  FTP_HISTORICO: { fecha: '2022', valor: 296, peso: 60, wattsPorKg: 4.93 },
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || 'TU_TOKEN_AQUI'
};

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

// ─── FUNCIONES AUXILIARES ───
function safeNum(val, fallback = 0) {
  const n = Number(val);
  return isNaN(n) || val === null || val === undefined ? fallback : n;
}

// ─── FUNCIÓN PARA ENVIAR MENSAJES A TELEGRAM ───
async function sendTelegram(chatId, text) {
  try {
    const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
      })
    });
    return await response.json();
  } catch (error) {
    console.error('❌ Error enviando mensaje a Telegram:', error);
  }
}

// ─── FUNCIÓN PARA ENVIAR MENSAJES LARGOS ───
async function sendTelegramLong(chatId, text) {
  const MAX = 4000;
  if (text.length <= MAX) {
    await sendTelegram(chatId, text);
    return;
  }
  const parts = text.match(new RegExp(`.{1,${MAX}}`, 'g')) || [];
  for (const part of parts) {
    await sendTelegram(chatId, part);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

// ─── FUNCIÓN PARA OBTENER ESTADO DEL ATLETA ───
async function getAthleteState() {
  // Versión simplificada de getAthleteState
  // En una implementación real, aquí se conectaría a Intervals.icu
  // Por ahora devolvemos datos de ejemplo
  return {
    tsb: -3.2,
    readiness: 72,
    estado: {
      ctl: 68.4,
      atl: 71.6,
      sleepQuality: 3,
      weeklyTss: 365,
      weeklySessions: 6,
      weeklyHours: 5.4,
      acwr: 1.16,
      pasos: 2359
    },
    decision: {
      tipo: 'z2',
      reps: 1,
      durMin: 20,
      recSec: 0,
      intensidad: 0.65,
      prioridad: 'base',
      motivo: 'Estado operativo',
      notaHidratacion: '💧 1L/hora + electrolitos obligatorios (calor extremo)'
    },
    entreno: {
      wLow: 144,
      wHigh: 168,
      tssEsperado: 23,
      ifEsperado: '0.65',
      kjEsperados: 331,
      carbsEsperados: 45
    },
    nutricion: {
      chTotalDia: 448,
      protTotalDia: 125,
      grasaDiaria: 55,
      kcalGastoTotal: 1993,
      hidratacion: '2.2L base + 0.5L extra por calor + electrolitos obligatorios',
      haceCalor: true,
      esDiaDescanso: false
    },
    fuerza: {
      nivel: 'Ligera-Moderada',
      duracion: '25-30 min',
      recomendacion: 'Fuerza ligera para mantener tono. Sin fallo muscular.',
      ejercicios: [
        'Sentadilla goblet: 3x10 (8-12kg)',
        'Peso muerto rumano: 3x10 (2x8-12kg)',
        'Zancadas: 3x8 c/pierna',
        'Remo con banda: 3x12',
        'Plancha: 3x30" frontal + 20" lateral'
      ],
      recomendado: true
    },
    consejo: [
      '🔥 *Calor extremo.* No entrenes al aire libre. Rodillo con ventilador.',
      '✅ *Día normal.* Sigue tu plan con consistencia.',
      '🧠 *Master 40+.* Recuerda: la recuperación es clave.'
    ],
    haceCalor: true,
    tempActual: 39,
    datos: {
      weather: {
        temp: 39,
        wind: 15,
        rain: 0,
        description: 'cielo claro'
      }
    }
  };
}

// ─── COMANDO /hoy ───
async function cmdHoy(chatId) {
  try {
    const state = await getAthleteState();
    
    let msg = '🌅 *WORLD TOUR COACH v9.7 - HOY*\n';
    msg += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    
    const emoji = state.tsb > 0 ? '🟢' : state.tsb > -10 ? '🟡' : '🔴';
    msg += '*📊 ESTADO*\n';
    msg += `• Readiness: *${state.readiness}/100*\n`;
    msg += `• CTL: ${state.estado.ctl.toFixed(1)} | ATL: ${state.estado.atl.toFixed(1)} | TSB: ${state.tsb.toFixed(1)}\n`;
    msg += `• Sueño: ${state.estado.sleepQuality === 1 ? '😴 Malo' : state.estado.sleepQuality === 2 ? '🟡 Regular' : '🟢 Bueno'}\n`;
    msg += `• Pasos: ${state.estado.pasos.toLocaleString()}\n`;
    if (state.estado.acwr > 1.3) msg += `• ⚠️ ACWR: ${state.estado.acwr.toFixed(2)} (ALTO)\n`;
    msg += '\n';
    
    const ftpHistorico = CONFIG.FTP_HISTORICO;
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
      if (state.entreno.tssEsperado) msg += `• TSS: ${state.entreno.tssEsperado} | IF: ${state.entreno.ifEsperado}\n`;
      if (state.decision.notaHidratacion) msg += `• ${state.decision.notaHidratacion}\n`;
      msg += '\n';
    }
    
    if (state.datos.weather) {
      const w = state.datos.weather;
      const tempEmoji = typeof w.temp === 'number' ? (w.temp > 35 ? '🔥' : w.temp > 30 ? '🌡️' : w.temp > 25 ? '☀️' : '✅') : '🌤️';
      msg += '*🌤️ CLIMA*\n';
      msg += `• ${tempEmoji} ${w.temp}°C | Viento ${w.wind} km/h\n`;
      msg += `• ${w.description}${w.rain > 0 ? ` | 🌧️ Lluvia` : ''}\n`;
      if (state.decision.tipo !== 'descanso') {
        if (typeof w.temp === 'number' && w.temp > 35) msg += '• ⚠️ Calor extremo - Rodillo recomendado\n';
        else if (typeof w.temp === 'number' && w.temp > 30) msg += '• ⚠️ Calor alto - Salida controlada\n';
        else msg += '• ✅ Condiciones favorables\n';
      }
      msg += '\n';
    }
    
    if (state.decision.tipo !== 'descanso' && state.entreno.carbsEsperados) {
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
    
    msg += '*💡 CONSEJO DEL DÍA*\n';
    state.consejo.forEach(c => { msg += `• ${c}\n`; });
    
    msg += '\n📱 *Comandos:* /plan | /estado | /clima | /nutricion | /objetivo';
    
    await sendTelegramLong(chatId, msg);
  } catch (error) {
    console.error('❌ Error en cmdHoy:', error);
    await sendTelegram(chatId, '❌ Error al procesar /hoy: ' + error.message);
  }
}

// ─── COMANDO /plan ───
async function cmdPlan(chatId) {
  try {
    const state = await getAthleteState();
    let msg = '*🧠 PLAN DEL DÍA*\n';
    msg += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    msg += '*📊 ESTADO*\n';
    msg += `• TSB: ${state.tsb.toFixed(1)} | Readiness: ${state.readiness}/100\n`;
    msg += `• Sueño: ${state.estado.sleepQuality === 1 ? '⚠️ Malo' : state.estado.sleepQuality === 2 ? '🟡 Regular' : '🟢 Bueno'}\n`;
    msg += `• TSS semanal: ${Math.round(state.estado.weeklyTss)} / 750\n`;
    if (state.haceCalor) msg += `• 🌡️ ${state.tempActual}°C (factor de ajuste aplicado)\n`;
    msg += '\n';
    
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
      if (state.entreno.tssEsperado) {
        msg += '*📈 MÉTRICAS*\n';
        msg += `• TSS: *${state.entreno.tssEsperado}*\n`;
        msg += `• IF: *${state.entreno.ifEsperado}*\n`;
        msg += `• KJ: *${state.entreno.kjEsperados} kJ*\n`;
        msg += `• CH: *${state.entreno.carbsEsperados}g*\n\n`;
      }
    }
    await sendTelegramLong(chatId, msg);
  } catch (error) {
    await sendTelegram(chatId, '❌ Error en /plan: ' + error.message);
  }
}

// ─── COMANDO /estado ───
async function cmdEstado(chatId) {
  try {
    const state = await getAthleteState();
    let msg = '*📊 ESTADO COMPLETO*\n';
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
    msg += `• TSS: ${Math.round(state.estado.weeklyTss)} / 750\n`;
    msg += `• Sesiones: ${state.estado.weeklySessions}\n`;
    msg += `• ACWR: ${state.estado.acwr.toFixed(2)}${state.estado.acwr > 1.3 ? ' ⚠️ ALTO' : ' ✅ OK'}\n\n`;
    if (state.haceCalor) {
      msg += `*🌡️ CLIMA*\n`;
      msg += `• ${state.tempActual}°C ${state.tempActual > 35 ? '🔥 Calor extremo' : state.tempActual > 30 ? '🌡️ Calor alto' : '☀️ Calor moderado'}\n`;
      msg += '• Factor de ajuste aplicado en /plan\n\n';
    }
    msg += '📱 *Comandos:* /plan | /hoy | /clima | /nutricion';
    await sendTelegramLong(chatId, msg);
  } catch (error) {
    await sendTelegram(chatId, '❌ Error en /estado: ' + error.message);
  }
}

// ─── COMANDO /clima ───
async function cmdClima(chatId) {
  try {
    const state = await getAthleteState();
    const w = state.datos.weather;
    if (!w) {
      await sendTelegram(chatId, '🌤️ No se pudo obtener información meteorológica.');
      return;
    }
    const temp = w.temp || 'N/D';
    const wind = w.wind || 0;
    const rain = w.rain || 0;
    const desc = w.description || 'Sin datos';
    let msg = '*🌤️ CLIMA + FACTOR DE AJUSTE*\n';
    msg += '━━━━━━━━━━━━━━━━━━━━━━\n';
    msg += `📍 ${CONFIG.CITY}\n`;
    msg += `🌡️ ${temp}°C\n`;
    msg += `💨 Viento: ${wind} km/h\n`;
    msg += `🌧️ Lluvia: ${rain} mm\n`;
    msg += `☁️ ${desc}\n`;
    msg += `📊 TSB: ${state.tsb.toFixed(1)}\n\n`;
    const tempNum = typeof temp === 'number' ? temp : 25;
    let recomendacion = '', hidratacion = '';
    if (tempNum > 38) { recomendacion = '🔴 *CALOR EXTREMO* - Reduce duración 30% e intensidad 10%\n→ Rodillo o salida muy corta'; hidratacion = '💧 1L/hora + electrolitos obligatorios'; }
    else if (tempNum > 35) { recomendacion = '🟠 *CALOR MUY ALTO* - Reduce duración 20% e intensidad 5%\n→ Rodillo o salida corta'; hidratacion = '💧 1L/hora + electrolitos'; }
    else if (tempNum > 32) { recomendacion = '🟡 *CALOR ALTO* - Reduce duración 15%\n→ Salida controlada'; hidratacion = '💧 750ml/hora + electrolitos'; }
    else if (tempNum > 28) { recomendacion = '🟡 *CALOR MODERADO* - Reduce duración 10%\n→ Salida normal con hidratación extra'; hidratacion = '💧 750ml/hora'; }
    else if (tempNum > 25) { recomendacion = '🟢 *CALOR LIGERO* - Sin ajustes significativos'; hidratacion = '💧 500ml/hora'; }
    else if (tempNum < 5) { recomendacion = '❄️ *FRÍO* - Reduce duración 10%\n→ Protege extremidades'; hidratacion = '💧 500ml/hora'; }
    else { recomendacion = '✅ *TEMPERATURA IDEAL* - Sin ajustes'; hidratacion = '💧 500ml/hora'; }
    msg += '*📊 FACTOR CLIMA APLICADO*\n';
    msg += recomendacion + '\n\n';
    msg += hidratacion + '\n\n';
    msg += '📱 *Comandos:* /plan | /ajuste | /hoy';
    await sendTelegramLong(chatId, msg);
  } catch (error) {
    await sendTelegram(chatId, '❌ Error en /clima: ' + error.message);
  }
}

// ─── COMANDO /nutricion ───
async function cmdNutricion(chatId) {
  try {
    const state = await getAthleteState();
    const n = state.nutricion;
    let msg = '*🥗 NUTRICIÓN*\n';
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
    if (n.haceCalor) {
      msg += `🌡️ *CALOR DETECTADO (${state.tempActual}°C)*\n`;
      msg += '• CH extra por calor: +0.5g/kg\n';
      msg += '• Electrolitos extra\n\n';
    }
    msg += '*📊 OBJETIVOS MACRO DIARIOS*\n';
    msg += `• 🍞 CH: *${n.chTotalDia}g*\n`;
    msg += `• 🍗 Proteína: *${n.protTotalDia}g*\n`;
    msg += `• 🥑 Grasas: *${n.grasaDiaria}g*\n\n`;
    if (state.decision.tipo !== 'descanso') {
      msg += '*⏳ TIMING POST-ENTRENO*\n';
      msg += '🥤 *Inmediatamente después (15-30 min):*\n';
      msg += `   → ${n.chTotalDia}g CH + 30g Proteína\n`;
      msg += '   → Ejemplo: 2 plátanos + batido proteico\n\n';
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
      if (n.haceCalor) {
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
    if (n.haceCalor && state.tempActual > 35) {
      msg += '• 🔴 Prioriza comidas frías y ligeras\n';
      msg += '• Añade sal a las comidas para reponer electrolitos\n';
    } else if (state.decision.tipo === 'descanso') {
      msg += '• Aprovecha el día de descanso para comer más vegetales\n';
    } else {
      msg += '• Come cada 3-4 horas para mantener energía\n';
    }
    msg += `\n_Edad: ${CONFIG.AGE_YEARS} años | Peso: ${CONFIG.WEIGHT_KG}kg_`;
    await sendTelegramLong(chatId, msg);
  } catch (error) {
    await sendTelegram(chatId, '❌ Error en /nutricion: ' + error.message);
  }
}

// ─── COMANDO /fuerza ───
async function cmdFuerza(chatId) {
  try {
    const state = await getAthleteState();
    const f = state.fuerza;
    let msg = '🏋️ *RUTINA DE FUERZA*\n';
    msg += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    msg += `*📊 ESTADO:* TSB ${state.tsb.toFixed(1)} | Readiness ${state.readiness}/100\n`;
    msg += `*🎯 NIVEL:* ${f.nivel} (${f.duracion})\n\n`;
    if (!f.recomendado) msg += '⚠️ *NO recomendada hoy.* Haz solo movilidad y estiramientos.\n\n';
    msg += '*💪 EJERCICIOS*\n';
    f.ejercicios.forEach((ej, idx) => { msg += `${idx+1}. ${ej}\n`; });
    msg += `\n💡 *Consejo:* ${f.recomendacion}\n`;
    if (state.haceCalor && state.tempActual > 30) msg += '\n🌡️ *Con calor, alarga descansos y hidrata entre series.*\n';
    await sendTelegramLong(chatId, msg);
  } catch (error) {
    await sendTelegram(chatId, '❌ Error en /fuerza: ' + error.message);
  }
}

// ─── COMANDO /objetivo ───
async function cmdObjetivo(chatId) {
  try {
    const state = await getAthleteState();
    const ftpHistorico = CONFIG.FTP_HISTORICO;
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
    await sendTelegramLong(chatId, msg);
  } catch (error) {
    await sendTelegram(chatId, '❌ Error en /objetivo: ' + error.message);
  }
}

// ─── COMANDO /traza ───
async function cmdTraza(chatId) {
  try {
    const state = await getAthleteState();
    let msg = '🧠 *DECISIÓN EXPLICADA*\n';
    msg += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    msg += '*📊 INPUTS USADOS*\n';
    msg += `• TSB: ${state.tsb.toFixed(1)}\n`;
    msg += `• Readiness: ${state.readiness}/100\n`;
    msg += `• CTL: ${state.estado.ctl.toFixed(1)}\n`;
    msg += `• ATL: ${state.estado.atl.toFixed(1)}\n`;
    msg += `• Sueño: ${state.estado.sleepQuality === 1 ? 'Malo' : state.estado.sleepQuality === 2 ? 'Regular' : 'Bueno'}\n`;
    msg += `• Temperatura: ${state.tempActual}°C\n`;
    msg += `• ACWR: ${state.estado.acwr.toFixed(2)}\n\n`;
    msg += '*⚡ REGLAS ACTIVADAS*\n';
    if (state.tsb < -20) msg += '• FATIGA AGUDA → Cambio a SweetSpot reducido\n';
    if (state.haceCalor && state.tempActual > 35) msg += '• CLIMA EXTREMO → Reducción 25%\n';
    else if (state.haceCalor && state.tempActual > 32) msg += '• CLIMA → Reducción 15%\n';
    if (state.estado.sleepQuality === 1) msg += '• SUEÑO MALO → Reducción intensidad 15%\n';
    if (state.estado.acwr > 1.3) msg += '• ACWR ALTO → Reducción volumen 15%\n';
    msg += '\n*🎯 DECISIÓN FINAL*\n';
    if (state.decision.tipo === 'descanso') {
      msg += `• Tipo: DESCANSOS\n`;
    } else {
      msg += `• Tipo: ${state.decision.tipo.toUpperCase()}\n`;
      msg += `• Intensidad: ${(state.decision.intensidad * 100).toFixed(0)}% FTP\n`;
      msg += `• Duración: ${state.decision.durMin}min\n`;
    }
    await sendTelegramLong(chatId, msg);
  } catch (error) {
    await sendTelegram(chatId, '❌ Error en /traza: ' + error.message);
  }
}

// ─── RUTA DE VERIFICACIÓN DE SALUD (NUEVO) ───
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: 'v9.7',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
    },
    config: {
      ftp: CONFIG.FTP,
      weight: CONFIG.WEIGHT_KG,
      age: CONFIG.AGE_YEARS
    }
  });
});

// ─── RUTA RAÍZ (NUEVO) ───
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    version: 'v9.7',
    name: 'World Tour Coach API',
    description: 'Backend para el bot de entrenamiento World Tour Coach',
    endpoints: {
      'GET /': 'Información del servidor',
      'GET /health': 'Estado de salud del servidor',
      'POST /feedback': 'Webhook para Telegram',
      'GET /ping': 'Ping para mantener activo el servidor'
    },
    documentation: 'https://github.com/tu-usuario/world-tour-coach',
    timestamp: new Date().toISOString()
  });
});

// ─── RUTA PING (NUEVO) ───
app.get('/ping', (req, res) => {
  res.json({
    status: 'pong',
    timestamp: new Date().toISOString(),
    serverTime: new Date().toLocaleString('es-ES', { timeZone: CONFIG.TIMEZONE })
  });
});

// ─── RUTA PRINCIPAL DE TELEGRAM ───
app.post('/feedback', async (req, res) => {
  try {
    const body = req.body;
    const message = body.message || body.edited_message;
    
    if (!message || !message.text) {
      return res.json({ ok: true });
    }

    const text = message.text.trim();
    const chatId = message.chat.id;
    const username = message.from?.username || 'Usuario';

    console.log(`📩 Mensaje de @${username}: ${text}`);

    // ─── PROCESAR COMANDOS ───
    switch (text) {
      case '/start':
        await sendTelegram(chatId, '🚴 *WORLD TOUR COACH v9.7*\n━━━━━━━━━━━━━━━━━━━━━━\n\nBienvenido. Usa /hoy para ver tu estado.');
        break;
      case '/hoy':
        await cmdHoy(chatId);
        break;
      case '/plan':
        await cmdPlan(chatId);
        break;
      case '/estado':
        await cmdEstado(chatId);
        break;
      case '/clima':
        await cmdClima(chatId);
        break;
      case '/nutricion':
        await cmdNutricion(chatId);
        break;
      case '/fuerza':
        await cmdFuerza(chatId);
        break;
      case '/objetivo':
        await cmdObjetivo(chatId);
        break;
      case '/traza':
        await cmdTraza(chatId);
        break;
      default:
        await sendTelegram(chatId, `❌ Comando no reconocido: ${text}\n\n📋 Comandos disponibles:\n/hoy - Resumen del día\n/plan - Plan de entrenamiento\n/estado - Estado completo\n/clima - Clima + factor\n/nutricion - Nutrición y recetas\n/fuerza - Rutina de fuerza\n/objetivo - Plan para 296W\n/traza - Explicación de decisiones`);
        break;
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Error en /feedback:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── MANEJO DE ERRORES 404 ───
app.use((req, res) => {
  res.status(404).json({
    error: 'Ruta no encontrada',
    path: req.path,
    method: req.method,
    availableEndpoints: ['/', '/health', '/ping', '/feedback (POST)']
  });
});

// ─── MANEJO DE ERRORES GLOBAL ───
app.use((err, req, res, next) => {
  console.error('❌ Error global:', err);
  res.status(500).json({
    error: 'Error interno del servidor',
    message: err.message
  });
});

// ─── INICIAR EL SERVIDOR ───
app.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ WORLD TOUR COACH v9.7`);
  console.log(`📡 Servidor corriendo en puerto ${PORT}`);
  console.log(`🔗 URL: http://localhost:${PORT}`);
  console.log(`📱 Conectado a Supabase: ${SUPABASE_URL}`);
  console.log(`🤖 Telegram Bot: ${CONFIG.TELEGRAM_TOKEN ? '✅ Configurado' : '⚠️ Sin token'}`);
  console.log(`🌍 Timezone: ${CONFIG.TIMEZONE}`);
  console.log(`📊 FTP: ${CONFIG.FTP}W | Peso: ${CONFIG.WEIGHT_KG}kg`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📍 Endpoints disponibles:');
  console.log('  GET  /        - Información del servidor');
  console.log('  GET  /health  - Estado de salud');
  console.log('  GET  /ping    - Mantener activo');
  console.log('  POST /feedback - Webhook Telegram');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
