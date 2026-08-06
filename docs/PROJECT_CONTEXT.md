# 🧠 WORLD TOUR COACH — PROJECT CONTEXT

> **Documentación oficial del proyecto**
> Última actualización: 06/08/2026
> Versión: v9.5

---

## 1. OBJETIVO DEL PROYECTO

**World Tour Coach** es un sistema avanzado de entrenamiento de ciclismo con IA, integrado en Telegram, diseñado para **Manu** (ciclista Master 40+, 43 años, 64kg, FTP 240W).

**¿Qué resuelve?**
- Planifica entrenamientos diarios con periodización real (4 fases)
- Calcula fatiga, recuperación y readiness de forma automática
- Proporciona nutrición avanzada con recetas personalizadas
- Analiza datos de Garmin/Intervals.icu en tiempo real
- Aprende del historial del atleta para adaptar recomendaciones
- Ayuda a recuperar el FTP histórico de 296W

**Finalidad:** Ser un entrenador personal virtual completo que entienda el contexto humano (grupeta, rodillo, descanso) y adapte el plan sin perder la lógica deportiva.

---

## 2. FILOSOFÍA DEL PROYECTO

1. **"No cambies el cerebro de fatiga. Añade una capa de contexto humano encima."** — El motor de intención no sustituye al motor de fatiga, lo complementa.
2. **Periodización estructural** — 4 fases (Base, Desarrollo, Especificidad, Taper) con objetivos de TSS semanal.
3. **Seguridad primero** — Conflict Resolver prioriza seguridad (TSB extremo, calor extremo, ACWR crítico) sobre cualquier plan.
4. **Aprendizaje continuo** — El sistema valida feedback y aprende de desviaciones.
5. **Datos reales** — Usa Garmin (Body Battery, HRV, sueño) y Intervals.icu (CTL, ATL, TSB) como fuentes de verdad.
6. **Contexto humano** — La grupeta se trata como sesión válida, no como desviación.

---

## 3. ARQUITECTURA COMPLETA

```
┌─────────────────────────────────────────────────────────────┐
│                    TELEGRAM (Bot API)                       │
│                    @WorldTourCoachBot                       │
└──────────────────────────┬──────────────────────────────────┘
                           │ Webhook POST /webhook
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    EXPRESS SERVER (Node.js)                 │
│                    index.js (6683 líneas)                   │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Webhook     │  │  Cola de     │  │  Procesador de   │  │
│  │  Handler     │→ │  Mensajes    │→ │  Comandos        │  │
│  └──────────────┘  └──────────────┘  └────────┬─────────┘  │
│                                               │            │
│  ┌────────────────────────────────────────────▼─────────┐  │
│  │              ORQUESTADOR CENTRAL                     │  │
│  │              getAthleteState()                       │  │
│  │              getAthleteStateConAjuste()              │  │
│  └──────────────────────────────────────────────────────┘  │
│         │              │              │                    │
│         ▼              ▼              ▼                    │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐      │
│  │  Datos   │  │  Motor de    │  │  Motor de        │      │
│  │  Garmin  │  │  Intención   │  │  Fatiga          │      │
│  │  Supabase│  │  motorInten- │  │  (decidirEntrena-│      │
│  │          │  │  cion.js     │  │  miento)         │      │
│  └──────────┘  └──────────────┘  └──────────────────┘      │
│         │              │              │                    │
│         ▼              ▼              ▼                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  GENERADOR DE WORKOUT (Single Source of Truth)       │  │
│  │  generateWorkout() → bloques, vatios, TSS, IF, KJ    │  │
│  └──────────────────────────────────────────────────────┘  │
│         │              │              │                    │
│         ▼              ▼              ▼                    │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐      │
│  │Nutrición │  │   Fuerza     │  │   Consejos       │      │
│  │calcular- │  │calcularFuer- │  │generarConsejo-   │      │
│  │Nutricion-│  │zaUnificada   │  │Unificado         │      │
│  │Unificada │  └──────────────┘  └──────────────────┘      │
│  └──────────┘                                              │
└─────────────────────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
│  SUPABASE    │ │ INTERVALS.ICU│ │  OPENROUTER AI   │
│  Persistencia│ │ Datos reales │ │  Asistente IA    │
└──────────────┘ └──────────────┘ └──────────────────┘
```

---

