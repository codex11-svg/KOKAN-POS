"use client";

import { KeyRound, ShieldCheck, X } from "lucide-react";
import { useState, type FormEvent } from "react";

export interface OwnerPinDraft {
  currentPin: string;
  newPin: string;
  confirmation: string;
}

export function OwnerPinModal({ onClose, onSave }: { onClose: () => void; onSave: (draft: OwnerPinDraft) => void }) {
  const [draft, setDraft] = useState<OwnerPinDraft>({ currentPin: "", newPin: "", confirmation: "" });
  const [error, setError] = useState("");

  const update = (key: keyof OwnerPinDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value.replace(/\D/g, "").slice(0, 8) }));
    setError("");
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.newPin.length < 4 || draft.newPin.length > 8) {
      setError("Choose a new PIN with 4 to 8 digits.");
      return;
    }
    if (draft.newPin !== draft.confirmation) {
      setError("The new PIN and confirmation don’t match.");
      return;
    }
    onSave(draft);
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card editor-modal pin-change-modal" role="dialog" aria-modal="true" aria-labelledby="pin-change-title">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">KEEP YOUR COUNTER YOURS</span>
            <h2 id="pin-change-title">Change owner PIN</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <form className="editor-form" onSubmit={submit}>
          <label className="form-label">CURRENT OWNER PIN<input className="form-input pin-field" type="password" inputMode="numeric" autoComplete="current-password" value={draft.currentPin} onChange={(event) => update("currentPin", event.target.value)} placeholder="Current PIN" required autoFocus /></label>
          <label className="form-label">NEW PIN<input className="form-input pin-field" type="password" inputMode="numeric" autoComplete="new-password" minLength={4} value={draft.newPin} onChange={(event) => update("newPin", event.target.value)} placeholder="4–8 digits" required /></label>
          <label className="form-label">CONFIRM NEW PIN<input className="form-input pin-field" type="password" inputMode="numeric" autoComplete="new-password" minLength={4} value={draft.confirmation} onChange={(event) => update("confirmation", event.target.value)} placeholder="Enter it once more" required /></label>
          {error && <p className="form-error">{error}</p>}
          <p className="customer-modal-note"><ShieldCheck size={15} /> Your PIN is hashed before it’s saved to local storage.</p>
          <div className="modal-action-row"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary" disabled={draft.currentPin.length < 4 || draft.newPin.length < 4 || draft.confirmation.length < 4}><KeyRound size={15} /> Save new PIN</button></div>
        </form>
      </section>
    </div>
  );
}
