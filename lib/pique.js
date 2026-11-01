'use strict';

// ═══════════════════════════════════════════════════════════════
// 🏆 ZONA 0 — MOTOR DEL MODO PIQUE
// ═══════════════════════════════════════════════════════════════
// Calcula la temporada con datos reales: semanas, puntos (cuando
// haya varios participantes), racha, vitrina y el segmento de la
// semana dentro de la Zona 0 (Las Infantas, 15 km).
//
// De momento hay un solo atleta: la app compite contra su propio
// historial. El motor ya acepta varios usuarios para la fase de
// grupeta sin cambiar las reglas.
//
// No escribe en Supabase ni toca segmentos/esfuerzos.
// ═══════════════════════════════════════════════════════════════

const { inicioSemana } = require('./zonas');

const ZONA_0 = {
  nombre: 'Las Infantas',
  lat: 37.9146,
  lon: -3.7857,
  radio_km: 15,
  radios_reserva_km: [20, 25, 30],
};

const PUNTOS_CATEGORIA = [5, 3, 2, 1];
const MIN_DURACION_S = 600; // 10 min
const MIN_DISTANCIA_M = 3000; // 3 km

function esCiclismo(tipo) {
  return /ride|bike|cycl|gravel|mtb|mountain/i.test(String(tipo || ''));
}

function esEbike(tipo) {
  return /ebike|e-bike|e_bike|electric/i.test(String(tipo || ''));
}

function esRodillo(tipo) {
  return /virtual|indoor|trainer|rodillo/i.test(String(tipo || ''));
}

function diaDe(fecha) {
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function mesDe(fecha) {
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 7);
}

/** Distancia en km entre dos coordenadas (haversine). */
function distanciaKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function centroDeSegmento(segmento) {
  if (
    !Number.isFinite(Number(segmento.inicio_lat)) ||
    !Number.isFinite(Number(segmento.inicio_lon))
  ) {
    return null;
  }
  const finLat = Number(segmento.fin_lat);
  const finLon = Number(segmento.fin_lon);
  if (Number.isFinite(finLat) && Number.isFinite(finLon)) {
    return {
      lat: (Number(segmento.inicio_lat) + finLat) / 2,
      lon: (Number(segmento.inicio_lon) + finLon) / 2,
    };
  }
  return { lat: Number(segmento.inicio_lat), lon: Number(segmento.inicio_lon) };
}

function distanciaAlCentro(segmento, centro = ZONA_0) {
  const punto = centroDeSegmento(segmento);
  if (!punto) return null;
  return distanciaKm(centro.lat, centro.lon, punto.lat, punto.lon);
}

/** Tiempo estimado en minutos a partir de distancia y pendiente. */
function minutosEstimados(segmento) {
  const km = Number(segmento.distancia_m) / 1000;
  if (!(km > 0)) return null;
  const pendiente = Number(segmento.pendiente_media) || 0;
  const velocidad = Math.max(8, 24 - Math.max(0, pendiente) * 1.2);
  return (km / velocidad) * 60;
}

/**
 * Puntos de una categoría ordenando participantes por valor descendente.
 * Devuelve un mapa id → puntos. Empates comparten la posición.
 */
function puntosCategoria(valores) {
  const ordenados = [...valores].sort((a, b) => b.valor - a.valor);
  const puntos = new Map();
  let posicion = 0;
  let anterior = null;

  ordenados.forEach((entrada, indice) => {
    if (anterior === null || entrada.valor < anterior) {
      posicion = indice;
      anterior = entrada.valor;
    }
    puntos.set(entrada.id, PUNTOS_CATEGORIA[posicion] ?? 0);
  });

  return puntos;
}

/**
 * Segmento de la semana: candidatos dentro de la Zona 0, 1–8 min,
 * con al menos 2 intentos, rotando de forma determinista por semana.
 */