## 4. TECNOLOGÍAS

| Tecnología | Uso |
|---|---|
| **Node.js 18+** | Runtime principal |
| **Express 4** | Servidor HTTP y webhook |
| **Telegram Bot API** | Interfaz de usuario |
| **Supabase** | Base de datos PostgreSQL + persistencia |
| **Intervals.icu API** | Datos de entrenamiento (TSS, CTL, ATL, actividades) |
| **OpenRouter AI** | Asistente IA (opcional, modelos gratuitos) |
| **OpenWeatherMap** | Datos meteorológicos (Heat Index) |
| **Railway** | Plataforma de despliegue (Nixpacks) |
| **node-fetch** | Cliente HTTP |
| **form-data** | Multipart para APIs |
| **dotenv** | Variables de entorno |
| **cors** | Middleware CORS |

---

## 5. ESTRUCTURA DEL PROYECTO

```
worldtourcoach-backend/
├── index.js              # Archivo principal (6683 líneas) - TODO el sistema
├── motorIntencion.js     # Motor de intención (382 líneas) - Capa de contexto humano
├── package.json          # Dependencias y scripts
├── package-lock.json     # Lock de dependencias
├── railway.json          # Configuración de despliegue Railway
├── README.md             # Documentación básica
├── ENV                   # Variables de entorno (sin extensión)
├── .gitignore            # Archivos ignorados
├── .nvmrc                # Versión de Node.js
├── models.json           # Modelos de datos (posiblemente)
├── cambios.patch         # Parche de cambios
├── crear_columna_moving_time.sql  # SQL para Supabase
├── fix_end.js            # Script de corrección
├── REVIEW.js             # Script de revisión
└── docs/                 # Documentación (esta carpeta)
```

---

## 6. FLUJO DE EJECUCIÓN

1. **Usuario escribe comando** en Telegram (ej: `/hoy`)
2. **Telegram envía webhook** POST a `/webhook` en Railway
3. **Sistema de cola** encola el mensaje (deduplicación por update_id)
4. **Procesador de webhook**:
   - Verifica chat_id autorizado
   - Comprueba si hay feedback pendiente
   - Comprueba si hay respuesta de desviación pendiente
   - Parsea comando y argumentos
5. **Orquestador central** (`getAthleteStateConAjuste`):
   - Obtiene datos de Garmin (Supabase) + Intervals.icu + clima
   - Calcula estado (CTL, ATL, TSB, readiness, ACWR)
   - Aplica restricciones globales (edad, calor, fatiga)
   - Decide entrenamiento (periodización)
   - Resuelve conflictos (seguridad > clima > fatiga > plan > objetivo)
   - Aplica motor de intención (grupeta, rodillo, etc.)
   - Genera workout (bloques, vatios, TSS, IF, KJ)
   - Calcula nutrición, fuerza, consejos
6. **Comando específico** construye mensaje formateado
7. **sendTelegram** envía respuesta al usuario

---

## 7. SISTEMA TELEGRAM — COMANDOS

### Comandos Principales
| Comando | Función | Módulos |
|---|---|---|
| `/start` | Menú de bienvenida con todos los comandos | cmdStart |
| `/hoy` | Resumen completo del día | cmdHoy → getAthleteStateConAjuste |
| `/hoy --estado` | Estado completo | cmdEstado |
| `/hoy --plan` | Plan detallado | cmdPlan |
| `/hoy --clima` | Clima + factor | cmdClima |
| `/hoy --nutricion` | Nutrición + recetas | cmdNutricion |
| `/hoy --objetivo` | Plan para 296W | cmdObjetivo |
| `/nutricion` | Nutrición detallada | cmdNutricion |

### Comandos Avanzados
| Comando | Función |
|---|---|
| `/ia [pregunta]` | Asistente IA con OpenRouter |
| `/traza` | Ver última decisión (Decision Trace) |
| `/analizar [ID]` | Análisis de entreno |
| `/fatiga` | Análisis de fatiga |
| `/alerta` | Detección de sobreentrenamiento |
| `/semana` | Resumen semanal |
| `/semanapasada` | Resumen semana anterior |
| `/aprender` | Dashboard de aprendizaje |
| `/aprendervalidar` | Validación del aprendizaje |
| `/progreso` | Evolución anual |
| `/prediccion` | Rendimiento esperado |
| `/recuperacion` | Tiempos de recuperación |
| `/tendencias` | Evolución 90 días |
| `/historial` | Historial de entrenos |

