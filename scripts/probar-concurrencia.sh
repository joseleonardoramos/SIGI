#!/usr/bin/env bash
# Dos sesiones registran a la vez 600 sobre una partida de 1000. La segunda debe esperar a la primera
# y rechazarse por exceder el disponible. Sin el bloqueo de la partida, las dos pasarían.
# Ejecutar: npm run test:concurrencia   (Supabase local en marcha y un Administrador creado con admin:crear)
# Deja en la base local una empresa de prueba dada de baja: SIGI no borra registros.
set -euo pipefail

DB="${SIGI_DB_CONTAINER:-supabase_db_SIGI}"
psql() { docker exec -i "$DB" psql -U postgres -v ON_ERROR_STOP=1 -tAq "$@"; }

ADMIN=$(psql -c "select m.usuario_id from membresias m where m.rol = 'Administrador' and m.activo limit 1")
[ -n "$ADMIN" ] || { echo "No hay Administrador en la base local (npm run admin:crear)."; exit 1; }
COD="CONC$(date +%s)"

PARTIDA=$(psql <<SQL
with e as (insert into empresas (codigo, nombre, inicio_ejercicio_mes) values ('$COD', 'Prueba de concurrencia', 1) returning id),
     v as (insert into presupuestos_versiones (empresa_id, ejercicio, numero, estado) select id, '2026', 1, 'Vigente' from e returning id, empresa_id)
insert into partidas (empresa_id, version_id, codigo, nombre, categoria, distribucion, monto)
select empresa_id, id, 'P1', 'Prueba', 'Prueba', 'Uniforme', 1000 from v
returning id;
SQL
)
EMPRESA=$(psql -c "select empresa_id from partidas where id = '$PARTIDA'")

registrar() { # $1 = código del gasto, $2 = segundos de espera antes de confirmar
  psql <<SQL
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"$ADMIN","role":"authenticated"}';
select registrar_compromiso('$EMPRESA', '$1', 'Partida', 'Prueba', 600, current_date, p_partida => '$PARTIDA');
select pg_sleep($2);
commit;
SQL
}

registrar G-A 3 > /tmp/sigi_a.log 2>&1 &
PID_A=$!
sleep 1
set +e
SALIDA_B=$(registrar G-B 0 2>&1)
ESTADO_B=$?
wait $PID_A
ESTADO_A=$?
set -e

psql -c "update empresas set activo = false, baja_motivo = 'Prueba de concurrencia terminada' where id = '$EMPRESA'" >/dev/null

[ $ESTADO_A -eq 0 ] || { echo "FALLO: la primera sesión no registró."; cat /tmp/sigi_a.log; exit 1; }
if [ $ESTADO_B -eq 0 ]; then
  echo "FALLO: la segunda sesión también registró; la partida quedó sobregirada sin motivo."
  exit 1
fi
echo "$SALIDA_B" | grep -q "Excede el disponible de la partida (400.00)" || { echo "FALLO: error inesperado: $SALIDA_B"; exit 1; }
echo "Concurrencia: la segunda sesión esperó y se rechazó por exceder el disponible (400.00). Correcto."
