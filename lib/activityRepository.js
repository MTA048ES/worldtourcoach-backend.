'use strict';

// ═══════════════════════════════════════════════════════════════
// 🗄️ REPOSITORIO DE ACTIVIDADES Y SEGMENTOS (SUPABASE)
// ═══════════════════════════════════════════════════════════════
// Todas las consultas filtran por user_id. El cliente se inyecta para
// poder probar la lógica sin red.
// ═══════════════════════════════════════════════════════════════

const CHUNK = 80;

function chunk(values, size = CHUNK) {
  const out = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

function createActivityRepository(options = {}) {
  const { supabase, userId, logger = () => {} } = options;

  if (!supabase) throw new Error('Falta el cliente de Supabase');
  if (!userId) throw new Error('Falta el user_id');

  function unwrap(result, label) {
    if (result.error) {
      logger(`[repository] ${label}: ${result.error.message}`);
      throw new Error(`${label}: ${result.error.message}`);
    }
    return result.data;
  }

  // ─── ACTIVIDADES ─────────────────────────────────────────────

  async function upsertActivity(row) {
    const data = unwrap(
      await supabase.from('actividades').upsert([row], { onConflict: 'actividad_id' }),
      'upsert actividades',
    );
    return data;
  }

  async function existingActivityIds(ids) {
    const found = new Set();
    for (const group of chunk(ids)) {
      const data = unwrap(
        await supabase
          .from('actividades')
          .select('actividad_id')
          .eq('user_id', userId)
          .in('actividad_id', group),
        'buscar actividades existentes',
      );
      for (const row of data || []) found.add(row.actividad_id);
    }
    return found;
  }

  async function listActivities({ limit = 50, offset = 0, desde, hasta } = {}) {
    let query = supabase
      .from('actividades')
      .select(
        'actividad_id,fecha,tipo,nombre,duracion_s,distancia_m,desnivel_m,pot_media,pot_max,np,fc_media,fc_max,cadencia_media,velocidad_media,tss,muestras,tiene_gps',
      )
      .eq('user_id', userId)
      .order('fecha', { ascending: false })
      .range(offset, offset + limit - 1);

    if (desde) query = query.gte('fecha', desde);
    if (hasta) query = query.lte('fecha', hasta);

    return unwrap(await query, 'listar actividades') || [];
  }

  async function getActivity(activityId) {
    const data = unwrap(
      await supabase
        .from('actividades')
        .select('*')
        .eq('user_id', userId)
        .eq('actividad_id', activityId)
        .maybeSingle(),
      'obtener actividad',
    );
    return data || null;
  }

  async function countActivities() {
    const result = await supabase
      .from('actividades')
      .select('actividad_id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (result.error) {
      logger(`[repository] contar actividades: ${result.error.message}`);
      return 0;
    }
    return result.count || 0;
  }

  // ─── TRAZAS ──────────────────────────────────────────────────

  async function upsertTrack(row) {
    return unwrap(
      await supabase.from('actividad_tracks').upsert([row], { onConflict: 'actividad_id' }),
      'guardar traza',
    );
  }

  async function getTrackRow(activityId) {
    const data = unwrap(
      await supabase
        .from('actividad_tracks')
        .select('actividad_id,datos,muestras')
        .eq('user_id', userId)
        .eq('actividad_id', activityId)
        .maybeSingle(),
      'obtener traza',
    );
    return data || null;
  }

  // Trazas de un lote de actividades, para recalcular esfuerzos.
  async function getTrackRows(activityIds) {
    const rows = [];
    for (const group of chunk(activityIds, 20)) {
      const data = unwrap(
        await supabase
          .from('actividad_tracks')
          .select('actividad_id,datos')
          .eq('user_id', userId)
          .in('actividad_id', group),
        'obtener trazas del lote',
      );
      for (const row of data || []) rows.push(row);
    }
    return rows;
  }

  // Recorre todas las trazas por páginas (para recalcular un segmento).
  async function* iterateTracks({ pageSize = 20 } = {}) {
    let offset = 0;
    for (;;) {
      const data = unwrap(
        await supabase
          .from('actividad_tracks')
          .select('actividad_id,datos')
          .eq('user_id', userId)
          .order('actividad_id', { ascending: true })
          .range(offset, offset + pageSize - 1),
        'recorrer trazas',
      );
      const rows = data || [];
      if (rows.length === 0) return;
      yield rows;
      if (rows.length < pageSize) return;
      offset += pageSize;
    }
  }

  // ─── SEGMENTOS ───────────────────────────────────────────────

  async function listSegments() {
    return (
      unwrap(
        await supabase
          .from('segmentos')
          .select('*')
          .eq('user_id', userId)
          .order('creado_en', { ascending: false }),
        'listar segmentos',
      ) || []
    );
  }

  async function getSegment(segmentId) {
    const data = unwrap(
      await supabase
        .from('segmentos')
        .select('*')
        .eq('user_id', userId)
        .eq('id', segmentId)
        .maybeSingle(),
      'obtener segmento',
    );
    return data || null;
  }

  async function insertSegment(row) {
    const data = unwrap(await supabase.from('segmentos').insert([row]).select('*'), 'crear segmento');
    return Array.isArray(data) ? data[0] : data;
  }

  async function updateSegment(segmentId, patch) {
    return unwrap(
      await supabase.from('segmentos').update(patch).eq('user_id', userId).eq('id', segmentId),
      'actualizar segmento',
    );
  }

  async function deleteSegment(segmentId) {
    return unwrap(
      await supabase.from('segmentos').delete().eq('user_id', userId).eq('id', segmentId),
      'borrar segmento',
    );
  }

  // ─── ESFUERZOS ───────────────────────────────────────────────

  async function upsertEffort(row) {
    return unwrap(
      await supabase
        .from('esfuerzos')
        .upsert([row], { onConflict: 'segmento_id,actividad_id' }),
      'guardar esfuerzo',
    );
  }

  async function deleteEffort(segmentId, activityId) {
    return unwrap(
      await supabase
        .from('esfuerzos')
        .delete()
        .eq('user_id', userId)
        .eq('segmento_id', segmentId)
        .eq('actividad_id', activityId),
      'borrar esfuerzo',
    );
  }

  async function listEfforts(segmentIds) {
    const rows = [];
    for (const group of chunk(segmentIds, 40)) {
      const data = unwrap(
        await supabase
          .from('esfuerzos')
          .select('segmento_id,actividad_id,tiempo_s,pot_media,np,fc_media,velocidad_media,fecha')
          .eq('user_id', userId)
          .in('segmento_id', group)
          .order('tiempo_s', { ascending: true }),
        'listar esfuerzos',
      );
      for (const row of data || []) rows.push(row);
    }
    return rows;
  }

  async function listEffortsForSegment(segmentId) {
    return (
      unwrap(
        await supabase
          .from('esfuerzos')
          .select('*')
          .eq('user_id', userId)
          .eq('segmento_id', segmentId)
          .order('tiempo_s', { ascending: true }),
        'listar esfuerzos del segmento',
      ) || []
    );
  }

  // Solo los ids de los segmentos ya recorridos por una actividad.
  async function listEffortsForActivity(activityId) {
    return (
      unwrap(
        await supabase
          .from('esfuerzos')
          .select('segmento_id,actividad_id')
          .eq('user_id', userId)
          .eq('actividad_id', activityId),
        'listar esfuerzos de la actividad',
      ) || []
    );
  }

  return {
    upsertActivity,
    existingActivityIds,
    listActivities,
    getActivity,
    countActivities,
    upsertTrack,
    getTrackRow,
    getTrackRows,
    iterateTracks,
    listSegments,
    getSegment,
    insertSegment,
    updateSegment,
    deleteSegment,
    upsertEffort,
    deleteEffort,
    listEfforts,
    listEffortsForSegment,
    listEffortsForActivity,
  };
}

module.exports = {
  createActivityRepository,
  chunk,
};
