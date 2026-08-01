// ═══════════════════════════════════════════════════════════════
// 📋 EXPERT CODE REVIEW - WORLD TOUR COACH v9.5
// ═══════════════════════════════════════════════════════════════
// Author: Code Review Expert
// Date: 2026-07-31
// ═══════════════════════════════════════════════════════════════

/*
══════════════════════════════════════════════════════════════════
  RESUMEN GENERAL
══════════════════════════════════════════════════════════════════

El código es funcionalmente RICO y bien estructurado para ser un
bot de Telegram. Sin embargo, hay varios problemas críticos:

1. ❌ FUNCIONES FALTANTES (REFERENCIADAS PERO NO DEFINIDAS):
   - calcularReadiness()
   - calcularFatigaOculta()
   - calcularZonaRecomendada()
   - buildExplicacionStaff()
   - buildTextoStress()
   - buildTextoSleep()
   - getSemaforo()
   - compararUltimasSesiones()

2. ❌ CÓDIGO DUPLICADO:
   - obtenerHistorial() definido 2 veces (líneas 211 y 2543)
   - generarRecomendacionesInteligentes() definido 2 veces (líneas 3954 y 5049)

3. ❌ SIN PERSISTENCIA EN MEMORIA:
   - getProperty/setProperty usando objeto en memoria VOLÁTIL
   - Al reiniciar el servidor se pierde TODO el historial en memoria

4. ⚠️ NÚMEROS MÁGICOS SIN DOCUMENTACIÓN
   - Thresholds como 0.85, 1.05, 1.30 sin explicación
   - Pesos arbitrarios en readiness score

5. ⚠️ SIN TYPESCRIPT NI JSDOC
   - Sin tipos en funciones críticas
   - Dificulta el mantenimiento
*/

// ═══════════════════════════════════════════════════════════════
// 🔴 ANÁLISIS DETALLADO: MOVILIDAD
// ═══════════════════════════════════════════════════════════════

/*
PROBLEMAS DETECTADOS:

1. MOVILIDAD NO SE ADAPTA AL ESTADO DE FATIGA
   - cmdMovilidad() siempre muestra los mismos 4 ejercicios
   - No diferencia: días de piernas pesadas vs ligeras
   - No hay movilidad específica para: cadera, columna, tobillos

2. MOVILIDAD ESTÁ EMBEBIDA EN FUERZA
   - La variable `movilidadBase` está dentro de calcularFuerzaUnificada()
   - Debería ser una función independiente con su propia lógica

3. FALTA MOVILIDAD ESPECÍFICA POR FASE/FATIGA:
   - Fase Base: Más movilidad de cadera y core
   - Fase Desarrollo: Movilidad de tobillo y flexibilidad dinámica
   - Fase Especificidad: Mantenimiento, no innovar
   - Taper: Movilidad suave + foam rolling intensivo

4. NO HAY PROGRESIÓN:
   - Siempre los mismos ejercicios
   - No hay registro de qué movilidad se hizo cada día
   - No hay aumento progresivo de intensidad/duración

SOLUCIÓN PROPUESTA:
*/

// ─── FUNCIÓN DE MOVILIDAD ADAPTATIVA MEJORADA ────────────────
function calcularMovilidadMejorada(estado) {
  const tsb = estado.tsb || 0;
  const readiness = estado.readiness || 50;
  const fase = getFaseActual();
  const sleepQuality = estado.sleepQuality || 2;
  const piernas = estado.piernas || 2; // 1=pesadas, 2=normales, 3=ligeras
  
  // ─── EJERCICIOS POR GRUPO MUSCULAR ──────────────────────────
  const ejercicios = {
    cadera: [
      '🔄 Círculos de cadera: 3x15 c/lado',
      '🦵 Estiramiento psoas rodilla al pecho: 3x30" c/lado',
      '🦵 Estiramiento piriformis: 3x30" c/lado',
      '🔄 Movilidad cadera en 4 direcciones: 3x10 c/lado'
    ],
    columna: [
      '🐱 Gato-vaca: 3x10 repeticiones lentas',
      '🔄 Rotaciones torácicas sentado: 3x10 c/lado',
      '🧘 Postura niño: 3x30"',
      '🔄 Rotaciones cervicales: 3x10 c/lado'
    ],
    tobillo: [
      '🦶 Círculos de tobillo: 3x15 c/lado',
      '🦶 Estiramiento sóleo contra pared: 3x30" c/lado',
      '🦶 Elevaciones de talón: 3x15'
    ],
    isquios: [
      '🦵 Estiramiento isquios con banda: 3x30" c/lado',
      '🦵 Peso muerto a una pierna (sin peso): 3x10 c/lado',
      '🦵 Estiramiento isquios en V: 3x30"'
    ],
    general: [
      '🧘 Foam rolling isquios: 2 min c/pierna',
      '🧘 Foam rolling glúteos: 2 min c/lado',
      '🧘 Foam rolling dorsales: 2 min c/lado',
      '🧘 Liberación fascia plantar: 1 min c/pie'
    ],
    activacion: [
      '🔥 Glute bridge: 3x15',
      '🔥 Clamshell: 3x15 c/lado',
      '🔥 Bird-dog: 3x10 c/lado'
    ]
  };
  
  // ─── SELECCIÓN INTELIGENTE SEGÚN ESTADO ─────────────────────
  let seleccionados = [];
  let duracionEstimada = 15;
  let enfasis = '';
  
  // PIERNAS PESADAS (mayoría de días de calidad)
  if (piernas === 1 || tsb < -10) {
    enfasis = '🔴 *Piernas pesadas* - Prioriza liberación y estiramientos suaves';
    seleccionados.push(
      ...ejercicios.isquios.slice(0, 2),
      ...ejercicios.cadera.slice(0, 2),
      ...ejercicios.general.slice(0, 2)
    );
    duracionEstimada = 20;
  } 
  // PIERNAS NORMALES - DÍA DE ENTRENO
  else if (piernas === 2) {
    enfasis = '🟡 *Estado normal* - Movilidad completa pre-entreno';
    seleccionados.push(
      ...ejercicios.cadera.slice(0, 2),
      ...ejercicios.columna.slice(0, 2),
      ...ejercicios.activacion.slice(0, 2)
    );
    duracionEstimada = 15;
  } 
  // PIERNAS LIGERAS - DÍA DE CALIDAD
  else {
    enfasis = '🟢 *Piernas ligeras* - Enfoque en activación dinámica';
    seleccionados.push(
      ...ejercicios.activacion,
      ...ejercicios.cadera.slice(0, 1),
      ...ejercicios.tobillo.slice(0, 2)
    );
    duracionEstimada = 12;
  }
  
  // AÑADIR SEGÚN FASE
  if (fase === 'base') {
    seleccionados.push(...ejercicios.cadera.slice(2, 4));
    duracionEstimada += 5;
  } else if (fase === 'especificidad') {
    seleccionados.push(...ejercicios.tobillo);
    duracionEstimada += 3;
  }
  
  // AÑADIR SEGÚN SUEÑO
  if (sleepQuality === 1) {
    seleccionados.unshift('😴 *Sueño malo* - Añade 5 min de respiración diafragmática');
    duracionEstimada += 5;
  }
  
  // Limitar a 6 ejercicios
  seleccionados = seleccionados.slice(0, 6);
  
  return {
    ejercicios: seleccionados,
    duracion: `${duracionEstimada} min`,
    enfasis: enfasis,
    recomendado: true,
    momento: tsb < -15 ? 'Cualquier momento del día (recuperación)' : 'Antes de entrenar'
  };
}

