// ═══════════════════════════════════════════════════════════════
// 🧠 MOTOR DE INTENCIÓN - CAPA DE CONTEXTO HUMANO
// ═══════════════════════════════════════════════════════════════
// 
// Este módulo NO sustituye al motor de fatiga.
// Añade una capa de contexto humano encima.
// 
// Filosofía: "No cambies el cerebro de fatiga. 
//             Añade una capa de contexto humano encima."   
//
// Detecta la intención del día (grupeta, rodillo, salida tranquila,
// descanso) y adapta la decisión del entrenador según esa intención.
// La grupeta se trata como sesión válida, no como desviación.
// ═══════════════════════════════════════════════════════════════

// ─── TABLA DE EQUIVALENCIAS DE ENTRENO ─────────────────────────
// Define qué tipos de entreno reales son equivalentes a los
// entrenamientos estructurados del plan.
const EQUIVALENCIAS = {
  grupeta: {
    tssMin: 110,
    tssMax: 160,
    zonas: ['Z2', 'Z3', 'VO2 ocasional'],
    objetivo: ['resistencia', 'fatiga periférica', 'social'],
    equivalenciaPlan: ['z2', 'sweetspot', 'tempo'],
    factorCarga: 1.1, // La grupeta suele ser más intensa de lo planeado
    descripcion: 'Salida en grupo con intensidad no controlada'
  },
  rodillo: {
    tssMin: 40,
    tssMax: 120,
    zonas: ['Z2', 'Z3', 'SweetSpot'],
    objetivo: ['base', 'control', 'calidad'],
    equivalenciaPlan: ['z2', 'sweetspot', 'ftp', 'vo2'],
    factorCarga: 1.0,
    descripcion: 'Entrenamiento en rodillo con control de intensidad'
  },
  salida_tranquila: {
    tssMin: 30,
    tssMax: 80,
    zonas: ['Z1', 'Z2'],
    objetivo: ['recuperación', 'disfrute', 'base'],
    equivalenciaPlan: ['z1', 'z2'],
    factorCarga: 0.8,
    descripcion: 'Salida suave sin control de intensidad'
  },
  descanso: {
    tssMin: 0,
    tssMax: 0,
    zonas: [],
    objetivo: ['recuperación', 'descanso'],
    equivalenciaPlan: ['descanso'],
    factorCarga: 0,
    descripcion: 'Día de descanso total'
  }
};

