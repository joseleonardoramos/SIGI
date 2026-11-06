-- Ajustes de la auditoría.

-- La pantalla Bitácora pide los últimos cambios de una empresa por fecha; la bitácora crece con
-- cada alta y edición, así que sin este índice la consulta recorrería la tabla entera.
create index bitacora_por_empresa on bitacora (empresa_id, ocurrido_en desc);

-- Una ausencia dada de baja (activo = false) tampoco debe ocupar sus fechas, igual que una cancelada.
alter table ausencias drop constraint ausencias_persona_id_daterange_excl;
alter table ausencias add constraint ausencias_persona_id_daterange_excl
  exclude using gist (persona_id with =, daterange(desde, hasta, '[]') with &&) where (not cancelada and activo);
