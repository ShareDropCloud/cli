export interface V1Page {
  id: string;
  slug: string;
  title: string;
  mode: string;
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
  };
  storage?: { usedGb: number; capGb: number; addonGb: number };
  pricing?: PricingBlock;
  upgradeUrl?: string;
}
