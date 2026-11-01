'use strict';

// ═══════════════════════════════════════════════════════════════
// 🧰 SERVICIOS POR USUARIO (APP MULTIJUGADOR)
// ═══════════════════════════════════════════════════════════════
// Cada token tiene su repositorio, sus segmentos, su sincronización
// y su router. Nada de un usuario puede leer los datos de otro: el
// repository filtra siempre por user_id.
// ═══════════════════════════════════════════════════════════════

const { createActivityRepository } = require('./activityRepository');
const { createSegmentsService } = require('./segmentsService');
const { createIntervalsClient } = require('./intervalsClient');
const { createActivitiesSync } = require('./activitiesSync');
const { createAppApiRouter } = require('./appApiRouter');
const { crearServicioPique } = require('./pique');
const { resolverAtleta } = require('./appUsers');

function crearServiciosApp({ supabase, perfil, fetchImpl, logger = () => {} } = {}) {
  if (!supabase) throw new Error('Falta el cliente de Supabase');
  if (!perfil || !perfil.token) throw new Error('Falta el perfil de la app');

  let promesa = null;

  async function construir() {
    let athleteId = perfil.athleteId || null;
    let userId = perfil.userId || null;
    let nombre = perfil.nombre || 'Ciclista';

    if ((!athleteId || !userId) && perfil.intervalsApiKey) {
      const atleta = await resolverAtleta({
        apiKey: perfil.intervalsApiKey,
        fetchImpl,
      });
      athleteId = athleteId || atleta.athleteId;
      userId = userId || athleteId;
      if (!perfil.nombre && atleta.nombre) nombre = atleta.nombre;
    }

    if (!userId && athleteId) userId = athleteId;
    if (!userId) {
      throw new Error(`Perfil ${nombre}: falta athlete_id o user_id`);
    }

    const resuelto = {
      ...perfil,
      athleteId,
      userId,
      nombre,
    };

    const repository = createActivityRepository({ supabase, userId, logger });
    const segmentsService = createSegmentsService({ repository, userId, logger });
    const piqueService = crearServicioPique({ repository, logger });

    const intervals =
      resuelto.intervalsApiKey && resuelto.athleteId
        ? createIntervalsClient({
            apiKey: resuelto.intervalsApiKey,
            athleteId: resuelto.athleteId,
            logger,
          })
        : null;

    const activitiesSync = intervals
      ? createActivitiesSync({
          repository,
          segmentsService,
          intervals,
          userId,
          logger,
        })
      : null;

    const router = createAppApiRouter({
      repository,
      segmentsService,
      activitiesSync,
      piqueService,
      skipAuth: true,
      logger,
    });

    return {
      perfil: resuelto,
      repository,
      segmentsService,
      piqueService,
      intervals,
      activitiesSync,
      router,
    };
  }

  function get() {
    if (!promesa) {
      promesa = construir().catch((error) => {
        promesa = null;
        throw error;
      });
    }
    return promesa;
  }

  return { get };
}

module.exports = { crearServiciosApp };
