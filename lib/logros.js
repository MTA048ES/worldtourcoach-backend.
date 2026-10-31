'use strict';

// ═══════════════════════════════════════════════════════════════
// 🏆 LOGROS, NIVEL Y RETOS
// ═══════════════════════════════════════════════════════════════
// Convierte el historial de actividades en un sistema de progreso
// tipo Garmin Connect: nivel por puntos, medallas con cuatro niveles
// (bronce, plata, oro, diamante), racha de semanas seguidas y retos
// de la semana en curso.
//
// Todo se calcula al vuelo desde `actividades` + los contadores de
// segmentos/esfuerzos, así que no necesita tablas nuevas.
// ═══════════════════════════════════════════════════════════════

const ZONA_HORARIA = 'Europe/Madrid';

const MEDALLAS = [
  {
    id: 'salidas',
    nombre: 'Salidas',
    descripcion: 'Actividades registradas',
    categoria: 'constancia',
    unidad: 'salidas',
    icono: '🚴',
    umbrales: [1, 50, 150, 300],
  },
  {
    id: 'km',
    nombre: 'Kilómetros',
    descripcion: 'Distancia acumulada',
    categoria: 'distancia',
    unidad: 'km',
    icono: '🛣️',
    umbrales: [100, 1000, 5000, 15000],
  },
  {
    id: 'desnivel',
    nombre: 'Desnivel',
    descripcion: 'Metros de subida acumulados',
    categoria: 'escalada',
    unidad: 'm',
    icono: '⛰️',
    umbrales: [1000, 10000, 50000, 100000],
  },
  {
    id: 'horas',
    nombre: 'Horas de silla',
    descripcion: 'Tiempo acumulado en bici',
    categoria: 'constancia',
    unidad: 'h',
    icono: '⏱️',
    umbrales: [10, 100, 300, 600],
  },
  {
    id: 'rodillo',
    nombre: 'Rodillo',
    descripcion: 'Sesiones virtuales (MyWhoosh, Zwift...)',
    categoria: 'rodillo',
    unidad: 'salidas',
    icono: '🖥️',
    umbrales: [1, 10, 25, 100],
  },
  {
    id: 'segmentos',
    nombre: 'Explorador',
    descripcion: 'Segmentos distintos recorridos',
    categoria: 'segmentos',
    unidad: 'segmentos',
    icono: '🧭',
    umbrales: [1, 25, 100, 500],
  },
  {
    id: 'esfuerzos',
    nombre: 'Cazador de tramos',
    descripcion: 'Esfuerzos registrados en segmentos',
    categoria: 'segmentos',
    unidad: 'esfuerzos',
    icono: '🎯',
    umbrales: [1, 100, 1000, 5000],
  },
  {
    id: 'racha',
    nombre: 'Racha',
    descripcion: 'Semanas seguidas con al menos una salida',
    categoria: 'constancia',
    unidad: 'semanas',
    icono: '🔥',
    umbrales: [2, 4, 8, 26],
  },
  {
    id: 'dia_100',
    nombre: 'Centurión',
    descripcion: 'Salidas de 100 km o más',
    categoria: 'distancia',
    unidad: 'salidas',
    icono: '💯',
    umbrales: [1, 3, 10, 25],
  },
  {
    id: 'dia_2000',
    nombre: 'Comepuertos',
    descripcion: 'Salidas con 2000 m de desnivel o más',
    categoria: 'escalada',
    unidad: 'salidas',
    icono: '🏔️',
    umbrales: [1, 3, 10, 25],
  },
  {
    id: 'madrugador',
    nombre: 'Madrugador',
    descripcion: 'Salidas antes de las 7:00',
    categoria: 'horario',
    unidad: 'salidas',
    icono: '🌅',
    umbrales: [1, 5, 15, 40],
  },
  {
    id: 'nocturno',
    nombre: 'Nocturno',
    descripcion: 'Salidas después de las 20:00',
    categoria: 'horario',
    unidad: 'salidas',
    icono: '🌙',
    umbrales: [1, 5, 15, 40],
  },
];