// ═══════════════════════════════════════════════════════════════
// 🔴 ANÁLISIS DETALLADO: FUERZA
// ═══════════════════════════════════════════════════════════════

/*
PROBLEMAS DETECTADOS:

1. LA PERIODIZACIÓN DE FUERZA NO ESTÁ ALINEADA CON LA FASE DE ENTRENO:
   - La fuerza usa `semana % 2 === 1` para alternar Máxima/Resistencia
   - Pero la fase de entrenamiento usa períodos de 4 semanas
   - Debería sincronizarse: Base=Mantenimiento, Desarrollo=Hipertrofia, 
     Especificidad=Fuerza Máxima, Taper=Descarga

2. FALTA CONEXIÓN CON LOS EJERCICIOS ESPECÍFICOS DE CICLISMO:
   - No hay ejercicios unilaterales específicos para ciclismo
   - Falta: step-ups, single-leg RDL, pistol squats asistidos
   - No hay trabajo de core específico para mantener posición en la bici

3. LOS PESOS RECOMENDADOS SON FIJOS:
   - "Sentadilla: 5x5 (25-35kg)" - no se adapta al progreso del atleta
   - No hay registro de fuerza máxima (1RM) para ajustar cargas
   - No hay progresión: si el atleta progresa, los pesos deberían subir

4. FALTA TRABAJO DE PREVENCIÓN DE LESIONES:
   - No hay ejercicios específicos para tendinitis rotuliana
   - No hay trabajo de estabilidad escapular
   - No hay ejercicios para prevenir dolor lumbar

SOLUCIÓN PROPUESTA:
*/

