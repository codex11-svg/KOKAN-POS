import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const featureDefaults = [
  { key: "enable_khata", label: "Khata ledger", description: "Allow trusted customers to buy now and settle later." },
  { key: "enable_gst", label: "GST tools", description: "Show GST-ready sales summaries and receipt fields." },
  { key: "enable_thermal_print", label: "Thermal printing", description: "Connect an ESC/POS Bluetooth receipt printer." },
  { key: "enable_camera_scan", label: "Camera scanner", description: "Use a device camera to read product barcodes." },
];

type JsonRecord = Record<string, unknown>;
type Mutation = { id: string; actionType: string; payload: unknown; timestamp: number; retryCount?: number };
type StoreRow = {
  id: string;
  name: string;
  owner_name: string;
  email: string;
  phone: string;
  area: string;
  status: string;
  owner_pin_hash?: string | null;
};

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function record(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected an object payload.");
  return value as JsonRecord;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function numeric(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function timestamp(value: unknown, fallback: number): string {
  const parsed = typeof value === "number" || typeof value === "string" ? new Date(value) : new Date(fallback);
  return Number.isNaN(parsed.getTime()) ? new Date(fallback).toISOString() : parsed.toISOString();
}

async function authenticatedUser(request: Request, supabase: SupabaseClient): Promise<User> {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in is required.");
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error("Your session is invalid or expired. Sign in again.");
  return data.user;
}

function isDeveloper(user: User): boolean {
  const allowed = Deno.env.get("DEVELOPER_ADMIN_EMAILS")?.split(",").map((email: string) => email.trim().toLowerCase()).filter(Boolean) ?? [];
  return !!user.email && allowed.includes(user.email.toLowerCase());
}

const ownerActions = new Set(["request_access", "account", "sync"]);
const developerActions = new Set([
  "dashboard",
  "approve_request",
  "reject_request",
  "provision_owner",
  "set_store_status",
  "set_feature",
  "create_support_note",
  "reset_owner_pin",
  "send_owner_recovery",
  "get_store_support_workspace",
]);

async function requirePlatformStore(supabase: SupabaseClient, storeId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeId)) {
    throw new Error("A valid store ID is required.");
  }
  const { data, error } = await supabase.from("stores").select("id,email,owner_pin_hash").eq("id", storeId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("The selected store no longer exists.");
  return data;
}

async function hashOwnerPin(ownerPin: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`kokan-pos:${ownerPin}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function assertStoreOwnership(
  supabase: SupabaseClient,
  table: "products" | "customers" | "invoices" | "staff" | "staff_shifts" | "operations_events",
  id: string,
  storeId: string,
): Promise<void> {
  const { data, error } = await supabase.from(table).select("store_id").eq("id", id).maybeSingle();
  if (error) throw error;
  if (data && data.store_id !== storeId) throw new Error("This record belongs to a different store.");
}

async function requireStore(supabase: SupabaseClient, userId: string): Promise<(StoreRow & { id: string }) | null> {
  const { data, error } = await supabase
    .from("store_memberships")
    .select("store_id, stores!inner(id,name,owner_name,email,phone,area,status,owner_pin_hash)")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const store = Array.isArray(data.stores) ? data.stores[0] : data.stores;
  if (!store) return null;
  const storeRecord = store as unknown as StoreRow;
  return { ...storeRecord, id: data.store_id as string };
}

async function createStoreAccess(
  supabase: SupabaseClient,
  input: { userId: string; email: string; shopName: string; ownerName: string; phone: string; area: string; ownerPin: string },
) {
  const ownerPinHash = await hashOwnerPin(input.ownerPin);
  const { data: store, error: storeError } = await supabase
    .from("stores")
    .insert({
      name: input.shopName,
      owner_name: input.ownerName,
      email: input.email,
      phone: input.phone,
      area: input.area,
      status: "active",
      owner_pin_hash: ownerPinHash,
    })
    .select("id")
    .single();
  if (storeError) throw storeError;

  const { error: membershipError } = await supabase
    .from("store_memberships")
    .insert({ store_id: store.id, user_id: input.userId, role: "owner" });
  if (membershipError) {
    await supabase.from("stores").delete().eq("id", store.id);
    throw membershipError;
  }

  const { error: featuresError } = await supabase.from("store_features").insert(
    featureDefaults.map((feature) => ({ store_id: store.id, feature_key: feature.key, enabled: true })),
  );
  if (featuresError) {
    await supabase.from("stores").delete().eq("id", store.id);
    throw featuresError;
  }

  return store.id as string;
}

async function ownerAccount(supabase: SupabaseClient, user: User) {
  const store = await requireStore(supabase, user.id);
  if (store) {
    if (store.status !== "active") return { status: "suspended", storeName: store.name, userName: user.user_metadata.full_name ?? null };
    const { data: featureRows, error } = await supabase.from("store_features").select("feature_key,enabled").eq("store_id", store.id);
    if (error) throw error;
    const features = Object.fromEntries((featureRows ?? []).map((feature: { feature_key: string; enabled: boolean }) => [feature.feature_key, feature.enabled]));
    return {
      status: "active",
      storeId: store.id,
      storeName: store.name,
      ownerName: store.owner_name,
      phone: store.phone,
      area: store.area,
      ownerPinHash: store.owner_pin_hash ?? null,
      features,
      userName: user.user_metadata.full_name ?? null,
    };
  }

  const { data: signupRequest, error } = await supabase
    .from("signup_requests")
    .select("id,user_id,email,shop_name,owner_name,phone,area,status,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return {
    status: signupRequest?.status ?? "unregistered",
    request: signupRequest ?? null,
    userName: user.user_metadata.full_name ?? null,
  };
}

async function platformDashboard(supabase: SupabaseClient) {
  const [storesResponse, requestsResponse, featureResponse, notesResponse, auditResponse] = await Promise.all([
    supabase.from("stores").select("id,name,owner_name,email,phone,area,status,created_at,store_features(feature_key,enabled)").order("created_at", { ascending: false }),
    supabase.from("signup_requests").select("id,user_id,email,shop_name,owner_name,phone,area,status,created_at").eq("status", "pending").order("created_at", { ascending: true }),
    supabase.from("platform_features").select("key,label,description").order("label"),
    supabase.from("developer_store_notes").select("id,store_id,note,author_email,created_at").order("created_at", { ascending: false }).limit(200),
    supabase.from("platform_audit_log").select("id,developer_email,action,store_id,details,created_at").order("created_at", { ascending: false }).limit(100),
  ]);
  for (const result of [storesResponse, requestsResponse, featureResponse, notesResponse, auditResponse]) {
    if (result.error) throw result.error;
  }

  return {
    stores: (storesResponse.data ?? []).map((store: StoreRow & {
      created_at: string;
      store_features: { feature_key: string; enabled: boolean }[];
    }) => {
      const { store_features: featureRows, ...storeDetails } = store;
      return {
        ...storeDetails,
        features: Object.fromEntries((featureRows ?? []).map((feature) => [feature.feature_key, feature.enabled])),
      };
    }),
    requests: requestsResponse.data ?? [],
    features: featureResponse.data ?? [],
    supportNotes: notesResponse.data ?? [],
    auditLog: auditResponse.data ?? [],
  };
}

async function writeAudit(
  supabase: SupabaseClient,
  user: User,
  action: string,
  storeId: string | null,
  details: JsonRecord = {},
): Promise<string | null> {
  const { error } = await supabase.from("platform_audit_log").insert({
    developer_email: user.email ?? "unknown",
    action,
    store_id: storeId,
    details,
  });
  return error?.message ?? null;
}

async function syncMutation(supabase: SupabaseClient, storeId: string, mutation: Mutation) {
  const payload = record(mutation.payload);
  const updatedAt = timestamp(payload.updatedAt, mutation.timestamp);
  switch (mutation.actionType) {
    case "UPSERT_SHOP_PROFILE":
      return supabase.from("shop_profiles").upsert({
        store_id: storeId,
        id: text(payload.id, "current_shop"),
        shop_name: text(payload.shopName, "Kokan POS"),
        owner_name: text(payload.ownerName),
        area: text(payload.area),
        phone: text(payload.phone),
        upi_id: text(payload.upiId),
        updated_at: updatedAt,
      }, { onConflict: "store_id,id" });
    case "UPSERT_PRODUCT": {
      const id = text(payload.id);
      if (!id) throw new Error("Product id is required.");
      await assertStoreOwnership(supabase, "products", id, storeId);
      return supabase.from("products").upsert({
        id,
        store_id: storeId,
        name: text(payload.name, "New product"),
        barcode: text(payload.barcode) || null,
        category: text(payload.category, "Grocery"),
        unit: text(payload.unit, "unit"),
        selling_price: numeric(payload.sellingPrice),
        cost_price: numeric(payload.costPrice),
        stock_qty: numeric(payload.stockQty),
        updated_at: updatedAt,
      });
    }
    case "DELETE_PRODUCT": {
      const id = text(payload.id);
      if (!id) throw new Error("Product id is required.");
      return supabase.from("products").delete().eq("id", id).eq("store_id", storeId);
    }
    case "UPSERT_CUSTOMER": {
      const id = text(payload.id);
      if (!id) throw new Error("Customer id is required.");
      await assertStoreOwnership(supabase, "customers", id, storeId);
      return supabase.from("customers").upsert({
        id,
        store_id: storeId,
        name: text(payload.name, "Customer"),
        phone: text(payload.phone),
        current_balance: numeric(payload.currentBalance),
        updated_at: updatedAt,
      });
    }
    case "UPSERT_INVOICE": {
      const id = text(payload.id);
      if (!id) throw new Error("Invoice id is required.");
      await assertStoreOwnership(supabase, "invoices", id, storeId);
      const items = Array.isArray(payload.items) ? payload.items : [];
      return supabase.from("invoices").upsert({
        id,
        store_id: storeId,
        customer_id: typeof payload.customerId === "string" ? payload.customerId : null,
        customer_name: typeof payload.customerName === "string" ? payload.customerName : null,
        customer_phone: typeof payload.customerPhone === "string" ? payload.customerPhone : null,
        items_json: items,
        subtotal: numeric(payload.subtotal),
        discount: numeric(payload.discount),
        total_amount: numeric(payload.totalAmount),
        payment_mode: text(payload.paymentMode, "cash"),
        created_at: timestamp(payload.createdAt, mutation.timestamp),
      }, { onConflict: "id", ignoreDuplicates: true });
    }
    case "UPSERT_OPERATION": {
      const id = text(payload.id);
      if (!id || typeof payload.payload !== "object" || payload.payload === null || Array.isArray(payload.payload)) {
        throw new Error("An operation ID and details are required.");
      }
      await assertStoreOwnership(supabase, "operations_events", id, storeId);
      return supabase.from("operations_events").upsert({
        id,
        store_id: storeId,
        payload: payload.payload,
        created_at: timestamp(payload.createdAt, mutation.timestamp),
        updated_at: updatedAt,
      }, { onConflict: "id" });
    }
    case "UPSERT_FEATURE_FLAG":
      return supabase.from("feature_flags").upsert({
        store_id: storeId,
        id: text(payload.id, text(payload.key)),
        key: text(payload.key, text(payload.id)),
        label: text(payload.label),
        description: text(payload.description),
        enabled: payload.enabled === true,
        updated_at: updatedAt,
      }, { onConflict: "store_id,id" });
    case "UPSERT_STAFF": {
      const id = text(payload.id);
      if (!id) throw new Error("Staff id is required.");
      await assertStoreOwnership(supabase, "staff", id, storeId);
      const { error } = await supabase.from("staff").upsert({
        id,
        store_id: storeId,
        name: text(payload.name, "Team member"),
        role: text(payload.role, "cashier"),
        active: payload.active !== false,
        pin_hash: text(payload.pinHash),
        hourly_rate: Math.max(0, numeric(payload.hourlyRate)),
        updated_at: updatedAt,
      });
      if (error) throw error;
      if (text(payload.role) === "owner") {
        return supabase.from("stores").update({ owner_pin_hash: text(payload.pinHash) }).eq("id", storeId);
      }
      return { error: null };
    }
    case "UPSERT_STAFF_SHIFT": {
      const id = text(payload.id);
      const staffId = text(payload.staffId);
      if (!id || !staffId) throw new Error("Shift and staff IDs are required.");
      await assertStoreOwnership(supabase, "staff_shifts", id, storeId);
      const { data: staffRecord, error: staffError } = await supabase.from("staff").select("store_id").eq("id", staffId).maybeSingle();
      if (staffError) throw staffError;
      if (!staffRecord || staffRecord.store_id !== storeId) throw new Error("The shift member does not belong to this store.");
      return supabase.from("staff_shifts").upsert({
        id,
        store_id: storeId,
        staff_id: staffId,
        staff_name: text(payload.staffName, "Team member"),
        started_at: timestamp(payload.startedAt, mutation.timestamp),
        ended_at: payload.endedAt === null || typeof payload.endedAt === "number" || typeof payload.endedAt === "string"
          ? payload.endedAt === null ? null : timestamp(payload.endedAt, mutation.timestamp)
          : null,
        hourly_rate: Math.max(0, numeric(payload.hourlyRate)),
        updated_at: updatedAt,
      }, { onConflict: "id" });
    }
    default:
      throw new Error(`Unsupported sync action: ${mutation.actionType}`);
  }
}

async function storeSnapshot(supabase: SupabaseClient, storeId: string) {
  const [shop, products, customers, invoices, flags, staff, shifts, operations] = await Promise.all([
    supabase.from("shop_profiles").select("*").eq("store_id", storeId).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("products").select("*").eq("store_id", storeId),
    supabase.from("customers").select("*").eq("store_id", storeId),
    supabase.from("invoices").select("*").eq("store_id", storeId).order("created_at", { ascending: false }).limit(5000),
    supabase.from("feature_flags").select("*").eq("store_id", storeId),
    supabase.from("staff").select("*").eq("store_id", storeId),
    supabase.from("staff_shifts").select("*").eq("store_id", storeId).order("started_at", { ascending: false }).limit(5000),
    supabase.from("operations_events").select("*").eq("store_id", storeId).order("created_at", { ascending: false }).limit(5000),
  ]);
  for (const result of [shop, products, customers, invoices, flags, staff, shifts, operations]) {
    if (result.error) throw result.error;
  }

  return {
    shop: shop.data ? {
      id: shop.data.id,
      shopName: shop.data.shop_name,
      ownerName: shop.data.owner_name,
      area: shop.data.area,
      phone: shop.data.phone,
      upiId: shop.data.upi_id,
      updatedAt: new Date(shop.data.updated_at).getTime(),
    } : null,
    products: (products.data ?? []).map((item: Record<string, unknown>) => ({
      id: item.id, name: item.name, barcode: item.barcode, category: item.category, unit: item.unit,
      sellingPrice: item.selling_price, costPrice: item.cost_price, stockQty: item.stock_qty,
      updatedAt: new Date(item.updated_at).getTime(), synced: 1,
    })),
    shifts: (shifts.data ?? []).map((item: Record<string, unknown>) => ({
      id: item.id,
      staffId: item.staff_id,
      staffName: item.staff_name,
      startedAt: new Date(item.started_at as string).getTime(),
      endedAt: item.ended_at ? new Date(item.ended_at as string).getTime() : null,
      hourlyRate: item.hourly_rate,
      updatedAt: new Date(item.updated_at as string).getTime(),
      synced: 1,
    })),
    operations: (operations.data ?? []).map((item: Record<string, unknown>) => ({
      id: item.id,
      payload: item.payload,
      createdAt: new Date(item.created_at as string).getTime(),
      updatedAt: new Date(item.updated_at as string).getTime(),
      synced: 1,
    })),
    customers: (customers.data ?? []).map((item: Record<string, unknown>) => ({
      id: item.id, name: item.name, phone: item.phone, currentBalance: item.current_balance,
      updatedAt: new Date(item.updated_at).getTime(), synced: 1,
    })),
    invoices: (invoices.data ?? []).map((item: Record<string, unknown>) => ({
      id: item.id, customerId: item.customer_id, customerName: item.customer_name, customerPhone: item.customer_phone, items: item.items_json,
      subtotal: item.subtotal, discount: item.discount, totalAmount: item.total_amount,
      paymentMode: item.payment_mode, createdAt: new Date(item.created_at).getTime(), synced: 1,
    })),
    flags: (flags.data ?? []).map((item: Record<string, unknown>) => ({
      id: item.id, key: item.key, label: item.label, description: item.description,
      enabled: item.enabled, updatedAt: new Date(item.updated_at).getTime(), synced: 1,
    })),
    staff: (staff.data ?? []).map((item: Record<string, unknown>) => ({
      id: item.id, name: item.name, role: item.role, active: item.active, pinHash: item.pin_hash,
      hourlyRate: item.hourly_rate, updatedAt: new Date(item.updated_at).getTime(), synced: 1,
    })),
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return response({ error: "Platform API is not configured." }, 503);
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const user = await authenticatedUser(request, supabase);
    const body = await request.json() as JsonRecord;
    const action = text(body.action);
    if (!ownerActions.has(action) && !developerActions.has(action)) {
      return response({ error: "Unknown platform action." }, 400);
    }

    if (action === "request_access") {
      const shopName = text(body.shopName);
      const ownerName = text(body.ownerName);
      const phone = text(body.phone);
      const area = text(body.area);
      if (!shopName || !ownerName || !phone || !area) return response({ error: "Complete all shop details before submitting." }, 400);
      if (await requireStore(supabase, user.id)) return response({ error: "This account already has store access." }, 409);

      const { data: prior, error: priorError } = await supabase.from("signup_requests").select("status")
        .eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (priorError) throw priorError;
      if (prior?.status === "pending") return response({ error: "You already have a request awaiting review." }, 409);

      const { error } = await supabase.from("signup_requests").insert({
        user_id: user.id, email: user.email ?? "", shop_name: shopName, owner_name: ownerName, phone, area,
      });
      if (error) throw error;
      return response({ ok: true });
    }

    if (action === "account") return response(await ownerAccount(supabase, user));

    if (action === "sync") {
      const store = await requireStore(supabase, user.id);
      if (!store || store.status !== "active") return response({ error: "Your store does not currently have active access." }, 403);
      if (text(body.storeId) !== store.id) return response({ error: "This sync request is for a different store." }, 403);
      if (!Array.isArray(body.mutations) || body.mutations.length > 100) return response({ error: "Sync accepts up to 100 changes at a time." }, 400);
      const results: { id: string; success: boolean; error?: string }[] = [];
      for (const [index, mutationValue] of body.mutations.entries()) {
        const mutation = record(mutationValue) as unknown as Mutation;
        const id = text(mutation.id, `invalid-${index}`);
        try {
          if (!text(mutation.actionType) || typeof mutation.timestamp !== "number") throw new Error("Invalid sync change.");
          const { error } = await syncMutation(supabase, store.id, mutation);
          if (error) throw error;
          results.push({ id, success: true });
        } catch (syncError) {
          results.push({ id, success: false, error: syncError instanceof Error ? syncError.message : "Sync failed." });
        }
      }
      return response({ results, snapshot: await storeSnapshot(supabase, store.id) });
    }

    if (!isDeveloper(user)) return response({ error: "This account is not authorized for developer administration." }, 403);

    if (action === "dashboard") return response(await platformDashboard(supabase));

    if (action === "approve_request" || action === "reject_request") {
      const requestId = text(body.requestId);
      const ownerPin = text(body.ownerPin);
      if (action === "approve_request" && !/^\d{4}$/.test(ownerPin)) {
        return response({ error: "Generate a four-digit numeric owner PIN before approving this request." }, 400);
      }
      const { data: signupRequest, error } = await supabase.from("signup_requests").select("*").eq("id", requestId).eq("status", "pending").maybeSingle();
      if (error) throw error;
      if (!signupRequest) return response({ error: "This request is no longer pending." }, 404);
      if (action === "reject_request") {
        const { error: rejectError } = await supabase.from("signup_requests")
          .update({ status: "rejected", reviewed_at: new Date().toISOString() }).eq("id", requestId);
        if (rejectError) throw rejectError;
        const auditWarning = await writeAudit(supabase, user, "reject_signup_request", null, { requestId, shopName: signupRequest.shop_name });
        return response({ ok: true, auditWarning });
      }
      const storeId = await createStoreAccess(supabase, {
        userId: signupRequest.user_id, email: signupRequest.email, shopName: signupRequest.shop_name,
        ownerName: signupRequest.owner_name, phone: signupRequest.phone, area: signupRequest.area, ownerPin,
      });
      const { error: reviewError } = await supabase.from("signup_requests")
        .update({ status: "approved", reviewed_at: new Date().toISOString() }).eq("id", requestId);
      if (reviewError) {
        await supabase.from("stores").delete().eq("id", storeId);
        throw reviewError;
      }
      const auditWarning = await writeAudit(supabase, user, "approve_signup_request", storeId, { requestId, shopName: signupRequest.shop_name });
      return response({ ok: true, storeId, auditWarning });
    }

    if (action === "provision_owner") {
      const email = text(body.email).toLowerCase();
      const password = text(body.password);
      const shopName = text(body.shopName);
      const ownerName = text(body.ownerName);
      const phone = text(body.phone);
      const area = text(body.area);
      const ownerPin = text(body.ownerPin);
      if (!email || !password || !shopName || !ownerName) return response({ error: "Email, temporary password, shop name, and owner name are required." }, 400);
      if (password.length < 12) return response({ error: "Temporary passwords must be at least 12 characters." }, 400);
      if (!/^\d{4}$/.test(ownerPin)) return response({ error: "The store owner PIN must be exactly four digits." }, 400);
      const { data: userData, error: userError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: ownerName, must_change_password: true },
      });
      if (userError) throw userError;
      if (!userData.user) throw new Error("The owner account could not be created.");
      try {
        const storeId = await createStoreAccess(supabase, { userId: userData.user.id, email, shopName, ownerName, phone, area, ownerPin });
        const auditWarning = await writeAudit(supabase, user, "provision_owner", storeId, { email, shopName });
        return response({ ok: true, email, storeId, auditWarning });
      } catch (createError) {
        await supabase.auth.admin.deleteUser(userData.user.id);
        throw createError;
      }
    }

    if (action === "set_store_status") {
      const storeId = text(body.storeId);
      const status = text(body.status);
      if (!["active", "suspended"].includes(status)) return response({ error: "Invalid store status." }, 400);
      await requirePlatformStore(supabase, storeId);
      const { error } = await supabase.from("stores").update({ status, updated_at: new Date().toISOString() }).eq("id", storeId);
      if (error) throw error;
      const auditWarning = await writeAudit(supabase, user, "set_store_status", storeId, { status });
      return response({ ok: true, auditWarning });
    }

    if (action === "set_feature") {
      const storeId = text(body.storeId);
      const featureKey = text(body.featureKey);
      if (!featureDefaults.some((feature) => feature.key === featureKey) || typeof body.enabled !== "boolean") {
        return response({ error: "Invalid store feature update." }, 400);
      }
      await requirePlatformStore(supabase, storeId);
      const { error } = await supabase.from("store_features").upsert({
        store_id: storeId, feature_key: featureKey, enabled: body.enabled, updated_at: new Date().toISOString(),
      }, { onConflict: "store_id,feature_key" });
      if (error) throw error;
      const auditWarning = await writeAudit(supabase, user, "set_store_feature", storeId, { featureKey, enabled: body.enabled });
      return response({ ok: true, auditWarning });
    }

    if (action === "create_support_note") {
      const storeId = text(body.storeId);
      const note = text(body.note);
      if (!storeId || note.length < 1 || note.length > 2000) {
        return response({ error: "Choose a store and enter a support note of 1–2,000 characters." }, 400);
      }
      await requirePlatformStore(supabase, storeId);
      const authorEmail = user.email ?? "unknown";
      const { data: supportNote, error } = await supabase.from("developer_store_notes")
        .insert({ store_id: storeId, note, author_email: authorEmail })
        .select("id,store_id,note,author_email,created_at")
        .single();
      if (error) throw error;
      const auditWarning = await writeAudit(supabase, user, "create_support_note", storeId, { noteId: supportNote.id });
      return response({ ok: true, supportNote, auditWarning });
    }

    if (action === "reset_owner_pin") {
      const storeId = text(body.storeId);
      const ownerPin = text(body.ownerPin);
      if (!/^\d{4}$/.test(ownerPin)) return response({ error: "Enter a four-digit owner PIN." }, 400);
      const store = await requirePlatformStore(supabase, storeId);
      const replacementHash = await hashOwnerPin(ownerPin);
      const { data: ownerStaff, error: ownerStaffError } = await supabase.from("staff")
        .select("id").eq("store_id", storeId).eq("role", "owner");
      if (ownerStaffError) throw ownerStaffError;
      const { error } = await supabase.from("stores")
        .update({ owner_pin_hash: replacementHash, updated_at: new Date().toISOString() })
        .eq("id", storeId);
      if (error) throw error;
      if (ownerStaff?.length) {
        const { error: staffUpdateError } = await supabase.from("staff")
          .update({ pin_hash: replacementHash, updated_at: new Date().toISOString() })
          .eq("store_id", storeId).eq("role", "owner");
        if (staffUpdateError) {
          await supabase.from("stores").update({ owner_pin_hash: store.owner_pin_hash }).eq("id", storeId);
          throw staffUpdateError;
        }
      }
      const auditWarning = await writeAudit(supabase, user, "reset_owner_pin", storeId);
      return response({ ok: true, auditWarning });
    }

    if (action === "send_owner_recovery") {
      const storeId = text(body.storeId);
      await requirePlatformStore(supabase, storeId);
      const { data: membership, error: membershipError } = await supabase.from("store_memberships")
        .select("user_id").eq("store_id", storeId).eq("role", "owner").maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) return response({ error: "No owner account is linked to this store." }, 404);
      const { data: ownerData, error: ownerError } = await supabase.auth.admin.getUserById(membership.user_id);
      if (ownerError) throw ownerError;
      const ownerEmail = ownerData.user?.email;
      if (!ownerEmail) return response({ error: "The linked owner account has no recovery email." }, 409);
      const { error } = await supabase.auth.resetPasswordForEmail(ownerEmail);
      if (error) throw error;
      const auditWarning = await writeAudit(supabase, user, "send_owner_recovery", storeId);
      return response({ ok: true, auditWarning });
    }

    if (action === "get_store_support_workspace") {
      const storeId = text(body.storeId);
      await requirePlatformStore(supabase, storeId);
      const [products, customers, invoices, staff, operations, lastInvoice, lastOperation, notes, audit] = await Promise.all([
        supabase.from("products").select("id", { count: "exact", head: true }).eq("store_id", storeId),
        supabase.from("customers").select("id", { count: "exact", head: true }).eq("store_id", storeId),
        supabase.from("invoices").select("id", { count: "exact", head: true }).eq("store_id", storeId),
        supabase.from("staff").select("id", { count: "exact", head: true }).eq("store_id", storeId),
        supabase.from("operations_events").select("id", { count: "exact", head: true }).eq("store_id", storeId),
        supabase.from("invoices").select("created_at").eq("store_id", storeId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("operations_events").select("created_at").eq("store_id", storeId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("developer_store_notes").select("id,store_id,note,author_email,created_at").eq("store_id", storeId).order("created_at", { ascending: false }).limit(20),
        supabase.from("platform_audit_log").select("id,developer_email,action,store_id,details,created_at").eq("store_id", storeId).order("created_at", { ascending: false }).limit(50),
      ]);
      for (const result of [products, customers, invoices, staff, operations, lastInvoice, lastOperation, notes, audit]) {
        if (result.error) throw result.error;
      }
      const auditWarning = await writeAudit(supabase, user, "view_store_support_workspace", storeId);
      return response({
        storeId,
        counts: {
          products: products.count ?? 0,
          customers: customers.count ?? 0,
          invoices: invoices.count ?? 0,
          staff: staff.count ?? 0,
          operations: operations.count ?? 0,
        },
        latestInvoiceAt: lastInvoice.data?.created_at ?? null,
        latestOperationAt: lastOperation.data?.created_at ?? null,
        supportNotes: notes.data ?? [],
        auditLog: audit.data ?? [],
        auditWarning,
      });
    }

    return response({ error: "Unknown platform action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Platform request could not be completed.";
    const status = /sign in|session is invalid/i.test(message) ? 401 : /no longer exists/i.test(message) ? 404 : 400;
    return response({ error: message }, status);
  }
});
