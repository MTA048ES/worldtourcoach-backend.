const fs = require('fs');

let c = fs.readFileSync('index.js', 'utf8');

// Verificar si falta el cierre del servidor
if (!c.includes("app.listen(PORT")) {
  const missingCode = `

// ─── INICIAR SERVIDOR ───
app.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ WORLD TOUR COACH v9.5 - DEFINITIVO');
  console.log(\`📡 Servidor corriendo en puerto \${PORT}\`);
  console.log(\`🔗 URL: http://localhost:\${PORT}\`);
  console.log(\`🤖 Telegram Bot: \${CONFIG.TELEGRAM_TOKEN ? '✅ Configurado' : '⚠️ Sin token'}\`);
  console.log(\`📊 FTP: \${CONFIG.FTP}W | Peso: \${CONFIG.WEIGHT_KG}kg\`);
  console.log(\`🎯 Objetivo: \${CONFIG.FTP_HISTORICO.valor}W\`);
  console.log(\`📅 Fase: \${getFaseActual().toUpperCase()} | Semana \${getSemanaActual()}\`);
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
  console.log('🆕 IA con OpenRouter (14 modelos gratuitos)');
  console.log('🆕 Sistema de cola para evitar duplicados');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
`;

  c = c.trim() + missingCode;
  fs.writeFileSync('index.js', c);
  console.log('Done. Cierre del servidor agregado.');
} else {
  console.log('El servidor ya tiene app.listen()');
}