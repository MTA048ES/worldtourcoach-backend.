# World Tour Coach Backend

Sistema avanzado de entrenamiento de ciclismo con IA para Telegram. Periodización real, nutrición inteligente y análisis de fatiga para ciclistas Master 40+.

## 🚀 Características

### 🧠 Inteligencia Artificial
- **Asistente IA con OpenRouter**: Consulta cualquier duda sobre entrenamiento, nutrición o recuperación
- **Análisis de tendencias**: Detección automática de patrones de fatiga
- **Aprendizaje automático**: El sistema aprende de tus entrenos y se adapta a ti
- **Predicción de FTP**: Proyección de rendimiento basada en datos históricos

### 📊 Periodización Estructural
- **4 fases**: Base, Desarrollo, Especificidad, Taper
- **Control de carga**: TSS semanal, CTL, ATL, TSB, ACWR
- **Readiness dinámico**: Calcula tu estado de forma diario con tendencias
- **Ventanas de calidad**: Optimiza entrenamientos intensos según tu estado

### 🍏 Nutrición Avanzada
- **Periodizada por fase**: Carbohidratos adaptados a cada fase
- **Fuel for the work required**: CH durante el entreno según intensidad
- **Hidratación inteligente**: Con tasa de sudor aprendida y electrolitos
- **Suplementación**: Omega-3, Vitamina D, Magnesio, Creatina según edad y fase
- **Recetas personalizadas**: Según gasto energético del entreno

### 🏋️ Fuerza y Movilidad
- **Fuerza periodizada**: Sincronizada con fase de entrenamiento
- **Movilidad adaptativa**: Según estado de fatiga y piernas
- **Prevención de lesiones**: Ejercicios específicos para rodilla, isquios, aquiles

### 🌡️ Clima y Adaptación
- **Heat Index (WBGT)**: Ajuste automático por calor extremo
- **Aclimatación**: Seguimiento de días de adaptación al calor
- **Hidratación**: Ajustada por temperatura y humedad

### 📈 Análisis y Seguimiento
- **Decision Trace Layer**: Explicación completa de cada decisión
- **Conflict Resolver**: Sistema de prioridades para resolver conflictos
- **Learning Filter**: Valida feedback para aprendizaje preciso
- **Dashboard de aprendizaje**: Estadísticas y recomendaciones inteligentes

## 🤖 Comandos Disponibles

### Comandos Principales
- `/hoy` - Resumen completo del día ⭐
- `/hoy --estado` - Estado completo
- `/hoy --plan` - Plan detallado
- `/hoy --clima` - Clima + adaptación
- `/hoy --nutricion` - Nutrición + recetas
- `/hoy --objetivo` - Plan para 296W
- `/nutricion` - Nutrición detallada + recetas ⭐

### Comandos Avanzados
- `/ia [pregunta]` - Asistente IA con OpenRouter 🤖
- `/traza` - Ver última decisión
- `/analizar [ID]` - Análisis de entreno (último o con ID)
- `/fatiga` - Análisis de fatiga
- `/alerta` - Detección de sobreentrenamiento
- `/semana` - Resumen semanal
- `/semanapasada` - Resumen semana anterior
- `/aprender` - Qué he aprendido
- `/aprendervalidar` - Validación del aprendizaje
- `/progreso` - Evolución anual
- `/prediccion` - Rendimiento esperado
- `/recuperacion` - Tiempos de recuperación
- `/tendencias` - Evolución 90 días
- `/historial` - Historial de entrenos

### Herramientas
- `/zwo` - Archivo rodillo (con cadencia)
- `/garmin` - Subir a Intervals
- `/exportar` - Exportar datos
- `/densidad` - Densidad de carga
- `/debug` - Datos técnicos
- `/movilidad` - Rutina de movilidad diaria
- `/sync` - Sincronizar con Supabase ⭐ NUEVO

## 🛠️ Tecnologías

