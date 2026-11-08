import Dexie, { type Table } from "dexie";

export const CURRENT_SHOP_ID = "current_shop";
export const ACTIVE_CART_ID = "current_cart";

export type PaymentMode = "cash" | "upi" | "khata";
export type StaffRole = "owner" | "admin" | "cashier";
export type SyncActionType =
  | "UPSERT_SHOP_PROFILE"
  | "UPSERT_PRODUCT"
  | "DELETE_PRODUCT"
  | "UPSERT_CUSTOMER"
  | "UPSERT_INVOICE"
  | "UPSERT_OPERATION"
  | "UPSERT_FEATURE_FLAG"
  | "UPSERT_STAFF"
  | "UPSERT_STAFF_SHIFT";

export type OperationsPayload =
  | { kind: "stock_adjustment"; productId: string; productName: string; previousQty: number; quantityDelta: number; reason: string }
  | { kind: "purchase"; supplier: string; productId: string; productName: string; quantity: number; unitCost: number; total: number; note: string }
  | { kind: "expense"; category: string; amount: number; description: string; paymentMode: "cash" | "upi" }
  | { kind: "return"; invoiceId: string; invoiceNumber: string; paymentMode: PaymentMode; productId: string; productName: string; quantity: number; amount: number; profitReversal: number }
  | { kind: "customer_payment"; customerId: string; customerName: string; amount: number; note: string }
  | { kind: "cash_close"; dateKey: string; openingFloat: number; countedCash: number; expectedCash: number; variance: number };

export interface OperationsRecord {
  id: string;
  payload: OperationsPayload;
  createdAt: number;
  updatedAt: number;
  synced: 0 | 1;
}

export interface ShopProfile {
  id: typeof CURRENT_SHOP_ID;
  shopName: string;
  ownerName: string;
  area: string;
  phone: string;
  upiId: string;
  updatedAt: number;
}

export interface Product {
  id: string;
  name: string;
  barcode: string | null;
  category: string;
  unit: string;
  sellingPrice: number;
  costPrice: number;
  stockQty: number;
  updatedAt: number;
  synced: 0 | 1;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  currentBalance: number;
  updatedAt: number;
  synced: 0 | 1;
}

export interface InvoiceItem {
  productId: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  unitCost: number;
  lineTotal: number;
}

export interface Invoice {
  id: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone?: string | null;
  items: InvoiceItem[];
  subtotal: number;
  discount: number;
  totalAmount: number;
  paymentMode: PaymentMode;
  createdAt: number;
  synced: 0 | 1;
}

export interface OutboxMutation {
  id: string;
  actionType: SyncActionType;
  payload: unknown;
  timestamp: number;
  retryCount: number;
}

export interface FeatureFlag {
  id: string;
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  updatedAt: number;
  synced: 0 | 1;
}

export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
  active: boolean;
  pinHash: string;
  hourlyRate?: number;
  updatedAt: number;
  synced: 0 | 1;
}

export interface StaffShift {
  id: string;
  staffId: string;
  staffName: string;
  startedAt: number;
  endedAt: number | null;
  hourlyRate: number;
  updatedAt: number;
  synced: 0 | 1;
}

export interface CartLine {
  productId: string;
  quantity: number;
}

export interface ActiveCart {
  id: typeof ACTIVE_CART_ID;
  items: CartLine[];
  customerId: string | null;
  discount: number;
  updatedAt: number;
}

export interface ParkedCart {
  id: string;
  label: string;
  cart: ActiveCart;
  createdAt: number;
  updatedAt: number;
}

class KokanDatabase extends Dexie {
  shop_profile!: Table<ShopProfile, string>;
  products!: Table<Product, string>;
  customers!: Table<Customer, string>;
  invoices!: Table<Invoice, string>;
  outbox_queue!: Table<OutboxMutation, string>;
  feature_flags!: Table<FeatureFlag, string>;
  staff!: Table<StaffMember, string>;
  active_cart!: Table<ActiveCart, string>;
  staff_shifts!: Table<StaffShift, string>;
  operations!: Table<OperationsRecord, string>;
  parked_carts!: Table<ParkedCart, string>;

