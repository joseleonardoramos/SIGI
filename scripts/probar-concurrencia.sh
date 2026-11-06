#!/usr/bin/env bash
# Dos sesiones registran a la vez 600 sobre una partida de 1000. La segunda debe esperar a la primera
# y rechazarse por exceder el disponible. Sin el bloqueo de la partida, las dos pasarían.
# Ejecutar: npm run test:concurrencia   (Supabase local en marcha)
# Corre en una base temporal (sigi_concurrencia) con el mismo esquema, que se borra al terminar:
# como en SIGI nada se borra, probar en la base real dejaría datos de prueba para siempre.
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash en Windows: no convertir /tmp del contenedor en una ruta de Windows

DB="${SIGI_DB_CONTAINER:-supabase_db_SIGI}"
BASE=sigi_concurrencia
LOG="$(mktemp)"
sql() { docker exec -i "$DB" psql -U supabase_admin -v ON_ERROR_STOP=1 -tAq -d "$@"; }
limpiar() {
  rm -f "$LOG"
  sql postgres -c "drop database if exists $BASE with (force)" >/dev/null 2>&1 || true
}
trap limpiar EXIT

sql postgres -c "drop database if exists $BASE with (force)" -c "create database $BASE" >/dev/null
docker exec "$DB" sh -c "pg_dump -U supabase_admin -Fc --schema-only postgres > /tmp/sigi-conc.dump \
  && pg_restore -U supabase_admin --exit-on-error -d $BASE /tmp/sigi-conc.dump; s=\$?; rm -f /tmp/sigi-conc.dump; exit \$s"

ADMIN=00000000-0000-0000-0000-00000000c0c0
PARTIDA=$(sql "$BASE" <<SQL
insert into auth.users (id, email) values ('$ADMIN', 'concurrencia@prueba.test');
insert into membresias (usuario_id, empresa_id, rol) values ('$ADMIN', null, 'Administrador');
with e as (insert into empresas (codigo, nombre, inicio_ejercicio_mes) values ('CONC', 'Prueba de concurrencia', 1) returning id),
     v as (insert into presupuestos_versiones (empresa_id, ejercicio, numero, estado) select id, '2026', 1, 'Vigente' from e returning id, empresa_id)
insert into partidas (empresa_id, version_id, codigo, nombre, categoria, distribucion, monto)
select empresa_id, id, 'P1', 'Prueba', 'Prueba', 'Uniforme', 1000 from v
returning id;
SQL
)
EMPRESA=$(sql "$BASE" -c "select empresa_id from partidas where id = '$PARTIDA'")

registrar() { # $1 = código del gasto, $2 = segundos de espera antes de confirmar
  sql "$BASE" <<SQL
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"$ADMIN","role":"authenticated"}';
select registrar_compromiso('$EMPRESA', '$1', 'Partida', 'Prueba', 600, current_date, p_partida => '$PARTIDA');
select pg_sleep($2);
commit;
SQL
}

registrar G-A 3 > "$LOG" 2>&1 &
PID_A=$!
sleep 1
set +e
SALIDA_B=$(registrar G-B 0 2>&1)
ESTADO_B=$?
wait $PID_A
ESTADO_A=$?
set -e

[ $ESTADO_A -eq 0 ] || { echo "FALLO: la primera sesión no registró."; cat "$LOG"; exit 1; }
if [ $ESTADO_B -eq 0 ]; then
  echo "FALLO: la segunda sesión también registró; la partida quedó sobregirada sin motivo."
  exit 1
fi
echo "$SALIDA_B" | grep -q "Excede el disponible de la partida (400.00)" || { echo "FALLO: error inesperado: $SALIDA_B"; exit 1; }
echo "Concurrencia: la segunda sesión esperó y se rechazó por exceder el disponible (400.00). Correcto."
