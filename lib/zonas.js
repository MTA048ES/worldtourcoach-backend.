'use strict';

// ═══════════════════════════════════════════════════════════════
// 📊 ZONAS SEMANALES Y POLARIZACIÓN
// ═══════════════════════════════════════════════════════════════
// Reparte el tiempo de cada salida en las 7 zonas de potencia
// (Coggan) según el FTP y lo agrupa por semanas que empiezan en
// lunes. Devuelve además un índice de polarización sencillo:
//
//   PI = (tiempo fácil − tiempo intenso) / tiempo total
//
//   fácil    = Z1 + Z2  (< 76 % FTP)
//   medio    = Z3 + Z4  (76–105 % FTP)
//   intenso  = Z5 + Z6 + Z7  (> 105 % FTP)
//
// Va de -1 (todo intenso) a 1 (todo fácil). Lo sano para un
// ciclista amateur es 0,4–0,8: mucho fácil y algo de muy intenso.
// ═══════════════════════════════════════════════════════════════

const LIMITES_FTP = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5];

const NOMBRES_ZONA = [
  'Recuperación',
  'Resistencia',
  'Tempo',
  'Umbral',
  'VO2max',
  'Anaeróbica',
  'Neuromuscular',
];

function esCiclismo(tipo) {
  return /ride|bike|cycl/i.test(String(tipo || ''));
}

/** Zona 1–7 para una potencia y un FTP dados. */
function zonaDePotencia(vatios, ftp) {
  if (!Number.isFinite(vatios) || vatios <= 0 || !Number.isFinite(ftp) || ftp <= 0) return 0;
  const ratio = vatios / ftp;
  for (let i = 0; i < LIMITES_FTP.length; i += 1) {
    if (ratio <= LIMITES_FTP[i]) return i + 1;
  }
  return 7;
}

/** Lunes (UTC) de la semana a la que pertenece una fecha, como YYYY-MM-DD. */
function inicioSemana(fecha) {
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return null;
  const dia = (d.getUTCDay() + 6) % 7; // 0 = lunes
  const lunes = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dia));
  return lunes.toISOString().slice(0, 10);
}

/**
 * Segundos en cada zona de una traza. Usa el hueco real entre muestras
 * (limitado a 5 s para no inflar paradas largas) y descarta las muestras
 * sin potencia.
 */
function segundosEnZonas(track, ftp) {
  const salida = [0, 0, 0, 0, 0, 0, 0];
  if (!track || !track.hasPower || !Array.isArray(track.t) || track.t.length < 2) {
    return { zonas: salida, total_s: 0 };
  }

  let total = 0;
  for (let i = 0; i < track.t.length - 1; i += 1) {
    const potencia = track.p[i];
    if (potencia === null || !Number.isFinite(potencia) || potencia < 0) continue;

    const hueco = track.t[i + 1] - track.t[i];
    if (!(hueco > 0)) continue;
    const dt = Math.min(hueco, 5);

    const zona = zonaDePotencia(potencia, ftp);
    if (zona > 0) {
      salida[zona - 1] += dt;
      total += dt;
    }
  }

  return { zonas: salida, total_s: Math.round(total) };
}

function porcentaje(parte, total) {
  return total > 0 ? Math.round((parte / total) * 1000) / 10 : 0;
}

/** Polarización a partir de los segundos por zona. */
function polarizacion(zonas) {
  const total = zonas.reduce((suma, valor) => suma + valor, 0);
  if (total <= 0) return null;
  const facil = zonas[0] + zonas[1];
  const medio = zonas[2] + zonas[3];
  const intenso = zonas[4] + zonas[5] + zonas[6];
  return {
    indice: Math.round(((facil - intenso) / total) * 100) / 100,
    facil_pct: porcentaje(facil, total),
    medio_pct: porcentaje(medio, total),
    intenso_pct: porcentaje(intenso, total),
  };
}

function etiquetaPolarizacion(distribucion) {
  if (!distribucion) return 'Sin datos';
  if (distribucion.medio_pct >= 40) return 'Mucho tempo';
  if (distribucion.indice >= 0.75) return 'Muy polarizada';
  if (distribucion.indice >= 0.4) return 'Polarizada';
  if (distribucion.indice >= 0.15) return 'Mixta';
  return 'Carga intensa';
}

