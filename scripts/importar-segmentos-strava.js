'use strict';

// ═══════════════════════════════════════════════════════════════
// 🧲 IMPORTAR SEGMENTOS DE STRAVA (VÍA INTERVALS.ICU)
// ═══════════════════════════════════════════════════════════════
// Uso:  node scripts/importar-segmentos-strava.js [ruta-al-ENV]
//
// Recorre las actividades guardadas, pide a Intervals.icu sus
// esfuerzos de segmento de Strava y crea/reutiliza los segmentos en
// Supabase usando la geometría de nuestras propias trazas.
//
// Es idempotente: se puede ejecutar tantas veces como haga falta.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const { createClient } = require('@supabase/supabase-js');
const { createActivityRepository } = require('../lib/activityRepository');
const { createSegmentsService } = require('../lib/segmentsService');
const { createIntervalsClient } = require('../lib/intervalsClient');
const codec = require('../lib/trackCodec');

function parseEnv(file) {
  const cfg = {};
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    cfg[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return cfg;
}

async function main() {
  const envPath = process.argv[2] || path.join(__dirname, '..', 'ENV');
  if (!fs.existsSync(envPath)) {
    throw new Error(`No encuentro el fichero de variables: ${envPath}`);
  }

  const cfg = parseEnv(envPath);
  const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const repository = createActivityRepository({ supabase, userId: cfg.ATHLETE_USER_ID });
  const intervals = createIntervalsClient({
    apiKey: cfg.INTERVALS_API_KEY,
    athleteId: cfg.ATHLETE_ID,
  });
  const service = createSegmentsService({ repository, userId: cfg.ATHLETE_USER_ID });

  // 1. Todas las actividades guardadas (de la más antigua a la más nueva).
  const actividades = [];
  for (let offset = 0; ; offset += 200) {
    const lote = await repository.listActivities({ limit: 200, offset });
    actividades.push(...lote);
    if (lote.length < 200) break;
  }
  actividades.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  console.log(`Actividades guardadas: ${actividades.length}`);

  let totalCreados = 0;
  let totalEsfuerzos = 0;
  let totalEmparejados = 0;
  let conTraza = 0;
  let sinSegmentos = 0;
  let errores = 0;

  let segmentos = await repository.listSegments();

  for (let i = 0; i < actividades.length; i++) {
    const actividad = actividades[i];
    const etiqueta = `[${i + 1}/${actividades.length}] ${actividad.actividad_id} · ${actividad.nombre || ''}`;

    if (!actividad.tiene_gps) {
      sinSegmentos++;
      continue;
    }

    try {
      const row = await repository.getTrackRow(actividad.actividad_id);
      if (!row) {
        sinSegmentos++;
        continue;
      }
      const track = codec.decodeTrack(row.datos);
      if (!track || !track.hasGps) {
        sinSegmentos++;
        continue;
      }

      const resultado = await service.importStravaSegments({
        activityId: actividad.actividad_id,
        fecha: actividad.fecha,
        track,
        intervals,
      });

      conTraza++;
      totalCreados += resultado.creados;
      totalEsfuerzos += resultado.esfuerzos;
      if (resultado.creados > 0) segmentos = await repository.listSegments();

      // Rutas que se repiten (rodillo sobre todo): empareja por geometría.
      const emparejados = await service.assignMissingEfforts({
        activityId: actividad.actividad_id,
        fecha: actividad.fecha,
        track,
        segments: segmentos,
      });
      totalEmparejados += emparejados;

      if (resultado.esfuerzos > 0 || emparejados > 0) {
        console.log(
          `${etiqueta} → +${resultado.creados} segmentos, ${resultado.esfuerzos} esfuerzos Strava, ${emparejados} por geometría`,
        );
      }
    } catch (error) {
      errores++;
      console.warn(`${etiqueta} → ERROR: ${error.message}`);
    }
  }

  console.log('\n──────────────────────────────────────────');
  console.log(`Actividades con traza revisadas : ${conTraza}`);
  console.log(`Actividades sin traza/segmentos  : ${sinSegmentos}`);
  console.log(`Segmentos nuevos de Strava       : ${totalCreados}`);
  console.log(`Esfuerzos importados             : ${totalEsfuerzos}`);
  console.log(`Esfuerzos emparejados geométrico : ${totalEmparejados}`);
  console.log(`Errores                          : ${errores}`);
}

main().catch((error) => {
  console.error('FALLO:', error.message);
  process.exit(1);
});