const RETOS_SEMANA = [
  { id: 'salidas', nombre: '3 salidas', descripcion: 'Completa tres salidas esta semana', objetivo: 3, unidad: 'salidas', icono: '🚴' },
  { id: 'km', nombre: '100 km', descripcion: 'Suma 100 km esta semana', objetivo: 100, unidad: 'km', icono: '🛣️' },
  { id: 'desnivel', nombre: '1000 m', descripcion: 'Suma 1000 m de desnivel esta semana', objetivo: 1000, unidad: 'm', icono: '⛰️' },
  { id: 'horas', nombre: '4 horas', descripcion: 'Rueda cuatro horas esta semana', objetivo: 4, unidad: 'h', icono: '⏱️' },
];

const TITULOS = [
  { desde: 1, titulo: 'Novato' },
  { desde: 3, titulo: 'Aficionado' },
  { desde: 6, titulo: 'Ciclista' },
  { desde: 10, titulo: 'Rodador' },
  { desde: 15, titulo: 'Escalador' },
  { desde: 20, titulo: 'Leyenda' },
];

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function redondear(valor, decimales = 0) {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}

function tituloPara(nivel) {
  let titulo = TITULOS[0].titulo;
  for (const item of TITULOS) {
    if (nivel >= item.desde) titulo = item.titulo;
  }
  return titulo;
}

/** Lunes 00:00 de la semana de `fecha` (hora local de Madrid). */
function inicioSemana(fecha) {
  const date = new Date(fecha);
  if (Number.isNaN(date.getTime())) return null;
  const dia = (date.getUTCDay() + 6) % 7; // lunes = 0
  const lunes = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - dia));
  return lunes;
}

function claveSemana(fecha) {
  const lunes = inicioSemana(fecha);
  return lunes ? lunes.toISOString().slice(0, 10) : null;
}

function horaLocal(fecha) {
  const date = new Date(fecha);
  if (Number.isNaN(date.getTime())) return null;
  const texto = date.toLocaleString('es-ES', {
    timeZone: ZONA_HORARIA,
    hour: '2-digit',
    hour12: false,
  });
  const hora = Number.parseInt(texto, 10);
  return Number.isFinite(hora) ? hora : null;
}

/** Semanas consecutivas con actividad, contando hacia atrás. */
function rachaSemanas(actividades, ahora) {
  const semanas = new Set();
  for (const actividad of actividades) {
    const clave = claveSemana(actividad.fecha);
    if (clave) semanas.add(clave);
  }
  if (semanas.size === 0) return 0;

  const actual = inicioSemana(ahora);
  let cursor = new Date(actual);
  // Si esta semana aún no hay salidas, la racha sigue viva desde la anterior.
  if (!semanas.has(cursor.toISOString().slice(0, 10))) {
    cursor = new Date(cursor.getTime() - 7 * 24 * 3600 * 1000);
  }

  let racha = 0;
  while (semanas.has(cursor.toISOString().slice(0, 10))) {
    racha += 1;
    cursor = new Date(cursor.getTime() - 7 * 24 * 3600 * 1000);
  }
  return racha;
}

function esRodillo(actividad) {
  const tipo = String(actividad.tipo || '').toLowerCase();
  return tipo === 'virtualride' || tipo === 'virtualrun';
}

function metricas(actividades, totalSegmentos, totalEsfuerzos, ahora) {
  let km = 0;
  let desnivel = 0;
  let segundos = 0;
  let rodillo = 0;
  let dia100 = 0;
  let dia2000 = 0;
  let madrugador = 0;
  let nocturno = 0;

  for (const actividad of actividades) {
    const distancia = numero(actividad.distancia_m) / 1000;
    const subida = numero(actividad.desnivel_m);
    km += distancia;
    desnivel += subida;
    segundos += numero(actividad.duracion_s);
    if (esRodillo(actividad)) rodillo += 1;
    if (distancia >= 100) dia100 += 1;
    if (subida >= 2000) dia2000 += 1;

    const hora = horaLocal(actividad.fecha);
    if (hora !== null && hora < 7) madrugador += 1;
    if (hora !== null && hora >= 20) nocturno += 1;
  }

  return {
    salidas: actividades.length,
    km: redondear(km, 1),
    desnivel_m: Math.round(desnivel),
    horas: redondear(segundos / 3600, 1),
    rodillo,
    segmentos: totalSegmentos,
    esfuerzos: totalEsfuerzos,
    dia_100: dia100,
    dia_2000: dia2000,
    madrugador,
    nocturno,
    racha: rachaSemanas(actividades, ahora),
    racha_semanas: rachaSemanas(actividades, ahora),
  };}