function crearServicioZonas({ repository, codec, cacheMs = 5 * 60 * 1000, logger = () => {} }) {
  const cache = new Map();

  function semanasDelRango(cantidad, ahora = new Date()) {
    const lunesActual = inicioSemana(ahora.toISOString());
    const semanas = [];
    for (let i = cantidad - 1; i >= 0; i -= 1) {
      const lunes = new Date(`${lunesActual}T00:00:00Z`);
      lunes.setUTCDate(lunes.getUTCDate() - i * 7);
      semanas.push(lunes.toISOString().slice(0, 10));
    }
    return semanas;
  }

  async function calcular({ semanas = 8, ftp = 250, ahora = new Date() }) {
    const listaSemanas = semanasDelRango(semanas, ahora);
    const desde = `${listaSemanas[0]}T00:00:00.000Z`;

    const actividades = [];
    for (let offset = 0; offset <= 20000; offset += 200) {
      const lote = await repository.listActivities({ limit: 200, offset, desde });
      actividades.push(...lote);
      if (lote.length < 200) break;
    }

    const porSemana = new Map();
    for (const clave of listaSemanas) {
      porSemana.set(clave, {
        semana: clave,
        zonas: [0, 0, 0, 0, 0, 0, 0],
        total_s: 0,
        salidas: 0,
        tss: 0,
        desnivel_m: 0,
        distancia_m: 0,
      });
    }

    // Solo bicicleta con potencia; las carreras no cuentan para las zonas.
    const elegibles = actividades.filter(
      (actividad) => esCiclismo(actividad.tipo) && Number(actividad.duracion_s) > 0,
    );
    const porId = new Map(elegibles.map((actividad) => [actividad.actividad_id, actividad]));

    for (const grupo of chunk([...porId.keys()], 20)) {
      const filas = await repository.getTrackRows(grupo);
      for (const fila of filas) {
        const actividad = porId.get(fila.actividad_id);
        if (!actividad) continue;

        let track = null;
        try {
          track = codec.decodeTrack(fila.datos);
        } catch (error) {
          logger(`[zonas] traza ${fila.actividad_id}: ${error.message}`);
          continue;
        }
        if (!track) continue;

        const { zonas, total_s: total } = segundosEnZonas(track, ftp);
        if (total <= 0) continue;

        const clave = inicioSemana(actividad.fecha);
        const semana = porSemana.get(clave) || {
          semana: clave,
          zonas: [0, 0, 0, 0, 0, 0, 0],
          total_s: 0,
          salidas: 0,
          tss: 0,
          desnivel_m: 0,
          distancia_m: 0,
        };

        for (let i = 0; i < 7; i += 1) semana.zonas[i] += zonas[i];
        semana.total_s += total;
        semana.salidas += 1;
        semana.tss += Number(actividad.tss) || 0;
        semana.desnivel_m += Number(actividad.desnivel_m) || 0;
        semana.distancia_m += Number(actividad.distancia_m) || 0;
        porSemana.set(clave, semana);
      }
    }

    const semanasSalida = [...porSemana.values()]
      .sort((a, b) => (a.semana < b.semana ? -1 : 1))
      .map((semana) => {
        const total = semana.zonas.reduce((suma, valor) => suma + valor, 0);
        const distribucion = polarizacion(semana.zonas);
        return {
          semana: semana.semana,
          zonas: Object.fromEntries(semana.zonas.map((valor, i) => [`z${i + 1}_s`, Math.round(valor)])),
          total_s: Math.round(total),
          horas: Math.round((total / 3600) * 10) / 10,
          salidas: semana.salidas,
          tss: Math.round(semana.tss),
          desnivel_m: Math.round(semana.desnivel_m),
          distancia_km: Math.round(semana.distancia_m / 1000),
          polarizacion: distribucion,
          etiqueta: etiquetaPolarizacion(distribucion),
        };
      });

    const zonasTotales = [0, 0, 0, 0, 0, 0, 0];
    let totalGeneral = 0;
    let tssTotal = 0;
    let salidasTotal = 0;
    let desnivelTotal = 0;
    for (const semana of semanasSalida) {
      for (let i = 0; i < 7; i += 1) zonasTotales[i] += semana.zonas[`z${i + 1}_s`];
      totalGeneral += semana.total_s;
      tssTotal += semana.tss;
      salidasTotal += semana.salidas;
      desnivelTotal += semana.desnivel_m;
    }

    const distribucion = polarizacion(zonasTotales);
    const conDatos = semanasSalida.filter((semana) => semana.total_s > 0);

    return {
      semanas: semanasSalida,
      resumen: {
        semanas: semanasSalida.length,
        semanas_con_datos: conDatos.length,
        salidas: salidasTotal,
        horas: Math.round((totalGeneral / 3600) * 10) / 10,
        tss: Math.round(tssTotal),
        desnivel_m: Math.round(desnivelTotal),
        zonas_s: Object.fromEntries(
          zonasTotales.map((valor, i) => [`z${i + 1}_s`, Math.round(valor)]),
        ),
        zonas_pct: Object.fromEntries(
          zonasTotales.map((valor, i) => [`z${i + 1}`, porcentaje(valor, totalGeneral)]),
        ),
        polarizacion: distribucion,
        etiqueta: etiquetaPolarizacion(distribucion),
      },
      nombres: NOMBRES_ZONA,
      ftp,
      actualizado: new Date().toISOString(),
    };
  }

  async function getZonas({ semanas = 8, ftp = 250, refresh = false } = {}) {
    const cantidad = Math.min(26, Math.max(1, Number(semanas) || 8));
    const potencia = Math.min(600, Math.max(60, Number(ftp) || 250));
    const clave = `${cantidad}:${potencia}`;

    const guardado = cache.get(clave);
    if (!refresh && guardado && Date.now() - guardado.en < cacheMs) {
      return { ...guardado.datos, cacheado: true };
    }

    const datos = await calcular({ semanas: cantidad, ftp: potencia });
    cache.set(clave, { en: Date.now(), datos });
    return { ...datos, cacheado: false };
  }

  return { getZonas, calcular };
}

function chunk(valores, tamano) {
  const salida = [];
  for (let i = 0; i < valores.length; i += tamano) salida.push(valores.slice(i, i + tamano));
  return salida;
}

module.exports = {
  crearServicioZonas,
  zonaDePotencia,
  inicioSemana,
  segundosEnZonas,
  polarizacion,
  etiquetaPolarizacion,
  LIMITES_FTP,
  NOMBRES_ZONA,
};