// ─── FUNCIÓN DE FUERZA PERIODIZADA MEJORADA ──────────────────
function calcularFuerzaMejorada(estado) {
  const tsb = estado.tsb || 0;
  const readiness = estado.readiness || 50;
  const fase = getFaseActual();
  const semana = getSemanaActual();
  const semanasEnFase = getSemanasFase();
  
  // Sincronizar con la fase de entrenamiento
  const faseFuerza = {
    'base': { 
      nombre: '🏗️ Mantenimiento + Resistencia',
      enfoque: 'Preparación física general, Core + Estabilidad',
      seriesReps: semana <= 2 ? '3x12-15' : '3x10-12',
      rpe: 'RPE 6-7 (2-3 repes en reserva)'
    },
    'desarrollo': { 
      nombre: '📈 Hipertrofia + Fuerza Resistencia',
      enfoque: 'Trabajo unilateral + Core avanzado',
      seriesReps: semana <= 2 ? '4x10-12' : '3x8-10',
      rpe: 'RPE 7-8 (1-2 repes en reserva)'
    },
    'especificidad': { 
      nombre: '🎯 Fuerza Máxima + Potencia',
      enfoque: 'Cargas altas, pocas repeticiones, reclutamiento neuronal',
      seriesReps: semana <= 2 ? '5x5' : '4x6-8',
      rpe: 'RPE 8-9 (0-1 repes en reserva)'
    },
    'taper': { 
      nombre: '🧘 Descarga + Mantenimiento',
      enfoque: 'Mantenimiento sin fatiga, movilidad',
      seriesReps: '2x10-12',
      rpe: 'RPE 5-6 (fácil)'
    }
  };
  
  const faseActual = faseFuerza[fase] || faseFuerza.base;
  
  // ─── ADAPTACIÓN POR FATIGA ─────────────────────────────────
  let nivel, recomendacion, ejercicios = [];
  
  const ejerciciosBase = {
    general: [
      { nombre: 'Sentadilla', variantes: ['Goblet', 'Barra', 'Bulgará'], peso: '8-40kg' },
      { nombre: 'Peso muerto', variantes: ['Rumano', 'Convencional', 'A una pierna'], peso: '10-45kg' },
      { nombre: 'Zancadas', variantes: ['Estáticas', 'Búlgaras', 'Laterales'], peso: '8-20kg' },
      { nombre: 'Hip thrust', variantes: ['Bilateral', 'Unilateral', 'A una pierna'], peso: '10-25kg' },
      { nombre: 'Remo', variantes: ['Con mancuerna', 'Con barra', 'Máquina'], peso: '8-22kg' }
    ],
    core: [
      'Plancha: 3x30-60"',
      'Dead bug: 3x10-15 c/lado',
      'Bird-dog: 3x10-15 c/lado',
      'Rueda abdominal: 3x8-12',
      'Dragon flag: 3x6-8'
    ],
    prevencion: [
      '🦶 Step-up lateral: 3x10-12 c/pierna (PREVENCIÓN RODILLA)',
      '🦶 Estiramiento cuádriceps: 3x30" c/pierna',
      '🦶 Copenhague plank: 3x20-30" c/lado (PREVENCIÓN ISQUIOS)',
      '🦶 Talón-glúteo dinámico: 3x15 c/pierna',
      '🦶 Rotación externa cadera con banda: 3x15 c/pierna',
      '🦶 Elevación de talón excéntrica: 3x15 (PREVENCIÓN AQUILES)'
    ]
  };
  
  // Selección de ejercicios según estado
  const isFatigado = tsb < -15 || readiness < 50;
  const isModeradamenteFatigado = tsb < -5 || readiness < 65;
  const esSemanaMaxima = fase === 'especificidad' && semana <= 2;
  
  // ─── EJERCICIOS PRINCIPALES SEGÚN ESTADO ───────────────────
  if (tsb < -20 || readiness < 40) {
    nivel = '🔴 Recuperación Activa - NO HAGAS FUERZA CON PESO';
    recomendacion = 'Prioriza movilidad, activación y prevención de lesiones';
    ejercicios = [
      ...ejerciciosBase.prevencion.slice(0, 3),
      ...ejerciciosBase.core.slice(0, 2),
      'Glute bridge: 3x15',
      'Clamshell con banda: 3x15 c/lado'
    ];
  } else if (tsb < -10 || readiness < 55) {
    nivel = `🟡 ${faseActual.nombre} - Versión suave`;
    recomendacion = `Fase: ${fase}. Sin fallo muscular. RPE ${parseInt(faseActual.rpe.split('-')[0]) - 2}-${parseInt(faseActual.rpe.split('-')[1]) - 2}`;
    ejercicios = [
      `${ejerciciosBase.general[0].nombre} (${ejerciciosBase.general[0].variantes[0]}): ${faseActual.seriesReps} (${ejerciciosBase.general[0].peso.split('-')[0]}-${Math.round(parseInt(ejerciciosBase.general[0].peso.split('-')[1]) * 0.7)}kg)`,
      `${ejerciciosBase.general[4].nombre}: ${faseActual.seriesReps}`,
      ...ejerciciosBase.core.slice(0, 2),
      ...ejerciciosBase.prevencion.slice(0, 2)
    ];
  } else {
    nivel = `🟢 ${faseActual.nombre}`;
    recomendacion = `${faseActual.enfoque} | ${faseActual.rpe}`;
    
    if (esSemanaMaxima) {
      ejercicios = [
        `${ejerciciosBase.general[0].nombre} (${ejerciciosBase.general[0].variantes[1]}): ${faseActual.seriesReps} (${ejerciciosBase.general[0].peso})`,
        `${ejerciciosBase.general[1].nombre} (${ejerciciosBase.general[1].variantes[1]}): ${faseActual.seriesReps} (${ejerciciosBase.general[1].peso})`,
        `${ejerciciosBase.general[2].nombre} (${ejerciciosBase.general[2].variantes[1]}): ${faseActual.seriesReps} (${ejerciciosBase.general[2].peso})`,
        ...ejerciciosBase.core.slice(1, 3),
        ...ejerciciosBase.prevencion.slice(0, 1)
      ];
    } else {
      ejercicios = [
        `${ejerciciosBase.general[0].nombre} (${ejerciciosBase.general[0].variantes[0]}): ${faseActual.seriesReps} (${ejerciciosBase.general[0].peso})`,
        `${ejerciciosBase.general[1].nombre} (${ejerciciosBase.general[1].variantes[2]}): ${faseActual.seriesReps} (${ejerciciosBase.general[1].peso})`,
        `${ejerciciosBase.general[2].nombre} (${ejerciciosBase.general[2].variantes[2]}): ${faseActual.seriesReps} (${ejerciciosBase.general[2].peso})`,
        ...ejerciciosBase.core,
        ...ejerciciosBase.prevencion.slice(0, 2)
      ];
    }
  }
  
  // MOVILIDAD OBLIGATORIA según estado
  const movilidadObjetivo = calcularMovilidadMejorada(estado);
  
  return {
    nivel,
    recomendacion,
    ejercicios: ejercicios.slice(0, 6),
    movilidadBase: movilidadObjetivo.ejercicios,
    duracion: isFatigado ? '15-20 min' : isModeradamenteFatigado ? '25-30 min' : '35-45 min',
    recomendado: !isFatigado,
    faseFuerza: faseActual.nombre,
    semanaFuerza: semana,
    prevencion: ejerciciosBase.prevencion.slice(0, 3)
  };
}

