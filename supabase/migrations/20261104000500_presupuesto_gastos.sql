-- Motor de presupuesto y gastos (fase 3).
-- Los gastos solo se registran con las funciones de abajo: bloquean la partida, validan el saldo y el NCF
-- y nunca borran. Un monto que supera el disponible se acepta solo con motivo (fuera de presupuesto).

-- ---------------------------------------------------------------------------
-- Tasas de cambio versionadas: cada cambio es una fila nueva con fecha de vigencia.
-- ---------------------------------------------------------------------------
create table tasas_cambio (
  id uuid primary key default gen_random_uuid(),
  moneda text not null check (moneda = 'US$'),
  vigente_desde date not null,
  tasa numeric(14, 4) not null check (tasa > 0), -- RD$ por cada US$
  fuente text not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  baja_en timestamptz,
  baja_por uuid,
  baja_motivo text,
  unique (moneda, vigente_desde)
);
alter table tasas_cambio enable row level security;
create trigger a_control before insert or update on tasas_cambio for each row execute function public.trg_control();
create trigger z_bitacora after insert or update on tasas_cambio for each row execute function public.trg_bitacora();
create trigger sin_borrado before delete on tasas_cambio for each row execute function public.trg_sin_borrado();
create trigger sin_vaciar before truncate on tasas_cambio for each statement execute function public.trg_sin_borrado();
create policy tasas_leer on tasas_cambio for select to authenticated using (public.tiene_acceso());
create policy tasas_crear on tasas_cambio for insert to authenticated with check (public.es_admin());
create policy tasas_editar on tasas_cambio for update to authenticated using (public.es_admin()) with check (public.es_admin());
revoke all on tasas_cambio from anon;
revoke delete, truncate on tasas_cambio from authenticated;

-- ---------------------------------------------------------------------------
-- Ajustes a gastos y movimientos.
-- ---------------------------------------------------------------------------
-- tasa del gasto: multiplicador de su moneda a la moneda de reporte de la empresa, fijado al comprometer.
alter table gastos alter column tasa type numeric(20, 10);
comment on column gastos.tasa is 'Multiplicador de la moneda del gasto a la moneda de reporte, fijado al comprometer.';

alter table gasto_pasos drop constraint gasto_pasos_tipo_check;
alter table gasto_pasos add constraint gasto_pasos_tipo_check check (tipo in ('Compromiso', 'Factura', 'Pago', 'Evidencia', 'Reverso'));
alter table gasto_pasos
  add column fuera_presupuesto_motivo text,
  add column nota text,
  add column reversado boolean not null default false,
  add column reversa_id uuid references gasto_pasos (id);
create unique index gasto_pasos_un_reverso on gasto_pasos (reversa_id) where reversa_id is not null;
-- El saldo de una partida se calcula en cada registro: estos índices lo mantienen rápido con volumen.
create index gastos_por_partida on gastos (partida_id) where activo;
create index gasto_pasos_vigentes on gasto_pasos (gasto_id) where activo and not reversado;

-- Nadie escribe gastos ni movimientos directo: solo con las funciones (que validan saldo y NCF).
-- Se permite editar los datos descriptivos del gasto y las bajas del Administrador (trg_control lo exige).
revoke insert, update on gastos, gasto_pasos from authenticated;
grant update (descripcion, referencia, cuenta_contable, renueva_hasta, activo, baja_motivo) on gastos to authenticated;
grant update (activo, baja_motivo) on gasto_pasos to authenticated;

-- ---------------------------------------------------------------------------
-- Saldo por partida, en la moneda de reporte.
-- Consumo de un gasto = el mayor entre lo comprometido y lo facturado (una factura sin orden también consume).
-- ---------------------------------------------------------------------------
create view saldo_partidas with (security_invoker = true) as
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
  -- partida_id en el agrupado deja filtrar por partida antes de sumar (la vista se consulta en cada registro).
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
  round(pa.monto - coalesce(sum(greatest(pg.comprometido, pg.facturado) * pg.tasa), 0), 2) as disponible
from partidas pa
left join por_gasto pg on pg.partida_id = pa.id
where pa.activo
group by pa.id;

-- ---------------------------------------------------------------------------
-- Funciones internas (no se exponen al cliente).
-- ---------------------------------------------------------------------------
create function public.tasa_vigente(p_moneda text, p_fecha date) returns numeric
language sql stable set search_path = ''
as $$
  select case when p_moneda = 'RD$' then 1::numeric else (
    select t.tasa from public.tasas_cambio t
    where t.moneda = p_moneda and t.vigente_desde <= p_fecha and t.activo
    order by t.vigente_desde desc
    limit 1
  ) end;
