// ============================================================
// WORLD TOUR COACH - SERVIDOR NODE.JS (CON COMANDO /hoy)
// ============================================================

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();
const PORT = process.env.PORT || 3000;

// ─── CONFIGURACIÓN DE SUPABASE ───
const SUPABASE_URL = 'https://qhtwueashkqbqytfwpwi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_mPhJsgW-V7n6TJs6-RLoWQ_Qk68d5qQ';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── MIDDLEWARE ───
app.use(express.json());

// ─── RUTA DE PRUEBA ───
app.get('/', (req, res) => {
  res.send('🚴 World Tour Coach - Servidor Node.js funcionando!');
});

// ─── RUTA PARA RECIBIR MENSAJES DE TELEGRAM ───
app.post('/feedback', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.text) {
      return res.json({ ok: true });
    }

    const text = message.text.trim();
    const chatId = message.chat.id;

    // ─── COMANDO /hoy ───
    if (text === '/hoy' || text.startsWith('/hoy ')) {
      const respuesta = await cmdHoy();
      await sendTelegram(chatId, respuesta);
      return res.json({ ok: true });
    }

    // ─── COMANDO /plan (próximamente) ───
    if (text === '/plan') {
      await sendTelegram(chatId, '🚴 Comando /plan en desarrollo...');
      return res.json({ ok: true });
    }

    // ─── COMANDO /estado (próximamente) ───
    if (text === '/estado') {
      await sendTelegram(chatId, '📊 Comando /estado en desarrollo...');
      return res.json({ ok: true });
    }

    // ─── SI NO ES UN COMANDO CONOCIDO ───
    await sendTelegram(chatId, '❌ Comando no reconocido. Usa /hoy, /plan o /estado.');
    res.json({ ok: true });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── FUNCIÓN PARA ENVIAR MENSAJES A TELEGRAM ───
async function sendTelegram(chatId, text) {
  const token = process.env.TELEGRAM_TOKEN || 'TU_TOKEN_AQUI';
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    })
  });
}

// ─── COMANDO /hoy ───
async function cmdHoy() {
  // Versión simplificada del comando /hoy
  // Aquí iría toda la lógica de getAthleteState(), etc.
  // Por ahora, devolvemos un mensaje de prueba
  return `📊 *ESTADO DE HOY*\n━━━━━━━━━━━━━━━━━━━━━━\n\n• TSB: -3.2\n• Readiness: 72/100\n• Sueño: 🟢 Bueno\n• Plan de hoy: Z2 1x20min\n\n🚴 *World Tour Coach v9.7*`;
}

// ─── INICIAR EL SERVIDOR ───
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en el puerto ${PORT}`);
});
