#!/usr/bin/env bash
# Prueba de respaldo: respalda ahora, restaura en una base aparte (sigi_restauracion) y compara.
# Ejecutar: npm run test:respaldo
# Comprueba: huellas de los archivos, restauración sin errores, mismos conteos en todas las tablas
# (más usuarios y fichas de archivos) y que cada evidencia registrada esté en el respaldo de archivos.
# La base real no se toca. El respaldo de prueba y la base de prueba se eliminan al terminar,
# también si la prueba falla.
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash en Windows: no convertir /tmp del contenedor en una ruta de Windows

DB="${SIGI_DB_CONTAINER:-supabase_db_SIGI}"
DIR="$(mktemp -d)"
sql() { docker exec -i "$DB" psql -U supabase_admin -v ON_ERROR_STOP=1 -tAq -d "$@"; }
limpiar() {
  rm -rf "$DIR"
  docker exec "$DB" rm -f /tmp/sigi-restauracion.dump || true
  sql postgres -c "drop database if exists sigi_restauracion" >/dev/null 2>&1 || true
}
trap limpiar EXIT

bash "$(dirname "$0")/respaldar.sh" "$DIR" >/dev/null
(cd "$DIR" && sha256sum --quiet -c sha256.txt)

# Docker de Windows no entiende las rutas de Git Bash (/tmp/...): se convierten si hay cygpath.
DUMP="$DIR/base.dump"
command -v cygpath >/dev/null && DUMP="$(cygpath -w "$DUMP")"
docker cp "$DUMP" "$DB:/tmp/sigi-restauracion.dump"
sql postgres -c "drop database if exists sigi_restauracion" -c "create database sigi_restauracion"
docker exec "$DB" pg_restore -U supabase_admin --exit-on-error -d sigi_restauracion /tmp/sigi-restauracion.dump

CONTEO="
select string_agg(t || '=' || n, ' ' order by t) from (
  select 'public.' || table_name as t,
         (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', table_name), false, true, '')))[1]::text as n
  from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'
  union all select 'auth.users', count(*)::text from auth.users
  union all select 'storage.objects', count(*)::text from storage.objects
) x"
ORIGINAL=$(sql postgres -c "$CONTEO")
RESTAURADA=$(sql sigi_restauracion -c "$CONTEO")
# Recuperación real: restaurar encima de una base que ya tiene datos. Solo lo de SIGI (datos, usuarios y
# fichas de archivos): los esquemas internos de Supabase (realtime) no admiten --clean y se regeneran solos.
docker exec "$DB" pg_restore -U supabase_admin --clean --if-exists --exit-on-error -n public -n auth -n storage -d sigi_restauracion /tmp/sigi-restauracion.dump
ENCIMA=$(sql sigi_restauracion -c "$CONTEO")
OBJETOS=$(sql postgres -c "select bucket_id || '/' || name from storage.objects")

if [ "$ORIGINAL" != "$RESTAURADA" ] || [ "$ORIGINAL" != "$ENCIMA" ]; then
  echo "FALLO: la base restaurada no coincide."
  echo "  original:          $ORIGINAL"
  echo "  restaurada:        $RESTAURADA"
  echo "  restaurada encima: $ENCIMA"
  exit 1
fi

ARCHIVOS=$(tar -tf "$DIR/evidencias.tar")
FALTAN=0
while IFS= read -r obj; do
  [ -z "$obj" ] && continue
  grep -qF "$obj" <<<"$ARCHIVOS" || { echo "FALTA en el respaldo de archivos: $obj"; FALTAN=1; }
done <<<"$OBJETOS"
[ $FALTAN -eq 0 ] || exit 1

echo "Respaldo verificado: restauración (nueva y encima de datos) sin errores, conteos iguales y $(grep -c . <<<"$OBJETOS" || true) evidencia(s) presentes."
echo "  $RESTAURADA"
