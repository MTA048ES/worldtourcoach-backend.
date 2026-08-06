# 🛡️ WORLD TOUR COACH — PLAN DE IMPLEMENTACIÓN DE ESTABILIDAD

> **Fase 1.1 — Plan de implementación (NO se implementa aún)**
> Última actualización: 06/08/2026
> Versión: v9.5

---

## REGLAS DE ESTA FASE

- **No se implementa nada todavía.**
- Cada cambio debe ser **pequeño e independiente**.
- Cada cambio debe poder **probarse por separado**.
- Prioridad: **Seguridad → Estabilidad → Protección de datos → Calidad IA → Mejoras internas**.

---

## ORDEN DE PRIORIDADES (por impacto real)

| Prioridad | Riesgo | Categoría |
|---|---|---|
| 1 | Credenciales hardcodeadas | 🔴 Seguridad |
| 2 | 30+ comandos sin try/catch | 🔴 Estabilidad |
| 3 | APIs externas sin timeout | 🔴 Estabilidad |
| 4 | `procesarMensajeFeedback` sin try/catch | 🔴 Estabilidad |
| 5 | `sendTelegram` sin timeout | 🟠 Estabilidad |
| 6 | `fetchIntervals` sin manejo de errores | 🟠 Estabilidad |
| 7 | Sin validación de datos de entrada | 🟠 Estabilidad |
| 8 | Datos de Supabase sin validación | 🟠 Protección de datos |
| 9 | Cola de mensajes en memoria | 🟠 Protección de datos |
| 10 | Historial en memoria no persistente | 🟠 Protección de datos |
| 11 | Fallbacks sin logging | 🟡 Calidad IA |
| 12 | IA sin validación de respuestas | 🟡 Calidad IA |
| 13 | Sin rate limiting | 🟡 Mejoras internas |
| 14 | Sin logging de mensajes ignorados | 🟡 Mejoras internas |
| 15 | `cmdGarmin` sin validación de respuesta | 🟢 Mejoras internas |
| 16 | `cmdExportar` sin límite de tamaño | 🟢 Mejoras internas |

---

## CAMBIOS PROPUESTOS (ordenados por prioridad)

---

### CAMBIO 1: Eliminar credenciales hardcodeadas

**Riesgo que soluciona:** RIESGO 3 (Credenciales hardcodeadas)

**Beneficio:** Seguridad — evita exposición de credenciales si el repo se hace público.

**Archivos afectados:** `index.js` (líneas ~130-131)

**Complejidad:** Baja

**Riesgo de romper funcionalidades:** Bajo — si las variables de entorno están configuradas en Railway, no hay impacto. Si faltan, el sistema ya no funcionará (comportamiento correcto).

**Cómo probar:**
1. Verificar que `node --check index.js` pasa
2. Verificar que el servidor arranca con las variables de entorno configuradas
3. Verificar que el servidor NO arranca (o falla claramente) si faltan las variables

**Código propuesto:**
```javascript
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ FATAL: SUPABASE_URL y SUPABASE_ANON_KEY son obligatorias');
  process.exit(1);
}
```

---

### CAMBIO 2: Añadir try/catch a todos los comandos

**Riesgo que soluciona:** RIESGO 1 (30+ comandos sin try/catch)

**Beneficio:** Estabilidad — un error en un comando no tumbla el webhook completo.

**Archivos afectados:** `index.js` — todos los comandos listados

**Complejidad:** Media (requiere envolver 24 comandos)

**Riesgo de romper funcionalidades:** Muy bajo — solo añade manejo de errores

**Cómo probar:**
1. `node --check index.js`
2. Ejecutar cada comando y verificar que no devuelve 500
3. Provocar un error (ej: API caída) y verificar que el usuario recibe mensaje de error

**Estrategia:** Hacerlo comando por comando (cambios independientes).

---

### CAMBIO 3: Añadir timeout a todas las llamadas fetch

**Riesgo que soluciona:** RIESGO 2 (APIs sin timeout)

**Beneficio:** Estabilidad — evita bloqueos indefinidos.

