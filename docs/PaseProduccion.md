# SIGI · Documento de pase a producción

Sistema Integral de Gestión de Infraestructura (El Catador · Bona).
Destino: **servidor propio con Docker** (fase 1) y luego **Docker Swarm** (fase 2). **Nada en la nube.**

| Dato | Valor |
|---|---|
| Versión de SIGI | rama `main` del repositorio, a partir del commit `0a5b4ff` (anotar el commit exacto el día del pase) |
| Repositorio | https://github.com/joseleonardoramos/SIGI |
| Base de datos | Supabase autoalojado: PostgreSQL 17 (`supabase/postgres:17.6.1.136`) |
| Plantilla de Supabase | `self-hosted/v0.8.4` del repositorio `supabase/supabase` (versiones de imágenes en la sección 3.2) |
| Frontend | React + Vite compilado y servido por `nginx:1.29-alpine` |
| Zona horaria de negocio | `America/Santo_Domingo` (la fija la migración `20261104000800_zona_horaria.sql`) |
| Documento redactado | 11 nov 2026 |

> Cómo leer este documento: cada paso dice **quién**, **qué comando** y **cómo comprobar** que salió bien. Los valores entre `<ángulos>` se reemplazan. Lo marcado **VERIFICAR** no se pudo probar en el entorno de desarrollo y debe comprobarse en el servidor antes del día del pase.

---

## Índice

1. Alcance y decisiones
2. Arquitectura de producción
3. Qué cambia respecto de desarrollo
4. Requisitos (servidor, red, DNS, certificados, personas)
5. Preparación del servidor
6. Instalación de Supabase autoalojado
7. Secretos y variables
8. Ajustes de SIGI sobre Supabase (archivo `docker-compose.sigi.yml`)
9. Arranque y verificación de Supabase
10. Migraciones de la base de SIGI
11. Función `usuarios`
12. Frontend (imagen, variables, contenedor)
13. Proxy inverso HTTPS
14. Puesta en marcha funcional (primer Administrador, empresas, catálogos)
15. Pruebas de humo (aceptación técnica)
16. Respaldos y recuperación
17. Operación diaria y mantenimiento
18. Seguridad (lista de control)
19. Plan de vuelta atrás (rollback)
20. Fase 2: Docker Swarm
21. Plan del día del pase y criterios de salida
22. Riesgos conocidos y pendientes
23. Anexos (variables, comandos, archivos)

---

## 1. Alcance y decisiones

**Incluye**: base de datos con todas las reglas (RLS, bitácora, bajas lógicas), autenticación, almacenamiento de evidencias, la función `usuarios`, el frontend y los respaldos.

**Decisiones ya tomadas por el usuario** (no cambiar sin aprobación):

- **Todo local**: no se usa Supabase Cloud ni ningún servicio en la nube. Ni `supabase link`, ni `db push` a un proyecto remoto, ni `functions deploy`.
- **Nada se borra**: las bajas son lógicas (`activo = false` con motivo) y todo cambio queda en la bitácora. No ejecutar `db reset`, `reset.sh` ni `docker compose down -v` sobre la instalación con datos.
- **Respaldos**: el destino lo elige el usuario cada vez. No hay carpeta por defecto. Contienen datos personales: van a un lugar que el responsable controle.
- **Inicio de sesión**: usuario y contraseña (mínimo 12 caracteres, con letras y números). El inicio con Microsoft queda para después.
- **Registro libre desactivado**: solo el Administrador crea usuarios.

**No incluye**: correo saliente (no hay recuperación de contraseña por correo, ver 17.6), MFA, inicio con Microsoft ni monitoreo centralizado de registros.

---

## 2. Arquitectura de producción

```
Usuarios (navegador, red interna o VPN)
        │  HTTPS 443
        ▼
┌──────────────────────────────── Servidor SIGI (Linux) ────────────────────────────────┐
│  Proxy inverso nginx (TLS)                                                             │
│    sigi.<dominio>      ──► 127.0.0.1:8080  Contenedor web SIGI (nginx + app compilada) │
│    api.sigi.<dominio>  ──► 127.0.0.1:8000  Pasarela de Supabase (Envoy, "api-gw")      │
│                                              │                                         │
│              ┌───────────────┬───────────────┼───────────────┬──────────────┐          │
│              ▼               ▼               ▼               ▼              ▼          │
│          auth (GoTrue)  rest (PostgREST)  storage-api   functions (edge)  realtime     │
│              │               │               │  └─ imgproxy    │                     │
│              └───────────────┴───────┬───────┴─────────────────┘                     │
│                                      ▼                                                │
│                         db (PostgreSQL 17)  ◄── supavisor (pooler, solo 127.0.0.1)    │
│                                                                                       │
│  Volúmenes en disco:  volumes/db/data (base)   volumes/storage (evidencias)           │
│  Studio (administración de la base): sin publicar; acceso solo por túnel SSH          │
└───────────────────────────────────────────────────────────────────────────────────────┘
        │
        ▼  respaldo (base.dump + evidencias.tar + sha256.txt) a un destino elegido por el usuario
```

- El navegador habla con **dos nombres**: `sigi.<dominio>` (la aplicación) y `api.sigi.<dominio>` (Supabase). La URL de la API queda **fija dentro del frontend al compilar**.
- Solo el proxy publica puertos al exterior (80 y 443). La pasarela (8000), la web (8080) y el pooler (5432/6543) escuchan **solo en 127.0.0.1**.
- SIGI **no usa Realtime**. Se deja encendido para no apartarse de la plantilla oficial; se puede quitar (sección 8.4).

---

## 3. Qué cambia respecto de desarrollo

| Tema | Desarrollo (hoy) | Producción |
|---|---|---|
| Cómo se levanta Supabase | `npm run db:start` (`supabase start`, CLI de desarrollo) | Plantilla oficial autoalojada (`docker compose` / `sh run.sh start`) |
| Pasarela | Kong de la CLI en `127.0.0.1:54321` | Envoy (`api-gw`) en `127.0.0.1:8000`, detrás del proxy HTTPS |
| Clave del frontend | `sb_publishable_…` de `supabase status` | `SUPABASE_PUBLISHABLE_KEY` (o `ANON_KEY`) generada en el servidor |
| Configuración de autenticación | `supabase/config.toml` | Variables de entorno de GoTrue (`.env` + `docker-compose.sigi.yml`) |
| Contenedores | `supabase_db_SIGI`, `supabase_storage_SIGI` | `supabase-db`, `supabase-storage` (Docker) · `sigi_db…` (Swarm) |
| Archivos de evidencias | `/mnt` dentro de Storage | `/var/lib/storage` dentro de Storage = `volumes/storage` en el disco |
| Migraciones | Se aplican solas al crear la base | Se aplican a mano con `supabase migration up --db-url` **después** de arrancar |
| Función `usuarios` | La sirve la CLI desde `supabase/functions` | Se copia a `volumes/functions/usuarios/` |
| Correo | Inbucket local (de prueba) | Ninguno (SMTP ficticio): no se envían correos |

> `supabase/config.toml` **no se usa en producción**. Todo lo que allí se fijó (registro desactivado, contraseña de 12 con letras y números, URL del sitio, rotación de sesiones) se repite en variables de entorno en las secciones 7 y 8.

---

## 4. Requisitos

### 4.1 Servidor

| Recurso | Mínimo | Recomendado para SIGI |
|---|---|---|
| Sistema | Linux x86_64 | **Ubuntu Server 24.04 LTS** |
| CPU | 2 núcleos | 4 núcleos |
| RAM | 4 GB | 8 GB (la plantilla limita las funciones a 2 GB) |
| Disco | 40 GB SSD | 80 GB SSD para sistema + datos; **disco aparte** o recurso de red para respaldos |
| Docker | Engine 24+ con Compose v2.24+ (necesario para `!override`) | Versión estable más reciente |

Carga esperada: decenas de usuarios internos, cientos de miles de filas como máximo. Un servidor basta. Swarm (sección 20) aporta reinicio automático y despliegues ordenados, no capacidad.

### 4.2 Red y DNS

| Nombre | Apunta a | Uso |
|---|---|---|
| `sigi.<dominio>` | IP del servidor | Aplicación |
| `api.sigi.<dominio>` | IP del servidor | Supabase (lo llama el navegador) |

Puertos:

