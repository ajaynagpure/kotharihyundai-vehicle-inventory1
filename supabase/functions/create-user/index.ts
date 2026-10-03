import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });

const normalizeUsername = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // =====================================================
  // ENVIRONMENT
  // =====================================================

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return json(
      { error: "Server configuration is missing." },
      500
    );
  }

  // =====================================================
  // AUTH TOKEN
  // =====================================================

  const authHeader =
    req.headers.get("Authorization") ?? "";

  const token = authHeader
    .replace(/^Bearer\s+/i, "")
    .trim();

  if (!token) {
    return json(
      { error: "Authentication required." },
      401
    );
  }

  // =====================================================
  // SERVICE ROLE CLIENT
  // =====================================================

  const adminClient = createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  // =====================================================
  // VERIFY CURRENT LOGIN USER
  // =====================================================

  const {
    data: userData,
    error: userError,
  } = await adminClient.auth.getUser(token);

  if (userError || !userData?.user) {
    console.error(
      "Auth verification error:",
      userError
    );

    return json(
      { error: "Invalid or expired admin session." },
      401
    );
  }

  const callerId = userData.user.id;

  // =====================================================
  // VERIFY ADMIN USING SECURITY DEFINER RPC
  // =====================================================

  const {
    data: isAdmin,
    error: adminCheckError,
  } = await adminClient.rpc(
    "verify_admin_user",
    {
      p_user_id: callerId,
    }
  );

  if (adminCheckError) {
    console.error(
      "Admin verification error:",
      adminCheckError
    );

    return json(
      {
        error:
          `Unable to verify admin profile: ${adminCheckError.message}`,
      },
      500
    );
  }

  if (isAdmin !== true) {
    return json(
      { error: "Admin access required." },
      403
    );
  }

  // =====================================================
  // READ REQUEST
  // =====================================================

  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    return json(
      { error: "Invalid JSON request." },
      400
    );
  }

  // =====================================================
  // USER DATA
  // =====================================================

  const username = normalizeUsername(
    body.username
  );

  const fullName = String(
    body.full_name ?? ""
  ).trim();

  const email = String(
    body.email ?? ""
  ).trim().toLowerCase();

  const password = String(
    body.password ?? ""
  );

  const roleId = String(
    body.role_id ?? ""
  ).trim();

  const locationIdRaw = body.location_id;

  const locationId =
    locationIdRaw &&
    String(locationIdRaw).trim() !== ""
      ? String(locationIdRaw).trim()
      : null;

  const active =
    body.active !== false;

  // =====================================================
  // BASIC VALIDATION
  // =====================================================

  if (
    !username ||
    !fullName ||
    !email ||
    !password ||
    !roleId
  ) {
    return json(
      {
        error:
          "Username, full name, email, password and role are required.",
      },
      400
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Enter a valid email address." }, 400);
  }

  // Password 6 to 12 characters
  if (
    password.length < 6 ||
    password.length > 12
  ) {
    return json(
      {
        error:
          "Password must be 6 to 12 characters.",
      },
      400
    );
  }

  // Username validation
  if (
    !/^[a-z0-9._-]{3,40}$/.test(username)
  ) {
    return json(
      {
        error:
          "Username must contain only letters, numbers, dot, underscore or hyphen.",
      },
      400
    );
  }

  // =====================================================
  // ROLE VALIDATION
  // =====================================================

  const {
    data: role,
    error: roleError,
  } = await adminClient
    .from("roles")
    .select("id, name")
    .eq("id", roleId)
    .maybeSingle();

  if (roleError) {
    console.error(
      "Role lookup error:",
      roleError
    );

    return json(
      {
        error:
          `Unable to verify selected role: ${roleError.message}`,
      },
      500
    );
  }

  if (!role) {
    return json(
      { error: "Selected role is invalid." },
      400
    );
  }

  // =====================================================
  // LOCATION VALIDATION
  // NULL = ALL LOCATIONS
  // =====================================================

  if (locationId) {
    const {
      data: location,
      error: locationError,
    } = await adminClient
      .from("locations")
      .select(
        "id, location_name, location_code, active"
      )
      .eq("id", locationId)
      .maybeSingle();

    if (locationError) {
      console.error(
        "Location lookup error:",
        locationError
      );

      return json(
        {
          error:
            `Unable to verify selected location: ${locationError.message}`,
        },
        500
      );
    }

    if (!location) {
      return json(
        { error: "Selected location is invalid." },
        400
      );
    }

    if (location.active === false) {
      return json(
        { error: "Selected location is inactive." },
        400
      );
    }
  }

  // =====================================================
  // USERNAME UNIQUE CHECK
  // =====================================================

  const {
    data: existingProfile,
    error: existingError,
  } = await adminClient
    .from("user_profiles")
    .select("id")
    .ilike("username", username)
    .maybeSingle();

  if (existingError) {
    console.error(
      "Username lookup error:",
      existingError
    );

    return json(
      {
        error:
          `Unable to check username: ${existingError.message}`,
      },
      500
    );
  }

  if (existingProfile) {
    return json(
      { error: "Username already exists." },
      409
    );
  }

  // =====================================================
  // AUTH EMAIL: use the real email entered by Admin.
  // This is what Supabase Authentication > Users will show.
  // =====================================================

  const authEmail = email;

  // =====================================================
  // CREATE AUTH USER
  // =====================================================

  const {
    data: created,
    error: createError,
  } =
    await adminClient.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        full_name: fullName,
        email,
      },
    });

  if (
    createError ||
    !created?.user
  ) {
    console.error(
      "Auth create error:",
      createError
    );

    return json(
      {
        error:
          createError?.message ||
          "Unable to create authentication user.",
      },
      400
    );
  }

  const newUserId =
    created.user.id;

  // =====================================================
  // CREATE USER PROFILE
  // =====================================================

  const {
    data: profile,
    error: insertError,
  } = await adminClient
    .from("user_profiles")
    .insert({
      id: newUserId,
      username,
      full_name: fullName,
      email,
      role_id: roleId,
      location_id: locationId,
      active,
    })
    .select(
      "id, username, full_name, email, role_id, location_id, active"
    )
    .single();

  // =====================================================
  // ROLLBACK AUTH USER IF PROFILE FAILS
  // =====================================================

  if (insertError) {
    await adminClient.auth.admin.deleteUser(
      newUserId
    );

    console.error(
      "Profile insert error:",
      insertError
    );

    return json(
      {
        error:
          `Unable to save user profile: ${insertError.message}`,
      },
      400
    );
  }

  // =====================================================
  // AUDIT LOG
  // =====================================================

  try {
    await adminClient
      .from("audit_logs")
      .insert({
        actor_id: callerId,
        action: "CREATE_USER",
        entity_type: "user_profiles",
        entity_id: newUserId,
        details: {
          username,
          full_name: fullName,
          role: role.name,
          location_id: locationId,
          active,
        },
      });
  } catch (auditError) {
    console.warn(
      "Audit log skipped:",
      auditError
    );
  }

  // =====================================================
  // SUCCESS
  // =====================================================

  return json(
    {
      success: true,
      user: profile,
      auth_email: authEmail,
    },
    201
  );
});