- **Node.js** + Express
- **Telegram Bot API**
- **Intervals.icu** - Datos de entrenamiento
- **Supabase** - Base de datos y persistencia
- **OpenRouter** - IA avanzada (opcional)
- **OpenWeatherMap** - Datos meteorológicos

## 📋 Requisitos

- Node.js 18+
- Cuenta de Telegram (BotFather)
- Cuenta de Intervals.icu
- Cuenta de Supabase (opcional, para persistencia)
- Cuenta de OpenRouter (opcional, para IA)

## 🔧 Instalación Local

1. **Clona el repositorio**:
   ```bash
   git clone https://github.com/MTA048ES/worldtourcoach-backend.git
   cd worldtourcoach-backend
   ```

2. **Instala dependencias**:
   ```bash
   npm install
   ```

3. **Crea archivo `ENV`** con tus variables:
   ```bash
   # Telegram
   TELEGRAM_TOKEN=tu_token_de_telegram
   CHAT_ID=tu_chat_id
   
   # Intervals.icu
   INTERVALS_API_KEY=tu_api_key
   ATHLETE_ID=tu_athlete_id
   
   # OpenWeatherMap
   WEATHER_API_KEY=tu_api_key
   
   # Configuración del atleta
   FTP=240
   WEIGHT_KG=64
   AGE_YEARS=43
   HEIGHT_CM=173
   
   # Supabase (opcional)
   SUPABASE_URL=tu_url
   SUPABASE_ANON_KEY=tu_key
   
   # OpenRouter AI (opcional)
   OPENROUTER_API_KEY=tu_key
   ```

4. **Inicia el servidor**:
   ```bash
   npm start
   ```

5. **Configura el webhook** de Telegram:
   ```bash
   # Usa ngrok para exponer tu servidor
   ngrok http 3000
   
   # Configura el webhook
   curl https://api.telegram.org/bot<TOKEN>/setWebhook?url=<URL_DE_NGROK>/webhook
   ```

## 🚀 Despliegue en Railway

1. Conecta tu repositorio de GitHub con Railway
2. Configura las variables de entorno en Railway:
   - `TELEGRAM_TOKEN` - Token de tu bot de Telegram
   - `CHAT_ID` - Tu ID de chat de Telegram
   - `INTERVALS_API_KEY` - API key de Intervals.icu
   - `ATHLETE_ID` - Tu ID de atleta en Intervals.icu
   - `WEATHER_API_KEY` - API key de OpenWeatherMap
   - `FTP` - Tu FTP actual (ej: 240)
   - `WEIGHT_KG` - Tu peso en kg (ej: 64)
   - `AGE_YEARS` - Tu edad (ej: 43)
   - `SUPABASE_URL` - URL de tu proyecto Supabase
   - `SUPABASE_ANON_KEY` - Key anónima de Supabase
   - `OPENROUTER_API_KEY` - (Opcional) API key de OpenRouter para IA
3. Deploy automático

## 🤖 OpenRouter AI (Opcional)

