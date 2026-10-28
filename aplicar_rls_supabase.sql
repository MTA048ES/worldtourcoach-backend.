-- ═══════════════════════════════════════════════════════════════════════
-- CIERRE DE ACCESO PÚBLICO A SUPABASE — World Tour Coach
-- ═══════════════════════════════════════════════════════════════════════
-- Qué hace:
--   1. Quita a `anon` y `authenticated` todo permiso sobre las tablas de
--      `public`: la publishable key deja de servir para leer o escribir.
--   2. Activa RLS en todas esas tablas.
--   3. Deja `service_role` como único rol con acceso. Lo usan el bot y el
--      workflow de Garmin mediante la secret key (sb_secret_...).
--   4. Bloquea los permisos por defecto de tablas futuras (cambio de
--      Supabase del 30/10/2026) y los conserva solo para service_role.
--
-- ANTES DE EJECUTAR (si no, el bot deja de escribir):
--   [ ] Secret key creada en Settings → API Keys
--   [ ] SUPABASE_SECRET_KEY puesta en el hosting (Railway/Render)
--   [ ] Secret SUPABASE_SECRET_KEY puesto en GitHub Actions
--   [ ] Bot y workflow redesplegados y funcionando con la clave nueva
--
-- Es idempotente: se puede relanzar sin romper nada.
-- No toca datos: solo permisos y RLS.
--
-- Tablas conocidas del proyecto (informativo):
--   actividades, actividad_tracks, segmentos, esfuerzos,
--   actividades_guardadas, historial_entrenos, aprendizaje_desviaciones,
--   garmin_wellness, garmin_hrv, garmin_sleep,
--   garmin_sleep_analysis, garmin_sleep_series, garmin_activities
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- 0. DIAGNÓSTICO (solo lectura, ejecútalo antes y guarda el resultado)
-- ───────────────────────────────────────────────────────────────────────
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

select table_name, grantee,
       string_agg(privilege_type, ', ' order by privilege_type) as privilegios
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role')
group by table_name, grantee
order by table_name, grantee;


-- ───────────────────────────────────────────────────────────────────────
-- 1. REVOCAR ACCESO PÚBLICO (tablas, vistas y secuencias)
-- ───────────────────────────────────────────────────────────────────────
-- `all tables` incluye vistas y vistas materializadas.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;


-- ───────────────────────────────────────────────────────────────────────
-- 2. ACTIVAR RLS + ASEGURAR ACCESO DE service_role
-- ───────────────────────────────────────────────────────────────────────
-- service_role salta RLS por diseño (BYPASSRLS), pero sigue necesitando
-- el GRANT: son dos capas distintas.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
    execute format('grant select, insert, update, delete on table public.%I to service_role', r.tablename);
  end loop;
end $$;

grant usage on schema public to service_role;
grant usage, select on all sequences in schema public to service_role;


-- ───────────────────────────────────────────────────────────────────────
-- 3. PERMISOS POR DEFECTO PARA TABLAS FUTURAS
-- ───────────────────────────────────────────────────────────────────────
-- Supabase revoca los grants automáticos el 30/10/2026. Aquí se dejan
-- cerrados para anon/authenticated y abiertos solo para service_role,
-- de modo que una tabla nueva creada por el bot funcione sin sorpresas.
--
-- Si prefieres el modelo estricto de Supabase (grant explícito por tabla),
-- comenta los dos bloques `grant ... to service_role` y añade el GRANT
-- a mano en cada migración (ver plantilla al final).
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;


-- ───────────────────────────────────────────────────────────────────────
-- 4. VERIFICACIÓN
-- ───────────────────────────────────────────────────────────────────────
-- Todas las filas deben salir con rowsecurity = true.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

-- anon/authenticated NO deben aparecer. service_role debe tener
-- DELETE, INSERT, SELECT, UPDATE.
select table_name, grantee,
       string_agg(privilege_type, ', ' order by privilege_type) as privilegios
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role')
group by table_name, grantee
order by table_name, grantee;

-- Permisos por defecto vigentes.
select pg_get_userbyid(defaclrole) as rol, defaclobjtype, defaclacl
from pg_default_acl;


-- ───────────────────────────────────────────────────────────────────────
-- 5. PRUEBA DE FUEGO (fuera de SQL Editor)
-- ───────────────────────────────────────────────────────────────────────
-- Con la publishable key debe devolver error 42501 / 401-403, nunca datos:
--
--   curl -s "https://<PROJECT_REF>.supabase.co/rest/v1/actividades?select=id&limit=1" \
--        -H "apikey: <PUBLISHABLE_KEY>"
--
-- Con la secret key (solo desde tu máquina o el servidor) debe devolver filas:
--
--   curl -s "https://<PROJECT_REF>.supabase.co/rest/v1/actividades?select=id&limit=1" \
--        -H "apikey: <SECRET_KEY>"


-- ───────────────────────────────────────────────────────────────────────
-- 6. ROLLBACK (solo si algo se rompe y necesitas volver atrás)
-- ───────────────────────────────────────────────────────────────────────
-- Descomenta y ejecuta. Reabre la puerta: úsalo solo de forma temporal.
--
-- grant usage on schema public to anon, authenticated;
-- grant select, insert, update, delete on all tables    in schema public to anon, authenticated;
-- grant usage, select                  on all sequences in schema public to anon, authenticated;
-- alter default privileges for role postgres in schema public
--   grant select, insert, update, delete on tables to anon, authenticated;
-- alter default privileges for role postgres in schema public
--   grant usage, select on sequences to anon, authenticated;
-- (RLS puede quedarse activo: sin políticas, anon seguiría sin ver filas.)


-- ───────────────────────────────────────────────────────────────────────
-- 7. PLANTILLA OBLIGATORIA PARA TABLAS NUEVAS (desde 30/10/2026)
-- ───────────────────────────────────────────────────────────────────────
-- create table public.mi_tabla (
--   id bigserial primary key,
--   user_id text not null,
--   ...
-- );
--
-- grant select, insert, update, delete on public.mi_tabla to service_role;
-- grant usage, select on sequence public.mi_tabla_id_seq to service_role;
-- alter table public.mi_tabla enable row level security;
--
-- -- Si algún día un cliente público debe leerla, añade políticas explícitas:
-- -- grant select on public.mi_tabla to anon;
-- -- create policy "lectura publica" on public.mi_tabla
-- --   for select to anon using (true);
