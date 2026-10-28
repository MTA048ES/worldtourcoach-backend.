-- ═══════════════════════════════════════════════════════════════
-- 🔄 REIMPORTAR ACTIVIDADES CON GPS
-- ═══════════════════════════════════════════════════════════════
-- Las actividades importadas antes del arreglo guardaron `lat` y `lon`
-- a null, así que no pueden generar segmentos. Este script las borra
-- para que el siguiente sync las descargue otra vez de Intervals.icu,
-- ya con coordenadas reales.
--
-- No se pierde nada: todo se vuelve a descargar desde Intervals.
--
-- Cómo usarlo:
--   1. Esperar a que Render termine el despliegue del commit e3fd235.
--   2. Supabase → SQL Editor → pegar y ejecutar.
--   3. En la app: Ajustes → Sincronizar.
-- ═══════════════════════════════════════════════════════════════

begin;

-- Foto de partida
select
  (select count(*) from public.actividades)      as actividades,
  (select count(*) from public.actividad_tracks) as trazas,
  (select count(*) from public.esfuerzos)        as esfuerzos,
  (select count(*) from public.segmentos)        as segmentos;

-- `esfuerzos` no tiene FK contra `actividades`: se limpia aparte para
-- no dejar registros huérfanos.
delete from public.esfuerzos;

-- Las trazas caen solas por `on delete cascade`.
delete from public.actividades;

-- Opcional: si algún día quieres regenerar también los segmentos
-- (incluidos los manuales), descomenta esta línea.
-- delete from public.segmentos;

-- Foto final: debe quedar todo a cero salvo `segmentos`.
select
  (select count(*) from public.actividades)      as actividades,
  (select count(*) from public.actividad_tracks) as trazas,
  (select count(*) from public.esfuerzos)        as esfuerzos,
  (select count(*) from public.segmentos)        as segmentos;

commit;
