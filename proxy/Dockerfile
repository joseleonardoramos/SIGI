# Proxy de entrada de SIGI: un solo nombre (SIGI_DOMINIO) por HTTPS.
#   /                                     → frontend de SIGI (servicio web)
#   /auth|rest|storage|functions|realtime/v1/ → pasarela de Supabase (api-gw)
# El certificado NO va en la imagen: se monta en /etc/nginx/ssl (sigi.crt y sigi.key).
# Si falta, al arrancar se genera uno autofirmado para SIGI_DOMINIO (ver 25-sigi-certificado.sh).
FROM nginx:1.29-alpine
RUN apk add --no-cache openssl
COPY sigi.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 25-sigi-certificado.sh /docker-entrypoint.d/25-sigi-certificado.sh
ENV SIGI_DOMINIO=sigi.elcatador.local \
    SIGI_WEB_UPSTREAM=web:80 \
    SIGI_API_UPSTREAM=api-gw:8000
EXPOSE 80 443
