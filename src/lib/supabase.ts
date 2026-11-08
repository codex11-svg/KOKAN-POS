"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}

export async function platformApiErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (typeof error === "object" && error !== null && "context" in error && error.context instanceof Response) {
    try {
      const body: unknown = await error.context.clone().json();
      if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
        return body.error;
      }
    } catch {
      // The response may not contain JSON.
    }
  }
  return error instanceof Error ? error.message : fallback;
}

export interface SignupRequest {
  id: string;
  user_id: string;
  email: string;
  shop_name: string;
  owner_name: string;
  phone: string;
  area: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

export interface PlatformStore {
  id: string;
  name: string;
  owner_name: string;
  email: string;
  phone: string;
  area: string;
  status: "active" | "suspended";
  created_at: string;
  features: Record<string, boolean>;
}

export interface PlatformFeature {
  key: string;
  label: string;
  description: string;
}

export interface PlatformSupportNote {
  id: string;
  store_id: string;
  note: string;
  author_email: string;
  created_at: string;
}

export interface PlatformAuditEntry {
  id: number;
  developer_email: string;
  action: string;
  store_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface PlatformSupportWorkspace {
  storeId: string;
  counts: {
    products: number;
    customers: number;
    invoices: number;
    staff: number;
    operations: number;
  };
  latestInvoiceAt: string | null;
  latestOperationAt: string | null;
  supportNotes: PlatformSupportNote[];
  auditLog: PlatformAuditEntry[];
}

export interface PlatformDashboard {
  stores: PlatformStore[];
  requests: SignupRequest[];
  features: PlatformFeature[];
  supportNotes?: PlatformSupportNote[];
  auditLog?: PlatformAuditEntry[];
}

export type AccountAccess =
  | { status: "unregistered"; request: null; userName: string | null }
  | { status: "pending"; request: SignupRequest | null; userName: string | null }
  | { status: "rejected"; request: SignupRequest | null; userName: string | null }
  | { status: "suspended"; storeName: string; userName: string | null }
  | {
      status: "active";
      storeId: string;
      storeName: string;
      ownerName: string;
      phone: string;
      area: string;
      ownerPinHash: string | null;
      features: Record<string, boolean>;
      userName: string | null;
    };
