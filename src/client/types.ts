export interface V1Page {
  id: string;
  slug: string;
  title: string;
  mode: string;
  // #207 — page kind (e.g. "archive", "html", "doc"). Optional: older servers
  // omit it, in which case the CLI treats the page as the non-archive zip path.
  kind?: string;
  file_size: number;
  visibility: string;
  url: string;
  full_url: string;
  created_at: string;
  updated_at: string;
}

export interface V1ShareGrant {
  id: string;
  email: string;
  status: string;
  created_at: string;
}

// ─── #198 (RES-CLI-1) reservations ────────────────────────────────────────
//
// Typed from serializeReservation (lib/pages/serializers.ts): the enveloped v1
// shape returned by GET/POST /api/v1/reservations and the revoke route. status
// is one of reserved | claimed | expired | revoked. claim_token is NOT part of
// this shape — it is a one-time SIBLING field on the 201 create response only.

export interface Reservation {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  intended_agent_name: string | null;
  visibility: string;
  mode: string;
  watermark_enabled: boolean;
  status: string;
  claimed_page_id: string | null;
  url: string;
  full_url: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Only-provided keys are sent (snake_case, matching v1CreateReservationSchema). */
export interface CreateReservationBody {
  title?: string;
  description?: string;
  intended_agent_name?: string;
  visibility?: "public" | "private" | "shared";
  mode?: "static" | "interactive";
  watermark_enabled?: boolean;
  folder_id?: string;
  expires_at?: string;
}

export interface V1Pagination {
  next_cursor: string | null;
  has_more: boolean;
}

export interface V1SuccessResponse<T> {
  data: T;
}

export interface V1ListResponse<T> {
  data: T[];
  pagination: V1Pagination;
}

export interface V1ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export interface UploadParams {
  html: string;
  title?: string;
  visibility?: "public" | "private" | "shared";
  mode?: "static" | "interactive";
  workspace?: string;
  /**
   * When set, replace an existing page's content instead of creating a new one.
   * The slug/URL stays stable; on paid tiers the previous content is snapshotted
   * as a version (free tier replaces in place with no snapshot).
   */
  pageId?: string;
}

export interface ListParams {
  workspace?: string;
  limit?: number;
  cursor?: string;
  /** Free-text filter matched against title, slug, id, and file type. */
  search?: string;
}

// ─── Billing envelope (Phase 12 / AGENT-06) ─────────────────────────────
//
// DUPLICATED VERBATIM from lib/billing/error-envelope.ts. The CLI is a
// separate npm package (`@sharedrop/cli`) without Next.js context, so it
// cannot import from `@/lib/...`. Keep these definitions in sync with the
// canonical source.

export type BillingErrorCode =
  | "TIER_LIMIT"
  | "STORAGE_LIMIT"
  | "SEAT_LIMIT"
  | "FILE_SIZE_EXCEEDED";

export interface PricingBlock {
  pro: { monthly: number; storageGb: number; currency: "USD" };
  team: {
    bundle: { seats: number; monthly: number };
    additionalPerSeat: number;
    storagePerSeatGb: number;
    currency: "USD";
  };
  storageAddons: { blockGb: number; monthly: number }[];
}

export interface BillingErrorEnvelope {
  error: {
    code: BillingErrorCode;
    message: string;
    currentTier: "free" | "pro" | "team";
    /** Set only for TIER_LIMIT — the tier the caller must upgrade to. */
    requiredTier?: "pro" | "team";
    /** Set only for STORAGE_LIMIT. */
    currentUsageGb?: number;
    /** Set only for STORAGE_LIMIT. */
    capGb?: number;
    /** Set only for SEAT_LIMIT. */
    currentSeats?: number;
    /** Set only for FILE_SIZE_EXCEEDED — the tier's per-file cap in bytes. */
    limitBytes?: number;
    /** Set only for FILE_SIZE_EXCEEDED — the size the client tried to upload. */
    requestedBytes?: number;
    /** Set only for paid-tier STORAGE_LIMIT — the recommended add-on block (GB). */
    recommendedAddonGb?: 25 | 250 | 1024;
    upgradeUrl: string;
    pricing: PricingBlock;
  };
}

export interface V1MeResponse {
  username: string;
  email: string;
  tier: string;
  pages_used: number;
  pages_limit: number;
  storage_used: number;
  // Phase 12 / AGENT-04 additive fields — optional so older servers don't break.
  entitlements?: {
    maxFileSizeBytes: number;
    allowedVisibilities: string[];
    maxVersionRetention: number;
    // #185 — folders capability (catch-up for the shipped Phase 24 field).
    folders?: boolean;
    // #198 (RES-ME-1) — reserved-addresses capability. Optional so older
    // servers that predate the field render exactly the prior whoami output.
    reservations?: {
      enabled: boolean;
      maxReservations: number;
      remaining: number;
    };
  };
  storage?: { usedGb: number; capGb: number; addonGb: number };
  pricing?: PricingBlock;
  upgradeUrl?: string;
}
