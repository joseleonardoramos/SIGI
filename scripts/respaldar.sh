#!/usr/bin/env bash
# Respaldo completo de SIGI en Docker local: la base entera (datos, usuarios, historial y permisos)
# y los archivos de evidencias. Ejecutar: npm run respaldar  [carpeta destino opcional]
#
# Se respalda la base completa con supabase_admin, no solo los datos: recargar datos sobre una base
# nueva dispararía los triggers y cambiaría autores, fechas y bitácora. Así se restaura tal cual.
# No se guardan sesiones ni tokens de acceso: con ellos, quien tenga el respaldo entraría como otro
# usuario. Al restaurar, cada usuario vuelve a iniciar sesión.
# No hay destino por defecto: usted elige dónde se guarda, cada vez (npm run respaldar -- <carpeta>)
# o una vez con la variable SIGI_RESPALDOS (se crea una subcarpeta con la fecha).
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash en Windows: no convertir /mnt ni /tmp del contenedor en rutas de Windows

# Desarrollo (supabase start): valores por defecto. Producción (Supabase autoalojado): ver docs/PaseProduccion.md
# (SIGI_DB_CONTAINER=supabase-db SIGI_STORAGE_CONTAINER=supabase-storage SIGI_STORAGE_DIR=/var/lib/storage).
DB="${SIGI_DB_CONTAINER:-supabase_db_SIGI}"
ST="${SIGI_STORAGE_CONTAINER:-supabase_storage_SIGI}"
ST_DIR="${SIGI_STORAGE_DIR:-/mnt}" # carpeta de los archivos dentro del contenedor de Storage
if [ -n "${1:-}" ]; then
  DESTINO="$1"
elif [ -n "${SIGI_RESPALDOS:-}" ]; then
  DESTINO="$SIGI_RESPALDOS/$(date +%Y%m%d-%H%M%S)"
else
  echo "Indique dónde guardar el respaldo: npm run respaldar -- <carpeta>  (o defina SIGI_RESPALDOS)."
  echo "No se guardó nada."
  exit 1
fi
mkdir -p "$DESTINO"

docker exec "$DB" pg_dump -U supabase_admin -Fc \
  --exclude-table-data=auth.refresh_tokens --exclude-table-data=auth.sessions --exclude-table-data=auth.one_time_tokens \
  --exclude-table-data=auth.mfa_amr_claims \
  postgres > "$DESTINO/base.dump"
docker exec "$ST" tar -C "$ST_DIR" -cf - . > "$DESTINO/evidencias.tar"
(cd "$DESTINO" && sha256sum base.dump evidencias.tar > sha256.txt)

echo "Respaldo listo en $DESTINO:"
ls -la "$DESTINO"
