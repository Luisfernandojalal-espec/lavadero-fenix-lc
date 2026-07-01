-- Esquema de sincronización para Lavadero Fénix.
-- Pegar y ejecutar en Supabase: panel -> SQL Editor -> New query -> Run.
--
-- Diseño "espejo": una sola tabla guarda todos los registros del negocio
-- (productos, servicios, trabajadores, ventas, gastos) como JSON.
-- Cada celular sube sus registros nuevos y baja los de los demás.
-- `updated_at` (milisegundos) permite traer solo lo que cambió desde la
-- última sincronización, y resolver conflictos por "el más reciente gana".

create table if not exists registros (
  id          uuid        primary key,
  tabla       text        not null check (tabla in
                ('productos','servicios','trabajadores','ventas','gastos')),
  data        jsonb       not null,
  updated_at  bigint      not null
);

create index if not exists registros_sync_idx on registros (updated_at);
create index if not exists registros_tabla_idx on registros (tabla);

-- Seguridad a nivel de fila.
alter table registros enable row level security;

-- MVP: la app accede con la llave "anon public". Esta política permite
-- leer/escribir con esa llave. Es suficiente para empezar con un negocio
-- privado. Más adelante la endurecemos con login real (Supabase Auth)
-- para que solo usuarios autenticados del lavadero puedan tocar los datos.
drop policy if exists "acceso_app" on registros;
create policy "acceso_app" on registros
  for all
  to anon
  using (true)
  with check (true);
