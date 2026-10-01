import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server configuration is missing." }, 500);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Authentication required." }, 401);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Who is calling?
  const { data: userData, error: userError } = await adminClient.auth.getUser(token);
  if (userError || !userData?.user) return json({ error: "Invalid or expired admin session." }, 401);
  const callerId = userData.user.id;

  // Only Admin may delete users (same check as create-user)
  const { data: isAdmin, error: adminCheckError } = await adminClient.rpc("verify_admin_user", { p_user_id: callerId });
  if (adminCheckError) return json({ error: `Unable to verify admin profile: ${adminCheckError.message}` }, 500);
  if (isAdmin !== true) return json({ error: "Admin access required." }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON request." }, 400); }
  const userId = String(body.user_id ?? "").trim();
  if (!userId) return json({ error: "user_id is required." }, 400);
  if (userId === callerId) return json({ error: "You cannot delete yourself." }, 400);

  // Remove the profile first, then the login
  const { error: profileError } = await adminClient.from("user_profiles").delete().eq("id", userId);
  if (profileError) return json({ error: `Could not delete the user profile: ${profileError.message}` }, 400);

  const { error: authError } = await adminClient.auth.admin.deleteUser(userId);
  if (authError && !/not found/i.test(authError.message)) {
    return json({ error: `Profile removed but the login could not be deleted: ${authError.message}` }, 500);
  }
  return json({ ok: true });
});