### Herramientas
| Comando | Función |
|---|---|
| `/zwo` | Archivo rodillo (con cadencia) |
| `/garmin` | Subir a Intervals |
| `/exportar` | Exportar datos |
| `/densidad` | Densidad de carga |
| `/debug` | Datos técnicos |
| `/movilidad` | Rutina de movilidad diaria |
| `/sync` | Sincronizar con Supabase |

---

## 8. SISTEMA IA (OpenRouter)

- **Modelos**: Lista de modelos gratuitos (Gemma, Nemotron, GPT-OSS, etc.)
- **Contexto**: El sistema envía contexto real (TSB, CTL, readiness, nutrición, clima, fase)
- **Cache**: 5 minutos TTL para consultas repetidas
- **Fallback**: Prueba hasta 5 modelos hasta que uno funciona
- **Limitación**: Requiere OPENROUTER_API_KEY en ENV

---

## 9. BASE DE DATOS (SUPABASE)

### Tablas detectadas:
- `historial_entrenos` — Entrenos con feedback (fecha, tipo, tss, rpe, watts, piernas, stress, sleep, resultado, momento_dia, comio_antes)
- `actividades_guardadas` — Actividades de Intervals.icu (actividad_id, Fecha, tss, np, ap, if_value, kj, Distancia, elevacion, moving_time)
- `garmin_wellness` — Datos de salud Garmin (body_battery, stress, sleep, HR, SpO2, HRV)
- `garmin_hrv` — HRV de Garmin
- `garmin_sleep` — Sueño de Garmin
- `aprendizaje_desviaciones` — Aprendizaje de desviaciones del plan

---

## 10. SERVICIOS EXTERNOS

| Servicio | Uso | Configuración |
|---|---|---|
| **Telegram** | Interfaz de usuario | TELEGRAM_TOKEN, CHAT_ID |
| **Supabase** | Persistencia | SUPABASE_URL, SUPABASE_ANON_KEY |
| **Railway** | Despliegue | railway.json |
| **Garmin** | Datos de salud | Via Supabase (garmin_wellness) |
| **Intervals.icu** | Datos de entrenamiento | INTERVALS_API_KEY, ATHLETE_ID |
| **OpenRouter** | IA | OPENROUTER_API_KEY |
| **OpenWeatherMap** | Clima | WEATHER_API_KEY, CITY |

---

## 11. LÓGICA DEPORTIVA

### TSS (Training Stress Score)
Calculado por Intervals.icu o estimado: `(duración * NP * IF) / (FTP * 3600) * 100`

### CTL/ATL/TSB
- CTL: Carga crónica (42 días)
- ATL: Carga aguda (7 días)
- TSB = CTL - ATL

### Readiness
Calculado con: TSB, HRV, sueño, pasos, tendencias (HRV, sueño, TSB), patrones de fatiga por día

### FTP Estimado
Basado en historial: semanas entrenando × mejora mensual (1.5W para Master 40+)

### Periodización
- **Base**: TSS 450/semana, 1 sesión calidad
- **Desarrollo**: TSS 550/semana, 2 sesiones calidad
- **Especificidad**: TSS 500/semana, 2 sesiones calidad
- **Taper**: TSS 350/semana, 0 sesiones calidad

### Nutrición
- Mifflin-St Jeor para TMB
- CH periodizados por fase (4-6 g/kg)
- Proteína 1.8-2.2 g/kg
- Fuel for the work required (CH durante entreno)
- Hidratación con tasa de sudor aprendida

---

## 12. FLUJO DE DATOS

```
Garmin → Supabase (garmin_wellness) → obtenerDatosGarminSupabase()
Intervals.icu → fetchWellness/fetchActivities → obtenerDatosCompletos()
OpenWeatherMap → fetchWeather → safeWeatherData
         ↓
    getAthleteState()
         ↓
    Estado calculado (CTL, ATL, TSB, readiness, ACWR)
         ↓
    Restricciones → Decisión → Conflictos → Intención
         ↓
    Workout generado
         ↓
    Nutrición + Fuerza + Consejos
         ↓
    Mensaje Telegram
```

---

## 13. DEPENDENCIAS

