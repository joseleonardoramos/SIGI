#!/bin/sh
# Lo ejecuta la imagen oficial de nginx antes de arrancar (/docker-entrypoint.d).
# Usa el certificado montado en /etc/nginx/ssl; si no hay, genera uno autofirmado para SIGI_DOMINIO
# para que el sistema funcione desde el primer día. Reemplácelo por el de la CA interna cuando esté.
set -eu
DIR=/etc/nginx/ssl
CRT="$DIR/sigi.crt"
KEY="$DIR/sigi.key"
if [ -s "$CRT" ] && [ -s "$KEY" ]; then
  echo "SIGI: usando el certificado de $CRT"
  exit 0
fi
echo "SIGI: no hay certificado en $DIR; se genera uno autofirmado para $SIGI_DOMINIO (825 días)."
mkdir -p "$DIR"
# Configuración propia: certificado de servidor (no de CA), con el nombre en subjectAltName,
# que es lo que validan los navegadores.
CNF=$(mktemp)
cat > "$CNF" <<EOF
[req]
prompt = no
distinguished_name = dn
x509_extensions = ext
[dn]
CN = $SIGI_DOMINIO
O = SIGI
[ext]
subjectAltName = DNS:$SIGI_DOMINIO
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
EOF
openssl req -x509 -nodes -newkey rsa:2048 -days 825 -sha256 -config "$CNF" -keyout "$KEY" -out "$CRT" 2>/dev/null
rm -f "$CNF"
chmod 600 "$KEY"
