-- Toda factura exige proveedor. El NCF es único por emisor: sin proveedor, facturas de suplidores
-- distintos (o de otras empresas) con el mismo NCF chocaban, y el error revelaba datos de otra empresa.
-- Un gasto creado sin proveedor lo recibe al registrar su primera factura (p_proveedor).
drop function public.registrar_movimiento(uuid, text, numeric, date, text, text, text, text, text);

create function public.registrar_movimiento(
  p_gasto uuid,
  p_tipo text,
  p_monto numeric,
  p_fecha date,
  p_documento text default null,
  p_ncf text default null,
  p_metodo_pago text default null,
  p_referencia_bancaria text default null,
  p_motivo_fuera text default null,
  p_proveedor uuid default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  g public.gastos%rowtype;
  v_comp numeric;
  v_fact numeric;
  v_pag numeric;
  v_aumento numeric := 0;
  v_ncf text := null;
  v_paso uuid;
  v_fuera boolean;
begin
  select * into g from public.gastos where id = p_gasto and activo;
  if not found then
    raise exception 'El gasto no existe o está dado de baja.';
  end if;
  if not public.puede_escribir(g.empresa_id) then
    raise exception 'Sin permiso para registrar en esta empresa.';
  end if;
  if p_tipo not in ('Compromiso', 'Factura', 'Pago') then
    raise exception 'Tipo de movimiento inválido: %.', p_tipo;
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser mayor que cero.';
  end if;

  -- Mismo orden de bloqueo en todas las funciones (partida y luego gasto) para no trabarse entre sí.
  if g.partida_id is not null then
    perform 1 from public.partidas where id = g.partida_id for update;
  end if;
  perform 1 from public.gastos where id = g.id for update;

  select
    coalesce(sum(monto) filter (where tipo = 'Compromiso'), 0),
    coalesce(sum(monto) filter (where tipo = 'Factura'), 0),
    coalesce(sum(monto) filter (where tipo = 'Pago'), 0)
  into v_comp, v_fact, v_pag
  from public.gasto_pasos
  where gasto_id = g.id and activo and not reversado;

  if p_tipo = 'Factura' then
    if g.proveedor_id is null then
      if p_proveedor is null then
        raise exception 'La factura requiere el proveedor (el NCF es único por emisor).';
      end if;
      update public.gastos set proveedor_id = p_proveedor where id = g.id;
      g.proveedor_id := p_proveedor;
    elsif p_proveedor is not null and p_proveedor <> g.proveedor_id then
      raise exception 'El gasto ya tiene otro proveedor.';
    end if;

    v_ncf := upper(btrim(p_ncf));
    perform public.validar_ncf(v_ncf);
    -- Serializa por proveedor y NCF: dos facturas iguales en gastos distintos no entran a la vez.
    perform pg_advisory_xact_lock(hashtext(g.proveedor_id::text || '|' || v_ncf));
    if exists (
      select 1 from public.gasto_pasos p join public.gastos g2 on g2.id = p.gasto_id
      where p.ncf = v_ncf and p.tipo = 'Factura' and p.activo and not p.reversado
        and g2.proveedor_id = g.proveedor_id
    ) then
      raise exception 'El NCF % ya está registrado para este proveedor.', v_ncf;
    end if;
    v_aumento := greatest(v_comp, v_fact + p_monto) - greatest(v_comp, v_fact);
  elsif p_tipo = 'Compromiso' then
    -- Facturas y pagos de un año cerrado sí se aceptan (llegan tarde); compromisos nuevos no.
    if exists (
      select 1 from public.partidas pa join public.presupuestos_versiones v on v.id = pa.version_id
      where pa.id = g.partida_id and v.estado = 'Cerrado'
    ) then
      raise exception 'La versión de presupuesto de esa partida está cerrada.';
    end if;
    v_aumento := greatest(v_comp + p_monto, v_fact) - greatest(v_comp, v_fact);
  else
    if v_pag + p_monto > v_fact then
      raise exception 'El pago supera lo facturado; pendiente de pago: %.', v_fact - v_pag;
    end if;
  end if;

  v_fuera := public.verificar_saldo(g.partida_id, v_aumento * g.tasa, p_motivo_fuera);

  insert into public.gasto_pasos (empresa_id, gasto_id, tipo, documento, ncf, fecha, monto, metodo_pago, referencia_bancaria, fuera_presupuesto_motivo)
  values (g.empresa_id, g.id, p_tipo, p_documento, v_ncf, p_fecha, p_monto,
          case when p_tipo = 'Pago' then p_metodo_pago end,
          case when p_tipo = 'Pago' then p_referencia_bancaria end,
          case when v_fuera then btrim(p_motivo_fuera) end)
  returning id into v_paso;
  return v_paso;
end;
$$;

revoke execute on function public.registrar_movimiento(uuid, text, numeric, date, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.registrar_movimiento(uuid, text, numeric, date, text, text, text, text, text, uuid) to authenticated;
