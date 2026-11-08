"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Banknote,
  Bell,
  Bluetooth,
  Check,
  CheckCircle2,
  CircleDollarSign,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  ClipboardList,
  Clock3,
  CreditCard,
  Download,
  FileText,
  Home,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Minus,
  Package,
  Pencil,
  Phone,
  Plus,
  Printer,
  QrCode,
  Receipt,
  ScanLine,
  Search,
  Share2,
  Settings,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Store,
  Tag,
  Trash2,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useBackgroundSync } from "@/hooks/useBackgroundSync";
import { useLocalData } from "@/hooks/useLocalData";
import {
  ACTIVE_CART_ID,
  CURRENT_SHOP_ID,
  createId,
  enqueueMutation,
  hashPin,
  localDb,
  type ActiveCart,
  type Customer,
  type FeatureFlag,
  type Invoice,
  type InvoiceItem,
  type OperationsPayload,
  type OperationsRecord,
  type PaymentMode,
  type Product,
  type ShopProfile,
  type StaffMember,
  type StaffShift,
  type StaffRole,
} from "@/lib/db";
import { csvCell, formatDateTime, formatMoney, formatShortDate, startOfLocalDay } from "@/lib/format";
import { CameraScanner } from "@/components/camera-scanner";
import { OperationsView } from "@/components/operations-view";
import { OwnerPinModal } from "@/components/owner-pin-modal";
import { AccessPortal } from "@/components/access-portal";
import { KokanMark } from "@/components/kokan-mark";
import { getSupabaseClient, type AccountAccess } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";

type View = "pos" | "admin" | "inventory" | "customers" | "reports" | "operations" | "team" | "settings";
type ToastKind = "success" | "error" | "info";

