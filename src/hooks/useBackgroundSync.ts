"use client";

import { liveQuery } from "dexie";
import { useEffect, useRef, useState } from "react";
import {
  localDb,
  type Customer,
  type FeatureFlag,
  type Invoice,
  type OperationsRecord,
  type OutboxMutation,
  type Product,
  type ShopProfile,
  type StaffMember,
  type StaffShift,
  type SyncActionType,
} from "@/lib/db";
import { getSupabaseClient } from "@/lib/supabase";

interface SyncResult {
  id: string;
  success: boolean;
}

interface RemoteSnapshot {
  shop: ShopProfile | null;
  products: Product[];
  customers: Customer[];
  invoices: Invoice[];
  flags: FeatureFlag[];
  staff: StaffMember[];
  shifts: StaffShift[];
  operations: OperationsRecord[];
}

interface SyncResponse {
  results: SyncResult[];
  snapshot: RemoteSnapshot;
}

async function mergeRemoteRows<T extends { id: string; updatedAt?: number; synced?: 0 | 1 }>(
  table: import("dexie").Table<T, string>,
  remoteRows: T[],
  removeMissing = true,
): Promise<void> {
  const remoteIds = new Set(remoteRows.map((row) => row.id));
  for (const remote of remoteRows) {
    const local = await table.get(remote.id);
    if (!local || local.synced === 1 || (local.updatedAt ?? 0) <= (remote.updatedAt ?? 0)) {
      await table.put(remote);
    }
  }
  if (removeMissing) {
    const localRows = await table.toArray();
    for (const local of localRows) {
      if (local.synced === 1 && !remoteIds.has(local.id)) await table.delete(local.id);
    }
  }
}

export interface BackgroundSyncState {
  isOnline: boolean;
  syncing: boolean;
  pendingCount: number;
  lastSyncedAt: number | null;
  lastError: string | null;
}

const initialState: BackgroundSyncState = {
  isOnline: true,
  syncing: false,
  pendingCount: 0,
  lastSyncedAt: null,
  lastError: null,
};

function getPayloadRecord(payload: unknown): Record<string, unknown> | null {
  return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
}

async function markLocalRecordSynced(mutation: OutboxMutation, db: typeof localDb): Promise<void> {
  const payload = getPayloadRecord(mutation.payload);
  const recordId = typeof payload?.id === "string" ? payload.id : undefined;
  if (!recordId) return;

  const mutationTime = typeof payload?.updatedAt === "number" ? payload.updatedAt : mutation.timestamp;
  const canMarkCurrent = (currentUpdatedAt: number | undefined) =>
    currentUpdatedAt !== undefined && currentUpdatedAt <= mutationTime;

  switch (mutation.actionType) {
    case "UPSERT_PRODUCT": {
      const current = await db.products.get(recordId);
      if (current && canMarkCurrent(current.updatedAt)) await db.products.update(recordId, { synced: 1 });
      break;
    }
    case "UPSERT_CUSTOMER": {
      const current = await db.customers.get(recordId);
      if (current && canMarkCurrent(current.updatedAt)) await db.customers.update(recordId, { synced: 1 });
      break;
    }
    case "UPSERT_INVOICE":
      await db.invoices.update(recordId, { synced: 1 });
      break;
    case "UPSERT_OPERATION": {
      const current = await db.operations.get(recordId);
      if (current && canMarkCurrent(current.updatedAt)) await db.operations.update(recordId, { synced: 1 });
      break;
    }
    case "UPSERT_STAFF": {
      const current = await db.staff.get(recordId);
      if (current && canMarkCurrent(current.updatedAt)) await db.staff.update(recordId, { synced: 1 });
      break;
    }
    case "UPSERT_STAFF_SHIFT": {
      const current = await db.staff_shifts.get(recordId);
      if (current && canMarkCurrent(current.updatedAt)) await db.staff_shifts.update(recordId, { synced: 1 });
      break;
    }
    case "UPSERT_FEATURE_FLAG": {
      const current = await db.feature_flags.get(recordId);
      if (current && canMarkCurrent(current.updatedAt)) await db.feature_flags.update(recordId, { synced: 1 });
      break;
    }
    case "UPSERT_SHOP_PROFILE":
    case "DELETE_PRODUCT":
      break;
  }
}

