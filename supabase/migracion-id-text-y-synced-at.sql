-- ============================================================================
-- CORRE ESTO UNA VEZ en Supabase → SQL Editor → New query → Run.
-- Arregla DOS cosas:
--   1) El error "invalid input syntax for type uuid: 'lavador-generico'" que
--      rompía el sync en algún equipo. Los ids de la app NO siempre son UUID
--      (el lavador genérico usa 'lavador-generico', y hay ids de respaldo tipo
--      'id-...'). Se cambia registros.id de uuid → text para que los acepte.
--   2) El reloj de sincronización del servidor (synced_at) que arregla el
--      desfase de relojes entre celulares. (Idempotente: si ya existe, no pasa
--      nada.)
-- Es seguro correrlo con la app en uso.
-- ============================================================================

-- 1) id de uuid → text (acepta cualquier id de la app, no solo UUID)
alter table registros alter column id type text using id::text;

-- 2) Reloj de sincronización del SERVIDOR (synced_at)
alter table registros add column if not exists synced_at timestamptz not null default now();

-- Backfill de lo existente (ANTES del trigger, para que no lo pise)
update registros
  set synced_at = to_timestamp(updated_at / 1000.0)
  where updated_at is not null;

-- El servidor sella synced_at en cada insert/update
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

-- Índice para bajar rápido lo nuevo
create index if not exists registros_synced_at_idx on registros (synced_at);
