'use strict';

// ═══════════════════════════════════════════════════════════════
// 📅 FECHAS DE LA LIGA (EUROPE/MADRID)
// ═══════════════════════════════════════════════════════════════
// La app es para gente de Madrid: una salida del domingo a las
// 23:30 debe caer en la semana que empieza el lunes siguiente, no
// en la anterior por culpa de UTC. Todo el backend usa estas
// funciones para días, semanas y meses.
// ═══════════════════════════════════════════════════════════════

const ZONA_HORARIA = 'Europe/Madrid';

const FORMATO = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONA_HORARIA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function aFecha(fecha) {
  const date = fecha instanceof Date ? fecha : new Date(fecha);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Partes de una fecha en la zona horaria de Madrid. */
function partesMadrid(fecha) {
  const date = aFecha(fecha);
  if (!date) return null;

  const partes = {};
  for (const parte of FORMATO.formatToParts(date)) {
    if (parte.type !== 'literal') partes[parte.type] = parte.value;
  }

  return {
    year: Number(partes.year),
    month: Number(partes.month),
    day: Number(partes.day),
    hour: Number(partes.hour),
    minute: Number(partes.minute),
    second: Number(partes.second),
  };
}

function dosDigitos(valor) {
  return String(valor).padStart(2, '0');
}

/** Día local YYYY-MM-DD. */
function claveDia(fecha) {
  const partes = partesMadrid(fecha);
  if (!partes) return null;
  return `${partes.year}-${dosDigitos(partes.month)}-${dosDigitos(partes.day)}`;
}

/** Mes local YYYY-MM. */
function claveMes(fecha) {
  const partes = partesMadrid(fecha);
  if (!partes) return null;
  return `${partes.year}-${dosDigitos(partes.month)}`;
}

/** Lunes local de la semana, como YYYY-MM-DD. */
function claveSemana(fecha) {
  const partes = partesMadrid(fecha);
  if (!partes) return null;

  // Mediodía UTC para que ningún cambio de hora altere el día.
  const dia = new Date(Date.UTC(partes.year, partes.month - 1, partes.day, 12));
  const desplazamiento = (dia.getUTCDay() + 6) % 7; // lunes = 0
  dia.setUTCDate(dia.getUTCDate() - desplazamiento);
  return dia.toISOString().slice(0, 10);
}

/** Hora local 0–23. */
function horaLocal(fecha) {
  const partes = partesMadrid(fecha);
  return partes ? partes.hour : null;
}

function sumarDiasClave(clave, dias) {
  const [year, month, day] = String(clave || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  const fecha = new Date(Date.UTC(year, month - 1, day + dias, 12));
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha.toISOString().slice(0, 10);
}

/** Lunes de la semana anterior o siguiente. */
function sumarSemanas(clave, cantidad) {
  return sumarDiasClave(clave, cantidad * 7);
}

function siguienteSemana(clave) {
  return sumarSemanas(clave, 1);
}

function restarSemanas(clave, cantidad) {
  return sumarSemanas(clave, -cantidad);
}

/** Desfase de Madrid respecto a UTC en minutos para un instante dado. */
function desfaseMinutos(fecha) {
  const partes = partesMadrid(fecha);
  if (!partes) return 0;
  const comoUtc = Date.UTC(
    partes.year,
    partes.month - 1,
    partes.day,
    partes.hour,
    partes.minute,
    partes.second,
  );
  return Math.round((comoUtc - fecha.getTime()) / 60000);
}

/** Instante UTC de una fecha/hora local de Madrid. */
function instanteMadrid({ year, month, day, hour = 0, minute = 0, second = 0 }) {
  const ingenuo = Date.UTC(year, month - 1, day, hour, minute, second);
  let desfase = desfaseMinutos(new Date(ingenuo));
  let instante = ingenuo - desfase * 60000;

  // En los cambios de hora el desfase puede cambiar entre la
  // suposición inicial y el instante real; se corrige una vez más.
  const desfaseReal = desfaseMinutos(new Date(instante));
  if (desfaseReal !== desfase) {
    instante = ingenuo - desfaseReal * 60000;
  }
  return instante;
}

/** Rango UTC [desde, hasta) de una semana local. */
function rangoSemana(clave) {
  const [year, month, day] = String(clave || '').split('-').map(Number);
  if (!year || !month || !day) return null;

  const desde = instanteMadrid({ year, month, day });
  const siguiente = sumarDiasClave(clave, 7);
  const [y2, m2, d2] = siguiente.split('-').map(Number);
  const hasta = instanteMadrid({ year: y2, month: m2, day: d2 });
  return { desde, hasta };
}

module.exports = {
  ZONA_HORARIA,
  partesMadrid,
  claveDia,
  claveMes,
  claveSemana,
  horaLocal,
  sumarSemanas,
  siguienteSemana,
  restarSemanas,
  rangoSemana,
};
