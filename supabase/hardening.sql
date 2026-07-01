-- BLINDAJE de la base de datos (paso 2 de seguridad).
-- Cambia la regla: ya NO se permite el acceso con solo la llave pública (anon).
-- Ahora solo los dispositivos CONECTADOS (autenticados con la cuenta del
-- negocio) pueden leer o escribir.
--
-- IMPORTANTE: después de correr esto, cada celular/PC debe "Conectar
-- dispositivo" en la app (tocar el ícono de nube) con el correo y código
-- del negocio. Hazlo cuando ya tengas creado el usuario del negocio en
-- Authentication -> Users.

drop policy if exists "acceso_app" on registros;

create policy "acceso_app" on registros
  for all
  to authenticated
  using (true)
  with check (true);
