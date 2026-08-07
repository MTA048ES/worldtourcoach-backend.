-- ═══════════════════════════════════════════════════════════════
-- AÑADIR COLUMNA moving_time A actividades_guardadas
-- ═══════════════════════════════════════════════════════════════
-- Ejecuta este SQL en el SQL Editor de Supabase:
-- https://supabase.com/dashboard/project/qhtwueashkqbqytfwpwi/sql

ALTER TABLE public.actividades_guardadas
ADD COLUMN IF NOT EXISTS moving_time NUMERIC DEFAULT 0;

-- Índice para búsqueda rápida por duración
CREATE INDEX IF NOT EXISTS idx_actividades_moving_time 
ON public.actividades_guardadas (moving_time);