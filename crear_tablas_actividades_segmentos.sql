-- ═══════════════════════════════════════════════════════════════
-- ACTIVIDADES, TRAZAS Y SEGMENTOS — World Tour Coach
-- ═══════════════════════════════════════════════════════════════
-- Ejecutar UNA vez en el SQL Editor de Supabase, antes de usar
-- /api/app. Es idempotente: se puede relanzar sin romper nada.
--
-- NOTA DE SEGURIDAD: el bot escribe con la anon key, así que estas
-- tablas no pueden tener RLS activo sin políticas (rompería la
-- escritura). La app NO accede a Supabase: pasa por /api/app con
-- token. Cuando el bot migre a service_role, se pueden cerrar.
-- ═══════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ─── ACTIVIDADES (resumen de cada salida importada) ────────────
create table if not exists actividades (
  actividad_id      text primary key,
  user_id           text not null,
  fecha             timestamptz not null,
  tipo              text,
  nombre            text,
  duracion_s        integer,
  distancia_m       integer,
  desnivel_m        integer,
  pot_media         integer,
  pot_max           integer,
  np                integer,
  fc_media          integer,
  fc_max            integer,
  cadencia_media    integer,
  velocidad_media   real,
  tss               real,
  origen            text default 'intervals',
  muestras          integer default 0,
  tiene_gps         boolean default false,
  sincronizado_en   timestamptz default now()
);

create index if not exists actividades_fecha_idx
  on actividades (user_id, fecha desc);

-- ─── TRAZAS (series por segundo comprimidas) ───────────────────
create table if not exists actividad_tracks (
  actividad_id    text primary key references actividades(actividad_id) on delete cascade,
  user_id         text not null,
  datos           text not null,          -- base64(gzip(JSON de arrays))
  muestras        integer not null,
  bytes           integer,
  bounds_min_lat  double precision,
  bounds_max_lat  double precision,
  bounds_min_lon  double precision,
  bounds_max_lon  double precision,
  creado_en       timestamptz default now()
);

create index if not exists actividad_tracks_user_idx
  on actividad_tracks (user_id);

-- ─── SEGMENTOS (automáticos de subida y manuales) ──────────────
create table if not exists segmentos (
  id                   uuid primary key default gen_random_uuid(),
  user_id              text not null,
  nombre               text not null,
  tipo                 text not null check (tipo in ('auto', 'manual')),
  deporte              text default 'Ride',
  distancia_m          integer,
  desnivel_m           integer,
  pendiente_media      real,
  categoria            text,
  inicio_lat           double precision not null,
  inicio_lon           double precision not null,
  fin_lat              double precision not null,
  fin_lon              double precision not null,
  radio_m              integer default 45,
  referencia_actividad text,
  estado               text default 'listo',
  esfuerzos            integer default 0,
  creado_en            timestamptz default now()
);

create index if not exists segmentos_user_idx
  on segmentos (user_id, creado_en desc);

-- ─── ESFUERZOS (una fila por actividad y segmento) ─────────────
create table if not exists esfuerzos (
  segmento_id      uuid not null references segmentos(id) on delete cascade,
  actividad_id     text not null,
  user_id          text not null,
  fecha            timestamptz,
  tiempo_s         integer not null,
  pot_media        integer,
  np               integer,
  fc_media         integer,
  velocidad_media  real,
  desnivel_m       integer,
  inicio_t         integer,
  fin_t            integer,
  creado_en        timestamptz default now(),
  primary key (segmento_id, actividad_id)
);

create index if not exists esfuerzos_ranking_idx
  on esfuerzos (segmento_id, tiempo_s asc);

create index if not exists esfuerzos_actividad_idx
  on esfuerzos (user_id, actividad_id);
