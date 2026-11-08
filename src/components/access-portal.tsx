"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, CircleAlert, KeyRound, LockKeyhole, ShieldCheck, Store, WifiOff } from "lucide-react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { platformApiErrorMessage, type AccountAccess } from "@/lib/supabase";

interface AccessPortalProps {
  supabase: SupabaseClient | null;
  session: Session | null;
  account: AccountAccess | null;
  accountLoading: boolean;
  accountError: string | null;
  onRefresh: () => void;
  onSignOut: () => void;
}

interface AccessRequestDraft {
  shopName: string;
  ownerName: string;
  phone: string;
  area: string;
}

export function AccessPortal({
  supabase,
  session,
  account,
  accountLoading,
  accountError,
  onRefresh,
  onSignOut,
}: AccessPortalProps) {
  const [mode, setMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [email, setEmail] = useState(session?.user.email ?? "");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [draft, setDraft] = useState<AccessRequestDraft>({
    shopName: "",
    ownerName: session?.user.user_metadata.full_name ?? "",
    phone: "",
    area: "",
  });
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setError("Sign-in is not configured. Ask the developer to configure the Supabase project.");
      return;
    }
    setError("");
    setMessage("");
    setWorking(true);
    try {
      if (mode === "sign_in") {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
      } else {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: draft.ownerName.trim() } },
        });
        if (authError) throw authError;
        if (!data.session) {
          setMessage("Account created. Check your email to confirm it, then sign in to request shop access.");
        } else {
          setMessage("Your account is ready. Submit your shop details to request access.");
        }
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Sign-in could not be completed.");
    } finally {
      setWorking(false);
    }
  };

  const submitAccessRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    setError("");
    setMessage("");
    setWorking(true);
    try {
      const { error: functionError } = await supabase.functions.invoke("platform-api", {
        body: { action: "request_access", ...draft },
      });
      if (functionError) throw functionError;
      setMessage("Request submitted. The Kokan POS developer team will review it and grant access.");
      onRefresh();
    } catch (requestError) {
      setError(await platformApiErrorMessage(requestError, "Your access request could not be submitted."));
    } finally {
      setWorking(false);
    }
  };

  const updatePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || newPassword.length < 10) {
      setError("Choose a password with at least 10 characters.");
      return;
    }
    setError("");
    setWorking(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
        data: { must_change_password: false },
      });
      if (updateError) throw updateError;
      setMessage("Password updated. Your account is ready.");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Password could not be updated.");
    } finally {
      setWorking(false);
    }
  };

  const mustChangePassword = session?.user.user_metadata.must_change_password === true;

  return (
    <main className="access-screen">
      <section className="access-card">
        <div className="access-brand">
          <span className="brand-mark">k<span>.</span></span>
          <span className="brand-name">kokan<span>pos</span></span>
        </div>
        <div className="access-heading">
          <span className="section-eyebrow">{session ? "SHOP OWNER ACCESS" : "WELCOME TO KOKAN POS"}</span>
          <h1>{session ? "Your shop, ready when you are." : mode === "sign_up" ? "Create your owner account" : "Sign in to your shop"}</h1>
          <p>Secure access to your shop, with checkout that keeps working offline.</p>
        </div>

        {!supabase && <div className="access-alert access-alert-error">Supabase sign-in is not configured yet. Contact the developer before continuing.</div>}
        {accountError && <div className="access-alert access-alert-error">{accountError}</div>}
        {error && <div className="access-alert access-alert-error">{error}</div>}
        {message && <div className="access-alert access-alert-success">{message}</div>}

        {!session ? (
          <>
            <div className="access-mode-switch" role="tablist" aria-label="Account action">
              <button type="button" className={mode === "sign_in" ? "active" : ""} onClick={() => { setMode("sign_in"); setError(""); setMessage(""); }}>Sign in</button>
              <button type="button" className={mode === "sign_up" ? "active" : ""} onClick={() => { setMode("sign_up"); setError(""); setMessage(""); }}>Create account</button>
            </div>
            <form className="access-form" onSubmit={(event) => void submitAuth(event)}>
              {mode === "sign_up" && <label className="form-label">YOUR NAME<input className="form-input" autoComplete="name" value={draft.ownerName} onChange={(event) => setDraft((current) => ({ ...current, ownerName: event.target.value }))} required /></label>}
              <label className="form-label">EMAIL ADDRESS<input className="form-input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
              <label className="form-label">PASSWORD<input className="form-input" type="password" autoComplete={mode === "sign_in" ? "current-password" : "new-password"} minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
              {mode === "sign_up" && <small className="access-password-hint">Use at least 10 characters. Your shop access is enabled after developer approval.</small>}
              <button className="button button-primary button-full" type="submit" disabled={working || !supabase}>{working ? "Please wait…" : mode === "sign_up" ? "Create owner account" : "Sign in"} <ArrowRight size={16} /></button>
            </form>
          </>
        ) : accountLoading || (!account && !accountError) ? (
          <div className="access-loading"><span className="loading-spinner" /><span>Checking your store access…</span></div>
        ) : mustChangePassword ? (
          <form className="access-form" onSubmit={(event) => void updatePassword(event)}>
            <div className="access-info-card"><KeyRound size={18} /><span><strong>Set a private password</strong><small>Your developer provided a temporary sign-in password. Replace it to keep your account secure.</small></span></div>
            <label className="form-label">NEW PASSWORD<input className="form-input" type="password" autoComplete="new-password" minLength={10} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
            <button className="button button-primary button-full" disabled={working}>{working ? "Updating…" : "Update password"} <ArrowRight size={16} /></button>
          </form>
        ) : account?.status === "pending" || account?.status === "rejected" || account?.status === "unregistered" ? (
          account.status === "pending" ? (
            <div className="access-state-card">
              <div className="access-state-icon access-state-icon-amber"><KeyRound size={21} /></div>
              <strong>Access request under review</strong>
              <p>{account.request?.shop_name ? `${account.request.shop_name} · ` : ""}We’ll activate your shop after the developer team reviews your details. You can sign in again on this device once approved.</p>
              <button type="button" className="button button-secondary button-full" onClick={onRefresh}>Check access status</button>
            </div>
          ) : account.status === "rejected" ? (
            <form className="access-form" onSubmit={(event) => void submitAccessRequest(event)}>
              <div className="access-alert access-alert-info">Your previous request was not approved. Review the details below or contact the developer team.</div>
              <AccessRequestFields draft={draft} setDraft={setDraft} />
              <button className="button button-primary button-full" disabled={working}>{working ? "Submitting…" : "Submit a new request"} <ArrowRight size={16} /></button>
            </form>
          ) : (
            <form className="access-form" onSubmit={(event) => void submitAccessRequest(event)}>
              <div className="access-info-card"><Store size={18} /><span><strong>Request access for your store</strong><small>Our developer team reviews new shop accounts before enabling checkout.</small></span></div>
              <AccessRequestFields draft={draft} setDraft={setDraft} />
              <button className="button button-primary button-full" disabled={working}>{working ? "Submitting…" : "Request shop access"} <ArrowRight size={16} /></button>
            </form>
          )
        ) : account?.status === "suspended" ? (
          <div className="access-state-card">
            <div className="access-state-icon access-state-icon-amber"><LockKeyhole size={21} /></div>
            <strong>Store access is paused</strong>
            <p>{account.storeName} is currently paused by the developer team. Contact support to restore access.</p>
          </div>
        ) : (
          <div className="access-state-card">
            <div className="access-state-icon access-state-icon-amber"><CircleAlert size={21} /></div>
            <strong>Could not verify store access</strong>
            <p>{accountError ?? "Try again to check whether your shop has been approved."}</p>
            <button type="button" className="button button-secondary button-full" onClick={onRefresh}>Check access status</button>
          </div>
        )}

        <div className="access-footer">
          {session ? (
            <button type="button" className="text-button" onClick={onSignOut}>Sign out of {session.user.email}</button>
          ) : (
            <a href="/developer"><ShieldCheck size={14} /> Developer admin sign-in</a>
          )}
          <span><WifiOff size={13} /> Offline sales are available after your shop is approved</span>
        </div>
      </section>
    </main>
  );
}

function AccessRequestFields({
  draft,
  setDraft,
}: {
  draft: AccessRequestDraft;
  setDraft: (update: (current: AccessRequestDraft) => AccessRequestDraft) => void;
}) {
  const update = (key: keyof AccessRequestDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <>
      <label className="form-label">SHOP NAME<input className="form-input" autoComplete="organization" value={draft.shopName} onChange={(event) => update("shopName", event.target.value)} required /></label>
      <label className="form-label">OWNER NAME<input className="form-input" autoComplete="name" value={draft.ownerName} onChange={(event) => update("ownerName", event.target.value)} required /></label>
      <div className="form-two-columns">
        <label className="form-label">PHONE<input className="form-input" autoComplete="tel" value={draft.phone} onChange={(event) => update("phone", event.target.value)} required /></label>
        <label className="form-label">AREA / CITY<input className="form-input" autoComplete="address-level2" value={draft.area} onChange={(event) => update("area", event.target.value)} required /></label>
      </div>
    </>
  );
}