function elegirSegmento({ segmentos, semana, centro = ZONA_0, radioKm = null }) {
  const semanasDesdeEpoca = Math.floor(
    (Date.parse(`${semana}T00:00:00Z`) - Date.parse('2020-01-06T00:00:00Z')) / (7 * 86400000),
  );

  const radios = radioKm ? [radioKm] : [centro.radio_km, ...(centro.radios_reserva_km || [])];

  for (const radio of radios) {
    const candidatos = segmentos
      .filter((segmento) => {
        // Solo compiten segmentos de Strava o creados a propósito.
        // Los automáticos son inventados por el algoritmo y no tienen
        // un inicio/fin elegido por una persona.
        if (segmento.tipo !== 'strava' && segmento.tipo !== 'manual') return false;
        if (segmento.estado && segmento.estado !== 'listo') return false;
        if (!(Number(segmento.distancia_m) >= 800)) return false;
        if (!(Number(segmento.distancia_m) <= 7000)) return false;
        if (!(Number(segmento.esfuerzos) >= 2)) return false;
        const distancia = distanciaAlCentro(segmento, centro);
        if (distancia === null || distancia > radio) return false;
        const minutos = minutosEstimados(segmento);
        return minutos !== null && minutos >= 1 && minutos <= 8;
      })
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    if (candidatos.length >= 3) {
      const elegido = candidatos[((semanasDesdeEpoca % candidatos.length) + candidatos.length) % candidatos.length];
      return { segmento: elegido, radio, candidatos: candidatos.length };
    }
  }

  return null;
}

/** Métricas de una semana de actividades. */
function metricasSemana(actividades, desde, hasta) {
  const dias = new Set();
  let km = 0;
  let desnivel = 0;
  let salidas = 0;
  let horas = 0;
  let tss = 0;
  let rodilloHoras = 0;

  for (const actividad of actividades) {
    const tiempo = Date.parse(actividad.fecha);
    if (!(tiempo >= desde && tiempo < hasta)) continue;

    const duracion = Number(actividad.duracion_s) || 0;
    if (duracion < MIN_DURACION_S) continue;

    salidas += 1;
    const dia = diaDe(actividad.fecha);
    if (dia) dias.add(dia);
    horas += duracion / 3600;
    tss += Number(actividad.tss) || 0;

    if (esRodillo(actividad.tipo)) {
      rodilloHoras += duracion / 3600;
      continue;
    }
    if (esEbike(actividad.tipo)) continue;
    if (!actividad.tiene_gps) continue;
    if ((Number(actividad.distancia_m) || 0) < MIN_DISTANCIA_M) continue;

    km += (Number(actividad.distancia_m) || 0) / 1000;
    desnivel += Number(actividad.desnivel_m) || 0;
  }

  return {
    km: Math.round(km * 10) / 10,
    desnivel_m: Math.round(desnivel),
    dias: dias.size,
    salidas,
    horas: Math.round(horas * 10) / 10,
    tss: Math.round(tss),
    rodillo_h: Math.round(rodilloHoras * 10) / 10,
  };
}

function porcentajeCambio(actual, media) {
  if (!(media > 0)) return null;
  return Math.round(((actual - media) / media) * 100);
}