```
index.js (crítico - TODO el sistema)
├── motorIntencion.js (dependencia directa)
├── Supabase (persistencia)
├── Intervals.icu (datos)
├── OpenWeatherMap (clima)
└── OpenRouter (IA opcional)
```

**Módulos críticos**: `getAthleteState()`, `generateWorkout()`, `decidirEntrenamiento()`, `resolverConflictos()`

---

## 14. RIESGOS

1. **index.js es monolítico** (6683 líneas) — Cualquier cambio puede afectar a todo
2. **Dependencia de APIs externas** — Si Intervals.icu o Garmin fallan, el sistema usa fallbacks
3. **Variables de entorno** — Si faltan, el sistema no funciona
4. **Cola de mensajes en memoria** — Se pierde si el servidor se reinicia
5. **Historial en memoria** — `scriptProperties` no persiste entre reinicios
6. **Datos de Supabase** — Si la tabla `moving_time` no existe, /densidad falla

---

## 15. CALIDAD DEL PROYECTO

### Fortalezas
- Sistema completo y funcional en producción
- Lógica deportiva avanzada (periodización, fatiga, nutrición)
- Motor de intención que entiende contexto humano
- Decision Trace Layer para explicar decisiones
- Aprendizaje automático del historial

### Debilidades
- **Monolito**: index.js es demasiado grande
- **Sin tests**: No hay tests automatizados
- **Sin TypeScript**: JavaScript sin tipos
- **Documentación limitada**: README básico
- **Sin CI/CD**: Despliegue manual via Railway

### Deuda técnica
- Código duplicado en varios comandos
- Fallbacks sin logging detallado
- Sin manejo de errores consistente

---

## 16. POSIBLES MEJORAS (BACKLOG)

### 🔴 Críticas
1. **Dividir index.js en módulos** — Beneficio: mantenibilidad. Dificultad: alta. Riesgo: alto. Módulos: todos.
2. **Añadir tests** — Beneficio: estabilidad. Dificultad: media. Riesgo: bajo. Módulos: todos.
3. **Persistencia de cola de mensajes** — Beneficio: no perder mensajes. Dificultad: media. Riesgo: bajo. Módulos: webhook.

### 🟠 Importantes
4. **Logging estructurado** — Beneficio: debugging. Dificultad: baja. Riesgo: bajo. Módulos: todos.
5. **Manejo de errores consistente** — Beneficio: estabilidad. Dificultad: media. Riesgo: medio. Módulos: todos.
6. **Documentación de API** — Beneficio: onboarding. Dificultad: baja. Riesgo: bajo. Módulos: docs.

### 🟡 Recomendables
7. **TypeScript** — Beneficio: tipos. Dificultad: alta. Riesgo: alto. Módulos: todos.
8. **CI/CD** — Beneficio: despliegue automático. Dificultad: media. Riesgo: bajo. Módulos: infra.
9. **Rate limiting** — Beneficio: protección. Dificultad: baja. Riesgo: bajo. Módulos: webhook.

### 🟢 Futuras
10. **App web** — Beneficio: accesibilidad. Dificultad: alta. Riesgo: medio. Módulos: nuevo.
11. **Soporte multi-atleta** — Beneficio: escalabilidad. Dificultad: alta. Riesgo: alto. Módulos: todos.
12. **Integración Strava** — Beneficio: más datos. Dificultad: media. Riesgo: medio. Módulos: datos.

---

## DUDAS Y PUNTOS NO DEDUCIBLES — RESPUESTAS DEL CREADOR

### 1. ¿Cuál es el objetivo deportivo exacto?

El objetivo principal es mejorar el rendimiento ciclista de forma sostenible:
- Recuperar un FTP aproximado de **296W**
- Volver a un nivel cercano a **4,7 W/kg**
- Mejorar como ciclista manteniendo salud, motivación y disfrute

**El objetivo NO es perseguir únicamente números.** El verdadero objetivo es crear un entrenador inteligente que ayude a mejorar durante años. El sistema debe valorar siempre: rendimiento, recuperación, fatiga, motivación, vida personal y disfrute del ciclismo.

### 2. ¿Por qué FTP 240W?

