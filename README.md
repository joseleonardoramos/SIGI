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

## Primer Administrador

1. Crea el usuario en Studio → Authentication → Add user (correo y contraseña).
2. En Studio → SQL Editor:

```sql
insert into membresias (usuario_id, empresa_id, rol)
select id, null, 'Administrador' from auth.users where email = 'correo@empresa.com';
```

Después, el Administrador crea las empresas y asigna los roles desde la aplicación.

## Reglas de la base

- **Roles:** Administrador (global), Captura y Consulta (por empresa). Una persona puede tener roles distintos en empresas distintas.
- **Nada se borra.** Las bajas cambian `activo` a falso, exigen motivo y solo las hace el Administrador.
- **Bitácora:** cada alta y edición guarda el valor anterior y el nuevo.
- **Personal y ausencias:** solo los ven el Administrador y Captura.
- **«Aprobado por Dirección»:** marca informativa; solo la escribe el Administrador.
- **Secretos:** nunca en el repositorio. La clave `service_role` del proyecto en la nube no se usa en el frontend.
