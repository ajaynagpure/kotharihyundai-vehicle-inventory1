import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers:corsHeaders});

Deno.serve(async req => {
  if(req.method === "OPTIONS") return new Response("ok", {headers:corsHeaders});
  if(req.method !== "POST") return json({error:"Method not allowed."}, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL"), serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!supabaseUrl || !serviceRoleKey) return json({error:"Server configuration is missing."}, 500);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if(!token) return json({error:"Authentication required."}, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {auth:{autoRefreshToken:false,persistSession:false}});
  const {data:userData,error:userError} = await admin.auth.getUser(token);
  if(userError || !userData.user) return json({error:"Invalid or expired admin session."}, 401);
  const {data:isAdmin,error:adminError} = await admin.rpc("verify_admin_user", {p_user_id:userData.user.id});
  if(adminError) return json({error:`Unable to verify admin profile: ${adminError.message}`}, 500);
  if(isAdmin !== true) return json({error:"Admin access required."}, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({error:"Invalid JSON request."}, 400); }
  const userId = String(body.user_id || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if(!userId) return json({error:"User ID is required."}, 400);
  if(!email && !password) return json({error:"Enter an email address or a new password."}, 400);
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({error:"Enter a valid email address."}, 400);
  if(password && (password.length < 6 || password.length > 12)) return json({error:"Password must be 6 to 12 characters."}, 400);

  const {data:profile,error:profileError} = await admin.from("user_profiles").select("id").eq("id",userId).maybeSingle();
  if(profileError) return json({error:profileError.message}, 500);
  if(!profile) return json({error:"User not found."}, 404);

  const authPatch: Record<string, unknown> = {};
  if(email){ authPatch.email = email; authPatch.email_confirm = true; }
  if(password) authPatch.password = password;
  const {error:authError} = await admin.auth.admin.updateUserById(userId, authPatch);
  if(authError) return json({error:authError.message}, 400);

  const profilePatch: Record<string, string> = {};
  if(email) profilePatch.email = email;
  if(password) profilePatch.password_display = password;
  const {error:saveError} = await admin.from("user_profiles").update(profilePatch).eq("id",userId);
  if(saveError) return json({error:`Auth updated, but profile details could not be saved: ${saveError.message}`}, 500);

  return json({ok:true,email:email || undefined,password_updated:!!password});
});