El bot puede integrarse con [OpenRouter](https://openrouter.ai) para proporcionar respuestas inteligentes usando modelos de IA avanzados (Claude, GPT, etc.).

### Configuración:

1. **Obtén tu API key** en: https://openrouter.ai/keys
   - Crea una cuenta en OpenRouter
   - Ve a "Keys" y crea una nueva key
   - Cópiala (solo se muestra una vez)

2. **Agrega la key a tus variables de entorno**:
   ```bash
   OPENROUTER_API_KEY=sk-or-v1-tu-key-aquí
   ```

3. **Reinicia el servidor**

### Uso:

Una vez configurado, usa el comando `/ia` en Telegram:
```
/ia ¿Cómo debo alimentarme antes de una salida de 3h?
/ia Tengo fatiga acumulada, ¿qué hago?
/ia ¿Es mejor entrenar por la mañana o por la tarde?
```

### Modelos disponibles:

- **Por defecto**: `anthropic/claude-3.5-sonnet` (modelo avanzado)
- **Fallback**: `openai/gpt-4o-mini` (modelo más económico)
- Puedes cambiar el modelo en `CONFIG.OPENROUTER.MODEL` en `index.js`

### Costos:

- OpenRouter funciona con sistema de créditos
- Claude 3.5 Sonnet: ~$3 por 1M tokens de entrada, ~$15 por 1M tokens de salida
- GPT-4o-mini: ~$0.15 por 1M tokens de entrada, ~$0.60 por 1M tokens de salida
- Una consulta típica consume ~500-1000 tokens (muy económico)

## 📊 Arquitectura

### Flujo de Decisión
1. **Input**: Datos de Intervals.icu (wellness, actividades, clima)
2. **Estado**: Cálculo de CTL, ATL, TSB, Readiness, ACWR
3. **Restricciones**: Aplicación de reglas de seguridad, clima, fatiga, edad
4. **Decisión**: Selección de tipo de entreno según periodización
5. **Conflict Resolver**: Resuelve conflictos entre reglas
6. **Workout**: Genera estructura detallada del entreno
7. **Nutrición**: Calcula macros, hidratación y suplementación
8. **Fuerza**: Rutina de fuerza periodizada
9. **Traza**: Registra toda la decisión para debugging

### Motor de Aprendizaje
- **Learning Filter**: Valida feedback para evitar sesgos
- **Análisis de desviaciones**: Detecta cuando no cumples el plan
- **Ajuste automático**: Modifica el plan según tu historial
- **Patrones temporales**: Identifica mejores momentos para entrenar
- **Predicción de desviaciones**: Anticipa cambios en el plan

## 🔒 Seguridad

- **Variables de entorno**: Todas las API keys en archivo `ENV` (no commitado)
- **Gitignore**: Incluye `ENV`, `.env`, `.env.local`
- **Validación**: Feedback validado antes de aprender
- **Filtros**: Mínimo de muestras para aprendizaje fiable

## 📈 Métricas

### Indicadores Clave
- **CTL** (Chronic Training Load): Carga crónica (fitness)
- **ATL** (Acute Training Load): Carga aguda (fatiga)
- **TSB** (Training Stress Balance): Balance = CTL - ATL
- **ACWR** (Acute:Chronic Workload Ratio): Ratio de carga aguda/crónica
- **Readiness**: Estado de forma diario (0-100)
- **IF** (Intensity Factor): Intensidad relativa
- **TSS** (Training Stress Score): Carga de entrenamiento

### Zonas de Potencia
- **Z1**: <55% FTP (Recuperación)
- **Z2**: 55-75% FTP (Base)
- **Z3**: 75-87% FTP (Tempo)
- **Z4**: 87-95% FTP (Sweet Spot)
- **Z5**: 95-105% FTP (Umbral/FTP)
- **Z6**: 105-120% FTP (VO2 Max)
- **Z7**: >120% FTP (Anaeróbico)

## 🎯 Objetivo

Recuperar el FTP histórico de **296W** (actual: 240W) mediante:
- Periodización estructurada de 12 semanas
- Nutrición avanzada adaptada a Master 40+
- Análisis continuo de fatiga y recuperación
- Aprendizaje automático de patrones personales

## 📝 Versión

**v9.5** - Sistema Definitivo con:
- Periodización estructural (4 fases)
- Predicción de FTP (Coggan)
- Nutrición avanzada con sodio y electrolitos
- Fuerza periodizada
- Clima con Heat Index (WBGT)
- Análisis VI/EF real
- Recuperación predictiva
- Aprendizaje contextual
- Motor de intención
- Cerebro: detección de desviaciones y ajuste automático
- OpenRouter AI integrado

## 👤 Autor

**Manu** - Ciclista Master 40+  
Objetivo: Recuperar 296W de FTP

## 📄 Licencia

MIT