function calcularMedallas(valores) {
  return MEDALLAS.map((medalla) => {
    const bruto = valores[medalla.id] ?? valores[`${medalla.id}_m`] ?? 0;
    const progreso = redondear(numero(bruto), 0);
    const nivel = medalla.umbrales.filter((umbral) => progreso >= umbral).length;
    const siguiente = nivel < medalla.umbrales.length ? medalla.umbrales[nivel] : null;
    const objetivo = siguiente ?? medalla.umbrales[medalla.umbrales.length - 1];

    return {
      id: medalla.id,
      nombre: medalla.nombre,
      descripcion: medalla.descripcion,
      categoria: medalla.categoria,
      unidad: medalla.unidad,
      icono: medalla.icono,
      progreso,
      nivel,
      nivel_maximo: medalla.umbrales.length,
      objetivo,
      siguiente,
      puntos: nivel * 5,
      conseguida: nivel > 0,
      completada: nivel >= medalla.umbrales.length,
    };
  });
}

function calcularRetos(actividades, ahora) {
  const lunes = inicioSemana(ahora);
  const fin = new Date(lunes.getTime() + 7 * 24 * 3600 * 1000);
  const semana = actividades.filter((actividad) => {
    const fecha = new Date(actividad.fecha);
    return !Number.isNaN(fecha.getTime()) && fecha >= lunes && fecha < fin;
  });

  const valores = {
    salidas: semana.length,
    km: redondear(semana.reduce((suma, a) => suma + numero(a.distancia_m) / 1000, 0), 1),
    desnivel: Math.round(semana.reduce((suma, a) => suma + numero(a.desnivel_m), 0)),
    horas: redondear(semana.reduce((suma, a) => suma + numero(a.duracion_s), 0) / 3600, 1),
  };

  return RETOS_SEMANA.map((reto) => {
    const progreso = redondear(valores[reto.id] || 0, 1);
    return {
      ...reto,
      progreso,
      conseguido: progreso >= reto.objetivo,
      porcentaje: Math.max(0, Math.min(100, Math.round((progreso / reto.objetivo) * 100))),
    };
  });
}

function computeLogros({ actividades = [], totalSegmentos = 0, totalEsfuerzos = 0, ahora = new Date() } = {}) {
  const valores = metricas(actividades, totalSegmentos, totalEsfuerzos, ahora);
  const medallas = calcularMedallas(valores);

  const puntosBase =
    valores.salidas * 10 +
    Math.floor(valores.km) +
    Math.floor(valores.desnivel_m / 50) +
    valores.segmentos * 2;
  const puntosMedallas = medallas.reduce((suma, medalla) => suma + medalla.puntos, 0);
  const puntos = puntosBase + puntosMedallas;

  const nivel = Math.floor(Math.sqrt(puntos / 40)) + 1;
  const puntosNivel = 40 * (nivel - 1) ** 2;
  const puntosSiguiente = 40 * nivel ** 2;
  const progresoNivel = puntosSiguiente > puntosNivel
    ? (puntos - puntosNivel) / (puntosSiguiente - puntosNivel)
    : 0;

  return {
    nivel,
    titulo: tituloPara(nivel),
    puntos,
    puntos_nivel: Math.round(puntosNivel),
    puntos_siguiente: Math.round(puntosSiguiente),
    progreso_nivel: redondear(Math.max(0, Math.min(1, progresoNivel)), 3),
    medallas_conseguidas: medallas.filter((m) => m.conseguida).length,
    medallas_totales: medallas.length,
    racha_semanas: valores.racha_semanas,
    totales: {
      salidas: valores.salidas,
      km: valores.km,
      desnivel_m: valores.desnivel_m,
      horas: valores.horas,
      rodillo: valores.rodillo,
      segmentos: valores.segmentos,
      esfuerzos: valores.esfuerzos,
    },
    medallas,
    retos: calcularRetos(actividades, ahora),
    actualizado: ahora.toISOString(),
  };
}

module.exports = {
  computeLogros,
  MEDALLAS,
  RETOS_SEMANA,
  rachaSemanas,
  claveSemana,
};
