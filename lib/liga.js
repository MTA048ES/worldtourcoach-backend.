'use strict';

// ═══════════════════════════════════════════════════════════════
// 🏁 LIGA ZONA 0 (VARIOS JUGADORES)
// ═══════════════════════════════════════════════════════════════
// Suma los puntos de las 5 categorías de cada semana:
// km, desnivel, días, segmento y remontada.
// El maillot amarillo es para el que más puntos suma, no para el
// que más kilómetros hace.
//
// Solo se comparten totales. Nunca trazas ni datos crudos.
// ═══════════════════════════════════════════════════════════════

const { puntosCategoria } = require('./pique');
const { claveSemana } = require('./fechas');

const CATEGORIAS = ['km', 'desnivel', 'dias', 'segmento', 'remontada'];

function dentroDeSemana(fecha, semana) {
  return claveSemana(fecha) === semana;
}

function mejorEsfuerzoSemana(esfuerzos, semana, segmentoId) {
  if (!segmentoId) return { mejor_s: null, intentos: 0, mejor: null };

  const lista = (esfuerzos || [])
    .filter(
      (esfuerzo) =>
        esfuerzo.segmento_id === segmentoId && dentroDeSemana(esfuerzo.fecha, semana),
    )
    .filter((esfuerzo) => Number.isFinite(Number(esfuerzo.tiempo_s)) && Number(esfuerzo.tiempo_s) > 0)
    .sort((a, b) => Number(a.tiempo_s) - Number(b.tiempo_s));

  const mejor = lista[0] || null;
  return {
    mejor_s: mejor ? Number(mejor.tiempo_s) : null,
    intentos: lista.length,
    mejor,
  };
}

function lider(filas, obtener, { positivo = true } = {}) {
  const validos = filas
    .map((fila) => ({ fila, valor: obtener(fila) }))
    .filter((entrada) => {
      if (entrada.valor === null || entrada.valor === undefined) return false;
      return positivo ? Number(entrada.valor) > 0 : true;
    });

  if (validos.length === 0) return null;

  const mejor = validos.reduce((actual, candidato) =>
    Number(candidato.valor) > Number(actual.valor) ? candidato : actual,
  );

  return {
    user_id: mejor.fila.user_id,
    nombre: mejor.fila.nombre,
    valor: mejor.valor,
  };
}

function maillotsSemana(filas) {
  return {
    amarillo: lider(filas, (fila) => fila.puntos),
    verde: lider(filas, (fila) => fila.dias),
    montana: lider(filas, (fila) => fila.desnivel_m),
    segmentos: lider(filas, (fila) => fila.categorias.segmento + fila.bonus_segmento),
    remontada: lider(filas, (fila) => fila.remontada_pct),
  };
}

function maillotsTabla(tabla) {
  return {
    amarillo: lider(tabla, (fila) => fila.puntos),
    verde: lider(tabla, (fila) => fila.dias),
    montana: lider(tabla, (fila) => fila.desnivel_m),
    segmentos: lider(tabla, (fila) => fila.segmento_puntos),
    remontada: lider(tabla, (fila) => fila.remontada_pct),
  };
}

