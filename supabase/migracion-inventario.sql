-- Migración: permitir tablas nuevas (movimientos de inventario, clientes,
-- abonos…) en la sincronización.
--
-- Al inicio la tabla `registros` tenía un candado (CHECK) que solo permitía
-- 5 tablas. Ahora que el sistema crece (inventario, crédito), quitamos ese
-- candado para que acepte cualquier tabla sin volver a tocar Supabase.
--
-- Ejecutar en Supabase → SQL Editor → New query → Run.

alter table registros drop constraint if exists registros_tabla_check;
