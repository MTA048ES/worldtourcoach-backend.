# ⚖️ WORLD TOUR COACH — DECISIONES DE ARQUITECTURA

> Última actualización: 06/08/2026
> Versión: v9.5

---

## DECISIÓN 1: Monolito en index.js

**Fecha:** Histórica
**Estado:** Vigente

### Decisión
Todo el sistema vive en un único archivo `index.js` (6683 líneas).

### Motivo
- Simplicidad de despliegue
- Un solo archivo para todo el sistema
- Fácil de copiar entre entornos

### Consecuencias
- ✅ Fácil de desplegar
- ❌ Difícil de mantener
- ❌ Cualquier cambio afecta a todo

---

## DECISIÓN 2: Motor de intención como capa separada

**Fecha:** v9.3
**Estado:** Vigente

### Decisión
Crear `motorIntencion.js` como módulo separado que añade contexto humano sin modificar el motor de fatiga.

### Motivo
- "No cambies el cerebro de fatiga. Añade una capa de contexto humano encima."
- La grupeta se trata como sesión válida, no como desviación

### Consecuencias
- ✅ El motor de fatiga permanece intacto
- ✅ El sistema entiende el contexto humano
- ✅ La grupeta no se penaliza

---

## DECISIÓN 3: Supabase como persistencia

**Fecha:** v9.3
**Estado:** Vigente

### Decisión
Usar Supabase (PostgreSQL) para persistencia de datos.

### Motivo
- Gratuito para uso personal
- API REST sencilla
- Integración con Garmin

### Consecuencias
- ✅ Datos persistentes entre reinicios
- ✅ Acceso desde cualquier dispositivo
- ❌ Dependencia de un servicio externo

---

## DECISIÓN 4: Intervals.icu como fuente de datos de entrenamiento

**Fecha:** Histórica
**Estado:** Vigente

### Decisión
Usar Intervals.icu para datos de entrenamiento (TSS, CTL, ATL, actividades).

### Motivo
- API completa para ciclismo
- Calcula TSS, CTL, ATL automáticamente
- Integración con Garmin

### Consecuencias
- ✅ Datos precisos de entrenamiento
- ✅ Cálculos de carga automáticos
- ❌ Dependencia de un servicio externo

---

## DECISIÓN 5: Garmin via Supabase para datos de salud

**Fecha:** v9.3
**Estado:** Vigente

### Decisión
Los datos de salud de Garmin (Body Battery, HRV, sueño) se obtienen de Supabase, no directamente de Garmin.

### Motivo
- Garmin no tiene API pública fácil
- Los datos se sincronizan a Supabase por otro proceso

### Consecuencias
- ✅ Datos de salud precisos
- ✅ Sin dependencia directa de Garmin API
- ❌ Depende de que otro proceso sincronice los datos

---

## DECISIÓN 6: OpenRouter para IA

**Fecha:** v9.3
**Estado:** Vigente (opcional)

### Decisión
Usar OpenRouter con modelos gratuitos para el asistente IA.

### Motivo
- Acceso a múltiples modelos con una API
- Modelos gratuitos disponibles
- Sin coste

### Consecuencias
- ✅ IA sin coste
- ✅ Múltiples modelos con fallback
- ❌ Modelos gratuitos pueden estar saturados

---

## DECISIÓN 7: Railway como plataforma de despliegue

**Fecha:** Histórica
**Estado:** Vigente

### Decisión
Desplegar en Railway con Nixpacks.

### Motivo
- Despliegue automático desde GitHub
- Gratuito para uso personal
- Simple

### Consecuencias
- ✅ Despliegue automático
- ✅ Sin configuración compleja
- ❌ Dependencia de Railway

---

## DECISIÓN 8: Cola de mensajes en memoria

**Fecha:** v9.3
**Estado:** Vigente

### Decisión
Usar una cola de mensajes en memoria con deduplicación por `update_id`.

### Motivo
- Evitar procesamiento concurrente
- Evitar duplicados de Telegram

### Consecuencias
- ✅ Sin duplicados
- ✅ Procesamiento ordenado
- ❌ Se pierde si el servidor se reinicia

---

## DECISIÓN 9: Periodización estructural (4 fases)

**Fecha:** v9.3
**Estado:** Vigente

### Decisión
Usar 4 fases de periodización: Base, Desarrollo, Especificidad, Taper.

### Motivo
- Periodización real para ciclismo
- Control de carga semanal
- Objetivo: recuperar 296W

### Consecuencias
- ✅ Planificación estructurada
- ✅ Control de calidad semanal
- ✅ Adaptación a la fase

---

## DECISIÓN 10: Conflict Resolver con prioridades

**Fecha:** v9.3
**Estado:** Vigente

### Decisión
Resolver conflictos con prioridades: Seguridad > Clima > Fatiga > Plan > Objetivo.

### Motivo
- La seguridad del atleta es lo primero
- El clima extremo puede ser peligroso
- La fatiga debe respetarse

### Consecuencias
- ✅ Seguridad garantizada
- ✅ Adaptación al clima
- ✅ Respeto a la fatiga