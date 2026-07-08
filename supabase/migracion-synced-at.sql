-- Migración: RELOJ DE SINCRONIZACIÓN DEL SERVIDOR (arregla el desfase de relojes).
--
-- Problema que resuelve: antes cada dispositivo marcaba la hora de sus cambios
-- con SU propio reloj y ese mismo valor decidía "desde cuándo bajar lo nuevo".
-- Si un equipo tenía el reloj adelantado, dejaba de bajar registros que otros
-- escribían con la hora correcta → cada dispositivo veía datos distintos.
--
-- Solución: una columna `synced_at` que pone SIEMPRE el servidor (un único
-- reloj central) en cada insert/update. La app baja los cambios ordenados por
-- `synced_at`, así que ya no importa si el reloj de un celular está mal.
--
-- Ejecutar UNA vez en Supabase → SQL Editor → New query → Run.
-- Es seguro correrla con la app en uso: el código nuevo trae compatibilidad
-- hacia atrás y toma la columna automáticamente en cuanto exista.

-- 1) La columna (por defecto la hora del servidor).
alter table registros add column if not exists synced_at timestamptz not null default now();

-- 2) Backfill de lo que ya existe: le damos un synced_at derivado de su
--    updated_at (cliente) para conservar el orden y no dejarlos todos con la
--    misma hora. OJO: se hace ANTES de crear el trigger, para que no lo pise.
update registros
  set synced_at = to_timestamp(updated_at / 1000.0)
  where updated_at is not null;

-- 3) El servidor sella synced_at en CADA insert y update (ignora lo que mande
--    el cliente). Así el reloj de sincronización es siempre el del servidor.
create or replace function set_synced_at()
returns trigger as $$
begin
  new.synced_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_synced_at on registros;
create trigger trg_set_synced_at
  before insert or update on registros
  for each row execute function set_synced_at();

-- 4) Índice para que bajar "lo nuevo" sea rápido.
create index if not exists registros_synced_at_idx on registros (synced_at);
