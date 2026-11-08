"use client";

import {
  ArrowUpRight,
  Check,
  CircleAlert,
  CircleCheck,
  Clock3,
  Download,
  KeyRound,
  LogOut,
  Mail,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient, platformApiErrorMessage, type PlatformDashboard, type PlatformFeature, type PlatformStore, type SignupRequest } from "@/lib/supabase";
import { csvCell, formatDateTime, formatMoney } from "@/lib/format";

interface ProvisionDraft {
  email: string;
  shopName: string;
  ownerName: string;
  phone: string;
  area: string;
}

const emptyProvisionDraft: ProvisionDraft = { email: "", shopName: "", ownerName: "", phone: "", area: "" };

function generateStorePin(): string {
  const random = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / 10_000) * 10_000;
  let value: number;
  do {
    crypto.getRandomValues(random);
    value = random[0];
  } while (value >= limit);
  return String(value % 10_000).padStart(4, "0");
}

export function DeveloperConsole() {
  const supabase = getSupabaseClient();
  const [session, setSession] = useState<Session | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const authReady = !supabase || authInitialized;
  const [dashboard, setDashboard] = useState<PlatformDashboard | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");
  const [storeStatusFilter, setStoreStatusFilter] = useState<"all" | "active" | "suspended">("all");
  const [storeFeatureFilter, setStoreFeatureFilter] = useState("all");
  const [storeAreaFilter, setStoreAreaFilter] = useState("all");
  const [storeSort, setStoreSort] = useState<"newest" | "oldest" | "name" | "owner">("newest");
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
  const [bulkFeatureKey, setBulkFeatureKey] = useState("");
  const [supportNoteDrafts, setSupportNoteDrafts] = useState<Record<string, string>>({});
  const [auditSearch, setAuditSearch] = useState("");
  const [auditActionFilter, setAuditActionFilter] = useState("all");
  const [draft, setDraft] = useState<ProvisionDraft>(emptyProvisionDraft);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [ownerPin, setOwnerPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [workingKey, setWorkingKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadDashboard = useCallback(async () => {
    if (!supabase || !session) return;
    setError("");
    setLoading(true);
    try {
      const { data, error: functionError } = await supabase.functions.invoke("platform-api", { body: { action: "dashboard" } });
      if (functionError) throw functionError;
      if (!data || !Array.isArray(data.stores) || !Array.isArray(data.requests)) {
        throw new Error("Developer access could not be verified. Ensure this email is in DEVELOPER_ADMIN_EMAILS.");
      }
      const loadedDashboard = data as PlatformDashboard;
      setDashboard({
        ...loadedDashboard,
        supportNotes: Array.isArray(loadedDashboard.supportNotes) ? loadedDashboard.supportNotes : [],
        auditLog: Array.isArray(loadedDashboard.auditLog) ? loadedDashboard.auditLog : [],
      });
    } catch (loadError) {
      setDashboard(null);
      setError(await platformApiErrorMessage(loadError, "The developer dashboard could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [session, supabase]);

  useEffect(() => {
    if (!supabase) {
      return;
    }
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setAuthInitialized(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setDashboard(null);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (session) void Promise.resolve().then(loadDashboard);
  }, [loadDashboard, session]);

  const stores = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (dashboard?.stores ?? []).filter((store) =>
      (storeStatusFilter === "all" || store.status === storeStatusFilter) &&
      (storeFeatureFilter === "all" || store.features[storeFeatureFilter] !== false) &&
      (storeAreaFilter === "all" || store.area === storeAreaFilter) &&
      `${store.name} ${store.owner_name} ${store.email} ${store.phone} ${store.area}`.toLowerCase().includes(term),
    ).sort((a, b) => storeSort === "name"
      ? a.name.localeCompare(b.name)
      : storeSort === "owner"
        ? a.owner_name.localeCompare(b.owner_name)
        : storeSort === "oldest"
          ? a.created_at.localeCompare(b.created_at)
          : b.created_at.localeCompare(a.created_at));
  }, [dashboard?.stores, search, storeAreaFilter, storeFeatureFilter, storeSort, storeStatusFilter]);
  const selectedVisibleStores = stores.filter((store) => selectedStoreIds.includes(store.id));
  const storeAreas = useMemo(
    () => Array.from(new Set((dashboard?.stores ?? []).map((store) => store.area.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [dashboard?.stores],
  );

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    setError("");
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) throw authError;
    } catch (authError) {
      setError(await platformApiErrorMessage(authError, "Sign-in failed."));
    } finally {
      setLoading(false);
    }
  };

  const runAction = async (key: string, action: string, payload: Record<string, unknown> = {}) => {
    if (!supabase) return null;
    setError("");
    setNotice("");
    setWorkingKey(key);
    try {
      const { data, error: functionError } = await supabase.functions.invoke("platform-api", { body: { action, ...payload } });
      if (functionError) throw functionError;
      if (data?.error) throw new Error(String(data.error));
      setNotice(typeof data?.auditWarning === "string" && data.auditWarning
        ? `Changes saved, but the audit entry could not be recorded: ${data.auditWarning}`
        : "Changes saved.");
      return data;
    } catch (actionError) {
      setError(await platformApiErrorMessage(actionError, "The requested change could not be saved."));
      return null;
    } finally {
      setWorkingKey("");
    }
  };

  const reviewRequest = (request: SignupRequest, action: "approve_request" | "reject_request") => {
    const verb = action === "approve_request" ? "approve" : "reject";
    if (!window.confirm(`${verb[0].toUpperCase()}${verb.slice(1)} access for ${request.shop_name}?`)) return;
    void (async () => {
      const generatedPin = action === "approve_request" ? generateStorePin() : "";
      const result = await runAction(request.id, action, { requestId: request.id, ownerPin: generatedPin });
      if (!result) return;
      if (action === "approve_request") {
        setOwnerPin(generatedPin);
        setNotice(`Access approved. Share the generated four-digit store PIN with the owner.${typeof result.auditWarning === "string" && result.auditWarning ? ` Audit warning: ${result.auditWarning}` : ""}`);
      }
      setDashboard((current) => {
        if (!current) return current;
        const stores = action === "approve_request" && typeof result.storeId === "string"
          ? [...current.stores, {
              id: result.storeId,
              name: request.shop_name,
              owner_name: request.owner_name,
              email: request.email,
              phone: request.phone,
              area: request.area,
              status: "active" as const,
              created_at: new Date().toISOString(),
              features: Object.fromEntries(current.features.map((feature) => [feature.key, true])),
            }]
          : current.stores;
        return { ...current, stores, requests: current.requests.filter((item) => item.id !== request.id) };
      });
    })();
  };

  const toggleStoreStatus = (store: PlatformStore) => {
    const nextStatus = store.status === "active" ? "suspended" : "active";
    void (async () => {
      if (!await runAction(`status:${store.id}`, "set_store_status", { storeId: store.id, status: nextStatus })) return;
      setDashboard((current) => current && ({
        ...current,
        stores: current.stores.map((item) => item.id === store.id ? { ...item, status: nextStatus } : item),
      }));
    })();
  };

  const bulkSetStoreStatus = async (status: "active" | "suspended") => {
    const targets = selectedVisibleStores.filter((store) => store.status !== status);
    if (!targets.length) {
      setNotice(status === "active" ? "All selected visible stores are already active." : "All selected visible stores are already suspended.");
      return;
    }
    const verb = status === "active" ? "restore" : "suspend";
    if (!window.confirm(`${verb[0].toUpperCase()}${verb.slice(1)} access for ${targets.length} selected store${targets.length === 1 ? "" : "s"}?`)) return;
    let completed = 0;
    let auditWarnings = 0;
    for (const store of targets) {
      const result = await runAction(`bulk-status:${store.id}`, "set_store_status", { storeId: store.id, status });
      if (!result) break;
      if (typeof result.auditWarning === "string" && result.auditWarning) auditWarnings += 1;
      completed += 1;
      setDashboard((current) => current && ({
        ...current,
        stores: current.stores.map((item) => item.id === store.id ? { ...item, status } : item),
      }));
      setSelectedStoreIds((current) => current.filter((id) => id !== store.id));
    }
    if (completed) setNotice(`${completed} store${completed === 1 ? "" : "s"} ${status === "active" ? "restored" : "suspended"}.${completed < targets.length ? " Remaining changes need attention." : ""}${auditWarnings ? ` Audit logging failed for ${auditWarnings} action${auditWarnings === 1 ? "" : "s"}.` : ""}`);
  };

  const bulkSetFeature = async (enabled: boolean) => {
    const feature = activeDashboardFeature;
    if (!feature) return;
    const targets = selectedVisibleStores.filter((store) => (store.features[feature.key] !== false) !== enabled);
    if (!targets.length) {
      setNotice(`The selected visible stores already have ${feature.label} ${enabled ? "enabled" : "disabled"}.`);
      return;
    }
    if (!window.confirm(`${enabled ? "Enable" : "Disable"} ${feature.label} for ${targets.length} selected store${targets.length === 1 ? "" : "s"}?`)) return;
    let completed = 0;
    let auditWarnings = 0;
    for (const store of targets) {
      if (enabled && store.status !== "active") continue;
      const result = await runAction(`bulk-feature:${store.id}:${feature.key}`, "set_feature", {
        storeId: store.id,
        featureKey: feature.key,
        enabled,
      });
      if (!result) break;
      if (typeof result.auditWarning === "string" && result.auditWarning) auditWarnings += 1;
      completed += 1;
      setDashboard((current) => current && ({
        ...current,
        stores: current.stores.map((item) => item.id === store.id
          ? { ...item, features: { ...item.features, [feature.key]: enabled } }
          : item),
      }));
    }
    if (completed) setNotice(`${feature.label} ${enabled ? "enabled" : "disabled"} for ${completed} store${completed === 1 ? "" : "s"}.${completed < targets.length ? " Some selected stores were unchanged; review errors or suspended-store status." : ""}${auditWarnings ? ` Audit logging failed for ${auditWarnings} action${auditWarnings === 1 ? "" : "s"}.` : ""}`);
  };

  const saveSupportNote = async (storeId: string) => {
    const note = supportNoteDrafts[storeId]?.trim() ?? "";
    if (!note) {
      setError("Enter a support note before saving.");
      return;
    }
    if (note.length > 2000) {
      setError("Support notes must be 2,000 characters or fewer.");
      return;
    }
    const result = await runAction(`support-note:${storeId}`, "create_support_note", { storeId, note });
    if (!result?.supportNote) return;
    setDashboard((current) => current && ({
      ...current,
      supportNotes: [result.supportNote, ...(current.supportNotes ?? [])],
    }));
    setSupportNoteDrafts((current) => ({ ...current, [storeId]: "" }));
  };

  const toggleFeature = (store: PlatformStore, feature: PlatformFeature) => {
    void (async () => {
      const enabled = store.features[feature.key] === false;
      if (!await runAction(`feature:${store.id}:${feature.key}`, "set_feature", {
        storeId: store.id,
        featureKey: feature.key,
        enabled,
      })) return;
      setDashboard((current) => current && ({
        ...current,
        stores: current.stores.map((item) => item.id === store.id
          ? { ...item, features: { ...item.features, [feature.key]: enabled } }
          : item),
      }));
    })();
  };

  const createOwner = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const oneTimePassword = `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().slice(0, 8)}`;
    const generatedPin = generateStorePin();
    setTemporaryPassword(oneTimePassword);
    const result = await runAction("provision", "provision_owner", { ...draft, password: oneTimePassword, ownerPin: generatedPin });
    if (result) {
      setOwnerPin(generatedPin);
      setDashboard((current) => current && typeof result.storeId === "string" ? ({
        ...current,
        stores: [...current.stores, {
          id: result.storeId,
          name: draft.shopName,
          owner_name: draft.ownerName,
          email: draft.email.trim().toLowerCase(),
          phone: draft.phone,
          area: draft.area,
          status: "active" as const,
          created_at: new Date().toISOString(),
          features: Object.fromEntries(current.features.map((feature) => [feature.key, true])),
        }],
      }) : current);
      setDraft(emptyProvisionDraft);
      setNotice(`Owner access created. Share the email password and four-digit store PIN with the shop owner.${typeof result.auditWarning === "string" && result.auditWarning ? ` Audit warning: ${result.auditWarning}` : ""}`);
    } else {
      setTemporaryPassword("");
      setOwnerPin("");
    }
  };

  const copyCredential = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
    } catch {
      setError("Could not copy the password. Select and copy it manually.");
    }
  };

  const exportStores = () => {
    const exportDashboard = dashboard;
    if (!exportDashboard) return;
    const rows = [
      ["Store", "Owner", "Email", "Phone", "Area", "Status", "Enabled features"],
      ...stores.map((store) => [
        store.name,
        store.owner_name,
        store.email,
        store.phone,
        store.area,
        store.status,
        exportDashboard.features.filter((feature) => store.features[feature.key] !== false).map((feature) => feature.label).join("; "),
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kokan-pos-stores-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!authReady) {
    return <main className="developer-loading"><span className="loading-spinner" /><p>Opening developer access…</p></main>;
  }

  if (session && !dashboard) {
    return (
      <main className="developer-login-screen">
        <section className="developer-login-card">
          <div className="developer-brand"><span className="developer-brand-mark"><ShieldCheck size={23} /></span><span><strong>Kokan POS</strong><small>PLATFORM ADMIN</small></span></div>
          <span className="section-eyebrow">RESTRICTED ACCESS</span>
          {loading || !error ? (
            <div className="access-loading"><span className="loading-spinner" /><span>Verifying developer access…</span></div>
          ) : (
            <>
              <h1>Developer access required</h1>
              <p>This signed-in account is not authorized to manage the platform. Ask the platform owner to add your email to the developer allowlist.</p>
              {error && <div className="access-alert access-alert-error">{error}</div>}
              <div className="developer-login-footer"><button className="text-button" onClick={() => void supabase?.auth.signOut()}>Sign out</button><Link href="/">← Back to shop sign in</Link></div>
            </>
          )}
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="developer-login-screen">
        <section className="developer-login-card">
          <div className="developer-brand"><span className="developer-brand-mark"><ShieldCheck size={23} /></span><span><strong>Kokan POS</strong><small>PLATFORM ADMIN</small></span></div>
          <span className="section-eyebrow">RESTRICTED ACCESS</span>
          <h1>Developer sign in</h1>
          <p>Manage shop access, store status, and platform features from one secure workspace.</p>
          {error && <div className="access-alert access-alert-error">{error}</div>}
          {!supabase && <div className="access-alert access-alert-error">Supabase configuration is missing.</div>}
          <form className="access-form" onSubmit={(event) => void signIn(event)}>
            <label className="form-label">DEVELOPER EMAIL<input className="form-input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label className="form-label">PASSWORD<input className="form-input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
            <button className="button button-primary button-full" disabled={loading || !supabase}>{loading ? "Signing in…" : "Sign in to admin"} <ArrowUpRight size={16} /></button>
          </form>
          <div className="developer-login-footer"><Link href="/">← Back to shop sign in</Link><span>Developer access is granted by the platform environment configuration.</span></div>
        </section>
      </main>
    );
  }

  const activeDashboard = dashboard;
  if (!activeDashboard) return <main className="developer-loading"><span className="loading-spinner" /><p>Loading stores…</p></main>;
  const activeCount = activeDashboard.stores.filter((store) => store.status === "active").length;
  const suspendedCount = activeDashboard.stores.length - activeCount;
  const pendingCount = activeDashboard.requests.length;
  const allVisibleSelected = stores.length > 0 && selectedVisibleStores.length === stores.length;
  const activeDashboardFeature = activeDashboard.features.find((feature) => feature.key === bulkFeatureKey);
  const visibleAuditEntries = (activeDashboard.auditLog ?? []).filter((entry) =>
    (auditActionFilter === "all" || entry.action === auditActionFilter) &&
    `${entry.action} ${entry.developer_email} ${entry.store_id ?? ""}`.toLowerCase().includes(auditSearch.trim().toLowerCase()),
  );
  const auditActions = Array.from(new Set((activeDashboard.auditLog ?? []).map((entry) => entry.action))).sort();
  const exportAuditLog = () => {
    const rows = [
      ["Date", "Developer", "Action", "Store ID", "Details"],
      ...visibleAuditEntries.map((entry) => [
        formatDateTime(new Date(entry.created_at).getTime()),
        entry.developer_email,
        entry.action,
        entry.store_id ?? "",
        JSON.stringify(entry.details),
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kokan-pos-platform-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <main className="developer-shell">
      <aside className="developer-sidebar">
        <div className="developer-brand"><span className="developer-brand-mark"><ShieldCheck size={23} /></span><span><strong>Kokan POS</strong><small>PLATFORM ADMIN</small></span></div>
        <div className="developer-nav-label">MANAGEMENT</div>
        <a className="developer-nav-active" href="#overview"><Store size={17} /> Store overview</a>
        <a className="developer-nav-link" href="#requests"><Clock3 size={17} /> Access requests{pendingCount > 0 && <b>{pendingCount}</b>}</a>
        <a className="developer-nav-link" href="#provision"><UserPlus size={17} /> Provision an owner</a>
        <div className="developer-sidebar-bottom">
          <div className="developer-secure-note"><ShieldCheck size={17} /><span><strong>Developer protected</strong><small>Actions are checked on the server.</small></span></div>
          <button type="button" className="developer-signout" onClick={() => void supabase?.auth.signOut()}><LogOut size={15} /> Sign out <small>{session.user.email}</small></button>
          <Link className="developer-back-link" href="/">← Shop owner sign in</Link>
        </div>
      </aside>

      <section className="developer-main">
        <header className="developer-topbar">
          <div><span className="section-eyebrow">PLATFORM CONTROL CENTER</span><h1>Store administration</h1><p>Approve owner access and manage the tools available to every shop.</p></div>
          <div className="developer-topbar-actions"><button type="button" className="button button-secondary developer-refresh-button" onClick={() => void loadDashboard()} disabled={loading}><RefreshCw size={14} className={loading ? "developer-refresh-spinning" : ""} /> {loading ? "Refreshing…" : "Refresh"}</button><span className="developer-secure-pill"><span /> Developer session</span></div>
        </header>

        <div className="developer-content" id="overview">
          {error && <div className="access-alert access-alert-error"><CircleAlert size={16} /> {error}</div>}
          {notice && <div className="access-alert access-alert-success"><CircleCheck size={16} /> {notice}</div>}
          {(temporaryPassword || ownerPin) && <div className="temporary-password-card"><div><strong>Owner sign-in details</strong><span>Email password is for account sign-in. The numeric PIN unlocks local owner tools.</span></div>{temporaryPassword && <><code>{temporaryPassword}</code><button className="button button-secondary" onClick={() => void copyCredential(temporaryPassword, "Temporary password")}>Copy password</button></>}{ownerPin && <><code className="store-owner-pin">{ownerPin}</code><button className="button button-secondary" onClick={() => void copyCredential(ownerPin, "Store PIN")}>Copy 4-digit PIN</button></>}<button className="icon-button" aria-label="Dismiss credentials" onClick={() => { setTemporaryPassword(""); setOwnerPin(""); }}><X size={15} /></button></div>}

          <div className="developer-metric-grid">
            <article><span className="developer-metric-icon developer-metric-green"><Store size={18} /></span><span>ACTIVE STORES</span><strong>{activeCount}</strong><small>{activeDashboard.stores.length} total store accounts</small></article>
            <article><span className="developer-metric-icon developer-metric-amber"><Clock3 size={18} /></span><span>WAITING FOR REVIEW</span><strong>{pendingCount}</strong><small>Shop owners requesting access</small></article>
            <article><span className="developer-metric-icon developer-metric-blue"><Users size={18} /></span><span>PLATFORM FEATURES</span><strong>{activeDashboard.features.length}</strong><small>Access can be managed per store</small></article>
            <article><span className="developer-metric-icon developer-metric-blue"><ShieldCheck size={18} /></span><span>SUSPENDED STORES</span><strong>{suspendedCount}</strong><small>Accounts currently paused</small></article>
          </div>

          <section className="developer-panel" id="requests">
            <div className="developer-panel-heading"><div><span className="section-eyebrow">OWNER ONBOARDING</span><h2>Access requests</h2><p>Review self-registered shop owners before they can use checkout.</p></div><span className="developer-count-pill">{pendingCount} pending</span></div>
            {pendingCount ? (
              <div className="developer-request-list">
                {activeDashboard.requests.map((request) => (
                  <article className="developer-request-row" key={request.id}>
                    <span className="developer-request-avatar">{request.owner_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>
                    <div className="developer-request-copy"><strong>{request.shop_name}</strong><span>{request.owner_name} · {request.area}</span><small><Mail size={12} /> {request.email} · {request.phone}</small><small>Requested {formatDateTime(new Date(request.created_at).getTime())}</small></div>
                    <div className="developer-row-actions"><button className="button button-primary" disabled={Boolean(workingKey)} onClick={() => reviewRequest(request, "approve_request")}><Check size={15} /> Approve</button><button className="button button-danger" disabled={Boolean(workingKey)} onClick={() => reviewRequest(request, "reject_request")}><X size={15} /> Decline</button></div>
                  </article>
                ))}
              </div>
            ) : <div className="developer-empty"><CircleCheck size={21} /><strong>You’re all caught up</strong><span>New shop access requests will appear here.</span></div>}
          </section>

          <section className="developer-panel" id="provision">
            <div className="developer-panel-heading"><div><span className="section-eyebrow">MANUAL ONBOARDING</span><h2>Give a shop owner access</h2><p>Create an owner account if they can’t sign up themselves.</p></div><span className="developer-heading-icon"><UserPlus size={19} /></span></div>
            <form className="developer-provision-form" onSubmit={(event) => void createOwner(event)}>
              <label className="form-label">OWNER EMAIL<input className="form-input" type="email" autoComplete="email" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} required /></label>
              <label className="form-label">SHOP NAME<input className="form-input" value={draft.shopName} onChange={(event) => setDraft((current) => ({ ...current, shopName: event.target.value }))} required /></label>
              <label className="form-label">OWNER NAME<input className="form-input" autoComplete="name" value={draft.ownerName} onChange={(event) => setDraft((current) => ({ ...current, ownerName: event.target.value }))} required /></label>
              <label className="form-label">PHONE<input className="form-input" autoComplete="tel" value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} /></label>
              <label className="form-label">AREA / CITY<input className="form-input" value={draft.area} onChange={(event) => setDraft((current) => ({ ...current, area: event.target.value }))} /></label>
              <div className="developer-provision-foot"><span><KeyRound size={14} /> A one-time password is generated securely. Owners must change it at first sign-in.</span><button className="button button-primary" type="submit" disabled={Boolean(workingKey)}><Plus size={16} /> {workingKey === "provision" ? "Creating access…" : "Create owner access"}</button></div>
            </form>
          </section>

          <section className="developer-panel developer-stores-panel">
            <div className="developer-panel-heading developer-store-tools-heading"><div><span className="section-eyebrow">ALL CUSTOMER STORES</span><h2>Stores and feature access</h2><p>Filter, sort, export, pause access, or manage each shop’s platform features.</p></div><div className="developer-store-tools"><label className="table-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, owner, email, phone…" aria-label="Search stores by name, owner, email or phone" /></label><label className="developer-status-filter"><span className="sr-only">Filter stores by status</span><select value={storeStatusFilter} onChange={(event) => setStoreStatusFilter(event.target.value as typeof storeStatusFilter)}><option value="all">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label><label className="developer-status-filter"><span className="sr-only">Filter stores by feature</span><select value={storeFeatureFilter} onChange={(event) => setStoreFeatureFilter(event.target.value)}><option value="all">All features</option>{activeDashboard.features.map((feature) => <option value={feature.key} key={feature.key}>{feature.label} enabled</option>)}</select></label><label className="developer-status-filter"><span className="sr-only">Filter stores by area</span><select value={storeAreaFilter} onChange={(event) => setStoreAreaFilter(event.target.value)}><option value="all">All areas</option>{storeAreas.map((area) => <option value={area} key={area}>{area}</option>)}</select></label><label className="developer-status-filter"><span className="sr-only">Sort stores</span><select value={storeSort} onChange={(event) => setStoreSort(event.target.value as typeof storeSort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name A–Z</option><option value="owner">Owner A–Z</option></select></label><button type="button" className="button button-secondary developer-export-button" onClick={exportStores} disabled={!stores.length}><Download size={14} /> Export CSV</button></div></div>
            <div className="developer-bulk-tools">
              <button type="button" className="text-button" onClick={() => setSelectedStoreIds((current) => allVisibleSelected
                ? current.filter((id) => !stores.some((store) => store.id === id))
                : Array.from(new Set([...current, ...stores.map((store) => store.id)])))} disabled={!stores.length}>
                {allVisibleSelected ? "Clear visible selection" : "Select all visible"}
              </button>
              <span>{selectedVisibleStores.length} selected</span>
              <label className="developer-status-filter"><span className="sr-only">Choose bulk feature</span><select value={bulkFeatureKey} onChange={(event) => setBulkFeatureKey(event.target.value)}><option value="">Choose feature…</option>{activeDashboard.features.map((feature) => <option value={feature.key} key={feature.key}>{feature.label}</option>)}</select></label>
              <button type="button" className="button button-secondary" onClick={() => void bulkSetFeature(true)} disabled={!selectedVisibleStores.length || !activeDashboardFeature || Boolean(workingKey)}>Enable feature</button>
              <button type="button" className="button button-secondary" onClick={() => void bulkSetFeature(false)} disabled={!selectedVisibleStores.length || !activeDashboardFeature || Boolean(workingKey)}>Disable feature</button>
              <button type="button" className="button button-danger" onClick={() => void bulkSetStoreStatus("suspended")} disabled={!selectedVisibleStores.some((store) => store.status === "active") || Boolean(workingKey)}>Pause selected</button>
              <button type="button" className="button button-secondary" onClick={() => void bulkSetStoreStatus("active")} disabled={!selectedVisibleStores.some((store) => store.status === "suspended") || Boolean(workingKey)}>Restore selected</button>
            </div>
            {stores.length ? (
              <div className="developer-store-list">
                {stores.map((store) => (
                  <article className="developer-store-card" key={store.id}>
                    <div className="developer-store-heading">
                      <label className="developer-store-select"><input type="checkbox" checked={selectedStoreIds.includes(store.id)} onChange={(event) => setSelectedStoreIds((current) => event.target.checked ? [...current, store.id] : current.filter((id) => id !== store.id))} aria-label={`Select ${store.name}`} /></label>
                      <span className="developer-store-avatar"><Store size={18} /></span>
                      <div><strong>{store.name}</strong><span>{store.owner_name} · {store.area || "Location not provided"}</span><small>{store.email} · {store.phone || "No phone"}</small></div>
                      <span className={`developer-status-pill ${store.status === "active" ? "developer-status-active" : "developer-status-paused"}`}>{store.status === "active" ? "Active" : "Paused"}</span>
                      <button className={`button ${store.status === "active" ? "button-danger" : "button-secondary"}`} onClick={() => toggleStoreStatus(store)} disabled={Boolean(workingKey)}>{workingKey === `status:${store.id}` ? "Saving…" : store.status === "active" ? "Pause access" : "Restore access"}</button>
                    </div>
                    <div className="developer-feature-grid">
                      {activeDashboard.features.map((feature) => {
                        const enabled = store.features[feature.key] !== false;
                        const key = `feature:${store.id}:${feature.key}`;
                        return (
                          <div className="developer-feature-row" key={feature.key}>
                            <span><strong>{feature.label}</strong><small>{feature.description}</small></span>
                            <button type="button" className={`toggle-switch ${enabled ? "toggle-switch-on" : ""}`} role="switch" aria-checked={enabled} aria-label={`${feature.label} for ${store.name}`} disabled={Boolean(workingKey) || store.status !== "active"} onClick={() => toggleFeature(store, feature)}><span /></button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="developer-support-notes">
                      <strong>Support notes</strong>
                      {(activeDashboard.supportNotes ?? []).filter((note) => note.store_id === store.id).slice(0, 3).map((note) => (
                        <div className="developer-support-note" key={note.id}><span>{note.note}</span><small>{note.author_email} · {formatDateTime(new Date(note.created_at).getTime())}</small></div>
                      ))}
                      <label className="sr-only" htmlFor={`support-note-${store.id}`}>Add a private support note for {store.name}</label>
                      <textarea id={`support-note-${store.id}`} className="form-input developer-support-input" rows={2} maxLength={2000} value={supportNoteDrafts[store.id] ?? ""} onChange={(event) => setSupportNoteDrafts((current) => ({ ...current, [store.id]: event.target.value }))} placeholder="Private note for your developer team…" />
                      <button type="button" className="button button-secondary" onClick={() => void saveSupportNote(store.id)} disabled={!supportNoteDrafts[store.id]?.trim() || Boolean(workingKey)}>Save support note</button>
                    </div>
                  </article>
                ))}
              </div>
            ) : <div className="developer-empty"><Store size={21} /><strong>{activeDashboard.stores.length ? "No matching stores" : "No stores yet"}</strong><span>{activeDashboard.stores.length ? "Try a different search." : "Approved and provisioned stores will appear here."}</span></div>}
          </section>
          <section className="developer-panel developer-audit-panel">
            <div className="developer-panel-heading"><div><span className="section-eyebrow">ADMIN ACCOUNTABILITY</span><h2>Recent platform activity</h2><p>Developer account changes are recorded with their actor, store, and safe action details.</p></div><div className="developer-audit-tools"><label className="table-search"><Search size={14} /><input value={auditSearch} onChange={(event) => setAuditSearch(event.target.value)} placeholder="Find an action or developer…" aria-label="Search audit log" /></label><label className="developer-status-filter"><span className="sr-only">Filter audit actions</span><select value={auditActionFilter} onChange={(event) => setAuditActionFilter(event.target.value)}><option value="all">All actions</option>{auditActions.map((action) => <option value={action} key={action}>{action.replaceAll("_", " ")}</option>)}</select></label><button type="button" className="button button-secondary" onClick={exportAuditLog} disabled={!visibleAuditEntries.length}><Download size={14} /> Export audit</button></div></div>
            {visibleAuditEntries.length ? <div className="developer-audit-list">{visibleAuditEntries.slice(0, 100).map((entry) => <article className="developer-audit-row" key={entry.id}><span><strong>{entry.action.replaceAll("_", " ")}</strong><small>{entry.developer_email}{entry.store_id ? ` · Store ${entry.store_id.slice(0, 8)}` : ""}</small></span><time>{formatDateTime(new Date(entry.created_at).getTime())}</time></article>)}</div> : <div className="developer-empty"><Clock3 size={20} /><strong>{(activeDashboard.auditLog ?? []).length ? "No matching activity" : "No platform actions recorded yet"}</strong><span>{(activeDashboard.auditLog ?? []).length ? "Change your audit search or action filter." : "Successful access, status, and feature changes will be listed here."}</span></div>}
          </section>
          <div className="developer-data-note"><ShieldCheck size={14} /> Store operations are protected by authenticated Supabase Edge Functions and isolated by store ID.</div>
        </div>
      </section>
    </main>
  );
}
