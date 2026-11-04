# SIGI — Sistema Integral de Gestión de Infraestructura

- `docs/` — diseño funcional (v3.1).
- `design/` — prototipo de pantallas (lienzo de Claude Design).
- `supabase/` — base de datos: migraciones, seguridad y pruebas.

## Desarrollo local

Requisitos: Docker Desktop abierto y Node 20 o superior.

```bash
npm install          # instala la CLI de Supabase del proyecto
npm run db:start     # levanta Supabase en Docker y aplica las migraciones
npm run db:test      # pruebas de seguridad (RLS, bajas, historial)
npm run db:reset     # borra la base local y la recrea desde las migraciones
npm run db:stop
```

Studio local: http://127.0.0.1:54323. Las claves locales se ven con `npx supabase status`; son de desarrollo y no sirven fuera de esta máquina.

## Frontend en Docker

1. Copia `.env.example` a `.env` y pon en `VITE_SUPABASE_PUBLISHABLE_KEY` el valor `PUBLISHABLE_KEY` de `npx supabase status`.
2. Levanta la aplicación en http://localhost:8080:

```bash
npm run web:start
```

Para desarrollar con recarga automática: copia `.env` a `web/.env.local` y ejecuta `npm run dev` dentro de `web/` (http://localhost:5173).

## Primer Administrador

Nadie puede registrarse solo: los usuarios los crea el Administrador. El primero se crea con el script, usando la clave de servicio en el entorno (nunca en un archivo del repositorio):

```bash
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY de supabase status> npm run admin:crear -- correo@empresa.com 'Contraseña12345'
```

Si el usuario ya existe, el script solo le da el rol de Administrador. Después, el Administrador entra a la aplicación y:

- **Empresas:** crea, edita o da de baja (con motivo) cada empresa.
- **Usuarios y roles:** crea usuarios con una contraseña temporal y elige el rol en cada empresa (Sin acceso, Consulta o Captura) o el rol global de Administrador.
- Cada usuario cambia su contraseña temporal en «Cambiar contraseña» (mínimo 12 caracteres, con letras y números).

## Reglas de la base

- **Roles:** Administrador (global), Captura y Consulta (por empresa). Una persona puede tener roles distintos en empresas distintas.
- **Nada se borra.** Las bajas cambian `activo` a falso, exigen motivo y solo las hace el Administrador.
- **Bitácora:** cada alta y edición guarda el valor anterior y el nuevo.
- **Personal y ausencias:** solo los ven el Administrador y Captura.
- **«Aprobado por Dirección»:** marca informativa; solo la escribe el Administrador.
- **Secretos:** nunca en el repositorio. La clave `service_role` del proyecto en la nube no se usa en el frontend.