// ═══════════════════════════════════════════════════════════════
// 🔴 ANÁLISIS DETALLADO: NUTRICIÓN
// ═══════════════════════════════════════════════════════════════

/*
PROBLEMAS DETECTADOS:

1. LOS CARBOHIDRATOS NO SE ADAPTAN A LA FASE DE ENTRENAMIENTO:
   - Base: Mayor necesidad de carbohidratos (entrenos largos Z2)
   - Especificidad: Menos carbohidratos totales, más periodización
   - Taper: Reducción intencionada de carbohidratos

2. NO HAY ESTRATEGIA DE PERIODIZACIÓN DE CARBOHIDRATOS:
   - "Train low, race high" no está implementado
   - No hay días de baja carga de carbohidratos (adaptación mitocondrial)
   - No hay carga de carbohidratos antes de días clave

3. LA HIDRATACIÓN NO CONSIDERA LA TASA DE SUDOR INDIVIDUAL:
   - Usa fórmula genérica basada en peso y temperatura
   - No aprende de la tasa de sudor del atleta

4. FALTA NUTRICIÓN ESPECÍFICA POR TIPO DE ENTRENO:
   - Z2 largo: 60-90g CH/hora
   - SweetSpot: 60-90g CH/hora
   - VO2 Max: 30-60g CH/hora (menos tiempo, más intensidad)
   - Recuperación: Priorizar proteína

5. LOS SUPLEMENTOS NO TIENEN DOSIS VARIABLE:
   - Omega-3: 3g/día (puede ser 2-4g según inflamación)
   - Vitamina D: 2000 UI (debería ser estacional: 4000 UI invierno, 1000 UI verano)
   - Magnesio: 400mg (debería aumentar con entrenamiento intenso)

SOLUCIÓN PROPUESTA:
*/

