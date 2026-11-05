-- Supabase concede por defecto todos los permisos a "authenticated" sobre lo nuevo en public.
-- La seguridad solo los quitó de lo que existía entonces: las vistas creadas después volvieron a tenerlos.
-- Desde ahora nada nuevo nace con permiso de borrar o vaciar, y las vistas son de solo lectura.
alter default privileges in schema public revoke delete, truncate on tables from authenticated;
revoke insert, update, delete, truncate on marcas_vigentes, saldo_partidas, resumen_gastos, panel_empresa from authenticated;
