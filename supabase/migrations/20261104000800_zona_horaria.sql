-- La operación es en República Dominicana: current_date (reversos, fechas por defecto, tasa vigente)
-- debe ser el día local, no el de UTC, que de noche ya es el día siguiente.
-- Las marcas de tiempo (timestamptz) no cambian; solo cómo se calcula «hoy».
alter database postgres set timezone to 'America/Santo_Domingo';