// ─── DETECTAR INTENCIÓN DEL DÍA ────────────────────────────────
// Analiza el historial, el día de la semana, el clima y el estado
// para predecir la intención más probable del atleta.
function detectarIntencion(estado, historial) {
  try {
    const intencion = {
      tipo: 'rodillo', // Por defecto
      probabilidad: 0.5,
      motivo: [],
      sugerencias: []
    };

    const diaSemana = new Date().getDay();
    const diasSemana = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const hoy = diasSemana[diaSemana];

    // ─── 1. PATRÓN POR DÍA DE LA SEMANA ─────────────────────────
    // Los domingos suelen ser días de grupeta
    if (hoy === 'domingo') {
      intencion.tipo = 'grupeta';
      intencion.probabilidad = 0.75;
      intencion.motivo.push('Domingo: día habitual de grupeta');
    }

    // ─── 2. ANÁLISIS DEL HISTORIAL ─────────────────────────────
    if (historial && historial.length >= 5) {
      // Buscar patrones de grupeta en el historial
      const grupetaHistorial = historial.filter(h => {
        const fecha = new Date(h.fecha);
        return fecha.getDay() === diaSemana && 
               (h.entreno?.tipo === 'grupeta' || 
                (h.entreno?.tipo === 'actividad' && (h.entreno?.tss || 0) > 100));
      });

      if (grupetaHistorial.length >= 2) {
        intencion.tipo = 'grupeta';
        intencion.probabilidad = Math.min(0.9, 0.6 + grupetaHistorial.length * 0.1);
        intencion.motivo.push(`Históricamente los ${hoy} sueles salir en grupeta (${grupetaHistorial.length} veces)`);
      }

      // Buscar patrones de rodillo
      const rodilloHistorial = historial.filter(h => {
        const fecha = new Date(h.fecha);
        return fecha.getDay() === diaSemana && 
               (h.entreno?.tipo === 'z2' || h.entreno?.tipo === 'sweetspot' || h.entreno?.tipo === 'ftp');
      });

      if (rodilloHistorial.length >= 3 && intencion.tipo === 'rodillo') {
        intencion.probabilidad = Math.min(0.8, 0.5 + rodilloHistorial.length * 0.05);
        intencion.motivo.push(`Históricamente los ${hoy} sueles entrenar en rodillo (${rodilloHistorial.length} veces)`);
      }
    }

    // ─── 3. ANÁLISIS DEL CLIMA ─────────────────────────────────
    if (estado && estado.haceCalor && estado.heatIndex > 35) {
      if (intencion.tipo === 'grupeta') {
        intencion.probabilidad *= 0.7;
        intencion.motivo.push('Calor extremo: la grupeta es menos probable');
      } else {
        intencion.tipo = 'rodillo';
        intencion.probabilidad = Math.max(intencion.probabilidad, 0.7);
        intencion.motivo.push(`Calor extremo (HI ${estado.heatIndex}°C): rodillo recomendado`);
      }
    } else if (estado && estado.haceCalor && estado.heatIndex > 30) {
      if (intencion.tipo === 'grupeta') {
        intencion.probabilidad *= 0.85;
        intencion.motivo.push('Calor alto: grupeta posible pero con precaución');
      }
    }

    // ─── 4. ANÁLISIS DEL ESTADO DE FATIGA ──────────────────────
    if (estado) {
      if (estado.tsb < -20 || estado.readiness < 40) {
        intencion.tipo = 'descanso';
        intencion.probabilidad = 0.9;
        intencion.motivo.push(`Fatiga crítica (TSB ${estado.tsb.toFixed(1)}): descanso recomendado`);
      } else if (estado.tsb < -10 || estado.readiness < 55) {
        if (intencion.tipo === 'grupeta') {
          intencion.probabilidad *= 0.6;
          intencion.motivo.push('Fatiga acumulada: grupeta menos recomendable');
        }
        intencion.sugerencias.push('Fatiga acumulada: si sales, hazlo suave y sin apretar');
      }
    }

    // ─── 5. GENERAR SUGERENCIAS ADAPTATIVAS ────────────────────
    if (intencion.tipo === 'grupeta') {
      intencion.sugerencias.push('La grupeta cuenta como estímulo válido de intensidad');
      intencion.sugerencias.push('Hidratación extra: 2 bidones + electrolitos');
      intencion.sugerencias.push('Mañana: Z2 suave 45min para asimilar la carga');
    } else if (intencion.tipo === 'rodillo') {
      intencion.sugerencias.push('Rodillo: control total de la intensidad');
      intencion.sugerencias.push('Ventilador + toalla para el calor');
    } else if (intencion.tipo === 'salida_tranquila') {
      intencion.sugerencias.push('Salida suave: disfruta del paisaje');
      intencion.sugerencias.push('Sin control de vatios, solo sensaciones');
    } else if (intencion.tipo === 'descanso') {
      intencion.sugerencias.push('Descanso total: movilidad 15min + foam rolling');
      intencion.sugerencias.push('Prioriza dormir 8+ horas');
    }

    return intencion;
  } catch (err) {
    console.log('[motorIntencion] detectarIntencion ERROR:', err);
    return {
      tipo: 'rodillo',
      probabilidad: 0.5,
      motivo: ['Error en detección, usando rodillo por defecto'],
      sugerencias: []
    };
  }
}

