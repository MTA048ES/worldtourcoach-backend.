'use strict';

// ═══════════════════════════════════════════════════════════════
// 🧹 LIMPIAR ESFUERZOS IMPOSIBLES
// ═══════════════════════════════════════════════════════════════
// Borra esfuerzos donde la distancia del segmento partida por el
// tiempo daría más de 100 km/h. Suelen ser tramos parciales que
// Strava devuelve en rotondas o con GPS malo.
//
// Uso: node scripts/limpiar-esfuerzos-imposibles.js [ruta-al-ENV] [--aplicar]
// Sin `--aplicar` solo cuenta, no borra.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const { createClient } = require('@supabase/supabase-js');

const VELOCIDAD_MAXIMA_KMH = 100;

function parseEnv(file) {
  const cfg = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    cfg[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return cfg;
}

async function todas(supabase, tabla, columnas, userId) {
  const filas = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from(tabla)
      .select(columnas)
      .eq('user_id', userId)
      .range(offset, offset + 999);
    if (error) throw error;
    filas.push(...data);
    if (data.length < 1000) break;
  }
  return filas;
}

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes('--aplicar');
  const envPath = args.find((arg) => !arg.startsWith('--')) || path.join(__dirname, '..', 'ENV');

  if (!fs.existsSync(envPath)) throw new Error(`No encuentro el fichero de variables: ${envPath}`);

  const cfg = parseEnv(envPath);
  const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const userId = cfg.ATHLETE_USER_ID;

  const segmentos = await todas(supabase, 'segmentos', 'id,nombre,distancia_m', userId);
  const segPorId = new Map(segmentos.map((s) => [s.id, s]));
  const esfuerzos = await todas(supabase, 'esfuerzos', 'segmento_id,actividad_id,tiempo_s', userId);

  const imposibles = [];
  for (const effort of esfuerzos) {
    const segment = segPorId.get(effort.segmento_id);
    if (!segment || !segment.distancia_m || !effort.tiempo_s) continue;
    const kmh = segment.distancia_m / 1000 / (effort.tiempo_s / 3600);
    if (kmh <= VELOCIDAD_MAXIMA_KMH) continue;
    imposibles.push({ ...effort, kmh, nombre: segment.nombre });
  }

  console.log(`Esfuerzos con más de ${VELOCIDAD_MAXIMA_KMH} km/h implícitos: ${imposibles.length}`);
  for (const item of imposibles.slice(0, 10)) {
    console.log(` - ${item.kmh.toFixed(0)} km/h · ${item.tiempo_s}s · ${item.nombre}`);
  }

  if (!aplicar) {
    console.log('\nModo simulación. Añade --aplicar para borrarlos.');
    return;
  }

  let borrados = 0;
  for (const item of imposibles) {
    const { error } = await supabase
      .from('esfuerzos')
      .delete()
      .eq('user_id', userId)
      .eq('segmento_id', item.segmento_id)
      .eq('actividad_id', item.actividad_id);
    if (error) {
      console.warn(`No se pudo borrar ${item.segmento_id}/${item.actividad_id}: ${error.message}`);
      continue;
    }
    borrados += 1;
  }

  console.log(`\nBorrados: ${borrados}`);
}

main().catch((error) => {
  console.error('FALLO:', error.message);
  process.exit(1);
});