interface ToastMessage {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ProductDraft {
  name: string;
  barcode: string;
  category: string;
  unit: string;
  sellingPrice: string;
  costPrice: string;
  stockQty: string;
}

interface CustomerDraft {
  name: string;
  phone: string;
}

interface StaffDraft {
  name: string;
  role: "admin" | "cashier";
  pin: string;
  hourlyRate: string;
}

interface OwnerPinDraft {
  currentPin: string;
  newPin: string;
  confirmation: string;
}

const emptyCart = (): ActiveCart => ({
  id: ACTIVE_CART_ID,
  items: [],
  customerId: null,
  discount: 0,
  updatedAt: Date.now(),
});

const categoryStyles: Record<string, { emoji: string; color: string }> = {
  Grocery: { emoji: "🌾", color: "wheat" },
  Dairy: { emoji: "🥛", color: "blue" },
  Snacks: { emoji: "🥨", color: "peach" },
  Beverages: { emoji: "🥭", color: "mint" },
  Bakery: { emoji: "🥖", color: "rose" },
  Household: { emoji: "🧼", color: "lavender" },
};

const navigation: { key: View; label: string; icon: typeof ShoppingCart; badge?: string }[] = [
  { key: "pos", label: "Checkout", icon: ShoppingCart, badge: "F1" },
  { key: "admin", label: "Admin", icon: LayoutDashboard },
  { key: "inventory", label: "Inventory", icon: Package },
  { key: "customers", label: "Customers", icon: Users },
  { key: "reports", label: "Reports", icon: BarChart3 },
  { key: "operations", label: "Operations", icon: ClipboardList },
  { key: "team", label: "Team & hours", icon: Clock3 },
  { key: "settings", label: "Settings", icon: Settings },
];

const pageTitles: Record<View, { eyebrow: string; title: string; subtitle: string }> = {
  pos: { eyebrow: "DAILY OPERATIONS", title: "Checkout", subtitle: "A quicker checkout, even when the internet takes a break." },
  admin: { eyebrow: "SHOP OVERVIEW", title: "Admin dashboard", subtitle: "Your shop at a glance, with the tools you need close by." },
  inventory: { eyebrow: "YOUR CATALOG", title: "Inventory", subtitle: "Keep every shelf, price and stock count in sync." },
  customers: { eyebrow: "YOUR COMMUNITY", title: "Customers", subtitle: "Good service today. A little khata for tomorrow." },
  reports: { eyebrow: "THE BIG PICTURE", title: "Reports", subtitle: "A clear view of how your shop is doing." },
  operations: { eyebrow: "THE DAILY SHOP RHYTHM", title: "Shop operations", subtitle: "Stock counts, purchases, cash, expenses and customer collections." },
  team: { eyebrow: "YOUR PEOPLE", title: "Team & attendance", subtitle: "Review shifts and estimated gross pay from this device." },
  settings: { eyebrow: "MADE FOR YOUR SHOP", title: "Settings", subtitle: "Your shop, your rules, your local-first setup." },
};

const featureFallbacks = [
  { id: "enable_khata", key: "enable_khata", label: "Khata ledger", description: "Let trusted customers buy now and settle later.", enabled: true, updatedAt: 0, synced: 0 as const },
  { id: "enable_gst", key: "enable_gst", label: "GST tools", description: "Show GST-ready sales summaries and receipt fields.", enabled: false, updatedAt: 0, synced: 0 as const },
  { id: "enable_thermal_print", key: "enable_thermal_print", label: "Thermal printing", description: "Connect an ESC/POS Bluetooth receipt printer.", enabled: true, updatedAt: 0, synced: 0 as const },
  { id: "enable_camera_scan", key: "enable_camera_scan", label: "Camera scanner", description: "Use your device camera to read product barcodes.", enabled: true, updatedAt: 0, synced: 0 as const },
];

function categoryStyle(category: string) {
  return categoryStyles[category] ?? { emoji: "🛍️", color: "mint" };
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function getPaymentLabel(mode: PaymentMode): string {
  return mode === "upi" ? "UPI" : mode === "khata" ? "Khata" : "Cash";
}

interface BluetoothCharacteristicLike {
  writeValue?: (value: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
}

interface BluetoothServiceLike {
  getCharacteristic: (uuid: string) => Promise<BluetoothCharacteristicLike>;
}

interface BluetoothServerLike {
  getPrimaryService: (uuid: string) => Promise<BluetoothServiceLike>;
}

interface BluetoothDeviceLike {
  gatt?: { connect: () => Promise<BluetoothServerLike> };
}

interface BluetoothApiLike {
  requestDevice: (options: { acceptAllDevices: boolean; optionalServices: string[] }) => Promise<BluetoothDeviceLike>;
}

export function PosShell() {
  const supabase = getSupabaseClient();
  const [session, setSession] = useState<Session | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const authReady = !supabase || authInitialized;
  const [account, setAccount] = useState<AccountAccess | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const activeAccess = account?.status === "active" ? account : null;
  const activeStoreId = activeAccess?.storeId ?? null;
  const activeStoreName = activeAccess?.storeName;
  const activeOwnerName = activeAccess?.ownerName;
  const activeArea = activeAccess?.area;
  const activePhone = activeAccess?.phone;
  const initialShop = useMemo(
    () => activeStoreId
      ? {
          shopName: activeStoreName ?? "",
          ownerName: activeOwnerName ?? "",
          area: activeArea ?? "",
          phone: activePhone ?? "",
          upiId: "",
        }
      : undefined,
    [activeArea, activeOwnerName, activePhone, activeStoreId, activeStoreName],
  );
  const { shop, products, customers, invoices, flags, staff, shifts, operations, ready, error } = useLocalData(
    activeStoreId !== null,
    activeStoreId,
    initialShop,
    activeAccess?.ownerPinHash,
  );
  const sync = useBackgroundSync(ready && activeAccess !== null, activeAccess?.storeId ?? null);
  const [activeView, setActiveView] = useState<View>("pos");
  const [cart, setCart] = useState<ActiveCart>(emptyCart);
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [inventorySearch, setInventorySearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [paymentMode, setPaymentMode] = useState<PaymentMode | null>(null);
  const [cashGiven, setCashGiven] = useState("");
  const [saleSaving, setSaleSaving] = useState(false);
  const [successfulInvoice, setSuccessfulInvoice] = useState<Invoice | null>(null);
  const [invoiceActionBusy, setInvoiceActionBusy] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [pendingAdminView, setPendingAdminView] = useState<View>("inventory");
  const [pinOpen, setPinOpen] = useState(false);
  const [pinChangeOpen, setPinChangeOpen] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [printerBusy, setPrinterBusy] = useState(false);
  const [signedInStaff, setSignedInStaff] = useState<StaffMember | null>(null);
  const [staffLoginName, setStaffLoginName] = useState("");
  const [staffLoginPin, setStaffLoginPin] = useState("");
  const [staffLoginError, setStaffLoginError] = useState("");
  const [staffLoginAttempts, setStaffLoginAttempts] = useState(0);
  const [staffLoginLockedUntil, setStaffLoginLockedUntil] = useState(0);

  const refreshAccount = useCallback(async () => {
    if (!supabase || !session) return;
    setAccountLoading(true);
    setAccountError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke("platform-api", {
        body: { action: "account" },
      });
      if (functionError) throw functionError;
      if (!data || typeof data.status !== "string") throw new Error("The access service returned an invalid response.");
      const currentAccount = data as AccountAccess;
      setAccount(currentAccount);
      if (currentAccount.status === "active") {
        window.localStorage.setItem(`kokan-pos-access:${session.user.id}`, JSON.stringify(currentAccount));
      } else {
        window.localStorage.removeItem(`kokan-pos-access:${session.user.id}`);
      }
    } catch (accountLookupError) {
      const cachedAccess = window.localStorage.getItem(`kokan-pos-access:${session.user.id}`);
      if (cachedAccess) {
        try {
          const parsed = JSON.parse(cachedAccess) as AccountAccess;
          if (parsed.status === "active" && typeof parsed.storeId === "string" && parsed.storeId.length > 0) {
            setAccount(parsed);
            setAccountError(null);
            return;
          }
        } catch {
          window.localStorage.removeItem(`kokan-pos-access:${session.user.id}`);
        }
      }
      setAccount(null);
      setAccountError(accountLookupError instanceof Error ? accountLookupError.message : "Store access could not be checked.");
    } finally {
      setAccountLoading(false);
    }
  }, [session, supabase]);

  useEffect(() => {
    if (!supabase) {
      return;
    }
    let active = true;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setAccountError(sessionError.message);
      setSession(data.session);
      setAuthInitialized(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAccount(null);
      setAccountError(null);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (authReady && session) void Promise.resolve().then(refreshAccount);
  }, [authReady, refreshAccount, session]);

  useEffect(() => {
    if (!session || !activeAccess) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshAccount();
    };
    const timer = window.setInterval(refreshWhenVisible, 60_000);
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
    };
  }, [activeAccess, refreshAccount, session]);

  const showToast = useCallback((message: string, kind: ToastKind = "success") => {
    setToast({ id: Date.now(), message, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const signInStaff = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (Date.now() < staffLoginLockedUntil) {
      setStaffLoginError("Too many attempts. Please wait before trying again.");
      return;
    }
    const name = staffLoginName.trim().toLocaleLowerCase();
    const candidate = staff.find((member) => member.active && member.name.trim().toLocaleLowerCase() === name);
    if (!candidate || candidate.pinHash !== await hashPin(staffLoginPin)) {
      const attempts = staffLoginAttempts + 1;
      setStaffLoginAttempts(attempts);
      setStaffLoginPin("");
      if (attempts >= 5) {
        setStaffLoginLockedUntil(Date.now() + 30_000);
        setStaffLoginAttempts(0);
        setStaffLoginError("Too many attempts. Sign-in is paused for 30 seconds.");
      } else {
        setStaffLoginError("Name or PIN didn’t match. Check your details and try again.");
      }
      return;
    }
    try {
      const openShift = await localDb.staff_shifts
        .where("staffId")
        .equals(candidate.id)
        .filter((shift) => shift.endedAt === null)
        .first();
      if (!openShift) {
        const startedAt = Date.now();
        const shift: StaffShift = {
          id: createId(),
          staffId: candidate.id,
          staffName: candidate.name,
          startedAt,
          endedAt: null,
          hourlyRate: Math.max(0, candidate.hourlyRate ?? 0),
          updatedAt: startedAt,
          synced: 0,
        };
        await localDb.transaction("rw", [localDb.staff_shifts, localDb.outbox_queue], async () => {
          await localDb.staff_shifts.add(shift);
          await enqueueMutation("UPSERT_STAFF_SHIFT", shift);
        });
      }
      setSignedInStaff(candidate);
      setStaffLoginPin("");
      setStaffLoginError("");
      setStaffLoginAttempts(0);
      setAdminUnlocked(false);
      setActiveView("pos");
      showToast(openShift ? `Welcome back, ${candidate.name}. Your shift is still running.` : `Shift started for ${candidate.name}.`);
    } catch (loginError) {
      setStaffLoginError(loginError instanceof Error ? loginError.message : "The shift could not be started. Please try again.");
    }
  };

  const clockOutStaff = async () => {
    if (!signedInStaff) return;
    try {
      const openShift = await localDb.staff_shifts
        .where("staffId")
        .equals(signedInStaff.id)
        .filter((shift) => shift.endedAt === null)
        .first();
      if (openShift) {
        const endedAt = Date.now();
        const updated: StaffShift = { ...openShift, endedAt, updatedAt: endedAt, synced: 0 };
        await localDb.transaction("rw", [localDb.staff_shifts, localDb.outbox_queue], async () => {
          await localDb.staff_shifts.put(updated);
          await enqueueMutation("UPSERT_STAFF_SHIFT", updated);
        });
      }
      setSignedInStaff(null);
      setAdminUnlocked(false);
      setActiveView("pos");
      setStaffLoginName("");
      setStaffLoginPin("");
      showToast(`Shift ended for ${signedInStaff.name}.`);
    } catch (clockOutError) {
      showToast(clockOutError instanceof Error ? clockOutError.message : "Could not record clock-out. Please retry.", "error");
    }
  };

  useEffect(() => {
    if (!ready) return;
    let active = true;
    void localDb.active_cart
      .get(ACTIVE_CART_ID)
      .then((savedCart) => {
        if (active && savedCart) setCart(savedCart);
      })
      .catch(() => showToast("The saved cart could not be restored.", "error"));
    return () => {
      active = false;
    };
  }, [ready, showToast]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js").then(async () => {
      if (!("caches" in window)) return;
      const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]")).map((element) => element.src);
      const stylesheets = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')).map((element) => element.href);
      const assets = [...scripts, ...stylesheets].filter((asset) => {
        const url = new URL(asset);
        return url.origin === window.location.origin && url.pathname.startsWith("/_next/static/");
      });
      const cache = await caches.open("kokan-pos-shell-v3");
      await Promise.allSettled(assets.map(async (asset) => {
        const response = await fetch(asset, { cache: "force-cache" });
        if (response.ok) await cache.put(asset, response.clone());
      }));
    }).catch(() => undefined);
  }, []);

  const persistCart = useCallback((nextCart: ActiveCart) => {
    const stamped = { ...nextCart, updatedAt: Date.now() };
    setCart(stamped);
    void localDb.active_cart.put(stamped).catch(() => undefined);
  }, []);

  const addToCart = useCallback(
    (product: Product) => {
      if (product.stockQty <= 0) {
        showToast(`${product.name} is out of stock.`, "error");
        return;
      }
      const existing = cart.items.find((line) => line.productId === product.id);
      if (existing && existing.quantity >= product.stockQty) {
        showToast(`Only ${product.stockQty} ${product.unit} available.`, "info");
        return;
      }
      const items = existing
        ? cart.items.map((line) => (line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line))
        : [...cart.items, { productId: product.id, quantity: 1 }];
      persistCart({ ...cart, items });
      showToast(`${product.name} added to cart.`, "success");
    },
    [cart, persistCart, showToast],
  );

  const handleScannedValue = useCallback(
    (value: string) => {
      setCameraOpen(false);
      setSearch(value);
      const match = products.find((product) => product.barcode?.trim() === value.trim());
      if (match) addToCart(match);
      else showToast(`No product found for barcode ${value}.`, "info");
    },
    [addToCart, products, showToast],
  );

  useEffect(() => {
    let buffer = "";
    let lastKeyAt = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      const now = Date.now();
      if (event.key === "F1" || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.key === "Enter") {
        if (buffer.length >= 4 && now - lastKeyAt < 120) {
          const barcode = buffer;
          const match = products.find((product) => product.barcode?.trim() === barcode.trim());
          if (match) addToCart(match);
        }
        buffer = "";
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (now - lastKeyAt > 90) buffer = event.key;
        else buffer += event.key;
        lastKeyAt = now;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addToCart, products]);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(products.map((product) => product.category))).sort()],
    [products],
  );
  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = categoryFilter === "All" || product.category === categoryFilter;
      const matchesSearch =
        !term ||
        product.name.toLowerCase().includes(term) ||
        product.category.toLowerCase().includes(term) ||
        (product.barcode ?? "").toLowerCase().includes(term);
      return matchesCategory && matchesSearch;
    });
  }, [categoryFilter, products, search]);

  const cartSubtotal = useMemo(
    () =>
      cart.items.reduce((sum, line) => {
        const product = products.find((item) => item.id === line.productId);
        return sum + (product?.sellingPrice ?? 0) * line.quantity;
      }, 0),
    [cart.items, products],
  );
  const cartTotal = Math.max(0, cartSubtotal - cart.discount);
  const cartQuantity = cart.items.reduce((sum, line) => sum + line.quantity, 0);
  const flagEnabled = (key: string) =>
    (flags.find((flag) => flag.key === key)?.enabled ??
      featureFallbacks.find((flag) => flag.key === key)?.enabled ??
      false) &&
    activeAccess?.features[key] !== false;

  const changeQuantity = (productId: string, change: number) => {
    const line = cart.items.find((item) => item.productId === productId);
    if (!line) return;
    const product = products.find((item) => item.id === productId);
    const nextQuantity = line.quantity + change;
    if (product && nextQuantity > product.stockQty) {
      showToast(`Only ${product.stockQty} ${product.unit} available.`, "info");
      return;
    }
    const items = nextQuantity <= 0
      ? cart.items.filter((item) => item.productId !== productId)
      : cart.items.map((item) => (item.productId === productId ? { ...item, quantity: nextQuantity } : item));
    persistCart({ ...cart, items, discount: Math.min(cart.discount, cartSubtotal) });
  };

  const setSelectedCustomer = (customerId: string) => {
    persistCart({ ...cart, customerId: customerId || null });
  };

  const requestView = (view: View) => {
    if (view === "pos" || adminUnlocked) {
      setActiveView(view);
      return;
    }
    setPendingAdminView(view);
    setPinInput("");
    setPinError("");
    setPinOpen(true);
  };

  const unlockAdmin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const pinHash = await hashPin(pinInput.trim());
    const administrator = staff.find((member) => member.active && (member.role === "owner" || member.role === "admin"));
    if (administrator && administrator.pinHash === pinHash) {
      setAdminUnlocked(true);
      setActiveView(pendingAdminView);
      setPinOpen(false);
      setPinInput("");
      setPinError("");
      showToast("Owner tools unlocked.");
      return;
    }
    setPinError("That PIN didn’t match. Try again.");
  };

  const lockAdmin = () => {
    setAdminUnlocked(false);
    setActiveView("pos");
    showToast("Owner tools are locked.", "info");
  };

  const downloadReceiptPdf = async (invoice: Invoice) => {
    setInvoiceActionBusy(true);
    try {
      const { createInvoicePdfFile, downloadInvoicePdf } = await import("@/lib/invoice-pdf");
      downloadInvoicePdf(createInvoicePdfFile(invoice, shop));
      showToast("Receipt PDF downloaded.");
    } catch (pdfError) {
      showToast(pdfError instanceof Error ? pdfError.message : "The receipt PDF could not be generated.", "error");
    } finally {
      setInvoiceActionBusy(false);
    }
  };

  const shareReceiptPdf = async (invoice: Invoice) => {
    setInvoiceActionBusy(true);
    try {
      const { createInvoicePdfFile, downloadInvoicePdf } = await import("@/lib/invoice-pdf");
      const file = createInvoicePdfFile(invoice, shop);
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Receipt ${invoice.id.slice(0, 8).toUpperCase()}`,
          text: `Receipt from ${shop?.shopName ?? "Kokan POS Store"}`,
        });
      } else {
        downloadInvoicePdf(file);
        showToast("PDF downloaded. Attach it in WhatsApp or your messaging app.");
      }
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      showToast(shareError instanceof Error ? shareError.message : "The receipt could not be shared.", "error");
    } finally {
      setInvoiceActionBusy(false);
    }
  };

  const receiptWhatsAppUrl = (invoice: Invoice) => {
    if (!invoice.customerPhone) return null;
    let phone = invoice.customerPhone.replace(/\D/g, "");
    if (phone.startsWith("0")) phone = phone.slice(1);
    if (phone.length === 10) phone = `91${phone}`;
    if (phone.length < 10) return null;
    const message = `Hello${invoice.customerName ? ` ${invoice.customerName}` : ""}, your receipt from ${shop?.shopName ?? "Kokan POS"} is ready. Receipt #${invoice.id.slice(0, 8).toUpperCase()} · ${formatMoney(invoice.totalAmount)}. Please attach the downloaded receipt PDF to this chat.`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  };

  const beginPayment = (mode: PaymentMode) => {
    if (cart.items.length === 0) {
      showToast("Add an item before checking out.", "info");
      return;
    }
    if (mode === "khata" && !cart.customerId) {
      showToast("Select a customer for a Khata sale.", "error");
      return;
    }
    setCashGiven(String(cartTotal));
    setMobileCartOpen(false);
    setPaymentMode(mode);
  };

  const finishSale = async () => {
    if (!paymentMode || saleSaving) return;
    if (paymentMode === "khata" && !cart.customerId) {
      showToast("Select a customer for a Khata sale.", "error");
      return;
    }
    if (paymentMode === "cash" && (Number(cashGiven) || 0) < cartTotal) {
      showToast("Cash received must cover the sale total.", "error");
      return;
    }
    if (paymentMode === "upi" && !shop?.upiId.trim()) {
      showToast("Add your UPI ID in Settings before taking UPI payments.", "error");
      return;
    }

    setSaleSaving(true);
    const createdAt = Date.now();
    const customer = customers.find((item) => item.id === cart.customerId) ?? null;
    const invoiceItems: InvoiceItem[] = cart.items.flatMap((line) => {
      const product = products.find((item) => item.id === line.productId);
      if (!product) return [];
      return [{
        productId: product.id,
        name: product.name,
        category: product.category,
        quantity: line.quantity,
        unit: product.unit,
        unitPrice: product.sellingPrice,
        unitCost: product.costPrice,
        lineTotal: product.sellingPrice * line.quantity,
      }];
    });
    if (invoiceItems.length !== cart.items.length) {
      setSaleSaving(false);
      showToast("A cart item is no longer available. Review the cart and try again.", "error");
      return;
    }
    const invoice: Invoice = {
      id: createId(),
      customerId: customer?.id ?? null,
      customerName: customer?.name ?? null,
      customerPhone: customer?.phone ?? null,
      items: invoiceItems,
      subtotal: cartSubtotal,
      discount: Math.min(cart.discount, cartSubtotal),
      totalAmount: cartTotal,
      paymentMode,
      createdAt,
      synced: 0,
    };
    const clearedCart: ActiveCart = { id: ACTIVE_CART_ID, items: [], customerId: null, discount: 0, updatedAt: createdAt };

    try {
      await localDb.transaction(
        "rw",
        [localDb.products, localDb.customers, localDb.invoices, localDb.outbox_queue, localDb.active_cart],
        async () => {
          for (const line of cart.items) {
            const current = await localDb.products.get(line.productId);
            if (!current || current.stockQty < line.quantity) {
              throw new Error(`${current?.name ?? "An item"} no longer has enough stock.`);
            }
            const updatedProduct: Product = {
              ...current,
              stockQty: current.stockQty - line.quantity,
              updatedAt: createdAt,
              synced: 0,
            };
            await localDb.products.put(updatedProduct);
            await enqueueMutation("UPSERT_PRODUCT", updatedProduct);
          }

          if (paymentMode === "khata" && customer) {
            const currentCustomer = await localDb.customers.get(customer.id);
            if (!currentCustomer) throw new Error("The selected customer is no longer available.");
            const updatedCustomer: Customer = {
              ...currentCustomer,
              currentBalance: currentCustomer.currentBalance + cartTotal,
              updatedAt: createdAt,
              synced: 0,
            };
            await localDb.customers.put(updatedCustomer);
            await enqueueMutation("UPSERT_CUSTOMER", updatedCustomer);
          }

          await localDb.invoices.add(invoice);
          await enqueueMutation("UPSERT_INVOICE", invoice);
          await localDb.active_cart.put(clearedCart);
        },
      );
      setCart(clearedCart);
      setPaymentMode(null);
      setSuccessfulInvoice(invoice);
      showToast(`Sale complete · ${formatMoney(invoice.totalAmount)}`);
    } catch (saleError) {
      showToast(saleError instanceof Error ? saleError.message : "Sale could not be saved. Please try again.", "error");
    } finally {
      setSaleSaving(false);
    }
  };

  const saveProduct = async (draft: ProductDraft) => {
    const now = Date.now();
    const product: Product = {
      id: editingProduct?.id ?? createId(),
      name: draft.name.trim(),
      barcode: draft.barcode.trim() || null,
      category: draft.category,
      unit: draft.unit.trim() || "unit",
      sellingPrice: Math.max(0, Number(draft.sellingPrice) || 0),
      costPrice: Math.max(0, Number(draft.costPrice) || 0),
      stockQty: Math.max(0, Number(draft.stockQty) || 0),
      updatedAt: now,
      synced: 0,
    };
    try {
      await localDb.transaction("rw", [localDb.products, localDb.outbox_queue], async () => {
        await localDb.products.put(product);
        await enqueueMutation("UPSERT_PRODUCT", product);
      });
      setProductModalOpen(false);
      setEditingProduct(null);
      showToast(editingProduct ? "Product updated on this device." : "Product added to your catalog.");
    } catch {
      showToast("Product could not be saved to local storage.", "error");
    }
  };

  const removeProduct = async (product: Product) => {
    if (!window.confirm(`Remove “${product.name}” from your catalog?`)) return;
    const updatedAt = Date.now();
    try {
      await localDb.transaction("rw", [localDb.products, localDb.outbox_queue], async () => {
        await localDb.products.delete(product.id);
        await enqueueMutation("DELETE_PRODUCT", { id: product.id, updatedAt });
      });
      showToast(`${product.name} removed from inventory.`, "info");
    } catch {
      showToast("Product could not be removed.", "error");
    }
  };

  const saveCustomer = async (draft: CustomerDraft) => {
    const now = Date.now();
    const customer: Customer = {
      id: createId(),
      name: draft.name.trim(),
      phone: draft.phone.trim(),
      currentBalance: 0,
      updatedAt: now,
      synced: 0,
    };
    try {
      await localDb.transaction("rw", [localDb.customers, localDb.outbox_queue], async () => {
        await localDb.customers.add(customer);
        await enqueueMutation("UPSERT_CUSTOMER", customer);
      });
      setCustomerModalOpen(false);
      showToast(`${customer.name} added to your customers.`);
    } catch {
      showToast("Customer could not be saved locally.", "error");
    }
  };

  const saveOperation = async (payload: OperationsPayload) => {
    const now = Date.now();
    const operation: OperationsRecord = { id: createId(), payload, createdAt: now, updatedAt: now, synced: 0 };
    await localDb.transaction("rw", [localDb.operations, localDb.outbox_queue], async () => {
      await localDb.operations.add(operation);
      await enqueueMutation("UPSERT_OPERATION", operation);
    });
    return operation;
  };

  const saveStockAdjustment = async (productId: string, newQuantity: number, reason: string): Promise<boolean> => {
    if (!Number.isFinite(newQuantity) || newQuantity < 0 || !reason.trim()) {
      showToast("Choose a product and enter a valid counted quantity and reason.", "error");
      return false;
    }
    const now = Date.now();
    let productName = "";
    let unchanged = false;
    try {
      await localDb.transaction("rw", [localDb.products, localDb.operations, localDb.outbox_queue], async () => {
        const product = await localDb.products.get(productId);
        if (!product) throw new Error("This product is no longer in the catalog.");
        productName = product.name;
        if (product.stockQty === newQuantity) {
          unchanged = true;
          return;
        }
        const updatedProduct: Product = { ...product, stockQty: newQuantity, updatedAt: now, synced: 0 };
        const operation: OperationsRecord = {
          id: createId(),
          payload: {
            kind: "stock_adjustment",
            productId,
            productName: product.name,
            previousQty: product.stockQty,
            quantityDelta: newQuantity - product.stockQty,
            reason,
          },
          createdAt: now,
          updatedAt: now,
          synced: 0,
        };
        await localDb.products.put(updatedProduct);
        await localDb.operations.add(operation);
        await enqueueMutation("UPSERT_PRODUCT", updatedProduct);
        await enqueueMutation("UPSERT_OPERATION", operation);
      });
      showToast(unchanged ? "The counted stock matches the current quantity." : `Stock count saved for ${productName}.`, unchanged ? "info" : "success");
      return true;
    } catch (saveError) {
      showToast(saveError instanceof Error ? saveError.message : "Stock adjustment could not be saved.", "error");
      return false;
    }
  };

  const receivePurchase = async (productId: string, supplier: string, quantity: number, unitCost: number, note: string): Promise<boolean> => {
    if (!supplier.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
      showToast("Enter a supplier, product, positive quantity, and valid unit cost.", "error");
      return false;
    }
    const now = Date.now();
    let productUnit = "unit";
    try {
      await localDb.transaction("rw", [localDb.products, localDb.operations, localDb.outbox_queue], async () => {
        const product = await localDb.products.get(productId);
        if (!product) throw new Error("This product is no longer in the catalog.");
        productUnit = product.unit;
        const updatedProduct: Product = { ...product, stockQty: product.stockQty + quantity, costPrice: unitCost, updatedAt: now, synced: 0 };
        const operation: OperationsRecord = {
          id: createId(),
          payload: {
            kind: "purchase",
            supplier: supplier.trim(),
            productId,
            productName: product.name,
            quantity,
            unitCost,
            total: quantity * unitCost,
            note,
          },
          createdAt: now,
          updatedAt: now,
          synced: 0,
        };
        await localDb.products.put(updatedProduct);
        await localDb.operations.add(operation);
        await enqueueMutation("UPSERT_PRODUCT", updatedProduct);
        await enqueueMutation("UPSERT_OPERATION", operation);
      });
      showToast(`${quantity} ${productUnit}${quantity === 1 ? "" : "s"} received from ${supplier}.`);
      return true;
    } catch (saveError) {
      showToast(saveError instanceof Error ? saveError.message : "The supplier purchase could not be saved.", "error");
      return false;
    }
  };

  const recordExpense = async (category: string, amount: number, description: string, paymentMode: "cash" | "upi"): Promise<boolean> => {
    if (!category.trim() || !Number.isFinite(amount) || amount <= 0 || !description.trim()) {
      showToast("Enter a category, positive amount, and description.", "error");
      return false;
    }
    try {
      await saveOperation({ kind: "expense", category, amount, description, paymentMode });
      showToast(`${category} expense recorded.`);
      return true;
    } catch (saveError) {
      showToast(saveError instanceof Error ? saveError.message : "Expense could not be saved.", "error");
      return false;
    }
  };

  const recordReturn = async (invoiceId: string, productId: string, quantity: number): Promise<boolean> => {
    if (!Number.isInteger(quantity) || quantity < 1) {
      showToast("This return is no longer valid. Refresh the selected sale and try again.", "error");
      return false;
    }
    const now = Date.now();
    let returnedItemName = "";
    let refundAmount = 0;
    let refundPaymentMode: PaymentMode = "cash";
    try {
      await localDb.transaction("rw", [localDb.invoices, localDb.products, localDb.customers, localDb.operations, localDb.outbox_queue], async () => {
        const invoice = await localDb.invoices.get(invoiceId);
        const item = invoice?.items.find((line) => line.productId === productId);
        const product = await localDb.products.get(productId);
        const operationRows = await localDb.operations.toArray();
        const alreadyReturned = operationRows.reduce((sum, operation) =>
          operation.payload.kind === "return" && operation.payload.invoiceId === invoiceId && operation.payload.productId === productId
            ? sum + operation.payload.quantity
            : sum, 0);
        if (!invoice || !item || !product || alreadyReturned + quantity > item.quantity) {
          throw new Error("This return exceeds the remaining quantity on the original sale.");
        }
        returnedItemName = item.name;
        refundPaymentMode = invoice.paymentMode;
        refundAmount = invoice.subtotal > 0
          ? item.lineTotal * (quantity / item.quantity) * (invoice.totalAmount / invoice.subtotal)
          : 0;
        const profitReversal = invoice.subtotal > 0
          ? ((item.unitPrice - item.unitCost) * quantity - invoice.discount * (item.lineTotal / invoice.subtotal) * (quantity / item.quantity))
          : 0;
        const updatedProduct: Product = { ...product, stockQty: product.stockQty + quantity, updatedAt: now, synced: 0 };
        const operation: OperationsRecord = {
          id: createId(),
          payload: {
            kind: "return",
            invoiceId,
            invoiceNumber: invoice.id.slice(0, 8).toUpperCase(),
            paymentMode: invoice.paymentMode,
            productId,
            productName: item.name,
            quantity,
            amount: refundAmount,
            profitReversal,
          },
          createdAt: now,
          updatedAt: now,
          synced: 0,
        };
        const customer = invoice.paymentMode === "khata" && invoice.customerId
          ? await localDb.customers.get(invoice.customerId)
          : undefined;
        if (invoice.paymentMode === "khata" && invoice.customerId && !customer) {
          throw new Error("The Khata customer for this sale is no longer available.");
        }
        const updatedCustomer = customer
          ? { ...customer, currentBalance: Math.max(0, customer.currentBalance - refundAmount), updatedAt: now, synced: 0 as const }
          : null;
        await localDb.products.put(updatedProduct);
        if (updatedCustomer) {
          await localDb.customers.put(updatedCustomer);
          await enqueueMutation("UPSERT_CUSTOMER", updatedCustomer);
        }
        await localDb.operations.add(operation);
        await enqueueMutation("UPSERT_PRODUCT", updatedProduct);
        await enqueueMutation("UPSERT_OPERATION", operation);
      });
      showToast(`Return recorded for ${returnedItemName}. Refund ${formatMoney(refundAmount)} via ${getPaymentLabel(refundPaymentMode)}.`);
      return true;
    } catch (saveError) {
      showToast(saveError instanceof Error ? saveError.message : "The return could not be saved.", "error");
      return false;
    }
  };

  const recordCustomerPayment = async (customerId: string, amount: number, note: string): Promise<boolean> => {
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Payment must be positive and no greater than the current balance.", "error");
      return false;
    }
    const now = Date.now();
    let customerName = "";
    try {
      await localDb.transaction("rw", [localDb.customers, localDb.operations, localDb.outbox_queue], async () => {
        const customer = await localDb.customers.get(customerId);
        if (!customer || amount > customer.currentBalance) {
          throw new Error("Payment must be no greater than the customer's current balance.");
        }
        customerName = customer.name;
        const updatedCustomer: Customer = { ...customer, currentBalance: customer.currentBalance - amount, updatedAt: now, synced: 0 };
        const operation: OperationsRecord = {
          id: createId(),
          payload: { kind: "customer_payment", customerId, customerName: customer.name, amount, note },
          createdAt: now,
          updatedAt: now,
          synced: 0,
        };
        await localDb.customers.put(updatedCustomer);
        await localDb.operations.add(operation);
        await enqueueMutation("UPSERT_CUSTOMER", updatedCustomer);
        await enqueueMutation("UPSERT_OPERATION", operation);
      });
      showToast(`${formatMoney(amount)} collected from ${customerName}.`);
      return true;
    } catch (saveError) {
      showToast(saveError instanceof Error ? saveError.message : "Customer payment could not be saved.", "error");
      return false;
    }
  };

  const recordCashClose = async (openingFloat: number, countedCash: number, expectedCash: number): Promise<boolean> => {
    if (![openingFloat, countedCash, expectedCash].every((value) => Number.isFinite(value) && value >= 0)) {
      showToast("Enter valid non-negative cash amounts.", "error");
      return false;
    }
    const now = Date.now();
    try {
      await saveOperation({
        kind: "cash_close",
        dateKey: new Date(now).toLocaleDateString("en-CA"),
        openingFloat,
        countedCash,
        expectedCash,
        variance: countedCash - expectedCash,
      });
      showToast(`Cash close saved. Variance: ${formatMoney(countedCash - expectedCash)}.`);
      return true;
    } catch (saveError) {
      showToast(saveError instanceof Error ? saveError.message : "Cash close could not be saved.", "error");
      return false;
    }
  };

  const saveStaffMember = async (draft: StaffDraft) => {
    const name = draft.name.trim();
    const hourlyRate = Number(draft.hourlyRate);
    if (!name || draft.pin.length < 4 || draft.pin.length > 8 || !/^\d+$/.test(draft.pin)) {
      showToast("Enter a name and a PIN with 4 to 8 digits.", "error");
      return;
    }
    if (staff.some((member) => member.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      showToast("A team member with that name already exists. Choose a unique name for sign-in.", "error");
      return;
    }
    if (!Number.isFinite(hourlyRate) || hourlyRate < 0) {
      showToast("Enter a valid hourly rate of zero or more.", "error");
      return;
    }
    const now = Date.now();
    const member: StaffMember = {
      id: createId(),
      name,
      role: draft.role as StaffRole,
      active: true,
      pinHash: await hashPin(draft.pin),
      hourlyRate,
      updatedAt: now,
      synced: 0,
    };
    try {
      await localDb.transaction("rw", [localDb.staff, localDb.outbox_queue], async () => {
        await localDb.staff.add(member);
        await enqueueMutation("UPSERT_STAFF", member);
      });
      setStaffModalOpen(false);
      showToast(`${member.name} added to the team.`);
    } catch {
      showToast("Team member could not be saved locally.", "error");
    }
  };

  const updateStaffRate = async (member: StaffMember, hourlyRate: number) => {
    if (!Number.isFinite(hourlyRate) || hourlyRate < 0) {
      showToast("Hourly rate must be zero or more.", "error");
      return;
    }
    const updated: StaffMember = { ...member, hourlyRate, updatedAt: Date.now(), synced: 0 };
    try {
      await localDb.transaction("rw", [localDb.staff, localDb.outbox_queue], async () => {
        await localDb.staff.put(updated);
        await enqueueMutation("UPSERT_STAFF", updated);
      });
      showToast(`Hourly rate updated for ${member.name}.`);
    } catch (saveError) {
      showToast(saveError instanceof Error ? saveError.message : "Hourly rate could not be saved.", "error");
    }
  };

  const setStaffActive = async (member: StaffMember) => {
    if (member.role === "owner") {
      showToast("The shop owner account cannot be deactivated here.", "error");
      return;
    }
    if (member.active && signedInStaff?.id === member.id) {
      showToast("Clock out before deactivating your own account.", "info");
      return;
    }
    const active = !member.active;
    const updated: StaffMember = { ...member, active, updatedAt: Date.now(), synced: 0 };
    try {
      await localDb.transaction("rw", [localDb.staff, localDb.outbox_queue], async () => {
        await localDb.staff.put(updated);
        await enqueueMutation("UPSERT_STAFF", updated);
      });
      showToast(`${member.name} ${active ? "reactivated" : "deactivated"}.`);
    } catch (saveError) {
      showToast(saveError instanceof Error ? saveError.message : "Team access could not be updated.", "error");
    }
  };

  const closeStaffShift = async (shift: StaffShift) => {
    if (shift.endedAt) return;
    if (!window.confirm(`Record clock-out now for ${shift.staffName}?`)) return;
    const endedAt = Date.now();
    const updated: StaffShift = { ...shift, endedAt, updatedAt: endedAt, synced: 0 };
    try {
      await localDb.transaction("rw", [localDb.staff_shifts, localDb.outbox_queue], async () => {
        await localDb.staff_shifts.put(updated);
        await enqueueMutation("UPSERT_STAFF_SHIFT", updated);
      });
      showToast(`Clock-out recorded for ${shift.staffName}.`);
    } catch (saveError) {
      showToast(saveError instanceof Error ? saveError.message : "The shift could not be closed.", "error");
    }
  };

  const saveOwnerPin = async (draft: OwnerPinDraft) => {
    if (draft.newPin.length < 4 || draft.newPin.length > 8) {
      showToast("Choose a PIN with 4 to 8 digits.", "error");
      return;
    }
    if (draft.newPin !== draft.confirmation) {
      showToast("The new PIN and confirmation don’t match.", "error");
      return;
    }
    const owner = staff.find((member) => member.active && member.role === "owner");
    if (!owner || owner.pinHash !== await hashPin(draft.currentPin)) {
      showToast("The current owner PIN didn’t match.", "error");
      return;
    }
    const updatedOwner: StaffMember = { ...owner, pinHash: await hashPin(draft.newPin), updatedAt: Date.now(), synced: 0 };
    try {
      await localDb.transaction("rw", [localDb.staff, localDb.outbox_queue], async () => {
        await localDb.staff.put(updatedOwner);
        await enqueueMutation("UPSERT_STAFF", updatedOwner);
      });
      setPinChangeOpen(false);
      showToast("Owner PIN changed on this device.");
    } catch {
      showToast("Owner PIN could not be saved locally.", "error");
    }
  };

  const saveShopProfile = async (draft: Omit<ShopProfile, "id" | "updatedAt">) => {
    const profile: ShopProfile = {
      id: CURRENT_SHOP_ID,
      ...draft,
      updatedAt: Date.now(),
    };
    try {
      await localDb.transaction("rw", [localDb.shop_profile, localDb.staff, localDb.outbox_queue], async () => {
        await localDb.shop_profile.put(profile);
        await enqueueMutation("UPSERT_SHOP_PROFILE", profile);
        const owner = await localDb.staff.where("role").equals("owner").filter((member) => member.active).first();
        if (owner && owner.name !== profile.ownerName) {
          const updatedOwner: StaffMember = { ...owner, name: profile.ownerName, updatedAt: profile.updatedAt, synced: 0 };
          await localDb.staff.put(updatedOwner);
          await enqueueMutation("UPSERT_STAFF", updatedOwner);
        }
      });
      setSignedInStaff((current) => current?.role === "owner" ? { ...current, name: profile.ownerName } : current);
      showToast("Shop details saved on this device.");
    } catch {
      showToast("Shop details could not be saved.", "error");
    }
  };

  const toggleFeature = async (flag: FeatureFlag) => {
    if (activeAccess?.features[flag.key] === false) {
      showToast(`${flag.label} is disabled by the Kokan POS developer team.`, "info");
      return;
    }
    const updated: FeatureFlag = { ...flag, enabled: !flag.enabled, updatedAt: Date.now(), synced: 0 };
    try {
      await localDb.transaction("rw", [localDb.feature_flags, localDb.outbox_queue], async () => {
        await localDb.feature_flags.put(updated);
        await enqueueMutation("UPSERT_FEATURE_FLAG", updated);
      });
      showToast(`${flag.label} ${updated.enabled ? "enabled" : "turned off"}.`, "info");
    } catch {
      showToast("That feature could not be updated.", "error");
    }
  };

  const printThermalReceipt = async (invoice?: Invoice) => {
    if (!flagEnabled("enable_thermal_print")) {
      showToast("Thermal printing is turned off in Features.", "info");
      return;
    }
    setPrinterBusy(true);
    try {
      const bluetooth = (navigator as Navigator & { bluetooth?: BluetoothApiLike }).bluetooth;
      if (!bluetooth) throw new Error("Web Bluetooth is not supported in this browser. Try Chrome on Android or desktop.");
      const device = await bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ["000018f0-0000-1000-8000-00805f9b34fb"],
      });
      if (!device.gatt) throw new Error("This printer did not provide a Bluetooth GATT connection.");
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService("000018f0-0000-1000-8000-00805f9b34fb");
      const characteristic = await service.getCharacteristic("00002af1-0000-1000-8000-00805f9b34fb");
      const lines = invoice
        ? [
            shop?.shopName ?? "Kokan Corner",
            shop?.area ?? "",
            "--------------------------------",
            `Receipt ${invoice.id.slice(0, 8).toUpperCase()}`,
            formatDateTime(invoice.createdAt),
            "--------------------------------",
            ...invoice.items.map((item) => `${item.name.slice(0, 18)} x${item.quantity}  ${formatMoney(item.lineTotal)}`),
            "--------------------------------",
            `TOTAL  ${formatMoney(invoice.totalAmount)}`,
            `PAID BY  ${getPaymentLabel(invoice.paymentMode)}`,
            "Thank you!",
          ]
        : [shop?.shopName ?? "Kokan Corner", "Printer test", "Kokan POS is ready.", "Thank you!"];
      const text = `\x1B@\x1Ba\x01${lines.join("\n")}\n\n\n\x1DVA\x00`;
      const bytes = new TextEncoder().encode(text);
      for (let offset = 0; offset < bytes.length; offset += 128) {
        const chunk = bytes.slice(offset, offset + 128).buffer as ArrayBuffer;
        if (characteristic.writeValueWithoutResponse) await characteristic.writeValueWithoutResponse(chunk);
        else if (characteristic.writeValue) await characteristic.writeValue(chunk);
        else throw new Error("The selected printer does not allow writing receipt data.");
      }
      showToast("Receipt sent to your Bluetooth printer.");
    } catch (printError) {
      const message = printError instanceof Error ? printError.message : "Printer connection failed. Check Bluetooth and try again.";
      showToast(message, "error");
    } finally {
      setPrinterBusy(false);
    }
  };

  if (!authReady) {
    return (
      <main className="loading-screen">
        <div className="loading-brand"><KokanMark className="brand-mark" /><span>kokan<span className="brand-light">pos</span></span></div>
        <div className="loading-spinner" />
        <p>Checking your account…</p>
        <small>Your store data stays private to your account.</small>
      </main>
    );
  }

  if (!session || !activeAccess) {
    return (
      <AccessPortal
        supabase={supabase}
        session={session}
        account={account}
        accountLoading={accountLoading}
        accountError={accountError}
        onRefresh={() => void refreshAccount()}
        onSignOut={() => void supabase?.auth.signOut()}
      />
    );
  }

  if (!ready) {
    return (
      <main className="loading-screen">
        <div className="loading-brand"><KokanMark className="brand-mark" /><span>kokan<span className="brand-light">pos</span></span></div>
        <div className="loading-spinner" />
        <p>Opening your local shop…</p>
        <small>Your catalog stays on this device.</small>
      </main>
    );
  }

  if (error) {
    return (
      <main className="loading-screen storage-error">
        <div className="error-mark"><CircleAlert size={26} /></div>
        <h1>Local storage needs attention</h1>
        <p>{error}</p>
        <button className="button button-primary" onClick={() => window.location.reload()}>Reload Kokan POS</button>
      </main>
    );
  }

  if (!signedInStaff) {
    return (
      <StaffSignInScreen
        shopName={shop?.shopName ?? "Your shop"}
        staff={staff}
        name={staffLoginName}
        pin={staffLoginPin}
        error={staffLoginError}
        lockedUntil={staffLoginLockedUntil}
        onNameChange={(value) => { setStaffLoginName(value); setStaffLoginError(""); }}
        onPinChange={(value) => { setStaffLoginPin(value.replace(/\D/g, "").slice(0, 8)); setStaffLoginError(""); }}
        onSubmit={signInStaff}
        onOwnerSignOut={() => void supabase?.auth.signOut()}
      />
    );
  }

  const title = pageTitles[activeView];
  const selectedCustomer = customers.find((customer) => customer.id === cart.customerId) ?? null;
  const syncLabel = !sync.isOnline
    ? "Working offline"
    : sync.syncing
      ? "Syncing changes"
      : sync.lastError
        ? "Sync needs attention"
        : sync.pendingCount
          ? `${sync.pendingCount} to sync`
          : "All changes saved";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <KokanMark className="brand-mark" />
          <span className="brand-name">kokan<span>pos</span></span>
        </div>
        <div className="shop-switcher">
          <div className="shop-avatar"><Store size={17} /></div>
          <div className="shop-switcher-copy"><strong>{shop?.shopName ?? "Kokan Corner"}</strong><span>{shop?.area ?? "Your local shop"}</span></div>
          <ChevronDown size={15} className="shop-chevron" />
        </div>

        <p className="nav-section-label">WORKSPACE</p>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`nav-link ${activeView === item.key ? "nav-link-active" : ""}`}
                key={item.key}
                onClick={() => requestView(item.key)}
                aria-current={activeView === item.key ? "page" : undefined}
                title={item.label}
              >
                <Icon size={19} strokeWidth={1.8} />
                <span className="nav-label">{item.label}</span>
                {item.badge && <span className="nav-shortcut">{item.badge}</span>}
                {item.key !== "pos" && !adminUnlocked && <LockKeyhole size={13} className="nav-lock" />}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />
        <div className={`sidebar-sync ${!sync.isOnline ? "sidebar-sync-offline" : ""}`}>
          <div className="sync-icon-wrap">{sync.isOnline ? <Wifi size={17} /> : <WifiOff size={17} />}</div>
          <div className="sidebar-sync-copy">
            <strong>{syncLabel}</strong>
            <span>{sync.isOnline ? "Your till is ready" : "Sales saved on this device"}</span>
          </div>
          <span className={`sync-dot ${sync.isOnline && sync.pendingCount === 0 ? "sync-dot-green" : ""}`} />
        </div>
        <div className="sidebar-profile">
          <div className="profile-avatar">{initials(shop?.ownerName ?? "Asha Sawant")}</div>
          <div className="sidebar-profile-copy"><strong>{signedInStaff.name}</strong><span>{signedInStaff.role === "owner" ? "Shop owner" : signedInStaff.role === "admin" ? "Administrator" : "Cashier"}</span></div>
          {adminUnlocked ? (
            <button className="profile-action" onClick={lockAdmin} aria-label="Lock owner tools" title="Lock owner tools"><LogOut size={16} /></button>
          ) : (
            <button className="profile-action" onClick={() => requestView("settings")} aria-label="Open owner tools" title="Open owner tools"><KeyRound size={16} /></button>
          )}
        </div>
        <div className="sidebar-version">KOKAN POS <span>·</span> LOCAL FIRST</div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="mobile-brand-lockup"><KokanMark className="brand-mark" /><span>kokan<span>pos</span></span></div>
          <div className="topbar-title">
            <span className="eyebrow">{title.eyebrow}</span>
            <h1>{title.title}</h1>
            <p>{title.subtitle}</p>
          </div>
          <div className="topbar-actions">
            <div className={`top-sync-pill ${!sync.isOnline || sync.lastError ? "top-sync-offline" : ""}`} title={sync.lastError ?? syncLabel}>
              {sync.isOnline ? <span className="online-indicator" /> : <WifiOff size={14} />}
              <span>{syncLabel}</span>
            </div>
            <button className="top-icon-button" aria-label="Notifications" onClick={() => showToast("You’re all caught up.", "info")}><Bell size={18} /><span className="notification-dot" /></button>
            <button type="button" className="button button-secondary shift-end-button" onClick={() => void clockOutStaff()} title="Record clock-out and switch staff"><Clock3 size={15} /> End shift</button>
            <div className="top-avatar" title={signedInStaff.name}>{initials(signedInStaff.name)}</div>
          </div>
        </header>

        <div className="page-content">
          {activeView === "admin" && (
            <AdminDashboard
              shop={shop}
              products={products}
              customers={customers}
              invoices={invoices}
              staff={staff}
              isOnline={sync.isOnline}
              syncLabel={syncLabel}
              pendingCount={sync.pendingCount}
              onNavigate={requestView}
              onAddProduct={() => { setEditingProduct(null); setProductModalOpen(true); }}
              onAddCustomer={() => setCustomerModalOpen(true)}
              onAddStaff={() => setStaffModalOpen(true)}
            />
          )}

          {activeView === "pos" && (
            <section className={`pos-layout${mobileCartOpen ? " mobile-cart-open" : ""}`}>
              <div className="catalog-panel">
                <div className="catalog-toolbar">
                  <div className="section-title-row">
                    <div><h2>Browse products</h2><p>{products.length} items in your catalog</p></div>
                    <span className="catalog-live"><span /> LOCAL CATALOG</span>
                  </div>
                  <div className="catalog-search-row">
                    <label className="search-field">
                      <Search size={18} />
                      <input ref={searchInputRef} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          const match = products.find((product) => product.barcode === search.trim());
                          if (match) addToCart(match);
                        }
                      }} placeholder="Search or scan products…" aria-label="Search products" />
                      <kbd>⌘ K</kbd>
                    </label>
                    {flagEnabled("enable_camera_scan") && <button className="scan-button" onClick={() => setCameraOpen(true)}><ScanLine size={17} /><span>Scan</span></button>}
                  </div>
                  <div className="category-filters" aria-label="Filter product categories">
                    {categories.map((category) => (
                      <button key={category} className={`category-chip ${categoryFilter === category ? "category-chip-active" : ""}`} onClick={() => setCategoryFilter(category)}>
                        {category !== "All" && <span>{categoryStyle(category).emoji}</span>}{category}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="products-grid">
                  {filteredProducts.map((product) => {
                    const visual = categoryStyle(product.category);
                    const inCart = cart.items.find((line) => line.productId === product.id)?.quantity ?? 0;
                    return (
                      <button key={product.id} className="product-card" onClick={() => addToCart(product)} disabled={product.stockQty <= 0}>
                        <div className={`product-art product-art-${visual.color}`}>
                          <span className="product-emoji">{visual.emoji}</span>
                          {inCart > 0 && <span className="product-cart-count">{inCart}</span>}
                          {product.stockQty <= 5 && product.stockQty > 0 && <span className="low-stock-pill">LOW</span>}
                          {product.stockQty <= 0 && <span className="low-stock-pill sold-out-pill">OUT</span>}
                        </div>
                        <div className="product-card-copy">
                          <span className="product-category">{product.category}</span>
                          <strong>{product.name}</strong>
                          <div className="product-price-row"><span>{formatMoney(product.sellingPrice)}</span><small>{product.stockQty} {product.unit}{product.stockQty === 1 ? "" : "s"}</small></div>
                        </div>
                        <span className="product-add-icon"><Plus size={16} /></span>
                      </button>
                    );
                  })}
                  {filteredProducts.length === 0 && <div className="empty-products"><ShoppingBag size={24} /><strong>No products found</strong><span>Try a different name or category.</span></div>}
                </div>
                <div className="catalog-footer"><span><span className="keyboard-dot" /> Barcode scanner ready</span><span>Tap an item to add it to the ticket</span></div>
              </div>

              {mobileCartOpen && <button className="mobile-cart-scrim" onClick={() => setMobileCartOpen(false)} aria-label="Close ticket" />}
              <aside className={`cart-panel${mobileCartOpen ? " cart-panel-mobile-open" : ""}`}>
                <div className="cart-header">
                  <div><span className="eyebrow">CURRENT SALE</span><h2>New ticket <span>#{String(invoices.length + 1).padStart(4, "0")}</span></h2></div>
                  <button className="cart-more-button" onClick={() => {
                    if (mobileCartOpen) setMobileCartOpen(false);
                    else if (cart.items.length > 0 && window.confirm("Clear this ticket?")) persistCart(emptyCart());
                  }} aria-label={mobileCartOpen ? "Close ticket" : "Clear ticket"} title={mobileCartOpen ? "Close ticket" : "Clear ticket"}>{mobileCartOpen ? <X size={16} /> : <Trash2 size={16} />}</button>
                </div>
                <label className="customer-select-label">CUSTOMER <span>OPTIONAL</span></label>
                <div className="customer-select-wrap"><UserRound size={17} /><select value={cart.customerId ?? ""} onChange={(event) => setSelectedCustomer(event.target.value)} aria-label="Choose a customer"><option value="">Walk-in customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.currentBalance > 0 ? ` · ${formatMoney(customer.currentBalance)} due` : ""}</option>)}</select><ChevronDown size={15} /></div>

                <div className="cart-items-area">
                  {cart.items.length === 0 ? (
                    <div className="empty-cart">
                      <div className="empty-cart-icon"><ShoppingCart size={22} /></div>
                      <strong>Your ticket is waiting</strong>
                      <span>Add products from the catalog<br />or scan a barcode to begin.</span>
                      <div className="empty-cart-shortcut"><kbd>F1</kbd> <span>Quick checkout</span></div>
                    </div>
                  ) : cart.items.map((line) => {
                    const product = products.find((item) => item.id === line.productId);
                    if (!product) return null;
                    const visual = categoryStyle(product.category);
                    return (
                      <div className="cart-line" key={line.productId}>
                        <div className={`cart-line-art product-art-${visual.color}`}>{visual.emoji}</div>
                        <div className="cart-line-details"><strong>{product.name}</strong><span>{formatMoney(product.sellingPrice)} / {product.unit}</span><div className="quantity-control"><button onClick={() => changeQuantity(product.id, -1)} aria-label={`Remove one ${product.name}`}><Minus size={13} /></button><span>{line.quantity}</span><button onClick={() => changeQuantity(product.id, 1)} aria-label={`Add one ${product.name}`}><Plus size={13} /></button></div></div>
                        <div className="cart-line-total"><strong>{formatMoney(product.sellingPrice * line.quantity)}</strong><button onClick={() => changeQuantity(product.id, -line.quantity)} aria-label={`Remove ${product.name}`}><X size={14} /></button></div>
                      </div>
                    );
                  })}
                </div>

                {cart.items.length > 0 && (
                  <div className="cart-summary">
                    <div className="cart-summary-row"><span>Subtotal <small>({cartQuantity} {cartQuantity === 1 ? "item" : "items"})</small></span><strong>{formatMoney(cartSubtotal)}</strong></div>
                    <div className="discount-row">
                      {discountOpen ? <label className="discount-input-wrap"><Tag size={14} /><span>Discount</span><input type="number" min="0" max={cartSubtotal} step="1" value={cart.discount || ""} onChange={(event) => persistCart({ ...cart, discount: Math.min(cartSubtotal, Math.max(0, Number(event.target.value) || 0)) })} placeholder="0" /><button onClick={() => { persistCart({ ...cart, discount: 0 }); setDiscountOpen(false); }} aria-label="Remove discount"><X size={13} /></button></label> : <button className="add-discount" onClick={() => setDiscountOpen(true)}><Tag size={14} /> Add discount</button>}
                      {cart.discount > 0 && <strong className="discount-amount">−{formatMoney(cart.discount)}</strong>}
                    </div>
                    <div className="cart-total-row"><span>Total due</span><strong>{formatMoney(cartTotal)}</strong></div>
                    {flagEnabled("enable_gst") && <div className="gst-note"><Check size={12} /> GST-ready sale summary</div>}
                    <div className="payment-label-row"><span>PAYMENT METHOD</span><span>Choose to continue</span></div>
                    <div className="payment-methods">
                      <button className="payment-method" onClick={() => beginPayment("cash")}><Banknote size={18} /><span>Cash</span></button>
                      <button className="payment-method" onClick={() => beginPayment("upi")}><QrCode size={18} /><span>UPI</span></button>
                      {flagEnabled("enable_khata") && <button className="payment-method" onClick={() => beginPayment("khata")}><Wallet size={18} /><span>Khata</span></button>}
                    </div>
                    <div className="cart-footnote"><ShieldCheck size={14} /><span>Saved instantly on this device</span></div>
                  </div>
                )}
              </aside>
            </section>
          )}

          {activeView === "inventory" && (
            <InventoryView
              products={products}
              search={inventorySearch}
              onSearch={setInventorySearch}
              onAdd={() => { setEditingProduct(null); setProductModalOpen(true); }}
              onEdit={(product) => { setEditingProduct(product); setProductModalOpen(true); }}
              onRemove={removeProduct}
            />
          )}

          {activeView === "customers" && (
            <CustomersView
              customers={customers}
              invoices={invoices}
              search={customerSearch}
              onSearch={setCustomerSearch}
              onAdd={() => setCustomerModalOpen(true)}
            />
          )}

          {activeView === "reports" && <ReportsView invoices={invoices} products={products} customers={customers} operations={operations} onPrint={() => window.print()} />}

          {activeView === "operations" && (
            <OperationsView
              products={products}
              customers={customers}
              invoices={invoices}
              operations={operations}
              onStockAdjustment={saveStockAdjustment}
              onReceivePurchase={receivePurchase}
              onExpense={recordExpense}
              onReturn={recordReturn}
              onCustomerPayment={recordCustomerPayment}
              onCashClose={recordCashClose}
            />
          )}

          {activeView === "team" && (
            <TeamAttendanceView
              staff={staff}
              shifts={shifts}
              onAddStaff={() => setStaffModalOpen(true)}
              onUpdateRate={updateStaffRate}
              onToggleActive={setStaffActive}
              onCloseShift={closeStaffShift}
            />
          )}

          {activeView === "settings" && (
            <SettingsView
              shop={shop}
              flags={flags.length ? flags : featureFallbacks}
              platformFeatureAccess={activeAccess.features}
              staff={staff}
              syncLabel={syncLabel}
              syncError={sync.lastError}
              pendingCount={sync.pendingCount}
              onSaveShop={saveShopProfile}
              onToggleFeature={toggleFeature}
              onAddStaff={() => setStaffModalOpen(true)}
              onChangeOwnerPin={() => setPinChangeOpen(true)}
              onPrintTest={() => void printThermalReceipt()}
              printerBusy={printerBusy}
              onSignOut={() => void supabase?.auth.signOut()}
            />
          )}
        </div>
      </main>

      {cart.items.length > 0 && !mobileCartOpen && (
        <button className="mobile-cart-fab" onClick={() => setMobileCartOpen(true)}><ShoppingCart size={17} /><span>View ticket</span><b>{cartQuantity}</b><strong>{formatMoney(cartTotal)}</strong></button>
      )}

      {cameraOpen && <CameraScanner onDetected={handleScannedValue} onClose={() => setCameraOpen(false)} />}
      {pinOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPinOpen(false)}>
          <section className="modal-card pin-modal" role="dialog" aria-modal="true" aria-labelledby="pin-title">
            <div className="pin-shield"><LockKeyhole size={24} /></div>
            <button className="modal-close pin-close" onClick={() => setPinOpen(false)} aria-label="Close"><X size={18} /></button>
            <span className="eyebrow">OWNER ACCESS</span>
            <h2 id="pin-title">A little privacy, please.</h2>
            <p>Enter your owner PIN to open the admin dashboard and shop management tools.</p>
            <form onSubmit={(event) => void unlockAdmin(event)}>
              <label className="form-label" htmlFor="owner-pin">4-digit PIN</label>
              <input autoFocus id="owner-pin" className="pin-input" inputMode="numeric" type="password" maxLength={8} value={pinInput} onChange={(event) => { setPinInput(event.target.value.replace(/\D/g, "")); setPinError(""); }} placeholder="••••" />
              {pinError && <p className="form-error">{pinError}</p>}
              <button className="button button-primary button-full" type="submit" disabled={pinInput.length < 4}><LockKeyhole size={16} /> Unlock owner tools</button>
            </form>
            <div className="pin-hint"><KeyRound size={13} /> {activeAccess?.ownerPinHash ? "Use the four-digit owner PIN provided when your store was set up." : <>Legacy store PIN: <strong>0427</strong>.</>} You can change it in team settings.</div>
          </section>
        </div>
      )}
      {productModalOpen && <ProductEditorModal key={editingProduct?.id ?? "new-product"} product={editingProduct} onClose={() => { setProductModalOpen(false); setEditingProduct(null); }} onSave={saveProduct} />}
      {customerModalOpen && <CustomerEditorModal onClose={() => setCustomerModalOpen(false)} onSave={saveCustomer} />}
      {staffModalOpen && <StaffEditorModal onClose={() => setStaffModalOpen(false)} onSave={saveStaffMember} />}
      {pinChangeOpen && <OwnerPinModal onClose={() => setPinChangeOpen(false)} onSave={saveOwnerPin} />}
      {paymentMode && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPaymentMode(null)}>
          <section className="modal-card payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-title">
            <div className="modal-heading">
              <div><span className="eyebrow">COMPLETE SALE · {getPaymentLabel(paymentMode).toUpperCase()}</span><h2 id="payment-title">{paymentMode === "upi" ? "Collect with UPI" : paymentMode === "khata" ? "Add to customer khata" : "Take cash payment"}</h2></div>
              <button className="icon-button" onClick={() => setPaymentMode(null)} aria-label="Close payment"><X size={18} /></button>
            </div>
            <div className="payment-total-card"><span>AMOUNT TO COLLECT</span><strong>{formatMoney(cartTotal)}</strong><small>{cartQuantity} items · Ticket #{String(invoices.length + 1).padStart(4, "0")}</small></div>
            {paymentMode === "cash" && (
              <div className="cash-entry">
                <label className="form-label" htmlFor="cash-given">Cash received</label>
                <div className="cash-input-wrap"><span>₹</span><input id="cash-given" type="number" min={cartTotal} step="1" value={cashGiven} onChange={(event) => setCashGiven(event.target.value)} autoFocus /></div>
                <div className="change-due-row"><span>Change due</span><strong>{formatMoney(Math.max(0, (Number(cashGiven) || 0) - cartTotal))}</strong></div>
              </div>
            )}
            {paymentMode === "upi" && (
              <div className="upi-payment-content">
                {shop?.upiId.trim() ? (
                  <>
                    <div className="qr-card"><QRCodeSVG value={`upi://pay?pa=${encodeURIComponent(shop.upiId)}&pn=${encodeURIComponent(shop.shopName)}&am=${cartTotal.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Kokan POS ${String(invoices.length + 1).padStart(4, "0")}`)}`} size={174} level="M" includeMargin /></div>
                    <div className="upi-instructions"><strong>Scan with any UPI app</strong><span>{shop.upiId}</span><small>Confirm the payment arrived before completing this sale.</small></div>
                  </>
                ) : <div className="upi-missing"><CircleAlert size={20} /><strong>UPI ID not set up yet</strong><span>Add your UPI ID in Settings to create a payment QR.</span></div>}
              </div>
            )}
            {paymentMode === "khata" && (
              <div className="khata-confirmation"><div className="customer-avatar">{initials(selectedCustomer?.name ?? "?")}</div><div><span>CHARGE TO</span><strong>{selectedCustomer?.name ?? "Choose a customer"}</strong><small>Current balance {formatMoney(selectedCustomer?.currentBalance ?? 0)} · New balance {formatMoney((selectedCustomer?.currentBalance ?? 0) + cartTotal)}</small></div><Wallet size={19} /></div>
            )}
            <button className="button button-primary button-full payment-confirm-button" onClick={() => void finishSale()} disabled={saleSaving || (paymentMode === "upi" && !shop?.upiId.trim()) || (paymentMode === "khata" && !selectedCustomer) || (paymentMode === "cash" && (Number(cashGiven) || 0) < cartTotal)}>
              {saleSaving ? <><span className="button-spinner" /> Saving sale on this device…</> : <><CheckCircle2 size={17} /> {paymentMode === "khata" ? "Charge customer" : paymentMode === "upi" ? "Payment received · Complete sale" : "Complete cash sale"}</>}
            </button>
            <p className="offline-payment-note"><ShieldCheck size={13} /> Sale is recorded locally first. Sync happens in the background.</p>
          </section>
        </div>
      )}
      {successfulInvoice && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSuccessfulInvoice(null)}>
          <section className="modal-card sale-success-modal receipt-print" role="dialog" aria-modal="true" aria-labelledby="sale-success-title">
            <div className="success-checkmark"><Check size={28} /></div>
            <span className="eyebrow">SALE SAVED ON THIS DEVICE</span>
            <h2 id="sale-success-title">Lovely. That’s a sale.</h2>
            <p className="success-ticket">Ticket #{successfulInvoice.id.slice(0, 8).toUpperCase()} <span>·</span> {formatDateTime(successfulInvoice.createdAt)}</p>
            <div className="success-receipt-summary">
              <div><span>{successfulInvoice.items.reduce((sum, item) => sum + item.quantity, 0)} items</span><strong>{formatMoney(successfulInvoice.totalAmount)}</strong></div>
              <div><span>Paid by</span><strong>{getPaymentLabel(successfulInvoice.paymentMode)}</strong></div>
              {successfulInvoice.customerName && <div><span>Customer</span><strong>{successfulInvoice.customerName}</strong></div>}
              <div><span>Sync status</span><strong className="receipt-local-status"><span /> Saved locally</strong></div>
            </div>
            <div className="success-actions">
              {flagEnabled("enable_thermal_print") && <button className="button button-secondary" onClick={() => void printThermalReceipt(successfulInvoice)} disabled={printerBusy}>{printerBusy ? <span className="button-spinner" /> : <Printer size={16} />} Print receipt</button>}
              <button className="button button-secondary" onClick={() => void downloadReceiptPdf(successfulInvoice)} disabled={invoiceActionBusy}>{invoiceActionBusy ? <span className="button-spinner" /> : <Download size={16} />} Download PDF</button>
              <button className="button button-secondary" onClick={() => void shareReceiptPdf(successfulInvoice)} disabled={invoiceActionBusy}>{invoiceActionBusy ? <span className="button-spinner" /> : <Share2 size={16} />} Share PDF</button>
              <button className="button button-primary" onClick={() => setSuccessfulInvoice(null)}>New sale <ArrowUpRight size={16} /></button>
            </div>
            {receiptWhatsAppUrl(successfulInvoice) ? (
              <a className="button button-secondary receipt-whatsapp-link" href={receiptWhatsAppUrl(successfulInvoice) ?? undefined} target="_blank" rel="noreferrer"><MessageCircle size={15} /> Open customer WhatsApp</a>
            ) : successfulInvoice.customerName ? (
              <p className="receipt-share-hint">A customer phone number is needed for the WhatsApp shortcut. Use Share PDF to choose another app.</p>
            ) : null}
            <p className="receipt-share-hint">On supported phones, Share PDF lets you send the file directly using WhatsApp. Otherwise, download the PDF and attach it in the customer chat.</p>
            <p className="receipt-thanks">{shop?.shopName ?? "Kokan Corner"} · Thank you for shopping local 🌿</p>
          </section>
        </div>
      )}
      {toast && <div className={`toast toast-${toast.kind}`} role="status"><span className="toast-icon">{toast.kind === "success" ? <Check size={15} /> : toast.kind === "error" ? <CircleAlert size={15} /> : <Sparkles size={15} />}</span><span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="Dismiss message"><X size={14} /></button></div>}
    </div>
  );
}

function StaffSignInScreen({
  shopName,
  staff,
  name,
  pin,
  error,
  lockedUntil,
  onNameChange,
  onPinChange,
  onSubmit,
  onOwnerSignOut,
}: {
  shopName: string;
  staff: StaffMember[];
  name: string;
  pin: string;
  error: string;
  lockedUntil: number;
  onNameChange: (value: string) => void;
  onPinChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onOwnerSignOut: () => void;
}) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (lockedUntil <= Date.now()) return;
    const timer = window.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (currentTime >= lockedUntil) window.clearInterval(timer);
    }, 500);
    return () => window.clearInterval(timer);
  }, [lockedUntil]);
  const isLocked = now < lockedUntil;
  const activeCount = staff.filter((member) => member.active).length;
  return (
    <main className="staff-login-screen">
      <section className="staff-login-card">
        <div className="developer-brand"><KokanMark className="developer-brand-mark" /><span><strong>Kokan POS</strong><small>STAFF CHECK-IN</small></span></div>
        <span className="section-eyebrow">WELCOME TO YOUR SHIFT</span>
        <h1>{shopName}</h1>
        <p>Enter your name and personal PIN. We’ll record your clock-in on this device.</p>
        <form className="access-form" onSubmit={onSubmit}>
          <label className="form-label">YOUR NAME<input className="form-input" autoComplete="username" value={name} onChange={(event) => onNameChange(event.target.value)} required autoFocus placeholder="Enter your name" /></label>
          <label className="form-label">PERSONAL PIN<input className="form-input" type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(event) => onPinChange(event.target.value)} required minLength={4} maxLength={8} placeholder="4–8 digits" /></label>
          {error && <div className="access-alert access-alert-error" role="alert">{error}</div>}
          <button className="button button-primary button-full" type="submit" disabled={isLocked || pin.length < 4 || !name.trim()}>
            {isLocked ? "Please wait before retrying" : "Sign in & start shift"} <ArrowUpRight size={16} />
          </button>
        </form>
        <div className="staff-login-note"><Clock3 size={15} /><span>{activeCount} active team {activeCount === 1 ? "member" : "members"} · Attendance saves locally first and syncs when online.</span></div>
        <button className="text-button staff-login-signout" type="button" onClick={onOwnerSignOut}>Sign out of the store account</button>
      </section>
    </main>
  );
}

function TeamAttendanceView({
  staff,
  shifts,
  onAddStaff,
  onUpdateRate,
  onToggleActive,
  onCloseShift,
}: {
  staff: StaffMember[];
  shifts: StaffShift[];
  onAddStaff: () => void;
  onUpdateRate: (member: StaffMember, hourlyRate: number) => void;
  onToggleActive: (member: StaffMember) => void;
  onCloseShift: (shift: StaffShift) => void;
}) {
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>({});
  const monthStartDate = new Date();
  monthStartDate.setDate(1);
  monthStartDate.setHours(0, 0, 0, 0);
  const monthStart = monthStartDate.getTime();
  const monthEndDate = new Date(monthStartDate);
  monthEndDate.setMonth(monthEndDate.getMonth() + 1);
  const monthEnd = monthEndDate.getTime();
  const thisMonth = shifts.filter((shift) => shift.endedAt !== null && shift.endedAt > monthStart && shift.startedAt < monthEnd);
  const shiftDurationMs = (shift: StaffShift) => shift.endedAt ? Math.max(0, shift.endedAt - shift.startedAt) : 0;
  const monthDurationMs = (shift: StaffShift) => shift.endedAt
    ? Math.max(0, Math.min(shift.endedAt, monthEnd) - Math.max(shift.startedAt, monthStart))
    : 0;
  const monthlyHours = thisMonth.reduce((sum, shift) => sum + monthDurationMs(shift) / 3_600_000, 0);
  const monthlyGross = thisMonth.reduce((sum, shift) => sum + monthDurationMs(shift) / 3_600_000 * shift.hourlyRate, 0);
  const activeShifts = shifts.filter((shift) => shift.endedAt === null);
  const exportAttendance = () => {
    const rows = [
      ["Staff", "Clock in", "Clock out", "Hours", "Hourly rate", "Estimated gross pay"],
      ...shifts.map((shift) => {
        const hours = shiftDurationMs(shift) / 3_600_000;
        return [
          shift.staffName,
          new Date(shift.startedAt).toISOString(),
          shift.endedAt ? new Date(shift.endedAt).toISOString() : "Still clocked in",
          hours.toFixed(2),
          shift.hourlyRate.toFixed(2),
          (hours * shift.hourlyRate).toFixed(2),
        ];
      }),
    ];
    const blob = new Blob([`\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kokan-pos-attendance-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="admin-page team-attendance-page">
      <div className="page-action-row">
        <div><span className="section-eyebrow">SHIFTS & ESTIMATED PAY</span><h2>Look after your team.</h2><p>Attendance is stored on this device. Payroll figures are estimates, not payslips.</p></div>
        <div className="team-actions"><button className="button button-secondary" onClick={exportAttendance} disabled={!shifts.length}><Download size={16} /> Export attendance</button><button className="button button-primary" onClick={onAddStaff}><Plus size={16} /> Add team member</button></div>
      </div>
      <div className="metric-grid three-metrics">
        <MetricCard icon={<Users size={19} />} label="Active team" value={String(staff.filter((member) => member.active).length)} detail={`${activeShifts.length} currently clocked in`} tone="green" />
        <MetricCard icon={<Clock3 size={19} />} label="Hours this month" value={monthlyHours.toFixed(1)} detail={`${thisMonth.length} completed shifts`} tone="blue" />
        <MetricCard icon={<Wallet size={19} />} label="Estimated gross pay" value={formatMoney(monthlyGross)} detail="Based on each shift’s saved rate" tone="violet" />
      </div>
      <section className="data-card team-management-card">
        <div className="data-card-toolbar"><div><h3>Team access & hourly rates</h3><span>Staff sign in with their name and PIN; PINs are never displayed here.</span></div></div>
        <div className="team-management-list">
          {staff.map((member) => (
            <div className={`team-management-row${!member.active ? " team-management-row-inactive" : ""}`} key={member.id}>
              <div className={`team-avatar ${member.role === "owner" ? "team-avatar-owner" : ""}`}>{initials(member.name)}</div>
              <div className="team-person"><strong>{member.name}</strong><span>{member.role === "owner" ? "Shop owner" : member.role === "admin" ? "Administrator" : "Cashier"} · {member.active ? "Active" : "Inactive"}</span></div>
              <label className="team-rate-field"><span>₹ / hour</span><input type="number" min="0" step="0.01" value={rateDrafts[member.id] ?? String(member.hourlyRate ?? 0)} onChange={(event) => setRateDrafts((current) => ({ ...current, [member.id]: event.target.value }))} aria-label={`Hourly rate for ${member.name}`} /></label>
              <button className="button button-secondary team-save-rate" onClick={() => onUpdateRate(member, Number(rateDrafts[member.id] ?? member.hourlyRate ?? 0))}>Save rate</button>
              {member.role !== "owner" && <button className={`button ${member.active ? "button-secondary" : "button-primary"} team-active-toggle`} onClick={() => onToggleActive(member)}>{member.active ? "Deactivate" : "Reactivate"}</button>}
            </div>
          ))}
          {!staff.length && <div className="admin-empty-state"><Users size={22} /><strong>No team members yet</strong><span>Add a cashier to start recording shifts.</span></div>}
        </div>
      </section>
      <section className="data-card attendance-history-card">
        <div className="data-card-toolbar"><div><h3>Recent shifts</h3><span>Latest clock-ins and clock-outs, including any active shift</span></div></div>
        {shifts.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>TEAM MEMBER</th><th>CLOCK IN</th><th>CLOCK OUT</th><th>HOURS</th><th>RATE</th><th>EST. GROSS</th><th>ACTION</th></tr></thead><tbody>
          {shifts.slice(0, 50).map((shift) => {
            const hours = shiftDurationMs(shift) / 3_600_000;
            return <tr key={shift.id}><td><strong>{shift.staffName}</strong></td><td>{formatDateTime(shift.startedAt)}</td><td>{shift.endedAt ? formatDateTime(shift.endedAt) : <span className="sync-status sync-status-pending"><span /> Clocked in</span>}</td><td>{shift.endedAt ? hours.toFixed(2) : "In progress"}</td><td>{formatMoney(shift.hourlyRate)}</td><td><strong>{shift.endedAt ? formatMoney(hours * shift.hourlyRate) : "—"}</strong></td><td>{!shift.endedAt && <button className="table-action" onClick={() => onCloseShift(shift)} aria-label={`Record clock-out for ${shift.staffName}`} title="Record clock-out"><LogOut size={15} /></button>}</td></tr>;
          })}
        </tbody></table></div> : <div className="admin-empty-state"><Clock3 size={22} /><strong>No shifts recorded yet</strong><span>Team members’ shifts appear here after they sign in.</span></div>}
      </section>
      <p className="attendance-disclaimer"><ShieldCheck size={14} /> Attendance and hourly rates sync when online; the export is a backup. Gross pay is an estimate and does not include breaks, overtime, deductions, or payroll compliance calculations.</p>
    </section>
  );
}

function AdminDashboard({
  shop,
  products,
  customers,
  invoices,
  staff,
  isOnline,
  syncLabel,
  pendingCount,
  onNavigate,
  onAddProduct,
  onAddCustomer,
  onAddStaff,
}: {
  shop: ShopProfile | null;
  products: Product[];
  customers: Customer[];
  invoices: Invoice[];
  staff: StaffMember[];
  isOnline: boolean;
  syncLabel: string;
  pendingCount: number;
  onNavigate: (view: View) => void;
  onAddProduct: () => void;
  onAddCustomer: () => void;
  onAddStaff: () => void;
}) {
  const todayStart = startOfLocalDay();
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
  const todayInvoices = invoices.filter((invoice) => invoice.createdAt >= todayStart && invoice.createdAt < tomorrowStart);
  const todaySales = todayInvoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0);
  const lowStockProducts = products.filter((product) => product.stockQty <= 5).sort((a, b) => a.stockQty - b.stockQty);
  const outstandingBalance = customers.reduce((sum, customer) => sum + customer.currentBalance, 0);
  const activeStaff = staff.filter((member) => member.active);
  const lastSevenDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const start = date.getTime();
    const end = start + 24 * 60 * 60 * 1000;
    return {
      date,
      revenue: invoices
        .filter((invoice) => invoice.createdAt >= start && invoice.createdAt < end)
        .reduce((sum, invoice) => sum + invoice.totalAmount, 0),
    };
  });
  const maxDailySales = Math.max(...lastSevenDays.map((day) => day.revenue), 1);
  const recentInvoices = invoices.slice(0, 5);
  const greeting = new Intl.DateTimeFormat("en", { hour: "numeric", hour12: false }).format(new Date());
  const greetingLabel = Number(greeting) < 12 ? "Good morning" : Number(greeting) < 17 ? "Good afternoon" : "Good evening";

  return (
    <section className="admin-page admin-dashboard">
      <div className="admin-welcome">
        <div>
          <span className="section-eyebrow">YOUR BUSINESS, AT A GLANCE</span>
          <h2>{greetingLabel}, {shop?.ownerName ?? "shop owner"}</h2>
          <p>Here’s what’s happening at {shop?.shopName ?? "your shop"} today.</p>
        </div>
        <div className="admin-welcome-actions">
          <button className="button button-secondary" onClick={() => onNavigate("pos")}><ShoppingCart size={16} /> Open checkout</button>
          <button className="button button-primary" onClick={onAddProduct}><Plus size={16} /> Add product</button>
        </div>
      </div>

      <div className="metric-grid four-metrics admin-metrics">
        <MetricCard icon={<Banknote size={19} />} label="Sales today" value={formatMoney(todaySales)} detail={`${todayInvoices.length} completed ${todayInvoices.length === 1 ? "sale" : "sales"}`} tone="green" />
        <MetricCard icon={<Receipt size={19} />} label="Transactions" value={String(todayInvoices.length)} detail="Recorded on this device" tone="blue" />
        <MetricCard icon={<CircleAlert size={19} />} label="Low stock" value={String(lowStockProducts.length)} detail={lowStockProducts.length ? "Products need a restock" : "All shelves look healthy"} tone={lowStockProducts.length ? "amber" : "green"} />
        <MetricCard icon={<Wallet size={19} />} label="Khata outstanding" value={formatMoney(outstandingBalance)} detail={`${customers.filter((customer) => customer.currentBalance > 0).length} customers with a balance`} tone="violet" />
      </div>

      <div className="admin-dashboard-grid">
        <section className="data-card admin-sales-card">
          <div className="data-card-toolbar">
            <div><h3>Sales overview</h3><span>Daily sales for the last seven days</span></div>
            <button className="text-button" onClick={() => onNavigate("reports")}>View reports <ArrowUpRight size={14} /></button>
          </div>
          <div className="admin-sales-chart" role="img" aria-label="Sales totals for the last seven days">
            {lastSevenDays.map(({ date, revenue }) => (
              <div className="admin-sales-day" key={date.toISOString()}>
                <div className="admin-sales-bar-track">
                  <div className={`admin-sales-bar${date.getTime() === todayStart ? " admin-sales-bar-today" : ""}`} style={{ height: `${Math.max(4, (revenue / maxDailySales) * 100)}%` }} title={formatMoney(revenue)} />
                </div>
                <strong>{formatMoney(revenue)}</strong>
                <span>{new Intl.DateTimeFormat("en-IN", { weekday: "short" }).format(date)}</span>
              </div>
            ))}
          </div>
          <div className="admin-chart-footnote"><span><span className="admin-chart-dot" /> Sales captured locally</span><strong>Today · {formatMoney(todaySales)}</strong></div>
        </section>

        <section className="data-card admin-status-card">
          <div className="data-card-toolbar"><div><h3>Store status</h3><span>Your local-first setup</span></div><ShieldCheck size={18} className="admin-status-shield" /></div>
          <div className="admin-status-list">
            <div><span className={`admin-status-dot${isOnline ? " admin-status-dot-online" : ""}`} /><span><strong>{isOnline ? "Internet connected" : "Working offline"}</strong><small>{isOnline ? "Background sync is available" : "Sales are saved safely on this device"}</small></span></div>
            <div><span className="admin-status-symbol"><Activity size={15} /></span><span><strong>{syncLabel}</strong><small>{pendingCount ? `${pendingCount} change${pendingCount === 1 ? "" : "s"} waiting to sync` : "Your latest changes are up to date"}</small></span></div>
            <div><span className="admin-status-symbol"><Users size={15} /></span><span><strong>{activeStaff.length} active team {activeStaff.length === 1 ? "member" : "members"}</strong><small>Owner access protected by a PIN</small></span></div>
          </div>
          <button className="admin-status-link" onClick={() => onNavigate("settings")}>Manage shop settings <ArrowUpRight size={14} /></button>
        </section>

        <section className="data-card admin-recent-card">
          <div className="data-card-toolbar"><div><h3>Recent sales</h3><span>Your latest recorded transactions</span></div><button className="text-button" onClick={() => onNavigate("reports")}>All reports <ArrowUpRight size={14} /></button></div>
          {recentInvoices.length ? (
            <div className="admin-recent-list">
              {recentInvoices.map((invoice) => (
                <div className="admin-recent-row" key={invoice.id}>
                  <span className={`admin-payment-icon admin-payment-${invoice.paymentMode}`}>{invoice.paymentMode === "cash" ? <Banknote size={16} /> : invoice.paymentMode === "upi" ? <QrCode size={16} /> : <Wallet size={16} />}</span>
                  <span className="admin-recent-copy"><strong>{invoice.customerName ?? "Walk-in customer"}</strong><small>{formatDateTime(invoice.createdAt)} · {getPaymentLabel(invoice.paymentMode)}</small></span>
                  <strong className="admin-recent-total">{formatMoney(invoice.totalAmount)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="admin-empty-state"><Receipt size={22} /><strong>No sales recorded yet</strong><span>Completed sales will appear here.</span><button className="text-button" onClick={() => onNavigate("pos")}>Start a sale <ArrowUpRight size={14} /></button></div>
          )}
        </section>

        <section className="data-card admin-attention-card">
          <div className="data-card-toolbar"><div><h3>Needs your attention</h3><span>Keep the counter running smoothly</span></div><button className="text-button" onClick={() => onNavigate("inventory")}>Inventory <ArrowUpRight size={14} /></button></div>
          {lowStockProducts.length ? (
            <div className="admin-low-stock-list">
              {lowStockProducts.slice(0, 4).map((product) => (
                <div className="admin-low-stock-row" key={product.id}>
                  <span className="admin-low-stock-icon"><Package size={15} /></span>
                  <span><strong>{product.name}</strong><small>{product.category}</small></span>
                  <b>{product.stockQty} {product.unit} left</b>
                </div>
              ))}
              {lowStockProducts.length > 4 && <button className="admin-more-link" onClick={() => onNavigate("inventory")}>See {lowStockProducts.length - 4} more low-stock products</button>}
            </div>
          ) : (
            <div className="admin-all-clear"><CheckCircle2 size={19} /><span><strong>Nothing needs attention</strong><small>Your inventory is in good shape.</small></span></div>
          )}
          <div className="admin-quick-actions">
            <button onClick={onAddCustomer}><Plus size={14} /> Add customer</button>
            <button onClick={onAddStaff}><Users size={14} /> Add team member</button>
          </div>
        </section>
      </div>
    </section>
  );
}

function InventoryView({
  products,
  search,
  onSearch,
  onAdd,
  onEdit,
  onRemove,
}: {
  products: Product[];
  search: string;
  onSearch: (search: string) => void;
  onAdd: () => void;
  onEdit: (product: Product) => void;
  onRemove: (product: Product) => void;
}) {
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "out">("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"name" | "stock" | "price">("name");
  const lowStock = products.filter((product) => product.stockQty <= 5).length;
  const inventoryCost = products.reduce((sum, product) => sum + product.costPrice * product.stockQty, 0);
  const retailValue = products.reduce((sum, product) => sum + product.sellingPrice * product.stockQty, 0);
  const term = search.trim().toLowerCase();
  const categories = Array.from(new Set(products.map((product) => product.category))).sort((a, b) => a.localeCompare(b));
  const visibleProducts = products
    .filter((product) =>
      (!term || `${product.name} ${product.barcode ?? ""} ${product.category}`.toLowerCase().includes(term)) &&
      (categoryFilter === "all" || product.category === categoryFilter) &&
      (stockFilter === "all" || (stockFilter === "low" ? product.stockQty > 0 && product.stockQty <= 5 : product.stockQty <= 0)),
    )
    .sort((a, b) => sortBy === "stock"
      ? a.stockQty - b.stockQty || a.name.localeCompare(b.name)
      : sortBy === "price"
        ? b.sellingPrice - a.sellingPrice || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name));
  const exportVisibleInventory = () => {
    const rows = [
      ["Product", "Barcode", "Category", "Stock", "Unit", "Selling price", "Cost price", "Margin %", "Stock cost value"],
      ...visibleProducts.map((product) => [
        product.name,
        product.barcode ?? "",
        product.category,
        product.stockQty,
        product.unit,
        product.sellingPrice.toFixed(2),
        product.costPrice.toFixed(2),
        product.sellingPrice > 0 ? Math.round((product.sellingPrice - product.costPrice) / product.sellingPrice * 100) : 0,
        (product.costPrice * product.stockQty).toFixed(2),
      ]),
    ];
    const blob = new Blob([`\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kokan-pos-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportRestockList = () => {
    const rows = [
      ["Product", "Barcode", "Category", "Current stock", "Unit", "Cost price", "Selling price"],
      ...products.filter((product) => product.stockQty <= 5).map((product) => [
        product.name,
        product.barcode ?? "",
        product.category,
        product.stockQty,
        product.unit,
        product.costPrice.toFixed(2),
        product.sellingPrice.toFixed(2),
      ]),
    ];
    if (rows.length === 1) return;
    const blob = new Blob([`\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kokan-pos-restock-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="admin-page">
      <div className="page-action-row"><div><span className="section-eyebrow">A LITTLE ORDER GOES A LONG WAY</span><h2>Your stock, at a glance</h2></div><button className="button button-primary" onClick={onAdd}><Plus size={17} /> Add product</button></div>
      <div className="metric-grid three-metrics">
        <MetricCard icon={<Package size={19} />} label="Active products" value={String(products.length)} detail="Across your catalog" tone="green" />
        <MetricCard icon={<CircleAlert size={19} />} label="Running low" value={String(lowStock)} detail={lowStock ? "Worth a quick restock" : "Shelves look healthy"} tone={lowStock ? "amber" : "green"} />
        <MetricCard icon={<Wallet size={19} />} label="Stock at cost" value={formatMoney(inventoryCost)} detail={`Retail value ${formatMoney(retailValue)}`} tone="blue" />
      </div>
      <div className="data-card inventory-card">
        <div className="data-card-toolbar"><div><h3>Product catalog</h3><span>{visibleProducts.length} products · local changes sync in the background</span></div><label className="table-search"><Search size={16} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search products…" aria-label="Search inventory" /></label></div>
        <div className="inventory-filter-row">
          <label><span>STOCK</span><select value={stockFilter} onChange={(event) => setStockFilter(event.target.value as typeof stockFilter)}><option value="all">All stock</option><option value="low">Low stock</option><option value="out">Out of stock</option></select></label>
          <label><span>CATEGORY</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">All categories</option>{categories.map((category) => <option value={category} key={category}>{category}</option>)}</select></label>
          <label><span>SORT BY</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}><option value="name">Name</option><option value="stock">Lowest stock</option><option value="price">Highest price</option></select></label>
          <button type="button" className="button button-secondary inventory-export-button" onClick={exportVisibleInventory} disabled={!visibleProducts.length}><Download size={14} /> Export visible</button>
          <button type="button" className="button button-secondary inventory-export-button" onClick={exportRestockList} disabled={!lowStock}><Package size={14} /> Export restock list</button>
        </div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>PRODUCT</th><th>CATEGORY</th><th>STOCK</th><th>SELLING PRICE</th><th>COST / MARGIN</th><th>SYNC</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
          {visibleProducts.map((product) => {
            const visual = categoryStyle(product.category);
            const margin = product.sellingPrice > 0 ? Math.round(((product.sellingPrice - product.costPrice) / product.sellingPrice) * 100) : 0;
            return <tr key={product.id}>
              <td><div className="table-product"><span className={`table-product-art product-art-${visual.color}`}>{visual.emoji}</span><span><strong>{product.name}</strong><small>{product.barcode || "No barcode"}</small></span></div></td>
              <td><span className="category-tag">{product.category}</span></td>
              <td><span className={`stock-value ${product.stockQty <= 5 ? "stock-value-low" : ""}`}>{product.stockQty} <small>{product.unit}</small></span></td>
              <td><strong>{formatMoney(product.sellingPrice)}</strong></td>
              <td><span className="cost-margin"><strong>{formatMoney(product.costPrice)}</strong><small>{margin}% margin</small></span></td>
              <td><span className={`sync-status ${product.synced ? "sync-status-done" : "sync-status-pending"}`}><span />{product.synced ? "Synced" : "Queued"}</span></td>
              <td><div className="row-actions"><button className="table-action" onClick={() => onEdit(product)} aria-label={`Edit ${product.name}`} title="Edit product"><Pencil size={15} /></button><button className="table-action table-action-danger" onClick={() => onRemove(product)} aria-label={`Remove ${product.name}`} title="Remove product"><Trash2 size={15} /></button></div></td>
            </tr>;
          })}
          {visibleProducts.length === 0 && <tr><td colSpan={7}><div className="table-empty"><Package size={22} /><strong>No products match</strong><span>Try another search or add a product.</span></div></td></tr>}
        </tbody></table></div>
        <div className="table-bottom-note"><ShieldCheck size={14} /> Inventory edits are written to this device immediately.</div>
      </div>
    </section>
  );
}

function CustomersView({
  customers,
  invoices,
  search,
  onSearch,
  onAdd,
}: {
  customers: Customer[];
  invoices: Invoice[];
  search: string;
  onSearch: (search: string) => void;
  onAdd: () => void;
}) {
  const totalCredit = customers.reduce((sum, customer) => sum + customer.currentBalance, 0);
  const owing = customers.filter((customer) => customer.currentBalance > 0).length;
  const term = search.trim().toLowerCase();
  const visibleCustomers = customers.filter((customer) => `${customer.name} ${customer.phone}`.toLowerCase().includes(term));

  return (
    <section className="admin-page">
      <div className="page-action-row"><div><span className="section-eyebrow">THE PEOPLE WHO MAKE YOUR SHOP</span><h2>Familiar faces, happy hearts.</h2></div><button className="button button-primary" onClick={onAdd}><Plus size={17} /> Add customer</button></div>
      <div className="metric-grid three-metrics">
        <MetricCard icon={<Users size={19} />} label="Your customers" value={String(customers.length)} detail="Saved on this device" tone="green" />
        <MetricCard icon={<Wallet size={19} />} label="Khata outstanding" value={formatMoney(totalCredit)} detail={`${owing} ${owing === 1 ? "customer" : "customers"} with a balance`} tone="amber" />
        <MetricCard icon={<Receipt size={19} />} label="Customer visits" value={String(invoices.filter((invoice) => invoice.customerId).length)} detail="Linked to a customer" tone="blue" />
      </div>
      <div className="data-card customers-card">
        <div className="data-card-toolbar"><div><h3>Customer book</h3><span>Khata balances are updated as soon as a sale is recorded.</span></div><label className="table-search"><Search size={16} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Find a customer…" aria-label="Search customers" /></label></div>
        <div className="customer-list">
          {visibleCustomers.map((customer) => {
            const latest = invoices.find((invoice) => invoice.customerId === customer.id);
            const purchases = invoices.filter((invoice) => invoice.customerId === customer.id).length;
            return <article className="customer-row" key={customer.id}>
              <div className="customer-avatar">{initials(customer.name)}</div>
              <div className="customer-row-name"><strong>{customer.name}</strong><span><Phone size={13} /> {customer.phone}</span></div>
              <div className="customer-visits"><strong>{purchases}</strong><span>{purchases === 1 ? "visit" : "visits"}{latest ? ` · ${formatShortDate(latest.createdAt)}` : " · just joined"}</span></div>
              <div className="customer-balance"><span>KHATA BALANCE</span><strong className={customer.currentBalance > 0 ? "balance-owing" : "balance-clear"}>{formatMoney(customer.currentBalance)}</strong></div>
              <span className={`customer-status ${customer.currentBalance > 0 ? "customer-status-due" : "customer-status-clear"}`}>{customer.currentBalance > 0 ? "To collect" : "All settled"}</span>
            </article>;
          })}
          {visibleCustomers.length === 0 && <div className="table-empty customer-empty"><Users size={23} /><strong>No customers found</strong><span>Add a familiar face to get started.</span></div>}
        </div>
        <div className="table-bottom-note"><Wallet size={14} /> Customer and Khata records stay available offline.</div>
      </div>
    </section>
  );
}

function ReportsView({
  invoices,
  products,
  customers,
  operations,
  onPrint,
}: {
  invoices: Invoice[];
  products: Product[];
  customers: Customer[];
  operations: OperationsRecord[];
  onPrint: () => void;
}) {
  const todayStart = startOfLocalDay();
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
  const todayInvoices = invoices.filter((invoice) => invoice.createdAt >= todayStart && invoice.createdAt < tomorrowStart);
  const todayOperations = operations.filter((operation) => operation.createdAt >= todayStart && operation.createdAt < tomorrowStart);
  const todayReturns = todayOperations.filter((operation) => operation.payload.kind === "return");
  const todayExpenses = todayOperations.filter((operation) => operation.payload.kind === "expense");
  const returnTotalByMode = (mode: PaymentMode) => todayReturns.reduce((sum, operation) =>
    operation.payload.kind === "return" && operation.payload.paymentMode === mode ? sum + operation.payload.amount : sum, 0);
  const expenseTotal = todayExpenses.reduce((sum, operation) =>
    operation.payload.kind === "expense" ? sum + operation.payload.amount : sum, 0);
  const revenue = Math.max(0, todayInvoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0) - todayReturns.reduce((sum, operation) =>
    operation.payload.kind === "return" ? sum + operation.payload.amount : sum, 0));
  const averageTicket = todayInvoices.length ? revenue / todayInvoices.length : 0;
  const grossProfit = todayInvoices.reduce((sum, invoice) => sum + invoice.items.reduce((itemSum, item) => itemSum + (item.unitPrice - item.unitCost) * item.quantity, 0) - invoice.discount, 0);
  const returnedProfit = todayReturns.reduce((sum, operation) => sum + (operation.payload.kind === "return" ? operation.payload.profitReversal : 0), 0);
  const netOperatingEstimate = grossProfit - returnedProfit - expenseTotal;
  const cashTotal = Math.max(0, todayInvoices.filter((invoice) => invoice.paymentMode === "cash").reduce((sum, invoice) => sum + invoice.totalAmount, 0) - returnTotalByMode("cash"));
  const upiTotal = Math.max(0, todayInvoices.filter((invoice) => invoice.paymentMode === "upi").reduce((sum, invoice) => sum + invoice.totalAmount, 0) - returnTotalByMode("upi"));
  const khataTotal = Math.max(0, todayInvoices.filter((invoice) => invoice.paymentMode === "khata").reduce((sum, invoice) => sum + invoice.totalAmount, 0) - returnTotalByMode("khata"));
  const lastCashClose = todayOperations.find((operation) => operation.payload.kind === "cash_close");
  const openingFloat = lastCashClose?.payload.kind === "cash_close" ? lastCashClose.payload.openingFloat : 0;
  const cashExpenses = todayExpenses.reduce((sum, operation) =>
    operation.payload.kind === "expense" && operation.payload.paymentMode === "cash" ? sum + operation.payload.amount : sum, 0);
  const expectedCashDrawer = Math.max(0, openingFloat + cashTotal - cashExpenses);
  const chartDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const start = date.getTime();
    const end = start + 24 * 60 * 60 * 1000;
    return {
      label: new Intl.DateTimeFormat("en-IN", { weekday: "short" }).format(date),
      dateLabel: formatShortDate(start),
      revenue: Math.max(0,
        invoices.filter((invoice) => invoice.createdAt >= start && invoice.createdAt < end).reduce((sum, invoice) => sum + invoice.totalAmount, 0) -
        operations.filter((operation) => operation.createdAt >= start && operation.createdAt < end && operation.payload.kind === "return")
          .reduce((sum, operation) => sum + (operation.payload.kind === "return" ? operation.payload.amount : 0), 0)),
      today: index === 6,
    };
  });
  const maxChartRevenue = Math.max(1, ...chartDays.map((day) => day.revenue));
  const itemsByName = new Map<string, { name: string; quantity: number; revenue: number }>();
  for (const invoice of todayInvoices) {
    for (const item of invoice.items) {
      const current = itemsByName.get(item.name) ?? { name: item.name, quantity: 0, revenue: 0 };
      current.quantity += item.quantity;
      current.revenue += item.lineTotal;
      itemsByName.set(item.name, current);
    }
  }
  const popularProducts = Array.from(itemsByName.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 4);
  const recentInvoices = invoices.slice(0, 6);
  const netPaymentTotal = cashTotal + upiTotal + khataTotal;
  const cashPercent = netPaymentTotal ? Math.round((cashTotal / netPaymentTotal) * 100) : 0;
  const upiPercent = netPaymentTotal ? Math.round((upiTotal / netPaymentTotal) * 100) : 0;
  const khataPercent = Math.max(0, 100 - cashPercent - upiPercent);
  const totalKhataOutstanding = customers.reduce((sum, customer) => sum + customer.currentBalance, 0);
  const stockValue = products.reduce((sum, product) => sum + product.costPrice * product.stockQty, 0);

  return (
    <section className="admin-page reports-page">
      <div className="page-action-row"><div><span className="section-eyebrow">A GOOD DAY’S WORK</span><h2>Today, in a nutshell.</h2></div><button className="button button-secondary" onClick={onPrint}><Printer size={16} /> Print closing report</button></div>
      <div className="metric-grid four-metrics">
        <MetricCard icon={<TrendingUp size={19} />} label="Net sales today" value={formatMoney(revenue)} detail={`${todayInvoices.length} sales less ${todayReturns.length} returns`} tone="green" />
        <MetricCard icon={<CircleDollarSign size={19} />} label="Net operating est." value={formatMoney(netOperatingEstimate)} detail={`After returns and ${formatMoney(expenseTotal)} recorded expenses`} tone="blue" />
        <MetricCard icon={<Receipt size={19} />} label="Average ticket" value={formatMoney(averageTicket)} detail="Per completed sale" tone="violet" />
        <MetricCard icon={<Wallet size={19} />} label="Khata outstanding" value={formatMoney(totalKhataOutstanding)} detail={`Stock at cost ${formatMoney(stockValue)}`} tone="amber" />
      </div>
      <div className="reports-grid">
        <article className="data-card chart-card">
          <div className="data-card-toolbar chart-toolbar"><div><h3>Sales over the week</h3><span>Daily revenue · INR</span></div><div className="chart-legend"><span /> Revenue</div></div>
          <div className="sales-chart" role="img" aria-label="Bar chart of sales for the last seven days">
            {chartDays.map((day) => <div className="chart-day" key={day.label + day.dateLabel}>
              <div className="chart-bar-space"><div className={`chart-bar ${day.today ? "chart-bar-today" : ""}`} style={{ height: `${Math.max(day.revenue ? 8 : 3, (day.revenue / maxChartRevenue) * 100)}%` }} title={`${day.dateLabel}: ${formatMoney(day.revenue)}`} /></div>
              <span className="chart-day-name">{day.label}</span><small>{day.dateLabel}</small>
            </div>)}
          </div>
          <div className="chart-footer"><span><span className="chart-footer-dot" /> Sales are stored locally and sync in the background</span><span>Today {formatMoney(revenue)}</span></div>
        </article>
        <article className="data-card payments-card">
          <div className="data-card-toolbar"><div><h3>Payment mix</h3><span>How customers paid today</span></div><div className="payment-mix-icon"><SlidersHorizontal size={17} /></div></div>
          <div className="payment-mix-bar"><span className="mix-cash" style={{ width: `${cashPercent}%` }} /><span className="mix-upi" style={{ width: `${upiPercent}%` }} /><span className="mix-khata" style={{ width: `${khataPercent}%` }} /></div>
          <div className="payment-breakdown">
            <PaymentBreakdown color="cash" label="Cash" value={cashTotal} percent={cashPercent} icon={<Banknote size={16} />} />
            <PaymentBreakdown color="upi" label="UPI" value={upiTotal} percent={upiPercent} icon={<QrCode size={16} />} />
            <PaymentBreakdown color="khata" label="Khata" value={khataTotal} percent={khataPercent} icon={<Wallet size={16} />} />
          </div>
          <div className="drawer-total"><span><Banknote size={15} /> Expected cash drawer</span><strong>{formatMoney(expectedCashDrawer)}</strong></div>
        </article>
      </div>
      <div className="reports-grid reports-bottom-grid">
        <article className="data-card popular-card">
          <div className="data-card-toolbar"><div><h3>Popular today</h3><span>Your customers’ favourites</span></div><span className="popular-badge"><Sparkles size={13} /> TODAY</span></div>
          {popularProducts.length ? <div className="popular-list">{popularProducts.map((item, index) => {
            const visual = categoryStyle(products.find((product) => product.name === item.name)?.category ?? "Grocery");
            return <div className="popular-item" key={item.name}><span className={`popular-rank ${index === 0 ? "popular-rank-first" : ""}`}>{String(index + 1).padStart(2, "0")}</span><span className={`popular-art product-art-${visual.color}`}>{visual.emoji}</span><span className="popular-name"><strong>{item.name}</strong><small>{item.quantity} sold</small></span><strong className="popular-revenue">{formatMoney(item.revenue)}</strong></div>;
          })}</div> : <div className="report-empty"><ShoppingBag size={20} /><span>Your first sale today will show up here.</span></div>}
        </article>
        <article className="data-card recent-card">
          <div className="data-card-toolbar"><div><h3>Recent sales</h3><span>Latest tickets from your local till</span></div><span className="local-only-pill"><span /> LOCAL</span></div>
          {recentInvoices.length ? <div className="recent-sales-list">{recentInvoices.map((invoice) => <div className="recent-sale-row" key={invoice.id}><span className={`recent-payment-icon recent-payment-${invoice.paymentMode}`}>{invoice.paymentMode === "cash" ? <Banknote size={15} /> : invoice.paymentMode === "upi" ? <QrCode size={15} /> : <Wallet size={15} />}</span><span className="recent-sale-copy"><strong>{invoice.customerName ?? "Walk-in customer"}</strong><small>{formatDateTime(invoice.createdAt)} · {invoice.items.reduce((sum, item) => sum + item.quantity, 0)} items</small></span><span className="recent-sale-total"><strong>{formatMoney(invoice.totalAmount)}</strong><small>{getPaymentLabel(invoice.paymentMode)}</small></span></div>)}</div> : <div className="report-empty"><Receipt size={20} /><span>Your completed sales will appear here.</span></div>}
        </article>
      </div>
      <div className="closing-note"><div className="closing-note-icon"><CheckCircle2 size={19} /></div><div><strong>That’s your day, neatly wrapped.</strong><span>Closing numbers are calculated from sales saved on this device. Khata is shown separately from collected cash.</span></div><ArrowDownRight size={17} /></div>
    </section>
  );
}

function PaymentBreakdown({ color, label, value, percent, icon }: { color: string; label: string; value: number; percent: number; icon: ReactNode }) {
  return <div className="payment-breakdown-row"><span className={`payment-breakdown-icon payment-breakdown-${color}`}>{icon}</span><span className="payment-breakdown-name"><strong>{label}</strong><small>{percent}% of sales</small></span><strong className="payment-breakdown-value">{formatMoney(value)}</strong></div>;
}

function SettingsView({
  shop,
  flags,
  platformFeatureAccess,
  staff,
  syncLabel,
  syncError,
  pendingCount,
  onSaveShop,
  onToggleFeature,
  onAddStaff,
  onChangeOwnerPin,
  onPrintTest,
  printerBusy,
  onSignOut,
}: {
  shop: ShopProfile | null;
  flags: FeatureFlag[];
  platformFeatureAccess: Record<string, boolean>;
  staff: StaffMember[];
  syncLabel: string;
  syncError: string | null;
  pendingCount: number;
  onSaveShop: (profile: Omit<ShopProfile, "id" | "updatedAt">) => void;
  onToggleFeature: (flag: FeatureFlag) => void;
  onAddStaff: () => void;
  onChangeOwnerPin: () => void;
  onPrintTest: () => void;
  printerBusy: boolean;
  onSignOut: () => void;
}) {
  return (
    <section className="admin-page settings-page">
      <div className="settings-welcome"><div className="settings-welcome-icon"><Sparkles size={21} /></div><div><span className="section-eyebrow">YOUR LITTLE CORNER OF THE WORLD</span><h2>Set up just the way you like it.</h2><p>Everything saves locally first, so the shop keeps moving when the internet doesn’t.</p></div><div className="settings-cloud-art"><span>✳</span><span>✿</span><span>☼</span></div></div>
      <div className="settings-grid">
        <div className="settings-column">
          <ShopSettingsForm key={shop?.updatedAt ?? 0} shop={shop} onSave={onSaveShop} />
          <section className="data-card settings-card feature-settings-card">
            <div className="settings-card-heading"><div className="settings-card-icon settings-icon-purple"><SlidersHorizontal size={18} /></div><div><h3>Features for your shop</h3><p>Switch things on or off as your business grows.</p></div></div>
            <div className="feature-list">{flags.map((flag) => {
              const platformEnabled = platformFeatureAccess[flag.key] !== false;
              const enabled = flag.enabled && platformEnabled;
              return <div className="feature-row" key={flag.id}><div className="feature-copy"><strong>{flag.label}</strong><span>{platformEnabled ? flag.description : `${flag.description} Disabled by the platform administrator.`}</span></div><button className={`toggle-switch ${enabled ? "toggle-switch-on" : ""}`} role="switch" aria-checked={enabled} aria-label={`Toggle ${flag.label}`} disabled={!platformEnabled} title={platformEnabled ? undefined : "Disabled by the platform administrator"} onClick={() => onToggleFeature(flag)}><span /></button></div>;
            })}</div>
          </section>
        </div>
        <div className="settings-column">
          <section className="data-card settings-card team-settings-card">
            <div className="settings-card-heading"><div className="settings-card-icon settings-icon-blue"><Users size={18} /></div><div><h3>People at the counter</h3><p>Owner tools are protected by a local PIN.</p></div><button className="text-button" onClick={onAddStaff}><Plus size={15} /> Add person</button></div>
            <div className="team-list">{staff.map((member) => <div className="team-row" key={member.id}><div className={`team-avatar ${member.role === "owner" ? "team-avatar-owner" : ""}`}>{initials(member.name)}</div><div className="team-person"><strong>{member.name}</strong><span>{member.role === "owner" ? "Shop owner" : member.role === "admin" ? "Administrator" : "Cashier"}</span></div><span className={`role-pill role-${member.role}`}>{member.role}</span></div>)}</div>
            <div className="owner-pin-note"><KeyRound size={15} /><span>First-run owner PIN <strong>0427</strong></span><button className="text-button" onClick={onChangeOwnerPin}>Change PIN</button></div>
          </section>
          <section className="data-card settings-card device-settings-card">
            <div className="settings-card-heading"><div className="settings-card-icon settings-icon-orange"><Bluetooth size={18} /></div><div><h3>Counter hardware</h3><p>Connect an ESC/POS Bluetooth receipt printer.</p></div></div>
            <div className="device-connection-card"><div className="printer-illustration"><Printer size={23} /></div><div><strong>Thermal receipt printer</strong><span>58mm / 80mm · Bluetooth LE</span></div><span className="device-ready-dot" /></div>
            <button className="button button-secondary button-full printer-connect-button" onClick={onPrintTest} disabled={printerBusy}>{printerBusy ? <span className="button-spinner" /> : <Bluetooth size={16} />}{printerBusy ? "Connecting…" : "Connect & print a test"}</button>
            <p className="device-note"><CircleHelp size={13} /> Browser Bluetooth requires a secure connection and a supported printer.</p>
          </section>
          <section className="offline-ready-card"><div className="offline-ready-icon"><WifiOff size={18} /></div><div><strong>Offline-ready by design</strong><span>Catalog, checkout and cart are stored in this browser.</span><small>{syncError ?? `${syncLabel}${pendingCount > 0 ? ` · ${pendingCount} change${pendingCount === 1 ? "" : "s"} waiting` : ""}`}</small></div><CheckCircle2 size={17} className="offline-ready-check" /></section>
        </div>
      </div>
      <div className="settings-footer-note"><ShieldCheck size={14} /><span>PINs are stored as one-way hashes on this device. Cloud sync only runs when a connection is available.</span><button className="text-button" onClick={onSignOut}>Sign out of this shop</button></div>
    </section>
  );
}

function ShopSettingsForm({ shop, onSave }: { shop: ShopProfile | null; onSave: (profile: Omit<ShopProfile, "id" | "updatedAt">) => void }) {
  const [draft, setDraft] = useState({
    shopName: shop?.shopName ?? "",
    ownerName: shop?.ownerName ?? "",
    area: shop?.area ?? "",
    phone: shop?.phone ?? "",
    upiId: shop?.upiId ?? "",
  });
  const savedAt = shop?.updatedAt ?? null;
  const update = (key: keyof typeof draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <form className="data-card settings-card shop-settings-card" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
      <div className="settings-card-heading"><div className="settings-card-icon settings-icon-green"><Store size={18} /></div><div><h3>About your shop</h3><p>These details appear on your receipts.</p></div></div>
      <label className="form-label">SHOP NAME<input className="form-input" value={draft.shopName} onChange={(event) => update("shopName", event.target.value)} required /></label>
      <div className="form-two-columns"><label className="form-label">OWNER NAME<input className="form-input" value={draft.ownerName} onChange={(event) => update("ownerName", event.target.value)} required /></label><label className="form-label">PHONE<input className="form-input" value={draft.phone} onChange={(event) => update("phone", event.target.value)} /></label></div>
      <label className="form-label">AREA / ADDRESS<input className="form-input" value={draft.area} onChange={(event) => update("area", event.target.value)} /></label>
      <label className="form-label">UPI ID <span className="label-help">used to create payment QR codes</span><input className="form-input" value={draft.upiId} onChange={(event) => update("upiId", event.target.value)} placeholder="yourname@bank" /></label>
      <div className="settings-save-row"><span>{savedAt ? "Saved on this device" : "Ready to set up"}</span><button className="button button-primary" type="submit"><Check size={15} /> Save details</button></div>
    </form>
  );
}

function MetricCard({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone: string }) {
  return <article className="metric-card"><div className={`metric-icon metric-icon-${tone}`}>{icon}</div><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong><span className="metric-detail">{detail}</span></article>;
}

function ProductEditorModal({ product, onClose, onSave }: { product: Product | null; onClose: () => void; onSave: (draft: ProductDraft) => void }) {
  const [draft, setDraft] = useState<ProductDraft>({
    name: product?.name ?? "",
    barcode: product?.barcode ?? "",
    category: product?.category ?? "Grocery",
    unit: product?.unit ?? "pack",
    sellingPrice: product ? String(product.sellingPrice) : "",
    costPrice: product ? String(product.costPrice) : "",
    stockQty: product ? String(product.stockQty) : "",
  });
  const update = (key: keyof ProductDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card editor-modal" role="dialog" aria-modal="true" aria-labelledby="product-modal-title">
        <div className="modal-heading"><div><span className="eyebrow">{product ? "UPDATE YOUR CATALOG" : "GROW YOUR CATALOG"}</span><h2 id="product-modal-title">{product ? "Edit product" : "Add a product"}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <form className="editor-form" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
          <label className="form-label">PRODUCT NAME<input className="form-input" value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="e.g. Alphonso mangoes · 1 kg" required autoFocus /></label>
          <div className="form-two-columns"><label className="form-label">CATEGORY<select className="form-input form-select" value={draft.category} onChange={(event) => update("category", event.target.value)}>{["Grocery", "Dairy", "Snacks", "Beverages", "Bakery", "Household", "Other"].map((category) => <option key={category}>{category}</option>)}</select></label><label className="form-label">UNIT<input className="form-input" value={draft.unit} onChange={(event) => update("unit", event.target.value)} placeholder="pack, kg, piece…" required /></label></div>
          <label className="form-label">BARCODE <span className="label-help">optional · scan it at checkout</span><input className="form-input" value={draft.barcode} onChange={(event) => update("barcode", event.target.value)} placeholder="Scan or enter barcode" /></label>
          <div className="form-two-columns"><label className="form-label">SELLING PRICE<input className="form-input" type="number" min="0" step="0.01" value={draft.sellingPrice} onChange={(event) => update("sellingPrice", event.target.value)} placeholder="0.00" required /></label><label className="form-label">COST PRICE<input className="form-input" type="number" min="0" step="0.01" value={draft.costPrice} onChange={(event) => update("costPrice", event.target.value)} placeholder="0.00" required /></label></div>
          <label className="form-label">CURRENT STOCK<input className="form-input" type="number" min="0" step="1" value={draft.stockQty} onChange={(event) => update("stockQty", event.target.value)} placeholder="0" required /></label>
          <div className="modal-action-row"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary"><Check size={16} /> {product ? "Save changes" : "Add to catalog"}</button></div>
        </form>
      </section>
    </div>
  );
}

function CustomerEditorModal({ onClose, onSave }: { onClose: () => void; onSave: (draft: CustomerDraft) => void }) {
  const [draft, setDraft] = useState<CustomerDraft>({ name: "", phone: "" });
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card editor-modal customer-editor-modal" role="dialog" aria-modal="true" aria-labelledby="customer-modal-title">
        <div className="modal-heading"><div><span className="eyebrow">A NEW FAMILIAR FACE</span><h2 id="customer-modal-title">Add a customer</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <form className="editor-form" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
          <label className="form-label">FULL NAME<input className="form-input" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required autoFocus placeholder="e.g. Meera Joshi" /></label>
          <label className="form-label">PHONE NUMBER<input className="form-input" type="tel" value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} placeholder="+91" /></label>
          <p className="customer-modal-note"><Wallet size={15} /> They’ll start with a clear Khata balance. You can add a sale to their ledger at checkout.</p>
          <div className="modal-action-row"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary"><Plus size={16} /> Add customer</button></div>
        </form>
      </section>
    </div>
  );
}