**Archivos afectados:** `index.js` — `fetchIntervals`, `fetchIntervalsActivity`, `fetchWeather`, `sendTelegram`

**Complejidad:** Baja

**Riesgo de romper funcionalidades:** Muy bajo — solo añade timeout

**Cómo probar:**
1. `node --check index.js`
2. Simular una API lenta y verificar que el timeout funciona
3. Verificar que los comandos siguen funcionando con APIs rápidas

**Código propuesto:**
```javascript
const fetchWithTimeout = (url, options, timeoutMs = 10000) => {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs))
  ]);
};
```

---

### CAMBIO 4: Envolver `procesarMensajeFeedback` en try/catch

**Riesgo que soluciona:** RIESGO 4 (procesarMensajeFeedback sin try/catch)

**Beneficio:** Estabilidad — el flujo de feedback no puede fallar silenciosamente.

**Archivos afectados:** `index.js` — `procesarMensajeFeedback`

**Complejidad:** Baja

**Riesgo de romper funcionalidades:** Muy bajo

**Cómo probar:**
1. `node --check index.js`
2. Ejecutar el flujo de feedback completo (7 pasos)
3. Provocar un error en el paso 7 y verificar que se limpia el estado

---

### CAMBIO 5: Añadir timeout a `sendTelegram`

**Riesgo que soluciona:** RIESGO 10 (sendTelegram sin timeout)

**Beneficio:** Estabilidad — Telegram no puede bloquear el webhook.

**Archivos afectados:** `index.js` — `sendTelegram`

**Complejidad:** Baja

**Riesgo de romper funcionalidades:** Muy bajo

**Cómo probar:**
1. `node --check index.js`
2. Verificar que los mensajes se envían correctamente
3. Simular Telegram lento y verificar timeout

---

### CAMBIO 6: Añadir manejo de errores a `fetchIntervals`

**Riesgo que soluciona:** RIESGO 5 (fetchIntervals sin manejo de errores)

**Beneficio:** Estabilidad — los comandos que usan Intervals no fallan silenciosamente.

**Archivos afectados:** `index.js` — `fetchIntervals`, `fetchIntervalsActivity`, `fetchPowerCurve`

**Complejidad:** Baja

**Riesgo de romper funcionalidades:** Muy bajo — solo añade try/catch

**Cómo probar:**
1. `node --check index.js`
2. Ejecutar `/analizar`, `/historial`, `/sync` con API caída
3. Verificar que reciben mensaje de error amable

---

### CAMBIO 7: Validar argumentos de entrada

**Riesgo que soluciona:** RIESGO 6 (Sin validación de datos de entrada)

**Beneficio:** Estabilidad — evita errores por entradas inesperadas.

**Archivos afectados:** `index.js` — todos los comandos con args

**Complejidad:** Media

**Riesgo de romper funcionalidades:** Muy bajo

**Cómo probar:**
1. `node --check index.js`
2. Enviar `/analizar abc` y verificar mensaje de error
3. Enviar `/hoy --comando-invalido` y verificar mensaje de ayuda

---

### CAMBIO 8: Validar datos de Supabase

**Riesgo que soluciona:** RIESGO 7 (Datos de Supabase sin validación)

**Beneficio:** Protección de datos — evita cálculos incorrectos.

**Archivos afectados:** `index.js` — `cargarHistorialCompleto`, `obtenerHistorialSupabase`, `cmdHistorial`, `cmdSemanaPasada`

**Complejidad:** Media

**Riesgo de romper funcionalidades:** Bajo — añade validación con fallbacks

**Cómo probar:**
1. `node --check index.js`
2. Verificar que `/densidad` funciona con datos incompletos
3. Verificar que `/historial` muestra datos correctamente

---

### CAMBIO 9: Añadir logging a fallbacks

**Riesgo que soluciona:** RIESGO 11 (Fallbacks sin logging)

**Beneficio:** Calidad IA — transparencia sobre datos estimados.

**Archivos afectados:** `index.js` — `getAthleteState`, `obtenerDatosCompletos`