$$;

-- Comprueba que un aumento de consumo (en moneda de reporte) cabe en la partida, o que trae motivo.
-- Devuelve true si el monto queda fuera de presupuesto (solo entonces se guarda el motivo).
-- Quien llama debe haber bloqueado la partida antes (select ... for update).
create function public.verificar_saldo(p_partida uuid, p_aumento numeric, p_motivo text) returns boolean
language plpgsql set search_path = ''
as $$
declare
  v_disponible numeric;
  v_con_motivo boolean := coalesce(btrim(p_motivo), '') <> '';
begin
  if p_aumento <= 0 then
    return false;
  end if;
  if p_partida is null then
    if not v_con_motivo then
      raise exception 'Un gasto sin partida es fuera de presupuesto: indique el motivo.';
    end if;
    return true;
  end if;
  select s.disponible into v_disponible from public.saldo_partidas s where s.partida_id = p_partida;
  -- La vista omite las partidas dadas de baja; sin esto el control se saltaría en silencio.
  if v_disponible is null then
    raise exception 'La partida está dada de baja: no acepta montos nuevos.';
  end if;
  if p_aumento <= v_disponible then
    return false;
  end if;
  if not v_con_motivo then
    raise exception 'Excede el disponible de la partida (%). Indique el motivo para registrarlo fuera de presupuesto.', v_disponible;
  end if;
  return true;
end;
$$;

-- NCF (B + tipo + 8 dígitos) o e-CF (E + tipo + 10 dígitos) de facturas de compra o gasto.
-- Las notas de crédito y débito no se registran como factura: las correcciones se hacen con reversar_movimiento.
create function public.validar_ncf(p_ncf text) returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if p_ncf is null or btrim(p_ncf) = '' then
    raise exception 'La factura requiere NCF o e-CF.';
  end if;
  if p_ncf !~ '^(B(01|02|11|13|14|15|16|17)[0-9]{8}|E(31|32|41|43|44|45|46|47)[0-9]{10})$' then
    raise exception 'NCF o e-CF inválido: %. Ejemplos: B0100000001 o E310000000001.', p_ncf;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Funciones de registro. SECURITY DEFINER: escriben aunque el cliente no pueda hacerlo directo,
-- pero verifican el permiso de la empresa con puede_escribir.
-- ---------------------------------------------------------------------------