function StaffEditorModal({ onClose, onSave }: { onClose: () => void; onSave: (draft: StaffDraft) => void }) {
  const [draft, setDraft] = useState<StaffDraft>({ name: "", role: "cashier", pin: "", hourlyRate: "" });
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card editor-modal" role="dialog" aria-modal="true" aria-labelledby="staff-modal-title">
        <div className="modal-heading"><div><span className="eyebrow">A FEW EXTRA HANDS</span><h2 id="staff-modal-title">Add a team member</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <form className="editor-form" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
          <label className="form-label">NAME<input className="form-input" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required autoFocus placeholder="Team member’s name" /></label>
          <label className="form-label">ROLE<select className="form-input form-select" value={draft.role} onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value as StaffDraft["role"] }))}><option value="cashier">Cashier · checkout only</option><option value="admin">Administrator · owner tools</option></select></label>
          <label className="form-label">PERSONAL PIN<input className="form-input pin-field" type="password" inputMode="numeric" minLength={4} maxLength={8} value={draft.pin} onChange={(event) => setDraft((current) => ({ ...current, pin: event.target.value.replace(/\D/g, "") }))} required placeholder="4–8 digits" /></label>
          <label className="form-label">HOURLY RATE (₹)<input className="form-input" type="number" min="0" step="0.01" value={draft.hourlyRate} onChange={(event) => setDraft((current) => ({ ...current, hourlyRate: event.target.value }))} required placeholder="e.g. 100" /></label>
          <p className="customer-modal-note"><ShieldCheck size={15} /> PINs are one-way hashed on this device. The hourly rate is used for estimated gross pay only.</p>
          <div className="modal-action-row"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary" disabled={draft.pin.length < 4}><Plus size={16} /> Add to team</button></div>
        </form>
      </section>
    </div>
  );
}