  constructor(databaseName: string) {
    super(databaseName);
    this.version(1).stores({
      shop_profile: "id, updatedAt",
      products: "id, name, barcode, category, updatedAt, synced",
      customers: "id, name, phone, updatedAt, synced",
      invoices: "id, customerId, paymentMode, createdAt, synced",
      outbox_queue: "id, actionType, timestamp",
      feature_flags: "id, key, enabled",
      staff: "id, role, active, updatedAt",
      active_cart: "id, updatedAt",
    });
    this.version(2).stores({
      shop_profile: "id, updatedAt",
      products: "id, name, barcode, category, updatedAt, synced",
      customers: "id, name, phone, updatedAt, synced",
      invoices: "id, customerId, paymentMode, createdAt, synced",
      outbox_queue: "id, actionType, timestamp",
      feature_flags: "id, key, enabled",
      staff: "id, role, active, updatedAt",
      active_cart: "id, updatedAt",
      staff_shifts: "id, staffId, staffName, startedAt, endedAt",
    });
    this.version(3).stores({
      shop_profile: "id, updatedAt",
      products: "id, name, barcode, category, updatedAt, synced",
      customers: "id, name, phone, updatedAt, synced",
      invoices: "id, customerId, paymentMode, createdAt, synced",
      outbox_queue: "id, actionType, timestamp",
      feature_flags: "id, key, enabled",
      staff: "id, role, active, updatedAt",
      active_cart: "id, updatedAt",
      staff_shifts: "id, staffId, staffName, startedAt, endedAt",
      operations: "id, createdAt, updatedAt",
    });
    this.version(4).stores({
      shop_profile: "id, updatedAt",
      products: "id, name, barcode, category, updatedAt, synced",
      customers: "id, name, phone, updatedAt, synced",
      invoices: "id, customerId, paymentMode, createdAt, synced",
      outbox_queue: "id, actionType, timestamp",
      feature_flags: "id, key, enabled",
      staff: "id, role, active, updatedAt",
      active_cart: "id, updatedAt",
      staff_shifts: "id, staffId, staffName, startedAt, endedAt",
      operations: "id, createdAt, updatedAt",
      parked_carts: "id, createdAt, updatedAt",
    });
  }
}

export let localDb = new KokanDatabase("kokan-pos-local");
let activeStoreId: string | null = null;

export function selectLocalStore(storeId: string): void {
  const normalizedStoreId = storeId.trim();
  if (!normalizedStoreId) throw new Error("A store ID is required for local storage.");
  if (activeStoreId === normalizedStoreId) return;
  localDb.close();
  localDb = new KokanDatabase(`kokan-pos-${normalizedStoreId}`);
  activeStoreId = normalizedStoreId;
}

export function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

export async function hashPin(pin: string): Promise<string> {
  const value = `kokan-pos:${pin}`;
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `local-${(hash >>> 0).toString(16)}`;
}

export async function enqueueMutation(actionType: SyncActionType, payload: unknown): Promise<void> {
  await localDb.outbox_queue.add({
    id: createId(),
    actionType,
    payload,
    timestamp: Date.now(),
    retryCount: 0,
  });
}

const seedProducts: Omit<Product, "id" | "updatedAt" | "synced">[] = [
  { name: "Fresh milk · 500 ml", barcode: "8901030875375", category: "Dairy", unit: "pack", sellingPrice: 32, costPrice: 26, stockQty: 24 },
  { name: "Kokan poha · 1 kg", barcode: "8906014561028", category: "Grocery", unit: "bag", sellingPrice: 85, costPrice: 62, stockQty: 18 },
  { name: "Kolhapuri jaggery · 500 g", barcode: "8908001234107", category: "Grocery", unit: "pack", sellingPrice: 68, costPrice: 49, stockQty: 14 },
  { name: "Parle-G family pack", barcode: "8901719111015", category: "Snacks", unit: "pack", sellingPrice: 30, costPrice: 22, stockQty: 32 },
  { name: "Konkani masala · 100 g", barcode: "8906110092042", category: "Grocery", unit: "pack", sellingPrice: 54, costPrice: 37, stockQty: 16 },
  { name: "Alphonso mango juice · 1 L", barcode: "8901571002238", category: "Beverages", unit: "bottle", sellingPrice: 110, costPrice: 82, stockQty: 10 },
  { name: "Farm eggs · 6 pcs", barcode: "8906109910028", category: "Dairy", unit: "box", sellingPrice: 60, costPrice: 48, stockQty: 15 },
  { name: "Batata wafers · 100 g", barcode: "8901725101401", category: "Snacks", unit: "pack", sellingPrice: 35, costPrice: 25, stockQty: 24 },
  { name: "Assam tea · 250 g", barcode: "8901030891161", category: "Grocery", unit: "pack", sellingPrice: 135, costPrice: 102, stockQty: 11 },
  { name: "Mineral water · 1 L", barcode: "8906017290016", category: "Beverages", unit: "bottle", sellingPrice: 20, costPrice: 9, stockQty: 34 },
  { name: "Soft bread loaf · 400 g", barcode: "8906009822317", category: "Bakery", unit: "loaf", sellingPrice: 42, costPrice: 30, stockQty: 9 },
  { name: "Coconut oil · 500 ml", barcode: "8901262150410", category: "Grocery", unit: "bottle", sellingPrice: 165, costPrice: 124, stockQty: 7 },
];

const seedCustomers: Omit<Customer, "id" | "updatedAt" | "synced">[] = [
  { name: "Meera Joshi", phone: "+91 98223 11408", currentBalance: 340 },
  { name: "Nilesh Sawant", phone: "+91 97654 22310", currentBalance: 0 },
  { name: "Rukmini Patil", phone: "+91 98901 67852", currentBalance: 825 },
  { name: "Arjun Naik", phone: "+91 93225 04178", currentBalance: 120 },
];