function puntuarSemana(filas) {
  const puntos = new Map(
    filas.map((fila) => [
      fila.user_id,
      { km: 0, desnivel: 0, dias: 0, segmento: 0, remontada: 0 },
    ]),
  );

  function repartir(clave, valores, opciones) {
    for (const [id, valor] of puntosCategoria(valores, opciones)) {
      puntos.get(id)[clave] = valor;
    }
  }

  repartir(
    'km',
    filas.filter((fila) => fila.km > 0).map((fila) => ({ id: fila.user_id, valor: fila.km })),
  );
  repartir(
    'desnivel',
    filas
      .filter((fila) => fila.desnivel_m > 0)
      .map((fila) => ({ id: fila.user_id, valor: fila.desnivel_m })),
  );
  repartir(
    'dias',
    filas.filter((fila) => fila.dias > 0).map((fila) => ({ id: fila.user_id, valor: fila.dias })),
  );
  repartir(
    'remontada',
    filas
      .filter((fila) => Number(fila.remontada_pct) > 0)
      .map((fila) => ({ id: fila.user_id, valor: fila.remontada_pct })),
  );
  repartir(
    'segmento',
    filas
      .filter((fila) => fila.segmento_s !== null)
      .map((fila) => ({ id: fila.user_id, valor: fila.segmento_s })),
    { ascendente: true },
  );

  const tabla = filas
    .map((fila) => {
      const categorias = puntos.get(fila.user_id);
      const bonusSegmento = fila.intentos > 0 ? 1 : 0;
      const total =
        categorias.km +
        categorias.desnivel +
        categorias.dias +
        categorias.segmento +
        categorias.remontada +
        bonusSegmento;

      return {
        ...fila,
        bonus_segmento: bonusSegmento,
        categorias,
        puntos: total,
      };
    })
    .sort((a, b) => b.puntos - a.puntos || b.km - a.km);

  return { filas: tabla, maillots: maillotsSemana(tabla) };
}

function agregarTabla(piques, semanas) {
  const acumulado = new Map(
    piques.map((pique) => [
      pique.userId,
      {
        user_id: pique.userId,
        nombre: pique.nombre,
        puntos: 0,
        km: 0,
        desnivel_m: 0,
        dias: 0,
        segmento_puntos: 0,
        bonus_segmento: 0,
        remontada_pct: null,
        categorias: { km: 0, desnivel: 0, dias: 0, segmento: 0, remontada: 0 },
      },
    ]),
  );

  for (const semana of semanas) {
    for (const fila of semana.filas) {
      const total = acumulado.get(fila.user_id);
      if (!total) continue;

      total.puntos += fila.puntos;
      total.km += fila.km;
      total.desnivel_m += fila.desnivel_m;
      total.dias += fila.dias;
      total.segmento_puntos += fila.categorias.segmento + fila.bonus_segmento;
      total.bonus_segmento += fila.bonus_segmento;

      for (const clave of CATEGORIAS) {
        total.categorias[clave] += fila.categorias[clave];
      }

      if (
        fila.remontada_pct !== null &&
        Number(fila.remontada_pct) > 0 &&
        (total.remontada_pct === null || fila.remontada_pct > total.remontada_pct)
      ) {
        total.remontada_pct = fila.remontada_pct;
      }
    }
  }

  return [...acumulado.values()].sort(
    (a, b) => b.puntos - a.puntos || b.km - a.km,
  );
}

