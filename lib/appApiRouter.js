'use strict';

// ═══════════════════════════════════════════════════════════════
// 📱 API PARA LA APP MÓVIL
// ═══════════════════════════════════════════════════════════════
// Prefijo /api/app. Todo exige token Bearer: si APP_API_TOKEN no está
// configurado el router responde 503 en lugar de quedar abierto.
// La app nunca ve la clave de Intervals.icu ni escribe en Supabase.
// ═══════════════════════════════════════════════════════════════

const express = require('express');

const { compararSecreto } = require('./security');
const codec = require('./trackCodec');

function bearerToken(req) {
  const header = req.get('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  const alt = req.get('x-api-token');
  return typeof alt === 'string' ? alt.trim() : '';
}

function validCoordinate(lat, lon) {
  return (
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lon)) &&
    Math.abs(Number(lat)) <= 90 &&
    Math.abs(Number(lon)) <= 180
  );
}

function createAppApiRouter(options = {}) {
  const { repository, segmentsService, activitiesSync, token, logger = () => {} } = options;

  if (!repository || !segmentsService) {
    throw new Error('Faltan dependencias para el router de la app');
  }

  const router = express.Router();

  // ─── AUTENTICACIÓN ───────────────────────────────────────────
  router.use((req, res, next) => {
    if (typeof token !== 'string' || token.length === 0) {
      return res.status(503).json({
        success: false,
        error: 'APP_API_TOKEN no está configurado en el servidor',
      });
    }
    if (!compararSecreto(bearerToken(req), token)) {
      return res.status(401).json({ success: false, error: 'Token no válido' });
    }
    return next();
  });

  const handle = (fn) => (req, res) => {
    Promise.resolve(fn(req, res)).catch((error) => {
      logger(`[appApi] ${req.method} ${req.path}: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
  };

  const numberParam = (value, fallback, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
  };

  // ─── ESTADO ──────────────────────────────────────────────────
  router.get(
    '/health',
    handle(async (_req, res) => {
      const total = await repository.countActivities();
      const segmentos = await repository.listSegments();
      res.json({
        success: true,
        data: {
          actividades: total,
          segmentos: segmentos.length,
          sync: activitiesSync ? activitiesSync.getStatus() : null,
        },
      });
    }),
  );

  // ─── ACTIVIDADES ─────────────────────────────────────────────
  router.get(
    '/activities',
    handle(async (req, res) => {
      const limit = numberParam(req.query.limit, 50, 1, 200);
      const offset = numberParam(req.query.offset, 0, 0, 100000);
      const rows = await repository.listActivities({
        limit,
        offset,
        desde: req.query.desde,
        hasta: req.query.hasta,
      });
      res.json({ success: true, data: { actividades: rows, limit, offset } });
    }),
  );

  router.get(
    '/activities/:id',
    handle(async (req, res) => {
      const activity = await repository.getActivity(req.params.id);
      if (!activity) {
        return res.status(404).json({ success: false, error: 'Actividad no encontrada' });
      }
      return res.json({ success: true, data: activity });
    }),
  );

  // Puntos del recorrido, reducidos para dibujar y para elegir segmentos.
  router.get(
    '/activities/:id/track',
    handle(async (req, res) => {
      const max = numberParam(req.query.max, 600, 100, 2000);
      const row = await repository.getTrackRow(req.params.id);
      if (!row) {
        return res.status(404).json({ success: false, error: 'La actividad no tiene traza guardada' });
      }
      const track = codec.decodeTrack(row.datos);
      if (!track) {
        return res.status(422).json({ success: false, error: 'La traza guardada no es válida' });
      }
      const puntos = codec.downsampleTrack(track, max);
      return res.json({
        success: true,
        data: {
          actividad_id: req.params.id,
          muestras: row.muestras,
          tiene_gps: track.hasGps,
          tiene_potencia: track.hasPower,
          tiene_fc: track.hasHeartRate,
          bounds: track.bounds,
          puntos,
        },
      });
    }),
  );

  // Segmentos recorridos por la actividad, con el puesto de cada esfuerzo.
  router.get(
    '/activities/:id/segments',
    handle(async (req, res) => {
      const segmentos = await segmentsService.listSegmentsForActivity(req.params.id);
      return res.json({ success: true, data: { segmentos } });
    }),
  );

  // ─── SEGMENTOS ───────────────────────────────────────────────
  router.get(
    '/segments',
    handle(async (_req, res) => {
      const segmentos = await segmentsService.listSegmentsWithBest();
      res.json({ success: true, data: { segmentos } });
    }),
  );

  router.get(
    '/segments/:id',
    handle(async (req, res) => {
      const detalle = await segmentsService.getSegmentDetail(req.params.id);
      if (!detalle) {
        return res.status(404).json({ success: false, error: 'Segmento no encontrado' });
      }
      return res.json({ success: true, data: detalle });
    }),
  );

  // Crear un segmento manual con dos puntos del recorrido.
  router.post(
    '/segments',
    handle(async (req, res) => {
      const { nombre, actividad_id: actividadId, inicio, fin, radio_m: radioM } = req.body || {};

      if (!nombre || typeof nombre !== 'string' || nombre.trim().length < 2) {
        return res.status(400).json({ success: false, error: 'Nombre obligatorio' });
      }
      if (!actividadId) {
        return res.status(400).json({ success: false, error: 'Falta la actividad de referencia' });
      }
      if (!inicio || !fin || !validCoordinate(inicio.lat, inicio.lon) || !validCoordinate(fin.lat, fin.lon)) {
        return res.status(400).json({ success: false, error: 'Coordenadas no válidas' });
      }

      const { segment } = await segmentsService.createManualSegment({
        nombre,
        actividadId,
        startPoint: { lat: Number(inicio.lat), lon: Number(inicio.lon) },
        endPoint: { lat: Number(fin.lat), lon: Number(fin.lon) },
        radioM,
      });

      // El cálculo sobre todo el historial va en segundo plano: la app
      // puede consultar el segmento hasta que `estado` sea "listo".
      segmentsService.recomputeSegment(segment.id).catch((error) => {
        logger(`[appApi] recálculo del segmento ${segment.id}: ${error.message}`);
      });

      return res.status(201).json({ success: true, data: segment });
    }),
  );

  router.post(
    '/segments/:id/recompute',
    handle(async (req, res) => {
      const segment = await repository.getSegment(req.params.id);
      if (!segment) {
        return res.status(404).json({ success: false, error: 'Segmento no encontrado' });
      }
      segmentsService.recomputeSegment(segment.id).catch((error) => {
        logger(`[appApi] recálculo del segmento ${segment.id}: ${error.message}`);
      });
      return res.status(202).json({ success: true, data: { estado: 'calculando' } });
    }),
  );

  router.delete(
    '/segments/:id',
    handle(async (req, res) => {
      const segment = await repository.getSegment(req.params.id);
      if (!segment) {
        return res.status(404).json({ success: false, error: 'Segmento no encontrado' });
      }
      await repository.deleteSegment(segment.id);
      return res.json({ success: true });
    }),
  );

  // ─── SINCRONIZACIÓN ──────────────────────────────────────────
  router.post(
    '/sync',
    handle(async (req, res) => {
      if (!activitiesSync) {
        return res.status(503).json({ success: false, error: 'Sincronización no disponible' });
      }
      if (activitiesSync.isRunning()) {
        return res.status(409).json({ success: false, error: 'Ya hay una sincronización en curso' });
      }
      const { desde, hasta, limite } = req.body || {};
      const result = activitiesSync.startSync({ desde, hasta, limite });
      return res.status(202).json({ success: true, data: result });
    }),
  );

  router.get(
    '/sync',
    handle(async (_req, res) => {
      if (!activitiesSync) {
        return res.status(503).json({ success: false, error: 'Sincronización no disponible' });
      }
      res.json({ success: true, data: activitiesSync.getStatus() });
    }),
  );

  return router;
}

module.exports = { createAppApiRouter };
