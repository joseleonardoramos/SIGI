-- Totales por gasto calculados en la base: la pantalla ya no descarga todos los movimientos
-- (Supabase entrega como máximo 1000 filas por consulta y los totales saldrían incompletos).
create view resumen_gastos with (security_invoker = true) as
select
  g.id as gasto_id,
  g.empresa_id,
  coalesce(sum(p.monto) filter (where p.tipo = 'Compromiso'), 0) as comprometido,
  coalesce(sum(p.monto) filter (where p.tipo = 'Factura'), 0) as facturado,
  coalesce(sum(p.monto) filter (where p.tipo = 'Pago'), 0) as pagado
from gastos g
left join gasto_pasos p on p.gasto_id = g.id and p.activo and not p.reversado
where g.activo
group by g.id;

revoke all on resumen_gastos from anon;