240W es el **FTP de referencia actual** del sistema. Es un valor operativo, no el mejor histórico. El mejor nivel histórico estuvo alrededor de **275W**. El FTP debe considerarse un valor **dinámico** que puede evolucionar según entrenamientos, rendimiento real, estimaciones de Garmin, Intervals y pruebas realizadas. **Nunca debe tratarse como un dato fijo permanente.**

### 3. ¿Cuál es la frecuencia de entrenamiento semanal esperada?

No existe una cantidad fija obligatoria. La planificación debe adaptarse a la vida real:
- Trabajo siempre en turno de mañana
- Día libre fijo: **domingo**
- Otro día libre que rota entre lunes y sábado
- Los días de trabajo se puede entrenar después de trabajar
- Los días libres son los mejores para entrenamientos largos, calidad y sesiones específicas

**La prioridad es la constancia.** Es preferible entrenar bien durante años que cumplir un plan perfecto durante pocas semanas.

### 4. ¿Hay algún plan de competición?

Actualmente **no existe un calendario de competición fijo**. El sistema debe permitir introducir objetivos futuros. Las competiciones deben modificar la planificación si aparecen. El objetivo principal no es preparar una única carrera, sino mejorar el nivel general como ciclista.

### 5. ¿Cuál es la relación con la grupeta?

La grupeta es una **parte fundamental** del proyecto. Las salidas sociales son entrenamiento real y **no deben considerarse una desviación del plan**. Una salida con la grupeta puede aportar: volumen, intensidad, motivación, experiencia y disfrute. El sistema debe analizar esas salidas igual que cualquier otro entrenamiento y **no debe penalizar** una salida diferente al entrenamiento previsto.

### 6. ¿Hay preferencias de horario?

Sí. La disponibilidad está condicionada por el trabajo:
- Turno fijo de mañana
- Entrenamientos normalmente después del trabajo
- Domingo normalmente salida con la grupeta
- Segundo día libre variable entre lunes y sábado

La IA debe adaptar los entrenamientos a la disponibilidad real. **Nunca debe proponer planes imposibles de cumplir.**

### 7. ¿Cuál es la historia del proyecto?

World Tour Coach nació con la idea de crear un entrenador personal inteligente basado en datos reales. No busca ser un simple bot de respuestas. Busca analizar: entrenamientos, recuperación, carga, nutrición, fatiga, rendimiento y contexto personal. El proyecto ha evolucionado añadiendo: Telegram, Node.js, Supabase, Railway, IA, Garmin, Intervals, análisis deportivo, nutrición, periodización y predicción. **La filosofía principal es mejorar continuamente sin destruir lo que ya funciona.**

### 8. ¿Hay limitaciones físicas?

No existen lesiones importantes conocidas actualmente. Pero el sistema debe tener siempre una **filosofía conservadora**. La recuperación tiene prioridad sobre forzar rendimiento. Si los datos indican fatiga elevada, el sistema debe recomendar reducir carga. **Nunca debe buscar mejoras rápidas sacrificando la continuidad.**

### 9. ¿Cuál es el presupuesto?

El proyecto busca mantener una buena relación calidad/precio:
- Priorizar herramientas gratuitas cuando sean suficientes
- Utilizar servicios de pago solo cuando aporten una mejora clara
- Evitar costes innecesarios

La eficiencia del sistema también es importante.

### 10. ¿Hay otros usuarios?

Actualmente el proyecto está diseñado para un **único usuario: Manu**. Sin embargo, la arquitectura debe evitar decisiones que impidan una futura evolución multiusuario. No implementar ahora funciones multiusuario, solo mantener una estructura que no cierre esa posibilidad.

---

## REGLAS FUNDAMENTALES DEL ENTRENADOR

Estas reglas deben considerarse parte del funcionamiento del sistema:

1. **Mejorar sí, obsesionarse no.**
2. **El plan debe adaptarse a la persona, no la persona al plan.**
3. **La grupeta y disfrutar del ciclismo tienen valor deportivo.**
4. **Una semana con salidas sociales puede ser una buena semana de entrenamiento.**
5. **La perfección del entrenamiento no es el objetivo.**
6. **La adherencia durante años es más importante que cumplir un entrenamiento aislado.**
7. **Nunca inventar datos.**
8. **Nunca recomendar algo que no pueda justificarse.**
9. **La recuperación tiene prioridad.**
10. **World Tour Coach debe actuar como un entrenador humano experimentado, no como un generador automático de sesiones.**