const seedFlags: Omit<FeatureFlag, "updatedAt" | "synced">[] = [
  { id: "enable_khata", key: "enable_khata", label: "Khata ledger", description: "Let trusted customers buy now and settle later.", enabled: true },
  { id: "enable_gst", key: "enable_gst", label: "GST tools", description: "Show GST-ready sales summaries and receipt fields.", enabled: false },
  { id: "enable_thermal_print", key: "enable_thermal_print", label: "Thermal printing", description: "Connect an ESC/POS Bluetooth receipt printer.", enabled: true },
  { id: "enable_camera_scan", key: "enable_camera_scan", label: "Camera scanner", description: "Use your device camera to read product barcodes.", enabled: true },
];

let initializationQueue: Promise<void> = Promise.resolve();

export function initializeLocalDatabase(
  storeId: string,
  initialShop?: Pick<ShopProfile, "shopName" | "ownerName" | "area" | "phone" | "upiId">,
  initialOwnerPinHash?: string | null,
): Promise<void> {
  const initialization = initializationQueue.then(() => initializeLocalDatabaseForStore(storeId, initialShop, initialOwnerPinHash));
  initializationQueue = initialization.catch(() => undefined);
  return initialization;
}

async function initializeLocalDatabaseForStore(
  storeId: string,
  initialShop?: Pick<ShopProfile, "shopName" | "ownerName" | "area" | "phone" | "upiId">,
  initialOwnerPinHash?: string | null,
): Promise<void> {
  selectLocalStore(storeId);
  await localDb.open();
  const now = Date.now();
  const defaultOwnerPinHash = await hashPin("0427");
  const ownerPinHash = initialOwnerPinHash || defaultOwnerPinHash;

  await localDb.transaction(
    "rw",
    [localDb.shop_profile, localDb.products, localDb.customers, localDb.feature_flags, localDb.staff, localDb.staff_shifts, localDb.active_cart, localDb.outbox_queue],
    async () => {
      if (!(await localDb.shop_profile.get(CURRENT_SHOP_ID))) {
        const profile: ShopProfile = {
          id: CURRENT_SHOP_ID,
          shopName: initialShop?.shopName ?? "Kokan Corner",
          ownerName: initialShop?.ownerName ?? "Shop owner",
          area: initialShop?.area ?? "",
          phone: initialShop?.phone ?? "",
          upiId: initialShop?.upiId ?? "",
          updatedAt: now,
        };
        await localDb.shop_profile.add(profile);
        await enqueueMutation("UPSERT_SHOP_PROFILE", profile);
      }

      if (!initialShop && (await localDb.products.count()) === 0) {
        const seededProducts: Product[] = seedProducts.map((product) => ({
          ...product,
          id: createId(),
          updatedAt: now,
          synced: 0,
        }));
        await localDb.products.bulkAdd(seededProducts);
        for (const product of seededProducts) await enqueueMutation("UPSERT_PRODUCT", product);
      }

      if (!initialShop && (await localDb.customers.count()) === 0) {
        const seededCustomers: Customer[] = seedCustomers.map((customer) => ({
          ...customer,
          id: createId(),
          updatedAt: now,
          synced: 0,
        }));
        await localDb.customers.bulkAdd(seededCustomers);
        for (const customer of seededCustomers) await enqueueMutation("UPSERT_CUSTOMER", customer);
      }

      if ((await localDb.feature_flags.count()) === 0) {
        const seededFlags: FeatureFlag[] = seedFlags.map((flag) => ({ ...flag, updatedAt: now, synced: 0 }));
        await localDb.feature_flags.bulkAdd(seededFlags);
        for (const flag of seededFlags) await enqueueMutation("UPSERT_FEATURE_FLAG", flag);
      }

      if ((await localDb.staff.count()) === 0) {
        const owner: StaffMember = {
          id: createId(),
          name: initialShop?.ownerName ?? "Shop owner",
          role: "owner",
          active: true,
          pinHash: ownerPinHash,
          updatedAt: now,
          synced: 0,
        };
        await localDb.staff.add(owner);
        await enqueueMutation("UPSERT_STAFF", owner);
      } else {
        const owner = await localDb.staff.where("role").equals("owner").filter((member) => member.active).first();
        if (owner) {
          const nextPinHash = owner.pinHash === defaultOwnerPinHash && initialOwnerPinHash
            ? initialOwnerPinHash
            : owner.pinHash;
          const nextName = initialShop?.ownerName?.trim() || owner.name;
          if (nextPinHash !== owner.pinHash || nextName !== owner.name) {
            const updatedOwner = { ...owner, name: nextName, pinHash: nextPinHash, updatedAt: now, synced: 0 as const };
            await localDb.staff.put(updatedOwner);
            await enqueueMutation("UPSERT_STAFF", updatedOwner);
          }
        }
      }

      if (!(await localDb.active_cart.get(ACTIVE_CART_ID))) {
        await localDb.active_cart.add({ id: ACTIVE_CART_ID, items: [], customerId: null, discount: 0, updatedAt: now });
      }
    },
  );
}
