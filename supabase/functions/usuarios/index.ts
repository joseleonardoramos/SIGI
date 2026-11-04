// Crea un usuario con correo y contraseña temporal. Solo para el Administrador.
// La clave de servicio vive solo aquí, en el servidor; nunca llega al navegador.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const authorization = req.headers.get("Authorization") ?? "";

  // Verifica con la sesión de quien llama, no con la clave de servicio.
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: esAdmin, error: errAdmin } = await caller.rpc("es_admin");
  if (errAdmin || esAdmin !== true) return json({ error: "Solo el Administrador puede crear usuarios." }, 403);

  let email = "";
  let password = "";
  try {
    const body = await req.json();
    email = String(body.email ?? "").trim().toLowerCase();
    password = String(body.password ?? "");
  } catch {
    return json({ error: "Solicitud inválida." }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Correo inválido." }, 400);
  if (password.length < 12 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return json({ error: "La contraseña debe tener al menos 12 caracteres, con letras y números." }, 400);
  }

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    const dup = /already|registered|exists/i.test(error.message);
    return json({ error: dup ? "Ya existe un usuario con ese correo." : "No se pudo crear el usuario." }, dup ? 409 : 400);
  }
  return json({ id: data.user.id, email: data.user.email });
});