// ─── FUNCIÓN DE NUTRICIÓN MEJORADA ───────────────────────────
function calcularNutricionMejorada(estado, entreno) {
  const peso = CONFIG.WEIGHT_KG || 64;
  const edad = CONFIG.AGE_YEARS || 43;
  const altura = CONFIG.HEIGHT_CM || 173;
  const pasos = estado.pasos || 0;
  const haceCalor = estado.haceCalor || false;
  const temp = estado.tempActual || 25;
  const heatIndex = estado.heatIndex || 25;
  const kj = entreno?.kjEsperados || 0;
  const ifValor = entreno?.ifEsperado || 0;
  const fase = getFaseActual();
  const duracionMin = entreno?.duracionTotalMin || 0;
  const tipo = entreno?.tipo || 'descanso';
  const tsb = estado.tsb || 0;
  
  // ─── TASA METABÓLICA BASAL (Mifflin-St Jeor) ─────────────
  const tmb = 10 * peso + 6.25 * altura - 5 * edad + 5;
  const neat = pasos > 0 ? Math.round(pasos * 0.04) : 300;
  const kcalGastoTotal = Math.round(tmb + neat + kj);
  
  // ─── PERIODIZACIÓN DE CARBOHIDRATOS SEGÚN FASE ───────────
  let ratioBaseCH, ratioProteina, ratioGrasa;
  
  switch (fase) {
    case 'base':
      // Base: más carbohidratos para volumen Z2
      ratioBaseCH = 6.0;
      ratioProteina = 1.8;
      ratioGrasa = 0.25;
      break;
    case 'desarrollo':
      // Desarrollo: equilibrio para calidad
      ratioBaseCH = 5.5;
      ratioProteina = 2.0;
      ratioGrasa = 0.25;
      break;
    case 'especificidad':
      // Especificidad: menos carbohidratos, más proteína
      ratioBaseCH = 5.0;
      ratioProteina = 2.2;
      ratioGrasa = 0.30;
      break;
    case 'taper':
      // Taper: reducción de carbohidratos
      ratioBaseCH = 4.0;
      ratioProteina = 2.0;
      ratioGrasa = 0.30;
      break;
    default:
      ratioBaseCH = 5.0;
      ratioProteina = 1.8;
      ratioGrasa = 0.25;
  }
  
  // Ajuste por edad Master 40+
  if (edad > 40) {
    ratioProteina += 0.2;
    ratioBaseCH += 0.5;
  }
  
  // Ajuste por calor
  if (haceCalor && heatIndex > 35) {
    ratioBaseCH += 0.5;
  } else if (haceCalor && heatIndex > 30) {
    ratioBaseCH += 0.3;
  }
  
  const chTotalDia = Math.round(peso * ratioBaseCH);
  const protTotalDia = Math.round(peso * ratioProteina);
  const grasaDiaria = Math.round((kcalGastoTotal * ratioGrasa) / 9);
  
  // ─── CARBOHIDRATOS DURANTE ENTRENO (según tipo e IF) ─────
  let chDuranteEntreno = 0;
  let recomendacionDurante = '';
  
  if (kj > 0 && tipo !== 'descanso') {
    // Estrategia específica según tipo de entreno
    if (ifValor > 0.85) {
      // Alta intensidad: menos CH durante, más antes/después
      chDuranteEntreno = Math.round(duracionMin * 0.8); // ~0.8g/min
      recomendacionDurante = `⚡ Alta intensidad: ${chDuranteEntreno}g CH durante (${Math.round(chDuranteEntreno/(duracionMin/60))}g/hora)`;
    } else if (ifValor > 0.65) {
      // Intensidad moderada: CH constante
      chDuranteEntreno = Math.round(duracionMin * 1.0); // ~1.0g/min
      recomendacionDurante = `🚴 Moderada intensidad: ${chDuranteEntreno}g CH durante (${Math.round(chDuranteEntreno/(duracionMin/60))}g/hora)`;
    } else {
      // Z2 suave: menos CH necesarios
      chDuranteEntreno = Math.round(duracionMin * 0.5); // ~0.5g/min
      recomendacionDurante = `🌱 Z2 suave: ${chDuranteEntreno}g CH durante (${Math.round(chDuranteEntreno/(duracionMin/60))}g/hora)`;
    }
  }
  
  // ─── ESTRATEGIA "FUEL FOR THE WORK REQUIRED" ──────────────
  let chInmediato = 0;
  if (kj > 0) {
    if (kj > 1200) chInmediato = 110;
    else if (kj >= 800) chInmediato = 90;
    else if (kj >= 500) chInmediato = 60;
    else chInmediato = 40;
  }
  
  // Ajuste post-entreno según tipo
  let protPost = CONFIG.NUTRICION.proteinaPostMaster || 40;
  if (ifValor > 0.85) {
    protPost += 10; // Más proteína después de alta intensidad
  }
  
  const chRestante = chTotalDia - chInmediato - chDuranteEntreno;
  let chCena = kj > 0 ? Math.round(chRestante * 0.65) : Math.round(chRestante * 0.50);
  if (chCena < 40) chCena = 40;
  
  // ─── HIDRATACIÓN CON TASA DE SUDOR APRENDIDA ──────────────
  let tasaSudor = getProperty('tasa_sudor') ? parseFloat(getProperty('tasa_sudor')) : 0.5;
  
  if (haceCalor && heatIndex > 35) tasaSudor = Math.max(tasaSudor, 1.0);
  else if (haceCalor && heatIndex > 32) tasaSudor = Math.max(tasaSudor, 0.8);
  else if (haceCalor && heatIndex > 28) tasaSudor = Math.max(tasaSudor, 0.6);
  
  if (kj > 800) tasaSudor += 0.2;
  
  const sodioMg = Math.round(tasaSudor * CONFIG.NUTRICION.sodioPorLitro);
  const salGramos = (sodioMg / 1000 * 0.4).toFixed(1);
  
  let hidratacion = (Math.round(peso * 35) / 1000).toFixed(1) + 'L base';
  if (haceCalor && heatIndex > 35) {
    hidratacion += ' + 0.5L extra por calor extremo';
    hidratacion += ` | 🧂 ${sodioMg}mg Sodio/hora (${salGramos}g sal)`;
  } else if (haceCalor && heatIndex > 30) {
    hidratacion += ' + 0.3L extra por calor';
    hidratacion += ` | 🧂 ${sodioMg}mg Sodio/hora (${salGramos}g sal)`;
  }
  
  // ─── SUPLEMENTACIÓN ESTACIONAL Y POR FASE ─────────────────
  let suplementacion = [];
  const mes = new Date().getMonth() + 1; // 1-12
  
  if (edad > 40) {
    // Omega-3: dosis según inflamación (TSB bajo = más inflamación)
    const omegaDosis = tsb < -15 ? '4g/día' : '3g/día';
    suplementacion.push(`Omega-3: ${omegaDosis} (${tsb < -15 ? 'dosis antiinflamatoria' : 'mantenimiento'})`);
    
    // Vitamina D: estacional
    const vitDDosis = (mes >= 11 || mes <= 3) ? '4000 UI/día' : '2000 UI/día';
    suplementacion.push(`Vitamina D: ${vitDDosis} (${(mes >= 11 || mes <= 3) ? 'invierno - dosis alta' : 'verano - dosis mantenimiento'})`);
  }
  
  if (haceCalor && heatIndex > 30) {
    suplementacion.push(`Magnesio: ${CONFIG.NUTRICION.magnesio} (por calor)`);
  }
  
  // Creatina: siempre recomendada para Master 40+
  if (edad > 40) {
    suplementacion.push(`Creatina: ${CONFIG.NUTRICION.creatina || '5g/día'}`);
  }
  
  // ─── RECOMENDACIONES ESPECÍFICAS ───────────────────────────
  let consejosExtra = [];
  if (fase === 'base' && kj > 800) {
    consejosExtra.push('🍝 Fase Base: Asegura 6-7g CH/kg/día para reponer glucógeno');
  }
  if (fase === 'especificidad' && ifValor > 0.85) {
    consejosExtra.push('⚡ Fase Especificidad: Carga de CH 2h antes del entreno (1-2g/kg)');
  }
  if (fase === 'taper') {
    consejosExtra.push('🧘 Taper: Reduce CH totales 20-30% para adaptación metabólica');
  }
  if (tsb < -15) {
    consejosExtra.push('🔴 Fatiga alta: Aumenta proteína a 2.2g/kg y prioriza recuperación');
  }
  
  return {
    chTotalDia,
    protTotalDia,
    grasaDiaria,
    chInmediato,
    chDuranteEntreno,
    chCena,
    hidratacion,
    kcalGastoTotal,
    esDiaDescanso: kj === 0,
    esDiaIntenso: kj > 800,
    haceCalor,
    temp,
    heatIndex,
    tasaSudor,
    sodioMg,
    suplementacion,
    protPost,
    recomendacionDurante,
    consejosExtra,
    fase: fase,
    estrategiaCH: fase === 'taper' ? 'Periodización baja en CH' : 'Carga completa'
  };
}