| Puerto | Desde | Para |
|---|---|---|
| 443/tcp | Red de usuarios | HTTPS (aplicación y API) |
| 80/tcp | Red de usuarios | Solo redirección a 443 (y validación del certificado si se usa Let's Encrypt) |
| 22/tcp | Solo equipos de administración | SSH (también para túneles a Studio) |
| 2377/tcp, 7946/tcp+udp, 4789/udp | Solo entre nodos del Swarm | Fase 2 |

**Salida a internet necesaria** (al instalar y al actualizar): Docker Hub (imágenes), GitHub (plantilla de Supabase y repositorio de SIGI), `registry.npmjs.org` (la función `usuarios` descarga `@supabase/supabase-js` la primera vez que se ejecuta y la guarda en el volumen `deno-cache`). Si el servidor no tiene salida, ver 22.4.

### 4.3 Certificados

- Interno: certificado de la CA de la empresa para `sigi.<dominio>` y `api.sigi.<dominio>` (o un comodín). Los navegadores de los usuarios deben confiar en esa CA.
- Si los nombres son públicos: Let's Encrypt con `certbot` (necesita el puerto 80 abierto desde internet durante la validación).

### 4.4 Personas y responsabilidades

| Rol | Responsable | Tareas |
|---|---|---|
| Responsable del pase | `<nombre>` | Aprueba el inicio, la salida y la vuelta atrás |
| Infraestructura | `<nombre>` | Servidor, DNS, certificados, firewall, Docker |
| Aplicación | `<nombre>` | Secciones 6 a 15 |
| Administrador de SIGI | `<nombre>` (el Gerente) | Primer usuario Administrador, empresas, usuarios y roles |
| Datos | `<nombre>` | Carga inicial de catálogos (sección 14) |
| Respaldos | `<nombre>` | Elige el destino y verifica la restauración (sección 16) |

---

## 5. Preparación del servidor

Ejecutar como usuario con `sudo`.

```bash
# 5.1 Sistema al día, hora sincronizada y zona horaria (los registros del sistema; la base usa la suya)
sudo apt update && sudo apt -y full-upgrade
sudo timedatectl set-timezone America/Santo_Domingo
timedatectl status            # "System clock synchronized: yes"

# 5.2 Docker Engine desde el repositorio oficial de Docker
sudo apt -y install ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update && sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker --version && docker compose version     # Compose v2.24 o superior

# 5.3 Usuario de servicio y carpetas
sudo useradd -m -s /bin/bash sigi
sudo usermod -aG docker sigi
sudo mkdir -p /opt/sigi && sudo chown sigi:sigi /opt/sigi

# 5.4 Node.js 24 (para la CLI de Supabase al aplicar migraciones y para crear el primer Administrador)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt -y install nodejs && node --version

# 5.5 Firewall
sudo ufw default deny incoming
sudo ufw allow from <red-admin>/<prefijo> to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable && sudo ufw status verbose
```

> **Docker y ufw**: los puertos que Docker publica en `0.0.0.0` **saltan** las reglas de ufw. Por eso en este documento todo puerto interno se publica en `127.0.0.1:` explícitamente (sección 8). Compruébelo después con `sudo ss -tlnp` (sección 9.3).

```bash
# 5.6 Código de SIGI (como usuario sigi)
sudo -iu sigi
cd /opt/sigi
git clone https://github.com/joseleonardoramos/SIGI.git app
cd app && git log --oneline -1      # anotar el commit que se instala
```

> **Fin de línea**: el repositorio se edita en Windows. En el servidor, los scripts deben tener fin de línea LF. Si un script falla con `$'\r': command not found`, ejecutar `git config core.autocrlf input && git rm --cached -r . -q && git reset --hard`.

---

## 6. Instalación de Supabase autoalojado

Se usa la **instalación manual con versión fija** de la guía oficial (https://supabase.com/docs/guides/self-hosting/docker), para controlar cada archivo.

```bash
cd /opt/sigi
git clone --depth 1 --branch self-hosted/v0.8.4 https://github.com/supabase/supabase supabase-src
mkdir supabase
cp -rf supabase-src/docker/. supabase/
cd supabase
cp .env.example .env
chmod 600 .env
printf 'ref=self-hosted/v0.8.4\n' > .supabase-version
docker compose pull
```

Resultado: `/opt/sigi/supabase` contiene `docker-compose.yml`, `.env`, `run.sh`, `utils/` y `volumes/` (configuración de la pasarela, scripts iniciales de la base, carpeta de funciones con su enrutador `main`).

> Alternativa: el instalador rápido `curl -fsSL https://supabase.link/setup.sh | sh` hace lo mismo y además pide las URL y genera los secretos. Si se usa, revise igualmente la sección 7 valor por valor.

---

## 7. Secretos y variables

### 7.1 Generar secretos

```bash
cd /opt/sigi/supabase
sh utils/generate-keys.sh          # JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY y demás secretos en .env
sh utils/add-new-auth-keys.sh      # SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, JWT_KEYS, JWT_JWKS
```

Después, revisar `.env` a mano. **Ningún valor de ejemplo puede quedar** (la guía oficial lo marca como peligro). Los que el script no genere se crean así:

| Variable | Regla | Comando |
|---|---|---|
| `POSTGRES_PASSWORD` | Larga, **solo letras y números** (evita problemas en URL) | `openssl rand -hex 24` |
| `SECRET_KEY_BASE` | ≥ 64 caracteres | `openssl rand -base64 48` |
| `REALTIME_DB_ENC_KEY` | Exactamente 16 caracteres | `openssl rand -hex 8` |
| `VAULT_ENC_KEY` | Exactamente 32 caracteres | `openssl rand -hex 16` |
| `PG_META_CRYPTO_KEY` | ≥ 32 caracteres | `openssl rand -base64 24` |
| `LOGFLARE_PUBLIC_ACCESS_TOKEN` / `LOGFLARE_PRIVATE_ACCESS_TOKEN` | ≥ 32 caracteres | `openssl rand -base64 24` |
| `S3_PROTOCOL_ACCESS_KEY_ID` | — | `openssl rand -hex 16` |
| `S3_PROTOCOL_ACCESS_KEY_SECRET` | — | `openssl rand -hex 32` |
| `MINIO_ROOT_PASSWORD` | ≥ 8 (no se usa MinIO, pero no dejar el ejemplo) | `openssl rand -hex 16` |
| `DASHBOARD_PASSWORD` | Con al menos una letra; sin caracteres especiales | `openssl rand -hex 16` |
| `POOLER_TENANT_ID` | Identificador del inquilino del pooler | `sigi` |

**Dónde guardar los secretos**: el archivo `.env` queda solo en el servidor (`chmod 600`, dueño `sigi`). Copia cifrada en el gestor de contraseñas de la empresa o en un sobre sellado, según la política. **Nunca** en el repositorio, en correo ni en chat.

### 7.2 Valores para SIGI en `/opt/sigi/supabase/.env`

| Variable | Valor en producción | Por qué |
|---|---|---|
| `SUPABASE_PUBLIC_URL` | `https://api.sigi.<dominio>` | URL pública de la API (Storage la usa para enlaces) |
| `API_EXTERNAL_URL` | `https://api.sigi.<dominio>/auth/v1` | Emisor de los tokens de autenticación |
| `SITE_URL` | `https://sigi.<dominio>` | URL de la aplicación |
| `ADDITIONAL_REDIRECT_URLS` | `https://sigi.<dominio>` | Única URL permitida |
| `JWT_EXPIRY` | `3600` | Igual que en desarrollo (1 hora; la sesión se renueva sola) |
| `DISABLE_SIGNUP` | `true` | Solo el Administrador crea usuarios |
| `ENABLE_EMAIL_SIGNUP` | `true` | **Debe quedar en `true`**: habilita el inicio con correo y contraseña. El registro lo bloquea `DISABLE_SIGNUP` |
| `ENABLE_EMAIL_AUTOCONFIRM` | `false` | Los usuarios se crean ya confirmados por la función `usuarios` |
| `ENABLE_ANONYMOUS_USERS` | `false` | — |
| `ENABLE_PHONE_SIGNUP` | `false` | No se usa teléfono |
| `ENABLE_PHONE_AUTOCONFIRM` | `false` | — |
| `SMTP_*` | Dejar los valores ficticios | SIGI no envía correos (ver 17.6) |
| `PGRST_DB_SCHEMAS` | `public,graphql_public` | Igual que en desarrollo |
| `PGRST_DB_MAX_ROWS` | **`1000`** | **No bajar de 1000**: el frontend lee por páginas de 1000 filas y entiende «menos de 1000» como «no hay más». Con un tope menor, las listas se cortarían sin aviso |
| `FUNCTIONS_VERIFY_JWT` | `false` | La función `usuarios` comprueba ella misma que quien llama sea Administrador (con su sesión) |
| `FUNCTIONS_MEMORY_LIMIT` | `1g` | Una sola función, liviana |
| `API_GW_HTTP_PORT` | `8000` | Se publica solo en 127.0.0.1 (sección 8) |
| `POSTGRES_PORT` | `5432` | Interno |
| `POOLER_PROXY_PORT_TRANSACTION` | `6543` | Interno |
| `STUDIO_DEFAULT_ORGANIZATION` / `STUDIO_DEFAULT_PROJECT` | `El Catador` / `SIGI` | Solo nombres en Studio |
| `OPENAI_API_KEY` | vacío | No enviar datos a terceros |
| `COMPOSE_FILE` | `docker-compose.yml:docker-compose.sigi.yml` | Agrega los ajustes de SIGI (sección 8) |

---

## 8. Ajustes de SIGI sobre Supabase

Crear `/opt/sigi/supabase/docker-compose.sigi.yml`. Así no se toca el `docker-compose.yml` oficial, y `update.sh` puede actualizarlo sin conflictos.

```yaml
# Ajustes de SIGI sobre la plantilla oficial de Supabase (self-hosted/v0.8.4).
# Se carga después de docker-compose.yml (ver COMPOSE_FILE en .env). Requiere Docker Compose 2.24+ por !override.
services:
  auth:
    environment:
      # Política de contraseñas de SIGI (en desarrollo: minimum_password_length = 12, password_requirements = "letters_digits")
      GOTRUE_PASSWORD_MIN_LENGTH: "12"
      GOTRUE_PASSWORD_REQUIRED_CHARACTERS: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789"
      # Sesiones: rotación del token de renovación (igual que en desarrollo)
      GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED: "true"
      GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: "10"
      # Límites de intentos (en desarrollo: sign_in_sign_ups = 30, token_refresh = 150 por 5 min)
      GOTRUE_RATE_LIMIT_TOKEN_REFRESH: "150"
      GOTRUE_RATE_LIMIT_VERIFY: "30"

  api-gw:
    # La pasarela solo escucha en el propio servidor: la publica el proxy HTTPS
    ports: !override
      - "127.0.0.1:${API_GW_HTTP_PORT:-8000}:8000/tcp"

  supavisor:
    # Pooler de la base: nunca expuesto a la red (las migraciones se aplican desde el propio servidor)
    ports: !override
      - "127.0.0.1:${POSTGRES_PORT}:5432"
      - "127.0.0.1:${POOLER_PROXY_PORT_TRANSACTION}:6543"
```

### 8.1 VERIFICAR: política de contraseñas

`GOTRUE_PASSWORD_REQUIRED_CHARACTERS` son grupos separados por `:`, y debe haber al menos un carácter de cada grupo. Comprobarlo en 15.2, intentando crear un usuario con contraseña `soloLetrasLargas` y otro con `123456789012`: ambos deben rechazarse.

La pantalla y la función `usuarios` ya validan 12 caracteres con letras y números; esta regla protege también el cambio de contraseña.

### 8.2 Studio

Studio no publica puertos en la plantilla, así que no queda expuesto. Para usarlo:

```bash
# Desde el equipo del administrador: túnel SSH y luego http://localhost:8000 en el navegador
ssh -L 8000:127.0.0.1:8000 sigi@<servidor>
```

Pide usuario y contraseña (`DASHBOARD_USERNAME` y `DASHBOARD_PASSWORD`). **Studio permite cambiar datos sin pasar por las reglas de la aplicación** (usa el rol de servicio). Úselo solo para diagnóstico; cualquier cambio de datos se hace desde SIGI.

### 8.3 Límite de archivos

La plantilla fija `FILE_SIZE_LIMIT: 52428800` (50 MB) para Storage. SIGI limita el bucket `evidencias` a 10 MB, PDF, PNG y JPG (lo hace la migración de seguridad). No hace falta cambiar nada.

### 8.4 Opcional: quitar Realtime

SIGI no usa Realtime. Para ahorrar memoria se puede quitar con un override (`deploy.replicas: 0` en Swarm, o `profiles: ["no-usar"]` en Compose). **Recomendación: dejarlo** en la primera puesta, para no apartarse de la plantilla.

---

## 9. Arranque y verificación de Supabase

```bash
cd /opt/sigi/supabase
sh run.sh start                  # equivale a docker compose up -d --wait
docker compose ps                # todos "Up … (healthy)" (tarda ~1 minuto)
```

### 9.1 Si algo no arranca

```bash
sh run.sh logs <servicio>        # p. ej. auth, storage, api-gw, db
sh tests/test-container-logs.sh  # revisión de registros de la plantilla
```

Si `api-gw` falla con un error del entrypoint, los archivos tienen fin de línea CRLF. Normalizar `volumes/api/envoy/*` a LF.

### 9.2 Comprobar la API

```bash
set -a; . ./.env; set +a
curl -s http://127.0.0.1:8000/auth/v1/health -H "apikey: $ANON_KEY"        # {"version":…,"name":"GoTrue",…}
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/rest/v1/ -H "apikey: $ANON_KEY"   # 200
```

### 9.3 Comprobar que nada interno quedó expuesto

```bash
sudo ss -tlnp | grep -E ':(8000|8080|5432|6543)\b'
# Todas las líneas deben decir 127.0.0.1:…  — si alguna dice 0.0.0.0 o *, revisar la sección 8
```

---

## 10. Migraciones de la base de SIGI

**Orden obligatorio**: las migraciones se aplican **después** de que Supabase esté sano. Usan esquemas que crean los servicios al arrancar (`auth.users` lo crea GoTrue, `storage.buckets` lo crea Storage). Aplicarlas antes falla.

Son 18 archivos en `app/supabase/migrations/`, de `20261104000100_esquema.sql` a `20261111000100_iniciativas_ahorro.sql`. Crean tablas, RLS, triggers de control y bitácora, el bucket `evidencias` con sus políticas, la zona horaria, las vistas del panel, el importador CSV, feriados e iniciativas de ahorro.

```bash
cd /opt/sigi/app
npm ci                                   # instala la CLI de Supabase del proyecto (solo se usa para migrar)
set -a; . /opt/sigi/supabase/.env; set +a
export SIGI_DB_URL="postgresql://postgres.${POOLER_TENANT_ID}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/postgres"

npx supabase migration list --db-url "$SIGI_DB_URL"   # muestra las 18, sin aplicar
npx supabase migration up   --db-url "$SIGI_DB_URL"   # las aplica en orden, en transacción cada una
npx supabase migration list --db-url "$SIGI_DB_URL"   # ahora todas marcadas como aplicadas
```

> **VERIFICAR**: el usuario del pooler Supavisor tiene la forma `postgres.<POOLER_TENANT_ID>`. Si la conexión falla, hay otra vía: publicar temporalmente el puerto 5432 del servicio `db` en `127.0.0.1` y conectar como `postgres` sin sufijo. **No** aplicar los archivos a mano con `psql`: la CLI registra lo aplicado en `supabase_migrations.schema_migrations`, y de eso dependen las actualizaciones futuras.

### 10.1 Comprobar la base

```bash
docker exec -i supabase-db psql -U postgres -d postgres -Atc "show timezone"
# America/Santo_Domingo
docker exec -i supabase-db psql -U postgres -d postgres -Atc "select id, public, file_size_limit from storage.buckets"
# evidencias|f|10485760
docker exec -i supabase-db psql -U postgres -d postgres -Atc \
  "select count(*) from pg_tables where schemaname='public' and not rowsecurity"
# 0   (todas las tablas tienen RLS)
docker exec -i supabase-db psql -U postgres -d postgres -Atc \
  "select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='authenticated' and privilege_type in ('DELETE','TRUNCATE')"
# 0   (nadie puede borrar)
```

### 10.2 Pruebas automáticas de la base (opcional, recomendado)

Las 119 pruebas pgTAP de `supabase/tests/` corren dentro de transacciones que se deshacen, así que no dejan datos. Se pueden correr **antes de cargar datos reales**:

```bash
for f in supabase/tests/*.test.sql; do
  docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$f" | grep -E "^(not ok|# Looks like)" && echo "FALLO en $f"
done
```

Si no se imprime ningún `FALLO`, todo está bien. Necesita la extensión `pgtap`; si no está, las pruebas la crean (`create extension if not exists pgtap`).

---

## 11. Función `usuarios`

Crea usuarios con contraseña temporal. Solo puede usarla el Administrador; la clave de servicio vive en el servidor y nunca llega al navegador.

```bash
mkdir -p /opt/sigi/supabase/volumes/functions/usuarios
cp /opt/sigi/app/supabase/functions/usuarios/index.ts /opt/sigi/supabase/volumes/functions/usuarios/index.ts
cd /opt/sigi/supabase && sh run.sh restart functions
```

- La plantilla ya le pasa `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`, que es lo que la función usa.
- La primera llamada descarga `npm:@supabase/supabase-js@2` (necesita salida a `registry.npmjs.org`) y la guarda en el volumen `deno-cache`.
- La función queda en `https://api.sigi.<dominio>/functions/v1/usuarios`. Se prueba en 15.3.

---

## 12. Frontend

La URL de la API y la clave pública **se fijan al compilar** (son variables `VITE_*`). Cambiar de dominio obliga a reconstruir la imagen.

### 12.1 Variables

Archivo `/opt/sigi/app/.env`, con permisos 600. El `docker-compose.yml` del repositorio lo lee:

```bash
VITE_SUPABASE_URL=https://api.sigi.<dominio>
VITE_SUPABASE_PUBLISHABLE_KEY=<SUPABASE_PUBLISHABLE_KEY de /opt/sigi/supabase/.env>
# Si SUPABASE_PUBLISHABLE_KEY quedó vacío, use ANON_KEY. Nunca SERVICE_ROLE_KEY ni SUPABASE_SECRET_KEY.
```

**No** poner aquí las variables `SIGI_PRUEBA_*`: son solo para pruebas en desarrollo.

### 12.2 Publicar solo en 127.0.0.1

El `docker-compose.yml` del repositorio publica `8080:80` en todas las interfaces. En el servidor, crear `/opt/sigi/app/docker-compose.override.yml`. Compose lo carga solo y no se sube al repositorio, porque es propio del servidor:

```yaml
services:
  web:
    ports: !override
      - "127.0.0.1:8080:80"
    image: sigi-web:${SIGI_VERSION:-local}
```

### 12.3 Construir y arrancar

```bash
cd /opt/sigi/app
export SIGI_VERSION=$(git rev-parse --short HEAD)
docker compose up -d --build
docker compose ps                                    # web Up
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/   # 200
```

La imagen compila con `node:24-alpine` y sirve con `nginx:1.29-alpine`. `web/nginx.conf` ya incluye:
- `try_files` para la aplicación de una sola página;
- caché larga para `/assets/`;
- las cabeceras `X-Content-Type-Options`, `X-Frame-Options DENY` y `Referrer-Policy`.

---

## 13. Proxy inverso HTTPS

nginx en el servidor (fuera de Docker) termina TLS y reparte por nombre.

```bash
sudo apt -y install nginx
sudo install -d -m 700 /etc/nginx/ssl
# Copiar el certificado y la clave:  /etc/nginx/ssl/sigi.crt  /etc/nginx/ssl/sigi.key  (cadena completa en el .crt)
```

`/etc/nginx/sites-available/sigi`:

```nginx
# Redirigir todo a HTTPS
server {
  listen 80;
  server_name sigi.<dominio> api.sigi.<dominio>;
  return 301 https://$host$request_uri;
}

# Aplicación
server {
  listen 443 ssl;
  http2 on;
  server_name sigi.<dominio>;
  ssl_certificate     /etc/nginx/ssl/sigi.crt;
  ssl_certificate_key /etc/nginx/ssl/sigi.key;
  ssl_protocols TLSv1.2 TLSv1.3;
  add_header Strict-Transport-Security "max-age=31536000" always;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}

# API de Supabase
server {
  listen 443 ssl;
  http2 on;
  server_name api.sigi.<dominio>;
  ssl_certificate     /etc/nginx/ssl/sigi.crt;
  ssl_certificate_key /etc/nginx/ssl/sigi.key;
  ssl_protocols TLSv1.2 TLSv1.3;
  add_header Strict-Transport-Security "max-age=31536000" always;

  client_max_body_size 12m;          # evidencias de hasta 10 MB + margen

  location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;     # Realtime (websocket), por si se usa en el futuro
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 300s;                    # importaciones CSV grandes
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/sigi /etc/nginx/sites-enabled/sigi
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
curl -s -o /dev/null -w "%{http_code}\n" https://sigi.<dominio>/                     # 200
curl -s https://api.sigi.<dominio>/auth/v1/health -H "apikey: <clave pública>"      # JSON de GoTrue
```

Con Let's Encrypt: `sudo apt -y install certbot python3-certbot-nginx && sudo certbot --nginx -d sigi.<dominio> -d api.sigi.<dominio>`. La renovación queda programada sola.

---

## 14. Puesta en marcha funcional

### 14.1 Primer Administrador (el Gerente)

```bash
cd /opt/sigi/app
set -a; . /opt/sigi/supabase/.env; set +a
SUPABASE_URL=http://127.0.0.1:8000 SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  npm run admin:crear -- <correo-del-gerente> '<contraseña temporal de 12+ con letras y números>'
history -d $(history 1)   # que la contraseña no quede en el historial
unset SERVICE_ROLE_KEY
```

El Gerente entra en `https://sigi.<dominio>` y cambia la contraseña en **Cuenta → Cambiar contraseña**.

### 14.2 Configuración inicial, en este orden (desde la aplicación, como Administrador)

1. **Administración → Empresas**: crear El Catador y Bona con código, inicio del año fiscal, moneda de reporte y colores.
2. **Administración → Usuarios y roles**: crear los usuarios con su contraseña temporal (se muestra una sola vez; entregar por un medio seguro) y asignar el rol por empresa: Consulta, Captura o Administrador.
3. **Catálogos → Tasas de cambio**: tasa US$ vigente (sin tasa, los montos en US$ no se convierten a RD$).
4. **Catálogos → Feriados**: los feriados del año. Sin ellos, los días hábiles de las ausencias solo descuentan fines de semana.
5. **Catálogos → Centros de costo**, **Áreas** y **Departamentos**: a mano, o Áreas y departamentos por CSV.
6. **Herramientas → Importar CSV**, en el orden de `docs/plantillas/` (descargar la plantilla de cada catálogo desde la pantalla):
   1. Áreas y departamentos
   2. Proveedores (maestro)
   3. Cuentas de proveedor
   4. Cuentas contables
   5. Servicios de telecomunicaciones
   6. Líneas de flota
   7. Partidas de presupuesto (después de crear la versión en **Presupuesto → Versiones** y marcarla «Vigente»)
7. **Software**, **Activos**, **Personal**, **Iniciativas de ahorro**: desde sus pantallas.

Cada importación revisa el archivo completo y no guarda nada si una fila tiene error. El mismo archivo no se puede importar dos veces.

### 14.3 ¿Y los datos de desarrollo?

La base de desarrollo tiene **datos de prueba** («Empresa de prueba», empresas de las pruebas de concurrencia). **No se migran**: producción empieza limpia. Si en el futuro hubiera que mover una base completa, se usa el respaldo y la restauración de la sección 16 (respaldo de origen y restauración en destino).

---

## 15. Pruebas de humo (aceptación técnica)

Marcar cada una. Todas deben pasar antes de abrir el sistema a los usuarios.

| # | Prueba | Resultado esperado |
|---|---|---|
| 15.1 | Abrir `https://sigi.<dominio>` | Pantalla de inicio de sesión, certificado válido, sin errores en la consola del navegador |
| 15.2 | Crear usuario con contraseña `soloLetrasLargas` y con `123456789012` | Ambos rechazados |
| 15.3 | Administrador crea un usuario de Captura desde **Usuarios y roles** | Usuario creado; la contraseña temporal se muestra una vez |
| 15.4 | Un usuario de Consulta intenta crear un registro | La base lo rechaza (sin permiso) |
| 15.5 | Captura de la empresa A intenta ver datos de la empresa B | No los ve |
| 15.6 | Registrar un gasto con compromiso, una factura con NCF válido y un pago | Saldos de la partida actualizados en **Presupuesto y ejecución** |
| 15.7 | Subir una evidencia PDF de < 10 MB al paso de factura y abrirla | Se abre con un enlace temporal |
| 15.8 | Subir un archivo `.exe` o de > 10 MB | Rechazado |
| 15.9 | Dar de baja un registro con motivo y reactivarlo (Administrador) | Queda en **Bitácora** con el valor anterior y el nuevo |
| 15.10 | Importar una plantilla CSV con una fila con error | Muestra el error con su número de fila; no guarda nada |
| 15.11 | Panel (Inicio) en Consolidado y por empresa | Carga sin errores; los indicadores cuadran con Presupuesto |
| 15.12 | Ausencia que cae en un feriado registrado | Los días hábiles lo descuentan |
| 15.13 | Respaldo y restauración de prueba (sección 16.4) | Sin errores; conteos iguales |
| 15.14 | `sudo ss -tlnp` | Solo 22, 80 y 443 en interfaces externas |
| 15.15 | Reiniciar el servidor (`sudo reboot`) | Todo vuelve solo (`restart: unless-stopped`) y la aplicación funciona |

---

## 16. Respaldos y recuperación

### 16.1 Qué se respalda

`scripts/respaldar.sh` genera tres archivos:
- `base.dump`: la base completa (datos, usuarios, historial y permisos), hecha con `supabase_admin` para restaurarla tal cual;
- `evidencias.tar`: los archivos de evidencias;
- `sha256.txt`: las huellas de los dos anteriores.

**No** guarda sesiones ni tokens: después de restaurar, cada usuario vuelve a iniciar sesión.

### 16.2 Respaldo manual en producción (Docker)

```bash
cd /opt/sigi/app
SIGI_DB_CONTAINER=supabase-db SIGI_STORAGE_CONTAINER=supabase-storage SIGI_STORAGE_DIR=/var/lib/storage \
  bash scripts/respaldar.sh <carpeta destino elegida por el responsable>
```

> **VERIFICAR**: `pg_dump -U supabase_admin` dentro de `supabase-db`. El contenedor trae `PGPASSWORD` (= `POSTGRES_PASSWORD`). Comprobarlo con el primer respaldo y con la restauración de prueba (16.4).

### 16.3 Respaldo programado

El destino lo decide el responsable de respaldos. Ejemplo con un disco montado en `/srv/respaldos-sigi`; reemplácelo por el destino elegido:

```bash
# /etc/cron.d/sigi-respaldo — todos los días a las 23:30
30 23 * * * sigi cd /opt/sigi/app && SIGI_DB_CONTAINER=supabase-db SIGI_STORAGE_CONTAINER=supabase-storage SIGI_STORAGE_DIR=/var/lib/storage SIGI_RESPALDOS=/srv/respaldos-sigi bash scripts/respaldar.sh >> /var/log/sigi-respaldo.log 2>&1
```

- Con `SIGI_RESPALDOS`, cada respaldo va a una subcarpeta con fecha y hora.
- **Retención**: definirla con el responsable, por ejemplo 30 diarios y 12 mensuales. Los respaldos viejos solo se eliminan si el responsable lo decide.
- **Copia fuera del servidor**: copiar cada noche la carpeta a otro equipo o disco (`rsync`). Un respaldo en el mismo disco no protege de una falla del disco.
- Los respaldos tienen **datos personales** (personal, ausencias, usuarios). Destino con acceso restringido; cifrado si sale del edificio.
- Vigilar `/var/log/sigi-respaldo.log` y el tamaño del destino.

### 16.4 Restauración de prueba (mensual, y antes del día del pase)

Restaurar en una base aparte dentro del mismo contenedor, sin tocar la real:

```bash
R=<carpeta de un respaldo>
(cd "$R" && sha256sum -c sha256.txt)                                        # OK en los dos
docker cp "$R/base.dump" supabase-db:/tmp/prueba.dump
docker exec supabase-db psql -U supabase_admin -d postgres -c "create database sigi_restauracion"
docker exec supabase-db pg_restore -U supabase_admin --exit-on-error -d sigi_restauracion /tmp/prueba.dump
docker exec supabase-db psql -U supabase_admin -d sigi_restauracion -Atc "select count(*) from public.gastos"
docker exec supabase-db psql -U supabase_admin -d postgres -Atc "select count(*) from public.gastos"   # debe coincidir
docker exec supabase-db psql -U supabase_admin -d postgres -c "drop database sigi_restauracion"
docker exec supabase-db rm -f /tmp/prueba.dump
```

### 16.5 Recuperación real (desastre)

1. Avisar a los usuarios y detener el frontend: `cd /opt/sigi/app && docker compose stop web`.
2. Verificar las huellas del respaldo elegido (`sha256sum -c`).
3. Restaurar la base:
   ```bash
   docker cp <carpeta>/base.dump supabase-db:/tmp/base.dump
   docker exec supabase-db pg_restore -U supabase_admin --clean --if-exists -n public -n auth -n storage -d postgres /tmp/base.dump
   ```
4. Restaurar los archivos:
   ```bash
   docker exec -i supabase-storage tar -C /var/lib/storage -xf - < <carpeta>/evidencias.tar
   ```
5. `cd /opt/sigi/supabase && sh run.sh restart`, y luego `cd /opt/sigi/app && docker compose start web`.
6. Pruebas 15.1, 15.6, 15.7 y 15.11.

Si el servidor se perdió entero: secciones 5 a 13 en un servidor nuevo (con el **mismo** `.env` de Supabase, guardado según 7.1), luego 16.5. **No** aplicar migraciones sobre una base restaurada: ya las trae.

---

## 17. Operación diaria y mantenimiento

### 17.1 Arranque y parada

```bash
cd /opt/sigi/supabase && sh run.sh start     # Supabase
cd /opt/sigi/app && docker compose up -d     # Frontend
cd /opt/sigi/app && docker compose stop      # Detener frontend
cd /opt/sigi/supabase && sh run.sh stop      # Detener Supabase (los datos quedan en volumes/)
```

**Nunca**:
- `sh reset.sh`: borra `volumes/db/data` y `volumes/storage`;
- `docker compose down -v`: borra los volúmenes;
- `npm run db:reset`.

### 17.2 Revisión diaria (5 minutos)

```bash
cd /opt/sigi/supabase && docker compose ps     # todo healthy
df -h /opt /srv                                # espacio en disco (alerta si > 80 %)
tail -n 5 /var/log/sigi-respaldo.log           # respaldo de anoche "Respaldo listo"
```

### 17.3 Registros

```bash
cd /opt/sigi/supabase && sh run.sh logs auth      # inicio de sesión
sh run.sh logs rest                               # consultas de la aplicación
sh run.sh logs storage                            # evidencias
sh run.sh logs functions                          # creación de usuarios
cd /opt/sigi/app && docker compose logs web       # frontend
sudo tail -f /var/log/nginx/error.log             # proxy
```

La auditoría de negocio está en la propia base: tabla `bitacora`, pantalla **Herramientas → Bitácora**.

Para que los registros de Docker no llenen el disco, en `/etc/docker/daemon.json`:

```json
{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }
```

Luego `sudo systemctl restart docker`. Esto reinicia los contenedores; hacerlo en una ventana de mantenimiento.

### 17.4 Instalar una versión nueva de SIGI

En una ventana acordada, con los usuarios avisados:

```bash
cd /opt/sigi/app
git fetch && git log --oneline HEAD..origin/main          # qué cambia
# 1. Respaldo antes de tocar nada
SIGI_DB_CONTAINER=supabase-db SIGI_STORAGE_CONTAINER=supabase-storage SIGI_STORAGE_DIR=/var/lib/storage \
  bash scripts/respaldar.sh <carpeta elegida>
# 2. Código
git pull --ff-only
# 3. Migraciones nuevas (solo agrega; los datos se conservan)
set -a; . /opt/sigi/supabase/.env; set +a
export SIGI_DB_URL="postgresql://postgres.${POOLER_TENANT_ID}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/postgres"
npm ci && npx supabase migration up --db-url "$SIGI_DB_URL"
# 4. Función (si cambió supabase/functions/usuarios)
cp supabase/functions/usuarios/index.ts /opt/sigi/supabase/volumes/functions/usuarios/index.ts
(cd /opt/sigi/supabase && sh run.sh restart functions)
# 5. Frontend
export SIGI_VERSION=$(git rev-parse --short HEAD)
docker compose up -d --build
# 6. Pruebas 15.1, 15.6, 15.11
```

Anotar en el registro de cambios: fecha, commit anterior, commit nuevo y migraciones aplicadas.

### 17.5 Actualizar Supabase

1. Leer `CHANGELOG.md` de la plantilla y la guía «Updating» de supabase.com para la versión destino.
2. Respaldo (16.2).
3. `cd /opt/sigi/supabase && sh update.sh`. Hace una mezcla de tres vías con la versión nueva; resolver conflictos conservando `docker-compose.sigi.yml` y los valores de `.env`.
4. `sh run.sh pull && sh run.sh start`, luego secciones 9.2, 9.3 y 15.

Primero en un servidor de prueba con una copia restaurada de la base. Nunca subir de versión mayor de PostgreSQL sin el procedimiento oficial (`utils/upgrade-pg17.sh` y equivalentes).

### 17.6 Contraseña olvidada (no hay correo)

SIGI no envía correos. Si un usuario olvida su contraseña, el Administrador de infraestructura le asigna una temporal desde el servidor:

```bash
set -a; . /opt/sigi/supabase/.env; set +a
ID=$(docker exec -i supabase-db psql -U postgres -d postgres -Atc "select id from auth.users where email = lower('<correo>')")
curl -s -X PUT "http://127.0.0.1:8000/auth/v1/admin/users/$ID" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d '{"password":"<temporal 12+ letras y números>"}'
history -d $(history 1)
```

El usuario entra y la cambia en **Cambiar contraseña**. Dejar constancia: quién lo pidió, cuándo y quién lo hizo.

### 17.7 Quitar el acceso a una persona

Desde **Usuarios y roles**: poner «Sin acceso» en cada empresa y quitar la casilla de Administrador. El usuario sigue existiendo (historial y autoría intactos), pero no ve nada.

### 17.8 Rotar secretos

- **Claves de la API**:
  1. `sh utils/rotate-new-api-keys.sh --update-env` y `sh run.sh recreate`.
  2. Reconstruir el frontend con la clave pública nueva (12.1 y 12.3).
  3. Las sesiones de los usuarios no se pierden.
- **Contraseña de la base**: `sh utils/db-passwd.sh` y `sh run.sh recreate`. Actualizar la copia guardada del `.env`.
- **Cuándo rotar**: si alguien con acceso deja la empresa, o ante cualquier sospecha.

---

## 18. Seguridad (lista de control)

| ✔ | Control |
|---|---|
| ☐ | Ningún valor de ejemplo en `/opt/sigi/supabase/.env` (secretos, `DASHBOARD_PASSWORD`, claves) |
| ☐ | `.env` de Supabase y de la app con permisos 600, dueño `sigi`; fuera del repositorio |
| ☐ | El frontend usa solo la clave pública. `SERVICE_ROLE_KEY` y `SUPABASE_SECRET_KEY` no aparecen en ningún archivo de `web/` ni en la imagen (`docker run --rm sigi-web:<versión> grep -r "service_role" /usr/share/nginx/html` no debe encontrar nada) |
| ☐ | `DISABLE_SIGNUP=true`; registro libre probado: `curl -X POST https://api.sigi.<dominio>/auth/v1/signup -H "apikey: <pública>" -d '{"email":"x@y.z","password":"abcdefgh1234"}'` devuelve error |
| ☐ | Política de contraseñas probada (15.2) |
| ☐ | Solo 22 (restringido), 80 y 443 abiertos (15.14). Pooler, pasarela y web en 127.0.0.1 |
| ☐ | Studio sin publicar; acceso solo por túnel SSH |
| ☐ | HTTPS con certificado válido y HSTS |
| ☐ | Respaldos programados, copiados fuera del servidor y restauración probada |
| ☐ | Actualizaciones de seguridad del sistema operativo programadas (`unattended-upgrades`) |
| ☐ | Acceso SSH solo con llave; sin contraseña (`PasswordAuthentication no`); sin `root` directo |
| ☐ | Bitácora revisable por el Administrador; nadie puede borrar (comprobado en 10.1) |

---

## 19. Plan de vuelta atrás (rollback)

| Situación | Acción |
|---|---|
| Falla en el pase inicial (antes de abrir a usuarios) | No hay datos reales: corregir y repetir desde el paso que falló. Si hay que empezar de cero en el servidor nuevo, `sh reset.sh` **solo** en ese momento y con aprobación del responsable |
| Una versión nueva del frontend falla | `cd /opt/sigi/app && git checkout <commit anterior> && SIGI_VERSION=<commit anterior> docker compose up -d --build` (o volver a la imagen anterior si se conservó la etiqueta) |
| Una migración nueva falla al aplicarse | Cada migración corre en una transacción: si falla, no queda a medias. Volver el código al commit anterior y reconstruir el frontend; avisar a desarrollo |
| Una migración aplicada causa problemas de datos | Restaurar el respaldo tomado justo antes (16.5) y volver al commit anterior. Se pierde lo registrado entre el respaldo y la restauración: avisar antes a los usuarios |
| Falla Supabase tras actualizarlo | Volver a las etiquetas de imagen anteriores (`git` en `/opt/sigi/supabase` o `.env.old`), `sh run.sh pull && sh run.sh start`; si la base quedó afectada, 16.5 |

Regla: **antes de cualquier cambio, un respaldo con su prueba de huellas**.

---

## 20. Fase 2: Docker Swarm

La guía oficial de Supabase **no documenta Swarm**. Esta sección traduce la instalación de Docker a Swarm según cómo trata Swarm los archivos Compose. Hacerla primero en un entorno de prueba, con una copia restaurada de la base. **Todo lo de esta sección es VERIFICAR.**

### 20.1 Qué aporta y qué no

- **Aporta**: reinicio y reprogramación automáticos de servicios, despliegues con actualización ordenada y vuelta atrás (`docker service rollback`), varias réplicas del frontend y secretos gestionados por Swarm.
- **No aporta** alta disponibilidad de la base ni de las evidencias. `db`, `storage` e `imgproxy` usan carpetas del disco de **un** nodo y deben quedarse en ese nodo. Para que la base sobreviva a la caída de un nodo haría falta almacenamiento compartido o replicación de PostgreSQL. Eso está fuera de este alcance y no se recomienda para la carga de SIGI.

### 20.2 Diseño recomendado

- **Nodo de datos** (manager, etiqueta `sigi.datos=true`): toda la pila de Supabase (una réplica de cada servicio), sus volúmenes y los respaldos.
- **Frontend `web`**: 2 réplicas, en cualquier nodo.
- **Proxy de entrada**: nginx como servicio publicado en 80/443 (modo `host` o malla de enrutamiento), o se mantiene el nginx del sistema en el nodo de datos.
- **Red**: overlay `sigi` (cifrada: `--opt encrypted`).

Empezar con **un solo nodo** (manager) y agregar trabajadores después.

### 20.3 Diferencias de Swarm que obligan a cambiar archivos

| Compose (Docker) | En Swarm (`docker stack deploy`) | Qué hacer |
|---|---|---|
| `build:` | No se construye | Construir y subir las imágenes a un registro (20.4) |
| `container_name:` | Se ignora; nombres tipo `sigi_db.1.<id>` | Ajustar los comandos (respaldo, `docker exec`) para buscar el contenedor (20.8) |
| `depends_on` con `condition: service_healthy` | Se ignora | Los servicios reintentan solos; el arranque inicial puede tardar más. Desplegar en dos tiempos si hace falta (primero `db`) |
| `.env` del directorio | No se lee solo | Generar el archivo de la pila ya resuelto con `docker compose config` (20.5) |
| Montajes con rutas relativas (`./volumes/...`) | Se resuelven en el nodo donde corre la tarea | Rutas absolutas y restricción de ubicación al nodo de datos (20.6) |
| `mem_limit` | Se ignora | `deploy.resources.limits.memory` |
| `restart: unless-stopped` | Se ignora | `deploy.restart_policy` |
| `ports: "127.0.0.1:…"` | No admite IP de escucha | No publicar puertos internos; usar la red overlay. Solo publica el proxy |
| `name:` del proyecto | Lo da el nombre de la pila | `docker stack deploy … sigi` |
| Healthchecks | Sí se usan (estado de la tarea) | Se conservan |

### 20.4 Registro de imágenes

Las imágenes oficiales de Supabase se descargan de Docker Hub en cada nodo. La imagen del frontend de SIGI hay que publicarla en un registro accesible por todos los nodos.

```bash
# Registro privado en el propio Swarm (solo red interna)
docker service create --name registry --publish published=5000,target=5000 \
  --constraint node.labels.sigi.datos==true \
  --mount type=bind,src=/srv/registry,dst=/var/lib/registry registry:2

# Construir y subir el frontend (en el nodo de datos)
cd /opt/sigi/app
export SIGI_VERSION=$(git rev-parse --short HEAD)
docker build -t 127.0.0.1:5000/sigi-web:$SIGI_VERSION \
  --build-arg VITE_SUPABASE_URL=https://api.sigi.<dominio> \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=<clave pública> ./web
docker push 127.0.0.1:5000/sigi-web:$SIGI_VERSION
```

Un registro en `127.0.0.1:5000` sin TLS solo sirve en el mismo nodo. Si hay varios nodos, el registro debe tener TLS (certificado interno) o cada nodo debe declararlo en `insecure-registries` de `daemon.json` (menos seguro).

### 20.5 Generar la pila de Supabase

```bash
docker swarm init --advertise-addr <IP del nodo de datos>
docker node update --label-add sigi.datos=true $(docker node ls -q --filter role=manager | head -1)
docker network create -d overlay --attachable --opt encrypted sigi

cd /opt/sigi/supabase
docker compose config > /opt/sigi/swarm/supabase-resuelto.yml   # variables de .env ya sustituidas
chmod 600 /opt/sigi/swarm/supabase-resuelto.yml                  # contiene secretos
```

Editar `supabase-resuelto.yml`:

1. Quitar la línea `name:` del principio.
2. En cada servicio:
   - quitar `container_name`, `depends_on` y `restart`;
   - cambiar `mem_limit` por `deploy.resources.limits.memory`.
3. Agregar a **cada** servicio de Supabase:
   ```yaml
       deploy:
         replicas: 1
         placement:
           constraints: [node.labels.sigi.datos == true]
         restart_policy:
           condition: any
           delay: 10s
       networks: [sigi]
   ```
4. Quitar todos los `ports:` salvo los de la pasarela (`api-gw`). Esta se publica solo si el proxy corre fuera de la pila; si el proxy está en la pila, tampoco.
5. Comprobar que los montajes de archivos quedaron con **ruta absoluta** (`/opt/sigi/supabase/volumes/...`). `docker compose config` normalmente ya los convierte.
6. Al final del archivo:
   ```yaml
   networks:
     sigi:
       external: true
   ```
7. La pasarela tiene el alias de red `kong`/`envoy` en la plantilla. Conservar esos alias en la red `sigi`: los usan otros servicios, por ejemplo `SUPABASE_URL: http://api-gw:8000` en funciones.

```bash
docker stack deploy -c /opt/sigi/swarm/supabase-resuelto.yml sigi
docker stack services sigi        # todas 1/1 en unos minutos
docker service ps sigi_db --no-trunc
```

### 20.6 Secretos en Swarm

- Las imágenes de Supabase leen secretos de **variables de entorno**, no de archivos. Por eso el archivo resuelto lleva los secretos en texto: debe quedar con `chmod 600`, solo en el manager, y nunca subirse al repositorio.
- `docker secret` solo sirve para lo que acepte `_FILE`: por ejemplo, la imagen de Postgres acepta `POSTGRES_PASSWORD_FILE`, pero los demás servicios de Supabase necesitan la misma contraseña por variable.
- Para los certificados del proxy sí conviene `docker secret create sigi_crt /etc/nginx/ssl/sigi.crt` (y la clave), montados en el servicio del proxy.

### 20.7 Pila del frontend y del proxy

`/opt/sigi/swarm/sigi-web.yml`:

```yaml
services:
  web:
    image: 127.0.0.1:5000/sigi-web:${SIGI_VERSION}
    networks: [sigi]
    deploy:
      replicas: 2
      update_config:
        parallelism: 1
        delay: 10s
        order: start-first          # sin corte durante la actualización
        failure_action: rollback
      rollback_config:
        parallelism: 1
      restart_policy:
        condition: any
      resources:
        limits: { memory: 128M }

  proxy:
    image: nginx:1.29-alpine
    networks: [sigi]
    ports:
      - { target: 80,  published: 80,  mode: host }
      - { target: 443, published: 443, mode: host }
    configs:
      - source: sigi_proxy_conf
        target: /etc/nginx/conf.d/default.conf
    secrets:
      - source: sigi_crt
        target: /etc/nginx/ssl/sigi.crt
      - source: sigi_key
        target: /etc/nginx/ssl/sigi.key
    deploy:
      replicas: 1
      placement:
        constraints: [node.labels.sigi.datos == true]
      restart_policy: { condition: any }

networks:
  sigi:
    external: true

configs:
  sigi_proxy_conf:
    file: ./proxy.conf
secrets:
  sigi_crt:
    external: true
  sigi_key:
    external: true
```

`/opt/sigi/swarm/proxy.conf` es el de la sección 13 con dos cambios: `proxy_pass http://web:80;` para la aplicación y `proxy_pass http://api-gw:8000;` para la API (nombres de servicio en la red `sigi`), y sin el bloque de redirección si se prefiere manejarlo aparte.

```bash
docker secret create sigi_crt /etc/nginx/ssl/sigi.crt
docker secret create sigi_key /etc/nginx/ssl/sigi.key
sudo systemctl disable --now nginx          # el proxy pasa a la pila
cd /opt/sigi/swarm && SIGI_VERSION=<versión> docker stack deploy -c sigi-web.yml sigi
```

Las configs de Swarm no se editan: para cambiar `proxy.conf`, crear una con nombre nuevo (`sigi_proxy_conf_v2`) y volver a desplegar.

### 20.8 Operación en Swarm

```bash
docker stack services sigi                                   # estado
docker service logs -f sigi_auth                             # registros
SIGI_VERSION=<nueva> docker stack deploy -c sigi-web.yml sigi # nueva versión del frontend (gradual)
docker service rollback sigi_web                              # volver a la anterior
docker service update --force sigi_functions                 # reiniciar un servicio

# Respaldo: ejecutar en el nodo de datos; los contenedores tienen nombre variable
DB=$(docker ps -q -f name=sigi_db. -f status=running | head -1)
ST=$(docker ps -q -f name=sigi_storage. -f status=running | head -1)
SIGI_DB_CONTAINER=$DB SIGI_STORAGE_CONTAINER=$ST SIGI_STORAGE_DIR=/var/lib/storage \
  bash /opt/sigi/app/scripts/respaldar.sh <destino elegido>
```

- **Migraciones en Swarm**: el pooler ya no publica puerto en 127.0.0.1. Hay dos opciones:
  - correr la CLI desde un contenedor en la red `sigi`: `docker run --rm --network sigi -v /opt/sigi/app:/app -w /app node:24 npx supabase migration up --db-url postgresql://postgres.<tenant>:<clave>@supavisor:5432/postgres`;
  - publicar temporalmente el puerto del pooler y quitarlo al terminar.
- **Función `usuarios`**: la carpeta `volumes/functions` sigue en el nodo de datos; copiar el archivo y forzar la actualización del servicio `sigi_functions`.
- **Agregar un nodo trabajador**: `docker swarm join-token worker` en el manager y ejecutar la orden en el nodo nuevo. Abrir 2377/tcp, 7946/tcp+udp y 4789/udp **solo** entre nodos.

### 20.9 Migración de Docker a Swarm (sin perder datos)

1. Ventana de mantenimiento; avisar a usuarios.
2. Respaldo completo (16.2) y verificación de huellas.
3. `cd /opt/sigi/app && docker compose down`, luego `cd /opt/sigi/supabase && sh run.sh stop`. **Sin `-v`**: los datos quedan en `volumes/`.
4. Pasos 20.4 a 20.7. Los servicios montan las mismas carpetas `volumes/db/data` y `volumes/storage`, así que la base y las evidencias se conservan.
5. Pruebas de la sección 15.
6. Vuelta atrás: `docker stack rm sigi` y volver a levantar con Docker (17.1). Las carpetas no cambiaron.

---

## 21. Plan del día del pase y criterios de salida

### 21.1 Antes del día (D-5 a D-1)

| Día | Tarea | Responsable |
|---|---|---|
| D-5 | Servidor listo (sección 5); DNS y certificados emitidos | Infraestructura |
| D-4 | Supabase instalado y verificado (6 a 9); migraciones y pruebas pgTAP (10) | Aplicación |
| D-3 | Función, frontend y proxy (11 a 13); pruebas de humo 15.1 a 15.15 con datos de prueba en un servidor de ensayo o antes de crear el Administrador real | Aplicación |
| D-2 | Respaldo programado y restauración de prueba (16) | Respaldos |
| D-1 | Plantillas CSV llenas y revisadas; lista de usuarios con su rol por empresa; tasa y feriados | Datos y Administrador |

### 21.2 El día

| Hora | Paso | Comprobación |
|---|---|---|
| T+0:00 | Anotar el commit; respaldo de la base vacía | `sha256sum -c` OK |
| T+0:15 | Primer Administrador (14.1) | Inicio de sesión del Gerente |
| T+0:30 | Empresas, tasas, feriados, catálogos (14.2 pasos 1 a 5) | Pantallas sin errores |
| T+1:00 | Importaciones CSV en orden (14.2 paso 6) | Conteos iguales a los archivos |
| T+2:30 | Usuarios y roles | Cada usuario entra y ve solo su empresa |
| T+3:00 | Pruebas 15.6, 15.7, 15.11 con datos reales | Cifras revisadas por Finanzas |
| T+3:30 | Respaldo con datos reales | `sha256sum -c` OK |
| T+3:45 | **Decisión de salida** | Ver 21.3 |

### 21.3 Criterios de salida (go / no-go)

- **Go**: todas las pruebas de la sección 15 pasan, la lista de seguridad (18) está completa, hay un respaldo con datos reales verificado y el responsable del pase lo aprueba.
- **No-go**: cualquier fallo en 15.2, 15.4, 15.5, 15.7, 15.13 o 15.14, o en la lista de seguridad. Corregir y repetir; si no se puede en el día, posponer.

### 21.4 Después del pase

- Primera semana: revisión diaria (17.2) y canal de soporte con los usuarios.
- Al mes: restauración de prueba (16.4) y revisión de espacio y crecimiento.

---

## 22. Riesgos conocidos y pendientes

| # | Riesgo / pendiente | Impacto | Mitigación |
|---|---|---|---|
| 22.1 | Sin correo: no hay recuperación de contraseña por correo | El Administrador de infraestructura debe intervenir | Procedimiento 17.6; configurar SMTP más adelante si se desea |
| 22.2 | Sin MFA ni inicio con Microsoft | Solo contraseña | Política de 12 caracteres; Microsoft (Entra ID) queda como fase posterior |
| 22.3 | Swarm no documentado por Supabase | Puede requerir ajustes no previstos | Probar en ensayo (20); la fase 1 con Docker es la referencia |
| 22.4 | Servidor sin salida a internet | No se descargan imágenes ni la dependencia de la función | Descargar imágenes en otro equipo (`docker save` / `docker load`) y precargar `deno-cache`, o permitir salida a Docker Hub, GitHub y `registry.npmjs.org` |
| 22.5 | Pasos marcados VERIFICAR (8.1, 10, 16.2, 20) | Fallos en el pase | Probarlos en D-4 a D-2 |
| 22.6 | Base y evidencias en un solo disco/nodo | Pérdida si falla el disco | Respaldo diario fuera del servidor + restauración probada |
| 22.7 | Consolidado con monedas de reporte distintas entre empresas | Suma RD$ con US$ si una empresa reporta en US$ | Mantener ambas empresas en RD$ (hoy es así) |
| 22.8 | `PGRST_DB_MAX_ROWS` menor de 1000 | Listas cortadas sin aviso | Dejarlo en 1000 (sección 7.2) |
| 22.9 | Proyección de cierre por partida | No existe: se proyecta por empresa y ejercicio | Ligar iniciativas a partidas si se necesita |
| 22.10 | Iniciativas de ahorro no se importan por CSV | Carga manual | Agregar al importador si hay volumen |

---

## 23. Anexos

### 23.1 Archivos y carpetas en el servidor

| Ruta | Contenido | ¿En respaldo? |
|---|---|---|
| `/opt/sigi/app` | Repositorio de SIGI (código, migraciones, scripts) | No (está en GitHub; anotar el commit) |
| `/opt/sigi/app/.env` | URL y clave pública del frontend | Guardar aparte (no es secreto crítico) |
| `/opt/sigi/app/docker-compose.override.yml` | Publicación de la web en 127.0.0.1 | Guardar aparte |
| `/opt/sigi/supabase` | Plantilla de Supabase | No (se reinstala) |
| `/opt/sigi/supabase/.env` | **Todos los secretos** | **Sí, aparte y cifrado** (7.1) |
| `/opt/sigi/supabase/docker-compose.sigi.yml` | Ajustes de SIGI | Guardar aparte |
| `/opt/sigi/supabase/volumes/db/data` | **Base de datos** | Sí (`base.dump`) |
| `/opt/sigi/supabase/volumes/storage` | **Evidencias** | Sí (`evidencias.tar`) |
| `/opt/sigi/supabase/volumes/functions/usuarios` | Función de creación de usuarios | No (está en el repositorio) |
| `/etc/nginx/sites-available/sigi`, `/etc/nginx/ssl/` | Proxy y certificados | Guardar aparte |
| `/etc/cron.d/sigi-respaldo` | Respaldo programado | Guardar aparte |
| `/opt/sigi/swarm/` | Pilas de Swarm (fase 2); el archivo resuelto lleva secretos | **Sí, aparte y cifrado** |

### 23.2 Versiones de las imágenes (plantilla `self-hosted/v0.8.4`, consultada el 11 nov 2026)

| Servicio | Imagen |
|---|---|
| db | `supabase/postgres:17.6.1.136` |
| auth | `supabase/gotrue:v2.197.0` |
| rest | `postgrest/postgrest:v14.18` |
| storage | `supabase/storage-api:v1.89.12` |
| imgproxy | `darthsim/imgproxy:v4.0.21` |
| functions | `supabase/edge-runtime:v1.77.9` |
| realtime | `supabase/realtime:v2.148.3` |
| meta | `supabase/postgres-meta:v0.100.0` |
| studio | `supabase/studio:2026.11.02-sha-a05e7ec` |
| api-gw | `envoyproxy/envoy:v1.39.6` |
| supavisor | `supabase/supavisor:2.9.13` |
| web (SIGI) | `node:24-alpine` (compilación) → `nginx:1.29-alpine` |

Confirmar contra el `docker-compose.yml` descargado el día de la instalación: es ese archivo el que manda.

### 23.3 Migraciones de SIGI (en orden)

| Archivo | Qué hace |
|---|---|
| `20261104000100_esquema.sql` | Tablas base: empresas, membresías, catálogos, telecom, flotas, software, presupuesto, gastos, evidencias, personal, bitácora |
| `20261104000200_seguridad.sql` | RLS, funciones de permisos, triggers de control y bitácora, sin borrado, bucket `evidencias` y sus políticas |
| `20261104000300_usuarios.sql` | Roles y gestión de usuarios (`asignar_rol`, `listar_usuarios`) |
| `20261104000400_empresa_activa.sql` | Una empresa dada de baja queda de solo lectura para Captura |
| `20261104000500_presupuesto_gastos.sql` | Tasas de cambio, compromisos, facturas, pagos y reversos con bloqueo de partida |
| `20261104000600_importacion_csv.sql` | Importador CSV con revisión previa e idempotencia |
| `20261104000700_tema_empresa.sql` | Colores por empresa |
| `20261104000800_zona_horaria.sql` | Zona horaria `America/Santo_Domingo` |
| `20261104000900_resumen_gastos.sql` | Vista de resumen de gastos |
| `20261104001000_panel.sql` | Vista del panel |
| `20261104001100_privilegios_por_defecto.sql` | Nada nuevo nace con permiso de borrar o vaciar; las vistas son de solo lectura |
| `20261104001200_activos_proyectos.sql` | Activos, reposición y proyectos |
| `20261105000100_saldo_categoria.sql` | Saldo por partida con categoría |
| `20261105000200_factura_con_proveedor.sql` | Toda factura exige proveedor |
| `20261106000100_ajustes_auditoria.sql` | Índice de la bitácora por empresa y fecha; el traslape de ausencias ignora las dadas de baja |
| `20261106000200_areas_departamentos.sql` | Maestro de áreas y departamentos |
| `20261110000100_feriados.sql` | Catálogo de feriados |
| `20261111000100_iniciativas_ahorro.sql` | Iniciativas de ahorro |

### 23.4 Comandos de referencia rápida

```bash
# Estado
cd /opt/sigi/supabase && docker compose ps ; cd /opt/sigi/app && docker compose ps
# Respaldo
SIGI_DB_CONTAINER=supabase-db SIGI_STORAGE_CONTAINER=supabase-storage SIGI_STORAGE_DIR=/var/lib/storage bash /opt/sigi/app/scripts/respaldar.sh <destino>
# Migraciones pendientes
npx supabase migration list --db-url "$SIGI_DB_URL"
# Registros
cd /opt/sigi/supabase && sh run.sh logs <servicio>
# Prohibido sobre la instalación con datos
#   sh reset.sh · docker compose down -v · npm run db:reset · supabase db reset
```
