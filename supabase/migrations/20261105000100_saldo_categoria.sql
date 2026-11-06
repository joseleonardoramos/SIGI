-- La comparación de versiones y la gráfica del panel agrupan por categoría: se agrega al final de la
-- vista (create or replace solo admite columnas nuevas al final). El resto es igual a 20261104000500.
create or replace view saldo_partidas with (security_invoker = true) as
with por_gasto as (
  select
    g.id,
    g.partida_id,
    g.tasa,
    coalesce(sum(p.monto) filter (where p.tipo = 'Compromiso'), 0) as comprometido,
    coalesce(sum(p.monto) filter (where p.tipo = 'Factura'), 0) as facturado,
    coalesce(sum(p.monto) filter (where p.tipo = 'Pago'), 0) as pagado
  from gastos g
  left join gasto_pasos p on p.gasto_id = g.id and p.activo and not p.reversado
  where g.activo and g.partida_id is not null
  group by g.id, g.partida_id, g.tasa
)
select
  pa.id as partida_id,
  pa.empresa_id,
  pa.version_id,
  pa.codigo,
  pa.nombre,
  pa.monto as presupuesto,
  round(coalesce(sum(pg.comprometido * pg.tasa), 0), 2) as comprometido,
  round(coalesce(sum(pg.facturado * pg.tasa), 0), 2) as ejecutado,
  round(coalesce(sum(pg.pagado * pg.tasa), 0), 2) as pagado,
  round(pa.monto - coalesce(sum(greatest(pg.comprometido, pg.facturado) * pg.tasa), 0), 2) as disponible,
  pa.categoria
from partidas pa
left join por_gasto pg on pg.partida_id = pa.id
where pa.activo
group by pa.id;