// ═══════════════════════════════════════════════════════════════
// 🔴 ANÁLISIS DETALLADO: ADAPTACIÓN A FATIGA Y ESTADO GENERAL
// ═══════════════════════════════════════════════════════════════

/*
PROBLEMAS DETECTADOS:

1. EL READINESS SE CALCULA CON UMBRALES FIJOS:
   - TSB < -20: -20 puntos
   - HRV < 40: -15 puntos
   - Sueño 1: -20 puntos
   - No hay adaptación a la sensibilidad individual

2. NO HAY DETECCIÓN DE TENDENCIAS:
   - Solo usa valores instantáneos (hoy)
   - No compara con la media de 7 días
   - No detecta: HRV en descenso, sueño empeorando, etc.

3. FALTA INTEGRACIÓN DE HRV CON CONTEXTO:
   - HRV bajo puede ser por: fatiga, enfermedad, alcohol, estrés
   - No hay lógica para diferenciar causas

4. LA RECUPERACIÓN PREDICTIVA ES SIMPLE:
   - horas = TSS/10 + edad*0.2 + sueño
   - No considera: intensidad del entreno, horas de sueño reales, 
     estrés laboral acumulado, alimentación

5. NO HAY APRENDIZAJE DE PATRONES DE FATIGA:
   - El sistema no recuerda: "cada vez que hago VO2 me siento mal"
   - No hay registro de: "los lunes siempre estoy más fatigado"

SOLUCIÓN PROPUESTA:
*/

