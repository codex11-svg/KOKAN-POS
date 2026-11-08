"use client";

import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import {
  initializeLocalDatabase,
  localDb,
  type Customer,
  type FeatureFlag,
  type Invoice,
  type OperationsRecord,
  type ParkedCart,
  type Product,
  type ShopProfile,
  type StaffMember,
  type StaffShift,
} from "@/lib/db";

export interface LocalSnapshot {
  shop: ShopProfile | null;
  products: Product[];
  customers: Customer[];
  invoices: Invoice[];
  flags: FeatureFlag[];
  staff: StaffMember[];
  shifts: StaffShift[];
  operations: OperationsRecord[];
  parkedCarts: ParkedCart[];
}

const emptySnapshot: LocalSnapshot = { shop: null, products: [], customers: [], invoices: [], flags: [], staff: [], shifts: [], operations: [], parkedCarts: [] };

export function useLocalData(
  enabled: boolean,
  storeId: string | null,
  initialShop?: Pick<ShopProfile, "shopName" | "ownerName" | "area" | "phone" | "upiId">,
  initialOwnerPinHash?: string | null,
) {
  const [state, setState] = useState<{ storeId: string | null; snapshot: LocalSnapshot; ready: boolean; error: string | null }>({
    storeId: null,
    snapshot: emptySnapshot,
    ready: false,
    error: null,
  });
  const currentState = state.storeId === storeId ? state : null;
  const snapshot = currentState?.snapshot ?? emptySnapshot;
  const ready = enabled && currentState?.ready === true;
  const error = currentState?.error ?? null;

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    if (!enabled || !storeId) return;

    void initializeLocalDatabase(storeId, initialShop, initialOwnerPinHash)
      .then(() => {
        if (!active) return;
        const db = localDb;
        const subscription = liveQuery(async () => {
          const [shop, products, customers, invoices, flags, staff, shifts, operations, parkedCarts] = await Promise.all([
            db.shop_profile.get("current_shop"),
            db.products.orderBy("name").toArray(),
            db.customers.orderBy("name").toArray(),
            db.invoices.orderBy("createdAt").reverse().toArray(),
            db.feature_flags.toArray(),
            db.staff.toArray(),
            db.staff_shifts.orderBy("startedAt").reverse().toArray(),
            db.operations.orderBy("createdAt").reverse().toArray(),
            db.parked_carts.orderBy("updatedAt").reverse().toArray(),
          ]);
          return { shop: shop ?? null, products, customers, invoices, flags, staff, shifts, operations, parkedCarts } satisfies LocalSnapshot;
        }).subscribe({
          next: (nextSnapshot) => {
            if (!active) return;
            setState({ storeId, snapshot: nextSnapshot, ready: true, error: null });
          },
          error: (databaseError) => {
            if (!active) return;
            setState({
              storeId,
              snapshot: emptySnapshot,
              ready: true,
              error: `Your local store could not be opened. Check browser storage permissions and reload. ${databaseError instanceof Error ? databaseError.message : ""}`.trim(),
            });
          },
        });
        unsubscribe = () => subscription.unsubscribe();
      })
      .catch((databaseError: unknown) => {
        if (!active) return;
        setState({
          storeId,
          snapshot: emptySnapshot,
          ready: true,
          error: `Your local store could not be opened. Check browser storage permissions and reload. ${databaseError instanceof Error ? databaseError.message : ""}`.trim(),
        });
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [enabled, initialOwnerPinHash, initialShop, storeId]);

  return { ...snapshot, ready, error };
}
