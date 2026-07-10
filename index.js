// ============================================================
// WORLD TOUR COACH - SERVIDOR NODE.JS (VERSIÓN 1.0)
// ============================================================

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();
const PORT = process.env.PORT || 3000;

// ─── CONFIGURACIÓN DE SUPABASE ───
// ⚠️ REEMPLAZA ESTOS DATOS CON LOS TUYOS
const SUPABASE_URL = 'https://qhtwueashkqbqytfwpwi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_mPhJsgW-V7n6TJs6-RLoWQ_Qk68d5qQ';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── MIDDLEWARE ───
app.use(express.json()); // Para leer JSON en las peticiones

// ─── RUTA DE PRUEBA ───
app.get('/', (req, res) => {
  res.send('🚴 World Tour Coach - Servidor Node.js funcionando!');
});

// ─── RUTA PARA RECIBIR FEEDBACK DESDE TELEGRAM ───
app.post('/feedback', async (req, res) => {
  try {
    // 1. Recibir datos del feedback
    const { entreno, feedback, resultado, tsb, readiness } = req.body;

    // 2. Guardar en Supabase
    const { data, error } = await supabase
      .from('actividades')
      .insert([{
        fecha: new Date().toISOString(),
        entreno: entreno || {},
        feedback: feedback || {},
        resultado: resultado || 50,
        tsb: tsb || 0,
        readiness: readiness || 50,
        peso: 64 // Podrías añadir el peso desde la petición
      }]);

    if (error) throw error;

    // 3. Responder con éxito
    res.json({ success: true, message: 'Entreno guardado en Supabase', data });
  } catch (error) {
    console.error('❌ Error al guardar en Supabase:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── INICIAR EL SERVIDOR ───
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en el puerto ${PORT}`);
});