-- Crea el gasto con su compromiso (orden, contrato o reserva).
create function public.registrar_compromiso(
  p_empresa uuid,
  p_codigo text,
  p_origen text,
  p_descripcion text,
  p_monto numeric,
  p_fecha date,
  p_moneda text default 'RD$',
  p_partida uuid default null,
  p_proveedor uuid default null,
  p_cuenta_proveedor uuid default null,
  p_documento text default null,
  p_motivo_fuera text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_gasto uuid;
  v_reporte text;
  v_factor numeric;
  v_estado text;
  v_fuera boolean;
begin
  if not public.puede_escribir(p_empresa) then
    raise exception 'Sin permiso para registrar en esta empresa.';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser mayor que cero.';
  end if;

  select e.moneda_reporte into v_reporte from public.empresas e where e.id = p_empresa;
  v_factor := public.tasa_vigente(p_moneda, p_fecha) / public.tasa_vigente(v_reporte, p_fecha);
  if v_factor is null then
    raise exception 'No hay tasa de cambio US$ vigente al %.', p_fecha;
  end if;

  if p_partida is not null then
    -- Bloquea la partida hasta el final de la transacción: otro registro sobre ella espera.
    select v.estado into v_estado
    from public.partidas pa
    join public.presupuestos_versiones v on v.id = pa.version_id
    where pa.id = p_partida and pa.empresa_id = p_empresa and pa.activo
    for update of pa;
    if not found then
      raise exception 'La partida no existe, no es de esta empresa o está dada de baja.';
    end if;
    if v_estado = 'Cerrado' then
      raise exception 'La versión de presupuesto de esa partida está cerrada.';
    end if;
  end if;

  v_fuera := public.verificar_saldo(p_partida, p_monto * v_factor, p_motivo_fuera);

  insert into public.gastos (empresa_id, codigo, origen, descripcion, proveedor_id, cuenta_proveedor_id, partida_id, moneda, tasa)
  values (p_empresa, btrim(p_codigo), p_origen, btrim(p_descripcion), p_proveedor, p_cuenta_proveedor, p_partida, p_moneda, v_factor)
  returning id into v_gasto;

  insert into public.gasto_pasos (empresa_id, gasto_id, tipo, documento, fecha, monto, fuera_presupuesto_motivo)
  values (p_empresa, v_gasto, 'Compromiso', p_documento, p_fecha, p_monto, case when v_fuera then btrim(p_motivo_fuera) end);

  return v_gasto;
end;
$$;

-- Agrega un movimiento a un gasto existente: más compromiso, una factura o un pago.
create function public.registrar_movimiento(
  p_gasto uuid,
  p_tipo text,
  p_monto numeric,
  p_fecha date,
  p_documento text default null,
  p_ncf text default null,
  p_metodo_pago text default null,
  p_referencia_bancaria text default null,
  p_motivo_fuera text default null
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
    v_ncf := upper(btrim(p_ncf));
    perform public.validar_ncf(v_ncf);
    -- Serializa por proveedor y NCF: dos facturas iguales en gastos distintos no entran a la vez.
    perform pg_advisory_xact_lock(hashtext(coalesce(g.proveedor_id::text, '') || '|' || v_ncf));
    if exists (
      select 1 from public.gasto_pasos p join public.gastos g2 on g2.id = p.gasto_id
      where p.ncf = v_ncf and p.tipo = 'Factura' and p.activo and not p.reversado
        and g2.proveedor_id is not distinct from g.proveedor_id
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

-- Corrige un movimiento sin borrarlo: lo marca reversado y agrega un movimiento "Reverso" con el motivo.
create function public.reversar_movimiento(p_paso uuid, p_motivo text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  p public.gasto_pasos%rowtype;
  v_partida uuid;
  v_fact numeric;
  v_pag numeric;
  v_reverso uuid;
begin
  select * into p from public.gasto_pasos where id = p_paso and activo;
  if not found then
    raise exception 'El movimiento no existe o está dado de baja.';
  end if;
  if not public.puede_escribir(p.empresa_id) then
    raise exception 'Sin permiso para registrar en esta empresa.';
  end if;
  if p.tipo not in ('Compromiso', 'Factura', 'Pago') then
    raise exception 'Solo se reversan compromisos, facturas y pagos.';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'El reverso requiere un motivo.';
  end if;

  select partida_id into v_partida from public.gastos where id = p.gasto_id;
  if v_partida is not null then
    perform 1 from public.partidas where id = v_partida for update;
  end if;
  perform 1 from public.gastos where id = p.gasto_id for update;

  -- Se relee con el bloqueo puesto: otro reverso pudo terminar mientras esperábamos.
  if (select reversado from public.gasto_pasos where id = p_paso) then
    raise exception 'Ese movimiento ya fue reversado.';
  end if;

  if p.tipo = 'Factura' then
    select
      coalesce(sum(monto) filter (where tipo = 'Factura'), 0),
      coalesce(sum(monto) filter (where tipo = 'Pago'), 0)
    into v_fact, v_pag
    from public.gasto_pasos
    where gasto_id = p.gasto_id and activo and not reversado;
    if v_pag > v_fact - p.monto then
      raise exception 'Primero reverse los pagos: lo pagado quedaría por encima de lo facturado.';
    end if;
  end if;

  update public.gasto_pasos set reversado = true where id = p_paso;
  insert into public.gasto_pasos (empresa_id, gasto_id, tipo, fecha, monto, nota, reversa_id)
  values (p.empresa_id, p.gasto_id, 'Reverso', current_date, p.monto, btrim(p_motivo), p_paso)
  returning id into v_reverso;
  return v_reverso;
end;
$$;

revoke execute on function public.tasa_vigente(text, date) from public, anon, authenticated;
revoke execute on function public.verificar_saldo(uuid, numeric, text) from public, anon, authenticated;
revoke execute on function public.validar_ncf(text) from public, anon, authenticated;
revoke execute on function public.registrar_compromiso(uuid, text, text, text, numeric, date, text, uuid, uuid, uuid, text, text) from public, anon;
revoke execute on function public.registrar_movimiento(uuid, text, numeric, date, text, text, text, text, text) from public, anon;
revoke execute on function public.reversar_movimiento(uuid, text) from public, anon;
grant execute on function public.registrar_compromiso(uuid, text, text, text, numeric, date, text, uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.registrar_movimiento(uuid, text, numeric, date, text, text, text, text, text) to authenticated;
grant execute on function public.reversar_movimiento(uuid, text) to authenticated;