function crearServicioPique({ repository, logger = () => {} }) {
  let cache = null;
  let cacheadoEn = 0;

  async function listarTodasLasActividades() {
    const todas = [];
    for (let offset = 0; offset <= 20000; offset += 200) {
      const lote = await repository.listActivities({ limit: 200, offset });
      todas.push(...lote);
      if (lote.length < 200) break;
    }
    return todas;
  }

  async function calcularSegmento(semana) {
    const segmentos = await repository.listSegments();

    // Prefiltro barato: zona, distancia y duración estimada.
    const candidatosBase = segmentos.filter((segmento) => {
      if (segmento.tipo !== 'strava' && segmento.tipo !== 'manual') return false;
      if (segmento.estado && segmento.estado !== 'listo') return false;
      if (!(Number(segmento.distancia_m) >= 800)) return false;
      if (!(Number(segmento.distancia_m) <= 7000)) return false;
      const distancia = distanciaAlCentro(segmento);
      if (distancia === null || distancia > 25) return false;
      const minutos = minutosEstimados(segmento);
      return minutos !== null && minutos >= 1 && minutos <= 8;
    });

    // La columna `esfuerzos` puede estar desactualizada: manda la tabla real.
    const esfuerzos = await repository.listEfforts(candidatosBase.map((segmento) => segmento.id));
    const porSegmento = new Map();
    for (const esfuerzo of esfuerzos) {
      if (!(Number(esfuerzo.tiempo_s) > 0)) continue;
      const lista = porSegmento.get(esfuerzo.segmento_id) || [];
      lista.push(esfuerzo);
      porSegmento.set(esfuerzo.segmento_id, lista);
    }

    const conEsfuerzos = candidatosBase
      .map((segmento) => {
        const lista = porSegmento.get(segmento.id) || [];
        if (lista.length < 2) return null;
        const tiempos = lista.map((esfuerzo) => Number(esfuerzo.tiempo_s)).sort((a, b) => a - b);
        const mediana = tiempos[Math.floor(tiempos.length / 2)];
        if (mediana < 60 || mediana > 480) return null;
        return { ...segmento, esfuerzos: lista.length };
      })
      .filter(Boolean);

    const eleccion = elegirSegmento({ segmentos: conEsfuerzos, semana });
    if (!eleccion) return null;

    const segmento = eleccion.segmento;
    const lista = (porSegmento.get(segmento.id) || []).sort(
      (a, b) => Number(a.tiempo_s) - Number(b.tiempo_s),
    );

    // Descarta esfuerzos imposibles (tiempos muy por debajo de la mediana):
    // un dato suelto no debe reventar el pique de la semana.
    const mediana =
      lista.length > 0
        ? Number(lista[Math.floor(lista.length / 2)].tiempo_s)
        : 0;
    const plausibles = lista.filter(
      (esfuerzo) => Number(esfuerzo.tiempo_s) >= mediana * 0.5,
    );
    const mejor = plausibles[0] || null;
    const deLaSemana = plausibles.filter((esfuerzo) => {
      const dia = diaDe(esfuerzo.fecha);
      return dia && dia >= semana && dia < siguienteSemana(semana);
    });
    const mejorSemana = deLaSemana[0] || null;

    return {
      id: segmento.id,
      nombre: segmento.nombre,
      tipo: segmento.tipo,
      deporte: segmento.deporte ?? null,
      distancia_m: segmento.distancia_m,
      desnivel_m: segmento.desnivel_m,
      pendiente_media: segmento.pendiente_media,
      categoria: segmento.categoria,
      centro: centroDeSegmento(segmento),
      radio_km: eleccion.radio,
      candidatos: eleccion.candidatos,
      esfuerzos: lista.length,
      mejor_tiempo_s: mejor ? Number(mejor.tiempo_s) : null,
      mejor_fecha: mejor ? mejor.fecha : null,
      mejor_semana_s: mejorSemana ? Number(mejorSemana.tiempo_s) : null,
      mejor_semana_fecha: mejorSemana ? mejorSemana.fecha : null,
      intentos_semana: deLaSemana.length,
    };
  }

  async function calcular({ ahora = new Date() } = {}) {
    const semanaActual = inicioSemana(ahora.toISOString());
    const actividades = await listarTodasLasActividades();

    // Últimas 12 semanas (8 visibles + 4 para la remontada).
    const semanas = [];
    for (let i = 11; i >= 0; i -= 1) {
      const lunes = new Date(`${semanaActual}T00:00:00Z`);
      lunes.setUTCDate(lunes.getUTCDate() - i * 7);
      const clave = lunes.toISOString().slice(0, 10);
      const desde = lunes.getTime();
      const hasta = desde + 7 * 86400000;
      semanas.push({ semana: clave, desde, hasta, ...metricasSemana(actividades, desde, hasta) });
    }

    // Remontada: horas vs media de las 4 semanas anteriores.
    for (let i = 0; i < semanas.length; i += 1) {
      const previas = semanas.slice(Math.max(0, i - 4), i).filter((s) => s.horas > 0);
      const media = previas.length >= 3 ? previas.reduce((suma, s) => suma + s.horas, 0) / previas.length : null;
      semanas[i].remontada_pct = media ? porcentajeCambio(semanas[i].horas, media) : null;
    }

    const visibles = semanas.slice(-8);
    const resumen = {
      km: Math.round(visibles.reduce((suma, s) => suma + s.km, 0) * 10) / 10,
      desnivel_m: Math.round(visibles.reduce((suma, s) => suma + s.desnivel_m, 0)),
      dias: visibles.reduce((suma, s) => suma + s.dias, 0),
      salidas: visibles.reduce((suma, s) => suma + s.salidas, 0),
      horas: Math.round(visibles.reduce((suma, s) => suma + s.horas, 0) * 10) / 10,
      tss: Math.round(visibles.reduce((suma, s) => suma + s.tss, 0)),
    };

    // Racha actual: semanas seguidas con al menos una salida válida.
    let racha = 0;
    for (let i = visibles.length - 1; i >= 0; i -= 1) {
      if (visibles[i].salidas > 0) racha += 1;
      else break;
    }
    resumen.racha_semanas = racha;

    // Vitrina: hitos de todo el historial.
    const mejorSemanaKm = visibles.reduce(
      (mejor, s) => (!mejor || s.km > mejor.km ? s : mejor),
      null,
    );
    const mejorSemanaDesnivel = visibles.reduce(
      (mejor, s) => (!mejor || s.desnivel_m > mejor.desnivel_m ? s : mejor),
      null,
    );

    const meses = new Map();
    let salidaMasLarga = null;
    let masDesnivel = null;
    for (const actividad of actividades) {
      const mes = mesDe(actividad.fecha);
      if (mes) {
        const actual = meses.get(mes) || { mes, km: 0, desnivel_m: 0 };
        actual.km += (Number(actividad.distancia_m) || 0) / 1000;
        actual.desnivel_m += Number(actividad.desnivel_m) || 0;
        meses.set(mes, actual);
      }

      if (!salidaMasLarga || (Number(actividad.distancia_m) || 0) > salidaMasLarga.distancia_m) {
        salidaMasLarga = {
          nombre: actividad.nombre,
          fecha: actividad.fecha,
          distancia_m: Number(actividad.distancia_m) || 0,
        };
      }
      if (!masDesnivel || (Number(actividad.desnivel_m) || 0) > masDesnivel.desnivel_m) {
        masDesnivel = {
          nombre: actividad.nombre,
          fecha: actividad.fecha,
          desnivel_m: Number(actividad.desnivel_m) || 0,
        };
      }
    }

    const mejorMesKm = [...meses.values()].reduce(
      (mejor, m) => (!mejor || m.km > mejor.km ? m : mejor),
      null,
    );
    const mejorMesDesnivel = [...meses.values()].reduce(
      (mejor, m) => (!mejor || m.desnivel_m > mejor.desnivel_m ? m : mejor),
      null,
    );

    const vitrina = [
      mejorSemanaKm && {
        id: 'semana_km',
        nombre: 'Semana más larga',
        valor: mejorSemanaKm.km,
        unidad: 'km',
        detalle: mejorSemanaKm.semana,
      },
      mejorSemanaDesnivel && {
        id: 'semana_desnivel',
        nombre: 'Semana más dura',
        valor: mejorSemanaDesnivel.desnivel_m,
        unidad: 'm',
        detalle: mejorSemanaDesnivel.semana,
      },
      mejorMesKm && {
        id: 'mes_km',
        nombre: 'Mejor mes',
        valor: Math.round(mejorMesKm.km),
        unidad: 'km',
        detalle: mejorMesKm.mes,
      },
      mejorMesDesnivel && {
        id: 'mes_desnivel',
        nombre: 'Mes más montañoso',
        valor: Math.round(mejorMesDesnivel.desnivel_m),
        unidad: 'm',
        detalle: mejorMesDesnivel.mes,
      },
      salidaMasLarga && {
        id: 'salida_larga',
        nombre: 'Salida más larga',
        valor: Math.round(salidaMasLarga.distancia_m / 1000),
        unidad: 'km',
        detalle: salidaMasLarga.nombre || salidaMasLarga.fecha?.slice(0, 10),
      },
      masDesnivel && {
        id: 'salida_desnivel',
        nombre: 'Salida más épica',
        valor: masDesnivel.desnivel_m,
        unidad: 'm',
        detalle: masDesnivel.nombre || masDesnivel.fecha?.slice(0, 10),
      },
    ].filter(Boolean);

    const segmento = await calcularSegmento(semanaActual);

    return {
      zona_0: {
        nombre: ZONA_0.nombre,
        lat: ZONA_0.lat,
        lon: ZONA_0.lon,
        radio_km: ZONA_0.radio_km,
      },
      semana_actual: semanaActual,
      semanas: visibles,
      resumen,
      vitrina,
      segmento,
      actualizado: new Date().toISOString(),
    };
  }

  async function getPique({ refresh = false } = {}) {
    if (!refresh && cache && Date.now() - cacheadoEn < 5 * 60 * 1000) {
      return { ...cache, cacheado: true };
    }

    const datos = await calcular();
    cache = datos;
    cacheadoEn = Date.now();
    return { ...datos, cacheado: false };
  }

  return { getPique, calcular };
}

function siguienteSemana(semana) {
  const d = new Date(`${semana}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  crearServicioPique,
  elegirSegmento,
  puntosCategoria,
  metricasSemana,
  distanciaKm,
  minutosEstimados,
  centroDeSegmento,
  esEbike,
  esRodillo,
  esCiclismo,
  ZONA_0,
  PUNTOS_CATEGORIA,
};