// ─── ADAPTAR DECISIÓN SEGÚN INTENCIÓN ─────────────────────────
// Toma la decisión del entrenador y la adapta según la intención
// del día. La decisión base sigue siendo del entrenador, pero
// ahora tiene en cuenta el contexto humano.
function adaptarDecisionParaIntencion(decision, intencion, estado) {
  try {
    if (!decision || !intencion) return decision;

    const decisionAdaptada = JSON.parse(JSON.stringify(decision));
    const tipoIntencion = intencion.tipo;

    // ─── GRUPETA: SESIÓN VÁLIDA ────────────────────────────────
    if (tipoIntencion === 'grupeta') {
      // La grupeta es un estímulo válido de intensidad
      // No la tratamos como desviación, sino como alternativa
      decisionAdaptada.tipo = 'grupeta';
      decisionAdaptada.reps = 1;
      decisionAdaptada.durMin = 120; // ~2h típico de grupeta
      decisionAdaptada.recSec = 0;
      decisionAdaptada.intensidad = 0.85; // IF estimado de grupeta
      decisionAdaptada.prioridad = 'intencion_grupeta';
      decisionAdaptada.motivo = '🎯 Intención detectada: grupeta. Estímulo válido de intensidad.';
      decisionAdaptada.esIntencion = true;
      decisionAdaptada.tipoIntencion = 'grupeta';
      decisionAdaptada.notaHidratacion = '💧 2 bidones + electrolitos obligatorios';
      decisionAdaptada.cadenciaRecomendada = '80-95 rpm (según terreno)';

      // Ajustar según fatiga
      if (estado && estado.tsb < -10) {
        decisionAdaptada.motivo += ' | ⚠️ Fatiga acumulada: sal suave y sin apretar';
        decisionAdaptada.intensidad = 0.75;
      }

      return decisionAdaptada;
    }

    // ─── RODILLO: CONTROL TOTAL ────────────────────────────────
    if (tipoIntencion === 'rodillo') {
      // Mantener la decisión del entrenador pero con contexto
      decisionAdaptada.esIntencion = true;
      decisionAdaptada.tipoIntencion = 'rodillo';
      decisionAdaptada.motivo = (decisionAdaptada.motivo || '') + ' | 🎯 Intención: rodillo (control total)';
      return decisionAdaptada;
    }

    // ─── SALIDA TRANQUILA ──────────────────────────────────────
    if (tipoIntencion === 'salida_tranquila') {
      decisionAdaptada.tipo = 'z2';
      decisionAdaptada.reps = 1;
      decisionAdaptada.durMin = 60;
      decisionAdaptada.recSec = 0;
      decisionAdaptada.intensidad = 0.60;
      decisionAdaptada.prioridad = 'intencion_salida_tranquila';
      decisionAdaptada.motivo = '🎯 Intención: salida tranquila. Disfruta sin control de vatios.';
      decisionAdaptada.esIntencion = true;
      decisionAdaptada.tipoIntencion = 'salida_tranquila';
      return decisionAdaptada;
    }

    // ─── DESCANSO ──────────────────────────────────────────────
    if (tipoIntencion === 'descanso') {
      decisionAdaptada.tipo = 'descanso';
      decisionAdaptada.reps = 0;
      decisionAdaptada.durMin = 0;
      decisionAdaptada.recSec = 0;
      decisionAdaptada.intensidad = 0;
      decisionAdaptada.prioridad = 'intencion_descanso';
      decisionAdaptada.motivo = '🧘 Intención: descanso. La recuperación es parte del entrenamiento.';
      decisionAdaptada.esIntencion = true;
      decisionAdaptada.tipoIntencion = 'descanso';
      return decisionAdaptada;
    }

    return decisionAdaptada;
  } catch (err) {
    console.log('[motorIntencion] adaptarDecisionParaIntencion ERROR:', err);
    return decision;
  }
}

// ─── CALCULAR EQUIVALENCIA DE ENTRENO REAL ────────────────────
// Dado un entreno real (ej: grupeta), calcula su equivalencia
// con el plan estructurado. Devuelve el % de cumplimiento.
function calcularEquivalenciaEntreno(entrenoReal, planEsperado) {
  try {
    if (!entrenoReal || !planEsperado) {
      return { cumplimiento: 0, equivalente: false, motivo: 'Datos insuficientes' };
    }

    const tipoReal = entrenoReal.tipo || 'desconocido';
    const tssReal = entrenoReal.tss || 0;
    const tssPlan = planEsperado.tss || 0;

    // Buscar en la tabla de equivalencias
    const equivalencia = EQUIVALENCIAS[tipoReal];

    if (!equivalencia) {
      // Tipo no reconocido, usar comparación directa de TSS
      const cumplimiento = tssPlan > 0 ? Math.min(100, Math.round((tssReal / tssPlan) * 100)) : 0;
      return { cumplimiento, equivalente: cumplimiento >= 70, motivo: 'Comparación directa TSS' };
    }

    // Verificar si el TSS real está dentro del rango esperado
    const tssEnRango = tssReal >= equivalencia.tssMin && tssReal <= equivalencia.tssMax;

    // Verificar si el tipo real es equivalente al plan
    const esEquivalente = equivalencia.equivalenciaPlan.includes(planEsperado.tipo);

    // Calcular cumplimiento
    let cumplimiento = 0;
    if (esEquivalente && tssEnRango) {
      cumplimiento = 90; // Estímulo equivalente
    } else if (esEquivalente) {
      cumplimiento = 75; // Tipo equivalente pero TSS fuera de rango
    } else if (tssEnRango) {
      cumplimiento = 60; // TSS en rango pero tipo diferente
    } else {
      cumplimiento = 40; // No equivalente
    }

    return {
      cumplimiento,
      equivalente: cumplimiento >= 70,
      motivo: esEquivalente 
        ? `✅ ${equivalencia.descripcion} - Estímulo equivalente al plan`
        : `⚠️ ${equivalencia.descripcion} - Tipo diferente al plan`,
      tssReal,
      tssPlan,
      factorCarga: equivalencia.factorCarga
    };
  } catch (err) {
    console.log('[motorIntencion] calcularEquivalenciaEntreno ERROR:', err);
    return { cumplimiento: 0, equivalente: false, motivo: 'Error en cálculo' };
  }
}

