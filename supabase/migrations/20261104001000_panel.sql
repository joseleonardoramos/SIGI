-- Panel gerencial (fase 6): una fila por empresa visible para quien consulta (RLS de cada tabla).
-- Presupuesto, consumo y saldo: solo versiones vigentes; cada gasto consume el mayor entre lo
-- comprometido y lo facturado (saldo_partidas), así que nada se cuenta dos veces.
-- Montos de presupuesto en la moneda de reporte de la empresa; telecom y flotas en su moneda.

-- Una sola versión vigente por empresa: con dos, el panel sumaría dos presupuestos.
create unique index una_version_vigente on presupuestos_versiones (empresa_id) where estado = 'Vigente' and activo;

create view panel_empresa with (security_invoker = true) as
select
  e.id as empresa_id,
  e.nombre,
  e.moneda_reporte,
  coalesce(p.presupuesto, 0) as presupuesto,
  coalesce(p.comprometido, 0) as comprometido,
  coalesce(p.ejecutado, 0) as ejecutado,
  coalesce(p.pagado, 0) as pagado,
  coalesce(p.disponible, 0) as disponible,
  coalesce(p.ahorro, 0) as ahorro,   -- saldo de las partidas que quedan por debajo de su presupuesto
  coalesce(p.exceso, 0) as exceso,   -- lo que superan las partidas en negativo
  coalesce(sp.fuera, 0) as sin_partida, -- gastos registrados sin partida (fuera de presupuesto)
  coalesce(t.rd, 0) as telecom_rd,
  coalesce(t.us, 0) as telecom_us,
  coalesce(fl.costo, 0) as flotas_mensual,
  coalesce(fl.lineas, 0) as flotas_lineas,
  coalesce(sw.vencen, 0) as software_vencen_60, -- ya vencido o vence en 60 días
  coalesce(au.fuera, 0) as personal_fuera_hoy
from empresas e
left join lateral (
  select sum(s.presupuesto) as presupuesto, sum(s.comprometido) as comprometido, sum(s.ejecutado) as ejecutado,
         sum(s.pagado) as pagado, sum(s.disponible) as disponible,
         sum(greatest(s.disponible, 0)) as ahorro, sum(greatest(-s.disponible, 0)) as exceso
  from saldo_partidas s
  join presupuestos_versiones v on v.id = s.version_id
  where s.empresa_id = e.id and v.estado = 'Vigente' and v.activo
) p on true
left join lateral (
  select round(sum(greatest(r.comprometido, r.facturado) * g.tasa), 2) as fuera
  from gastos g join resumen_gastos r on r.gasto_id = g.id
  where g.empresa_id = e.id and g.partida_id is null
) sp on true
left join lateral (
  select sum(x.monto) filter (where x.moneda = 'RD$') as rd, sum(x.monto) filter (where x.moneda = 'US$') as us
  from servicios_telecom x where x.empresa_id = e.id and x.activo
) t on true
left join lateral (
  select sum(l.costo_mensual) as costo, count(*) as lineas
  from lineas_flota l where l.empresa_id = e.id and l.activo and l.estado <> 'Cancelada'
) fl on true
left join lateral (
  select count(*) as vencen
  from productos_software s where s.empresa_id = e.id and s.activo and s.vence <= current_date + 60
) sw on true
left join lateral (
  select count(*) as fuera
  from ausencias a where a.empresa_id = e.id and a.activo and not a.cancelada and current_date between a.desde and a.hasta
) au on true
where e.activo;

revoke all on panel_empresa from anon;