function crearServicioLiga({ usuarios = [], logger = () => {} } = {}) {
  let cache = null;
  let cacheadoEn = 0;

  async function calcular({ refresh = false } = {}) {
    const resueltos = (
      await Promise.all(
        usuarios.map(async (usuario) => {
          const nombre = usuario.perfil?.nombre || usuario.nombre || 'Ciclista';
          try {
            const servicios = await usuario.getServicios();
            const perfil = servicios.perfil || usuario.perfil || {};
            return {
              ...servicios,
              userId: perfil.userId || usuario.userId,
              nombre: perfil.nombre || nombre,
            };
          } catch (error) {
            logger(`[liga] ${nombre}: ${error.message}`);
            return null;
          }
        }),
      )
    ).filter((usuario) => usuario && usuario.userId);

    if (resueltos.length === 0) {
      throw new Error('No hay perfiles disponibles para la liga');
    }

    const piques = (
      await Promise.all(
        resueltos.map(async (usuario) => {
          try {
            return {
              ...usuario,
              pique: await usuario.piqueService.getPique({ refresh }),
            };
          } catch (error) {
            logger(`[liga] ${usuario.nombre}: ${error.message}`);
            return null;
          }
        }),
      )
    ).filter(Boolean);

    if (piques.length === 0) {
      throw new Error('No se ha podido calcular la liga');
    }

    const capitan = piques[0];
    const semanasBase = capitan.pique.semanas || [];

    // Cada semana tiene su propio segmento (rotación determinista).
    // El catálogo del capitán se cachea dentro de su servicio de pique.
    const calcularSegmento =
      capitan.piqueService && typeof capitan.piqueService.calcularSegmento === 'function'
        ? (semana) => capitan.piqueService.calcularSegmento(semana)
        : async () => capitan.pique.segmento || null;

    const segmentosSemana = new Map();
    for (const semanaBase of semanasBase) {
      try {
        segmentosSemana.set(
          semanaBase.semana,
          await calcularSegmento(semanaBase.semana),
        );
      } catch (error) {
        logger(`[liga] segmento de ${semanaBase.semana}: ${error.message}`);
        segmentosSemana.set(semanaBase.semana, null);
      }
    }

    const idsSegmentos = [
      ...new Set(
        [...segmentosSemana.values()]
          .filter(Boolean)
          .map((segmento) => segmento.id),
      ),
    ];

    // El segmento de la liga vive en el catálogo del capitán. Los demás
    // perfiles pueden no tener el mismo Strava, así que completamos sus
    // esfuerzos calculándolos sobre sus trazas (sin guardar nada).
    const segmentosCompletos = new Map();
    if (capitan.repository && typeof capitan.repository.getSegment === 'function') {
      for (const id of idsSegmentos) {
        try {
          const segmento = await capitan.repository.getSegment(id);
          if (segmento) segmentosCompletos.set(id, segmento);
        } catch (error) {
          logger(`[liga] geometría del segmento ${id}: ${error.message}`);
        }
      }
    }

    const esfuerzosPorUsuario = new Map();
    for (const usuario of piques) {
      let esfuerzos = [];
      if (idsSegmentos.length > 0) {
        try {
          // El servicio de pique filtra e-bike, running, manuales y
          // salidas no válidas sin borrar los esfuerzos antiguos.
          if (
            usuario.piqueService &&
            typeof usuario.piqueService.listEffortsValidos === 'function'
          ) {
            esfuerzos = await usuario.piqueService.listEffortsValidos(idsSegmentos);
          } else {
            esfuerzos = await usuario.repository.listEfforts(idsSegmentos);
          }
        } catch (error) {
          logger(`[liga] esfuerzos de ${usuario.nombre}: ${error.message}`);
        }
      }

      const yaTiene = new Set(esfuerzos.map((esfuerzo) => esfuerzo.segmento_id));
      const faltantes = idsSegmentos
        .filter((id) => !yaTiene.has(id))
        .map((id) => segmentosCompletos.get(id))
        .filter(Boolean);

      if (faltantes.length > 0 && usuario.segmentsService) {
        try {
          let calculados = [];
          if (typeof usuario.segmentsService.listEffortsForSharedSegments === 'function') {
            // Una sola pasada por las trazas para todos los segmentos.
            calculados = await usuario.segmentsService.listEffortsForSharedSegments(faltantes);
          } else if (typeof usuario.segmentsService.listEffortsForSharedSegment === 'function') {
            // Compatibilidad con perfiles/servicios antiguos.
            for (const segmento of faltantes) {
              const lote = await usuario.segmentsService.listEffortsForSharedSegment(segmento);
              if (Array.isArray(lote)) {
                calculados.push(
                  ...lote.map((esfuerzo) => ({
                    ...esfuerzo,
                    segmento_id: esfuerzo.segmento_id || segmento.id,
                  })),
                );
              }
            }
          }

          if (Array.isArray(calculados) && calculados.length > 0) {
            esfuerzos = esfuerzos.concat(calculados);
          }
        } catch (error) {
          logger(`[liga] comparativa de ${usuario.nombre}: ${error.message}`);
        }
      }

      esfuerzosPorUsuario.set(usuario.userId, esfuerzos);
    }

    const semanas = semanasBase.map((semanaBase) => {
      const segmento = segmentosSemana.get(semanaBase.semana) || null;
      const filas = piques.map((usuario) => {
        const semanaUsuario =
          (usuario.pique.semanas || []).find((semana) => semana.semana === semanaBase.semana) ||
          {};
        const esfuerzo = mejorEsfuerzoSemana(
          esfuerzosPorUsuario.get(usuario.userId),
          semanaBase.semana,
          segmento ? segmento.id : null,
        );

        return {
          user_id: usuario.userId,
          nombre: usuario.nombre,
          km: Number(semanaUsuario.km) || 0,
          desnivel_m: Number(semanaUsuario.desnivel_m) || 0,
          dias: Number(semanaUsuario.dias) || 0,
          remontada_pct:
            semanaUsuario.remontada_pct === null ||
            semanaUsuario.remontada_pct === undefined
              ? null
              : Number(semanaUsuario.remontada_pct),
          segmento_s: esfuerzo.mejor_s,
          intentos: esfuerzo.intentos,
        };
      });

      return {
        semana: semanaBase.semana,
        segmento: segmento
          ? { id: segmento.id, nombre: segmento.nombre }
          : null,
        ...puntuarSemana(filas),
      };
    });

    const tabla = agregarTabla(piques, semanas);
    const semanaActualBase = semanasBase[semanasBase.length - 1];
    const segmentoActual = semanaActualBase
      ? segmentosSemana.get(semanaActualBase.semana) || null
      : null;

    // Comparativa del segmento de esta semana: el mejor esfuerzo de cada
    // perfil, con potencia y pulso. Solo datos del tramo, nunca la traza.
    const comparativa = segmentoActual
      ? piques
          .map((usuario) => {
            const esfuerzo = mejorEsfuerzoSemana(
              esfuerzosPorUsuario.get(usuario.userId),
              semanaActualBase.semana,
              segmentoActual.id,
            );
            return {
              user_id: usuario.userId,
              nombre: usuario.nombre,
              tiempo_s: esfuerzo.mejor_s,
              intentos: esfuerzo.intentos,
              fecha: esfuerzo.mejor ? esfuerzo.mejor.fecha : null,
              pot_media: esfuerzo.mejor ? esfuerzo.mejor.pot_media : null,
              np: esfuerzo.mejor ? esfuerzo.mejor.np : null,
              fc_media: esfuerzo.mejor ? esfuerzo.mejor.fc_media : null,
              velocidad_media: esfuerzo.mejor ? esfuerzo.mejor.velocidad_media : null,
              posicion: null,
            };
          })
          .sort((a, b) => {
            const tiempoA = a.tiempo_s === null ? Number.POSITIVE_INFINITY : a.tiempo_s;
            const tiempoB = b.tiempo_s === null ? Number.POSITIVE_INFINITY : b.tiempo_s;
            return tiempoA - tiempoB;
          })
      : [];

    comparativa.forEach((fila, indice) => {
      if (fila.tiempo_s !== null) fila.posicion = indice + 1;
    });

    return {
      participantes: piques.length,
      semana_actual: capitan.pique.semana_actual,
      segmento: segmentoActual
        ? {
            id: segmentoActual.id,
            nombre: segmentoActual.nombre,
            distancia_m: segmentoActual.distancia_m,
            pendiente_media: segmentoActual.pendiente_media,
            comparativa,
          }
        : null,
      semanas,
      tabla,
      maillots: maillotsTabla(tabla),
      actualizado: new Date().toISOString(),
    };
  }

  async function getLiga({ refresh = false } = {}) {
    if (!refresh && cache && Date.now() - cacheadoEn < 5 * 60 * 1000) {
      return { ...cache, cacheado: true };
    }

    const datos = await calcular();
    cache = datos;
    cacheadoEn = Date.now();
    return { ...datos, cacheado: false };
  }

  return { getLiga, calcular };
}

module.exports = {
  crearServicioLiga,
  puntuarSemana,
  agregarTabla,
  maillotsSemana,
  maillotsTabla,
  mejorEsfuerzoSemana,
  dentroDeSemana,
};