// ─── GENERAR CONSEJO ADAPTATIVO ───────────────────────────────
// Genera un consejo basado en la intención del día, con tono
// sugerente y flexible, no prescriptivo.
function generarConsejoAdaptativo(intencion, estado, decision) {
  try {
    const consejos = [];
    const tipo = intencion.tipo;

    // ─── CONSEJO PRINCIPAL SEGÚN INTENCIÓN ────────────────────
    if (tipo === 'grupeta') {
      consejos.push('🚴 *Hoy pinta grupeta.* Aprovecha el estímulo social.');
      consejos.push('La grupeta cuenta como sesión de intensidad válida.');
      if (estado && estado.tsb > 0) {
        consejos.push('🟢 Estás fresco. Puedes apretar en los repechos.');
      } else if (estado && estado.tsb > -10) {
        consejos.push('🟡 Estado equilibrado. Sal cómodo y sin forzar.');
      } else {
        consejos.push('🔴 Fatiga acumulada. Ve al grupo pero rueda suave.');
      }
    } else if (tipo === 'rodillo') {
      consejos.push('🏠 *Hoy toca rodillo.* Control total de la intensidad.');
      if (decision && decision.tipo === 'vo2') {
        consejos.push('⚡ Tienes energía para calidad. Aprovecha.');
      } else if (decision && decision.tipo === 'sweetspot') {
        consejos.push('🔥 SweetSpot: equilibrio entre carga y recuperación.');
      } else {
        consejos.push('🌱 Base aeróbica: construye sin forzar.');
      }
    } else if (tipo === 'salida_tranquila') {
      consejos.push('🌅 *Hoy salida tranquila.* Disfruta del paisaje.');
      consejos.push('Sin control de vatios, solo sensaciones.');
      consejos.push('La recuperación activa también entrena.');
    } else if (tipo === 'descanso') {
      consejos.push('🧘 *Hoy descanso.* La recuperación es parte del entrenamiento.');
      consejos.push('Movilidad 15min + foam rolling.');
      consejos.push('Prioriza dormir 8+ horas.');
    }

    // ─── CONSEJOS ADICIONALES SEGÚN ESTADO ────────────────────
    if (estado) {
      if (estado.haceCalor && estado.heatIndex > 35) {
        consejos.push(`🔥 Calor extremo (HI ${estado.heatIndex}°C). Hidratación extra obligatoria.`);
      } else if (estado.haceCalor && estado.heatIndex > 30) {
        consejos.push(`🌡️ Calor alto (HI ${estado.heatIndex}°C). Lleva 2 bidones.`);
      }

      if (estado.sleepQuality === 1) {
        consejos.push('😴 Has dormido mal. Reduce intensidad hoy.');
      }

      if (estado.acwr > 1.3) {
        consejos.push(`📊 ACWR alto (${estado.acwr.toFixed(2)}). Controla la carga.`);
      }
    }

    // ─── CONSEJO DE RECUPERACIÓN POST-INTENCIÓN ───────────────
    if (tipo === 'grupeta') {
      consejos.push('📅 Mañana: Z2 suave 45min para asimilar la carga.');
      consejos.push('🍽️ Post-grupeta: 60-80g CH + 30-40g proteína.');
    }

    return consejos.slice(0, 5);
  } catch (err) {
    console.log('[motorIntencion] generarConsejoAdaptativo ERROR:', err);
    return ['✅ Sigue tu plan con consistencia.'];
  }
}

// ─── EXPORTAR MÓDULO ──────────────────────────────────────────
module.exports = {
  EQUIVALENCIAS,
  detectarIntencion,
  adaptarDecisionParaIntencion,
  calcularEquivalenciaEntreno,
  generarConsejoAdaptativo
};