export function useBackgroundSync(enabled: boolean, storeId: string | null): BackgroundSyncState {
  const [state, setState] = useState<BackgroundSyncState>(initialState);
  const syncingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let unsubscribeCount: (() => void) | undefined;
    let observedPendingCount = 0;

    const db = localDb;
    const syncNow = async () => {
      if (!active || !navigator.onLine || syncingRef.current) return;
      syncingRef.current = true;
      let hasMore = false;
      setState((current) => ({ ...current, isOnline: true, syncing: true, lastError: null }));

      try {
        const pending = await db.outbox_queue.orderBy("timestamp").limit(50).toArray();
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error("Supabase sync is not configured.");
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) return;
        const { data, error } = await supabase.functions.invoke("platform-api", {
          body: { action: "sync", storeId, mutations: pending },
        });
        if (error) throw error;
        const body = data as SyncResponse | null;
        if (!body || !Array.isArray(body.results) || !body.snapshot) throw new Error("Invalid sync response");
        const results = new Map(body.results.map((result) => [result.id, result]));
        const firstFailure = body.results.find((result) => !result.success);

        await db.transaction(
          "rw",
          [
            db.outbox_queue,
            db.shop_profile,
            db.products,
            db.customers,
            db.invoices,
            db.staff,
            db.staff_shifts,
            db.operations,
            db.feature_flags,
          ],
          async () => {
            for (const mutation of pending) {
              const result = results.get(mutation.id);
              if (result?.success) {
                await db.outbox_queue.delete(mutation.id);
                await markLocalRecordSynced(mutation, db);
              } else {
                await db.outbox_queue.update(mutation.id, { retryCount: mutation.retryCount + 1 });
              }
            }
            if (body.snapshot.shop) {
              const localShop = await db.shop_profile.get(body.snapshot.shop.id);
              if (!localShop || localShop.updatedAt <= body.snapshot.shop.updatedAt) {
                await db.shop_profile.put(body.snapshot.shop);
              }
            }
            await mergeRemoteRows(db.products, body.snapshot.products);
            await mergeRemoteRows(db.customers, body.snapshot.customers);
            await mergeRemoteRows(db.invoices, body.snapshot.invoices);
            await mergeRemoteRows(db.feature_flags, body.snapshot.flags);
            await mergeRemoteRows(db.staff, body.snapshot.staff);
            await mergeRemoteRows(db.staff_shifts, body.snapshot.shifts, false);
            await mergeRemoteRows(db.operations, body.snapshot.operations ?? [], false);
          },
        );
        hasMore = !firstFailure && (await db.outbox_queue.count()) > 0;
        if (active) {
          setState((current) => ({
            ...current,
            lastSyncedAt: Date.now(),
            lastError: firstFailure ? `A change could not sync: ${firstFailure.id}` : null,
          }));
        }
      } catch (syncError) {
        if (active) {
          setState((current) => ({
            ...current,
            lastError: syncError instanceof Error ? syncError.message : "The sync request failed.",
          }));
        }
        // A failed request stays in the local outbox; billing never waits on it.
        try {
          const pending = await db.outbox_queue.orderBy("timestamp").limit(50).toArray();
          await db.transaction("rw", db.outbox_queue, async () => {
            for (const mutation of pending) {
              await db.outbox_queue.update(mutation.id, { retryCount: mutation.retryCount + 1 });
            }
          });
        } catch {
          // IndexedDB will retry naturally on the next online/focus event.
        }
      } finally {
        syncingRef.current = false;
        if (active) {
          setState((current) => ({ ...current, syncing: false, isOnline: navigator.onLine }));
          if (hasMore) window.setTimeout(() => void syncNow(), 0);
        }
      }
    };

    const updateConnection = () => {
      setState((current) => ({ ...current, isOnline: navigator.onLine }));
      if (navigator.onLine) void syncNow();
    };
    const onWake = () => {
      if (document.visibilityState === "visible") void syncNow();
    };

    setState((current) => ({ ...current, isOnline: navigator.onLine }));
    const countSubscription = liveQuery(() => db.outbox_queue.count()).subscribe({
      next: (pendingCount) => {
        if (!active) return;
        setState((current) => ({ ...current, pendingCount }));
        if (pendingCount > observedPendingCount) void syncNow();
        observedPendingCount = pendingCount;
      },
      error: () => undefined,
    });
    unsubscribeCount = () => countSubscription.unsubscribe();

    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    void syncNow();

    return () => {
      active = false;
      unsubscribeCount?.();
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [enabled, storeId]);

  return state;
}

export function isSyncAction(value: unknown): value is SyncActionType {
  return (
    value === "UPSERT_SHOP_PROFILE" ||
    value === "UPSERT_PRODUCT" ||
    value === "DELETE_PRODUCT" ||
    value === "UPSERT_CUSTOMER" ||
    value === "UPSERT_INVOICE" ||
    value === "UPSERT_FEATURE_FLAG" ||
    value === "UPSERT_STAFF" ||
    value === "UPSERT_STAFF_SHIFT"
  );
}