**Complejidad:** Baja

**Riesgo de romper funcionalidades:** Muy bajo

**Cómo probar:**
1. `node --check index.js`
2. Provocar un fallback y verificar el logging
3. Verificar que el usuario recibe aviso de datos estimados

---

### CAMBIO 10: Añadir disclaimer a respuestas IA

**Riesgo que soluciona:** RIESGO 12 (IA sin validación de respuestas)

**Beneficio:** Calidad IA — evita que el usuario confíe ciegamente en respuestas inventadas.

**Archivos afectados:** `index.js` — `cmdIA`

**Complejidad:** Baja

**Riesgo de romper funcionalidades:** Muy bajo

**Cómo probar:**
1. `node --check index.js`
2. Ejecutar `/ia prueba` y verificar el disclaimer

---

### CAMBIO 11: Añadir rate limiting

**Riesgo que soluciona:** RIESGO 13 (Sin rate limiting)

**Beneficio:** Mejoras internas — protección contra spam.

**Archivos afectados:** `index.js` — webhook

**Complejidad:** Baja

**Riesgo de romper funcionalidades:** Muy bajo

**Cómo probar:**
1. `node --check index.js`
2. Enviar múltiples comandos rápidamente
3. Verificar que se limita correctamente

---

### CAMBIO 12: Añadir logging de mensajes ignorados

**Riesgo que soluciona:** RIESGO 14 (Sin logging de mensajes ignorados)

**Beneficio:** Mejoras internas — mejor debugging.

**Archivos afectados:** `index.js` — `procesarWebhook`

**Complejidad:** Baja

**Riesgo de romper funcionalidades:** Muy bajo

**Cómo probar:**
1. `node --check index.js`
2. Enviar un mensaje no reconocido
3. Verificar el logging

---

## RESUMEN DE IMPLEMENTACIÓN

| Cambio | Prioridad | Complejidad | Riesgo |
|---|---|---|---|
| 1. Eliminar credenciales hardcodeadas | 🔴 Seguridad | Baja | Bajo |
| 2. try/catch a todos los comandos | 🔴 Estabilidad | Media | Muy bajo |
| 3. Timeout a llamadas fetch | 🔴 Estabilidad | Baja | Muy bajo |
| 4. try/catch a procesarMensajeFeedback | 🔴 Estabilidad | Baja | Muy bajo |
| 5. Timeout a sendTelegram | 🟠 Estabilidad | Baja | Muy bajo |
| 6. Manejo de errores a fetchIntervals | 🟠 Estabilidad | Baja | Muy bajo |
| 7. Validar argumentos de entrada | 🟠 Estabilidad | Media | Muy bajo |
| 8. Validar datos de Supabase | 🟠 Protección de datos | Media | Bajo |
| 9. Logging a fallbacks | 🟡 Calidad IA | Baja | Muy bajo |
| 10. Disclaimer IA | 🟡 Calidad IA | Baja | Muy bajo |
| 11. Rate limiting | 🟡 Mejoras internas | Baja | Muy bajo |
| 12. Logging de mensajes ignorados | 🟡 Mejoras internas | Baja | Muy bajo |

---

## NOTA

Este documento es **solo un plan**. No se ha implementado nada. Todas las propuestas están pendientes de tu confirmación.
</arg_value>
<task_progress>
- [x] Crear carpeta docs/
- [x] Crear PROJECT_CONTEXT.md
- [x] Crear ARCHITECTURE.md
- [x] Crear ROADMAP.md
- [x] Crear CHANGELOG.md
- [x] Crear DECISIONS.md
- [x] Crear docs/README.md con instrucción de lectura
- [x] Subir a GitHub
- [x] Actualizar PROJECT_CONTEXT.md con respuestas del creador
- [x] Subir actualización a GitHub
- [x] Crear STABILITY_AUDIT.md
- [x] Subir STABILITY_AUDIT.md a GitHub
- [x] Crear STABILITY_PLAN.md
- [ ] Subir STABILITY_PLAN.md a GitHub
</task_progress>
</write_to_file></tool_call>