// ─── READINESS CON TENDENCIA Y APRENDIZAJE ──────────────────
function calcularReadinessMejorado(estado, historial) {
  // Valores actuales
  const tsb = estado.tsb || 0;
  const hrv = estado.hrv || 50;
  const sleepQuality = estado.sleepQuality || 2;
  const pasos = estado.pasos || 0;
  const weeklyTss = estado.weeklyTss || 0;
  
  // ─── TENDENCIAS (comparar con media de 7 días) ────────────
  let tendenciaHRV = 0;
  let tendenciaSleep = 0;
  let tendenciaTSB = 0;
  
  if (historial && historial.length >= 3) {
    const ultimos = historial.slice(-7);
    const hrvValues = ultimos.filter(h => h.hrv).map(h => h.hrv);
    const sleepValues = ultimos.filter(h => h.sleepQuality).map(h => h.sleepQuality);
    const tsbValues = ultimos.filter(h => h.tsb !== undefined).map(h => h.tsb);
    
    // Tendencia HRV
    if (hrvValues.length >= 3) {
      const hrvMedia = hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length;
      if (hrv < hrvMedia * 0.9) tendenciaHRV = -10; // HRV en descenso
      else if (hrv > hrvMedia * 1.1) tendenciaHRV = 5; // HRV mejorando
    }
    
    // Tendencia sueño
    if (sleepValues.length >= 3) {
      const sleepMedia = sleepValues.reduce((a, b) => a + b, 0) / sleepValues.length;
      if (sleepQuality < sleepMedia - 0.5) tendenciaSleep = -10;
      else if (sleepQuality > sleepMedia + 0.5) tendenciaSleep = 5;
    }
    
    // Tendencia TSB (últimos 3 días vs hace 7 días)
    if (tsbValues.length >= 3) {
      const tsbReciente = tsbValues.slice(-3).reduce((a, b) => a + b, 0) / 3;
      const tsbAnterior = tsbValues.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
      if (tsbReciente < tsbAnterior - 5) tendenciaTSB = -10;
      else if (tsbReciente > tsbAnterior + 5) tendenciaTSB = 5;
    }
  }
  
  // ─── READINESS BASE ───────────────────────────────────────
  let readiness = 70;
  
  // TSB
  if (tsb < -30) readiness -= 30;
  else if (tsb < -20) readiness -= 20;
  else if (tsb < -10) readiness -= 10;
  else if (tsb > 10) readiness += 10;
  else if (tsb > 5) readiness += 5;
  
  // HRV
  if (hrv < 30) readiness -= 20;
  else if (hrv < 40) readiness -= 15;
  else if (hrv < 50) readiness -= 5;
  else if (hrv > 65) readiness += 10;
  else if (hrv > 55) readiness += 5;
  
  // Sueño
  if (sleepQuality === 1) readiness -= 20;
  else if (sleepQuality === 2) readiness -= 5;
  else if (sleepQuality === 3) readiness += 10;
  
  // Pasos (actividad diaria)
  if (pasos > 20000) readiness -= 10;
  else if (pasos > 15000) readiness -= 5;
  else if (pasos < 5000 && tsb < -10) readiness += 5; // Día de descanso
  
  // Tendencias
  readiness += tendenciaHRV + tendenciaSleep + tendenciaTSB;
  
  // ─── CLASIFICACIÓN CON CONTEXTO ──────────────────────────
  let clasificacion = '🟢 Normal';
  let alertas = [];
  
  if (readiness < 30) {
    clasificacion = '🔴 Crítico';
    alertas.push('🔴 Descanso obligatorio');
  } else if (readiness < 45) {
    clasificacion = '🟠 Muy fatigado';
    alertas.push('🟠 Solo Z1-Z2 suave');
  } else if (readiness < 55) {
    clasificacion = '🟡 Fatigado';
    alertas.push('🟡 Recuperación activa');
  } else if (readiness < 70) {
    clasificacion = '🟡 Normal-fatiga';
    alertas.push('🟡 Entreno controlado');
  } else if (readiness > 85) {
    clasificacion = '🟢 Excelente';
    alertas.push('🟢 Ventana de calidad');
  }
  
  // Añadir alertas de tendencia
  if (tendenciaHRV < 0) alertas.push('📉 HRV en descenso - Vigila recuperación');
  if (tendenciaSleep < 0) alertas.push('😴 Calidad de sueño empeorando');
  if (tendenciaTSB < 0) alertas.push('📉 TSB en descenso - Reduce carga');
  
  // ─── APRENDIZAJE DE PATRONES ─────────────────────────────
  const diaSemana = new Date().getDay();
  const patronFatiga = getProperty(`patron_fatiga_${diaSemana}`);
  if (patronFatiga) {
    const patron = JSON.parse(patronFatiga);
    if (patron.probabilidad > 0.6) {
      readiness -= 5;
      alertas.push(`📅 Los ${['domingo','lunes','martes','miércoles','jueves','viernes','sábado'][diaSemana]} sueles tener más fatiga (-5)`);
    }
  }
  
  return {
    readiness: Math.max(5, Math.min(100, Math.round(readiness))),
    clasificacion,
    alertas: alertas.slice(0, 3),
    tendencias: {
      hrv: tendenciaHRV,
      sleep: tendenciaSleep,
      tsb: tendenciaTSB
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// 🟢 MEJORAS ADICIONALES RECOMENDADAS
// ═══════════════════════════════════════════════════════════════

/*
1. 🟢 IMPLEMENTAR LAS FUNCIONES FALTANTES:
   - calcularReadiness(), calcularFatigaOculta(), etc.
   - Son referenciadas en procesarMensajeFeedback() pero no existen

2. 🟢 ELIMINAR CÓDIGO DUPLICADO:
   - eliminar la segunda definición de obtenerHistorial() (línea 2543)
   - eliminar la segunda definición de generarRecomendacionesInteligentes() (línea 5049)

3. 🟢 AÑADIR PERSISTENCIA REAL:
   - Usar Supabase para guardar el historial en memoria
   - Cargar al iniciar el servidor
   - No perder datos al reiniciar

4. 🟢 AÑADIR JSDOC A FUNCIONES CRÍTICAS:
   - @param, @returns, @description
   - Facilitar mantenimiento y colaboración

5. 🟢 IMPLEMENTAR SISTEMA DE APRENDIZAJE:
   - Tasa de sudor individual (guardar en Supabase)
   - Patrones de fatiga por día de la semana
   - Mejor hora para entrenar según datos históricos
   - Sensibilidad a la intensidad (RPE vs potencia real)

6. 🟢 AÑADIR LOGS ESTRUCTURADOS:
   - Usar niveles: info, warn, error
   - Incluir contexto en los logs
   - Facilitar debugging

7. 🟢 EXTERNALIZAR CONFIGURACIÓN:
   - Mover magic numbers a CONFIG
   - Hacer que los thresholds sean configurables
   - Permitir ajustes sin cambiar código

8. 🟢 MEJORAR LA DETECCIÓN DE SOBREENTRENAMIENTO:
   - Añadir: relación HRV/FC reposo
   - Añadir: variabilidad de la frecuencia cardiaca en reposo
   - Añadir: cuestionario de bienestar diario (Hooper)
*/

// ═══════════════════════════════════════════════════════════════
// 📋 IMPLEMENTACIÓN DE FUNCIONES FALTANTES CRÍTICAS
// ═══════════════════════════════════════════════════════════════

// ─── calcularReadiness() - IMPLEMENTACIÓN ────────────────────
function calcularReadiness(rpe, piernas, stress, sleep, tsb, atl, ctl, watts) {
  let readiness = 70;
  
  // RPE
  if (rpe >= 8) readiness -= 15;
  else if (rpe >= 7) readiness -= 5;
  else if (rpe <= 4) readiness += 10;
  
  // Piernas
  if (piernas === 1) readiness -= 15;
  else if (piernas === 3) readiness += 10;
  
  // Stress
  if (stress === 3) readiness -= 15;
  else if (stress === 1) readiness += 5;
  
  // Sueño
  if (sleep === 1) readiness -= 20;
  else if (sleep === 3) readiness += 10;
  
  // TSB
  if (tsb < -20) readiness -= 20;
  else if (tsb < -10) readiness -= 10;
  else if (tsb > 10) readiness += 10;
  
  // Watts
  if (watts === 'no') readiness -= 10;
  
  return Math.max(10, Math.min(100, readiness));
}

// ─── calcularFatigaOculta() - IMPLEMENTACIÓN ─────────────────
function calcularFatigaOculta(rpe, tsb, piernas, watts) {
  let fatiga = 0;
  
  // RPE alto con carga baja = fatiga oculta
  if (rpe >= 7 && tsb > 0) fatiga += 1;
  if (rpe >= 8 && tsb > -5) fatiga += 1;
  
  // Piernas pesadas sin carga alta
  if (piernas === 1 && tsb > -5) fatiga += 1;
  
  // No cumplir watts con RPE normal
  if (watts === 'no' && rpe <= 5) fatiga += 1;
  
  if (fatiga >= 3) return '🔴 Alta';
  if (fatiga >= 2) return '🟡 Media';
  return '🟢 Baja';
}

// ─── calcularZonaRecomendada() - IMPLEMENTACIÓN ──────────────
function calcularZonaRecomendada(readiness) {
  if (readiness < 30) return 'Descanso total';
  if (readiness < 45) return 'Z1 (Recuperación, <55% FTP)';
  if (readiness < 55) return 'Z2 (Base, 55-75% FTP)';
  if (readiness < 70) return 'Z2-Z3 (Base/Tempo, 55-87% FTP)';
  if (readiness < 85) return 'SweetSpot-FTP (88-105% FTP)';
  return 'VO2 Max (105-120% FTP)';
}

// ─── buildExplicacionStaff() - IMPLEMENTACIÓN ────────────────
function buildExplicacionStaff(readiness, fatigaOculta, estado, tsb, acwr) {
  let msg = '';
  
  if (readiness < 30) {
    msg = '🔴 Descanso obligatorio. Tu cuerpo necesita recuperación.';
  } else if (readiness < 50) {
    msg = '🟠 Fatiga significativa. Entreno suave o descanso.';
  } else if (readiness < 65) {
    msg = '🟡 Estado aceptable. Entreno controlado.';
  } else if (readiness < 80) {
    msg = '🟢 Buen estado. Puedes entrenar con normalidad.';
  } else {
    msg = '🟢 Excelente estado. Ventana de calidad.';
  }
  
  if (fatigaOculta === '🔴 Alta') {
    msg += ' ⚠️ Fatiga oculta alta. Reduce intensidad aunque te sientas bien.';
  }
  
  if (acwr > 1.3) {
    msg += ' 📊 ACWR elevado. Controla la carga.';
  }
  
  return msg;
}

// ─── buildTextoStress() - IMPLEMENTACIÓN ─────────────────────
function buildTextoStress(stress) {
  if (stress === 1) return '🟢 Bajo';
  if (stress === 2) return '🟡 Normal';
  return '🔴 Alto';
}

// ─── buildTextoSleep() - IMPLEMENTACIÓN ──────────────────────
function buildTextoSleep(sleep) {
  if (sleep === 1) return '🔴 Malo';
  if (sleep === 2) return '🟡 Regular';
  return '🟢 Bueno';
}

// ─── getSemaforo() - IMPLEMENTACIÓN ──────────────────────────
function getSemaforo(readiness) {
  if (readiness < 30) return '🔴🔴🔴';
  if (readiness < 50) return '🟠🟠🟠';
  if (readiness < 65) return '🟡🟡🟡';
  if (readiness < 80) return '🟢🟢🟢';
  return '🟢🟢🟢✨';
}

// ─── compararUltimasSesiones() - IMPLEMENTACIÓN ──────────────
function compararUltimasSesiones(activities) {
  if (!activities || activities.length < 2) {
    return { ultimas: 0, avgTss: 0, maxTss: 0, avgIf: '0.00', avgDur: 0, tendencia: 'Sin datos' };
  }
  
  let tssTotal = 0, ifTotal = 0, durTotal = 0;
  let maxTss = 0;
  
  activities.forEach((a, idx) => {
    const tss = safeNum(a.icu_training_load, 0);
    const np = safeNum(a.icu_weighted_avg_watts, 0);
    const ifVal = (np > 0 && CONFIG.FTP > 0) ? np / CONFIG.FTP : 0;
    const dur = safeNum(a.moving_time, 0) / 60;
    
    tssTotal += tss;
    ifTotal += ifVal;
    durTotal += dur;
    if (tss > maxTss) maxTss = tss;
  });
  
  const n = activities.length;
  const avgTss = Math.round(tssTotal / n);
  const avgIf = (ifTotal / n).toFixed(2);
  const avgDur = Math.round(durTotal / n);
  
  // Tendencia: comparar primera mitad vs segunda mitad
  const mitad = Math.floor(n / 2);
  let tendencia = '➡️ Estable';
  if (mitad >= 1) {
    const primeraMitad = activities.slice(0, mitad);
    const segundaMitad = activities.slice(mitad);
    const tss1 = primeraMitad.reduce((s, a) => s + safeNum(a.icu_training_load, 0), 0) / primeraMitad.length;
    const tss2 = segundaMitad.reduce((s, a) => s + safeNum(a.icu_training_load, 0), 0) / segundaMitad.length;
    if (tss2 > tss1 * 1.15) tendencia = '⬆️ Aumentando';
    else if (tss2 < tss1 * 0.85) tendencia = '⬇️ Disminuyendo';
  }
  
  return { ultimas: n, avgTss, maxTss, avgIf, avgDur, tendencia };
}

// ═══════════════════════════════════════════════════════════════
// 📋 RESUMEN DE MEJORAS PRIORIZADAS
// ═══════════════════════════════════════════════════════════════

/*
PRIORIDAD 1 - CRÍTICO (ERRORES QUE ROMPEN EL CÓDIGO):
  [ ] Implementar funciones faltantes (calcularReadiness, calcularFatigaOculta, etc.)
  [ ] Eliminar código duplicado (obtenerHistorial, generarRecomendacionesInteligentes)

PRIORIDAD 2 - ALTO (MEJORAS FUNCIONALES):
  [ ] Movilidad adaptativa al estado de fatiga
  [ ] Fuerza sincronizada con la fase de entrenamiento
  [ ] Nutrición periodizada por fase y tipo de entreno
  [ ] Readiness con tendencias (no solo instantáneo)

PRIORIDAD 3 - MEDIO (OPTIMIZACIONES):
  [ ] Persistencia real (Supabase para historial en memoria)
  [ ] Aprendizaje de tasa de sudor individual
  [ ] Detección de patrones de fatiga por día de la semana
  [ ] Estrategia "Fuel for the Work Required" en nutrición

PRIORIDAD 4 - BAJO (CALIDAD DE CÓDIGO):
  [ ] Añadir JSDoc a funciones críticas
  [ ] Externalizar umbrales a CONFIG
  [ ] Logs estructurados con niveles
  [ ] Migrar a TypeScript
*/