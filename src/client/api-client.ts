import type {
  V1Page, V1ShareGrant, V1Pagination, V1MeResponse,
  V1SuccessResponse, V1ListResponse, V1ErrorResponse,
  ListParams,
  BillingErrorEnvelope,
} from "./types.js";

/**
 * Billing-error codes that carry a `BillingErrorEnvelope` payload (Phase 12).
 * When the response body's `error.code` is one of these, the parsed envelope
 * is attached to the thrown `SharedropApiError` so `handleError` can render
 * the friendly 402 block (or emit the verbatim envelope in --json mode).
 *
 * #126 — `FILE_SIZE_EXCEEDED` (a 402 from /api/upload/sign) now carries the
 * full envelope (price + upgradeUrl) and joins the set so the CLI renders its
 * upsell consistently with the other capacity codes.
 */
const BILLING_CODES = new Set([
  "STORAGE_LIMIT",
  "TIER_LIMIT",
  "SEAT_LIMIT",
  "FILE_SIZE_EXCEEDED",
]);

// ─── UPLOAD-07 streamed-upload types ──────────────────────────────────────

export interface SignUploadParams {
  filename: string;
  content_type: string;
  size_bytes: number;
  workspace?: string;
  /** Set on a re-upload; exempts the sign page-count cap (260703-pzs). */
  page_id?: string;
}

export interface SignUploadResponse {
  upload_url: string;
  upload_token: string;
  finalize_url: string;
  object_key: string;
}

export interface FinalizeUploadParams {
  object_key: string;
  upload_token: string;
  title?: string;
  visibility?: "public" | "private" | "shared";
  mode?: "static" | "interactive";
  workspace?: string;
  page_id?: string;
  /**
   * #185 — destination folder for a NEW upload (snake_case; the finalize route
   * validates it is an owned live folder and gates on Pro). Ignored by the
   * server on a re-upload (page_id set), so the caller must not send it then.
   */
  folder_id?: string;
}

export interface FinalizeUploadResponse {
  url: string;
  page_id: string;
  slug: string;
  visibility: string;
  mode: string;
  kind: string;
  contentType: string;
}

// ─── Bundle (folder) upload types — Epic 2 / #81, #90 ─────────────────────

export interface SignBundleParams {
  files: Array<{ filename: string; content_type: string; size_bytes: number }>;
  workspace?: string;
  /** Set on a bundle re-upload; exempts the sign page-count cap (260703-pzs). */
  page_id?: string;
}

export interface SignBundleResponse {
  /** Index-aligned with the request `files`: one signed slot per file. */
  files: Array<{
    filename: string;
    upload_url: string;
    upload_token: string;
    object_key: string;
  }>;
  finalize_url: string;
}

export interface FinalizeBundleParams {
  /** Exactly one file must have path "index.html"; the rest are assets. */
  files: Array<{ path: string; object_key: string; upload_token: string }>;
  title?: string;
  visibility?: "public" | "private" | "shared";
  mode?: "static" | "interactive";
  workspace_id?: string;
  page_id?: string;
}

export interface FinalizeBundleResponse {
  url: string;
  page_id: string;
  slug: string;
  visibility: string;
  mode: string;
  kind: string;
  assets: number;
  was_reupload?: boolean;
}

export class SharedropApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    /** Populated only when status === 402 and code ∈ BILLING_CODES. */
    public envelope?: BillingErrorEnvelope["error"],
    /**
     * #185 — the folder-delete 409 (`FOLDER_NOT_EMPTY`) carries the descendant
     * counts so the command layer can print the refusal ("N page(s), M
     * folder(s)") and prompt for --force. Additive; unused by other codes.
     */
    public details?: { pages: number; folders: number },
  ) {
    super(message);
    this.name = "SharedropApiError";
  }
}

// ─── #185 folder tree types (flat-body routes) ────────────────────────────
//
// The folder / trash / move / tree routes return FLAT JSON bodies, not the v1
// { data } envelope. These local shapes describe just the fields the CLI reads.

/** A folder node as returned by POST /api/folders ({ folder }). */
export interface FolderNode {
  id: string;
  name: string;
  title: string;
  parentId: string | null;
  path: string;
  nodeType: string;
  createdAt: string;
}

/**
 * An owner-tree node from GET /api/tree/:username ({ pages }). Both folders and
 * pages carry the flat nesting fields; only the ones the CLI filters/lists on
 * are typed here (the serializer returns more).
 */
export interface OwnerNode {
  id: string;
  slug?: string;
  title: string;
  nodeType: "page" | "folder";
  parentId: string | null;
  path: string | null;
  sortOrder?: number;
  // Present on page rows (serializeOwnerPage). Optional so folder rows and older
  // servers stay assignable; the list-in-folder path reads them when present.
  mode?: string;
  visibility?: string;
  fileSize?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** A trashed row from GET /api/trash ({ items }). */
export interface TrashItem {
  id: string;
  title: string;
  nodeType: string;
  parentId: string | null;
  path: string;
  deletedAt: string | null;
  kind: string;
  fileSize: number;
}

export class SharedropApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: { apiKey: string; baseUrl: string }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        ...options.headers,
      },
    });

    const body = await res.json() as V1SuccessResponse<T> | V1ErrorResponse;

    if (!res.ok) {
      const errorBody = body as V1ErrorResponse;
      const error = errorBody.error || { code: "UNKNOWN", message: res.statusText };
      const envelope = BILLING_CODES.has(error.code)
        ? (error as unknown as BillingErrorEnvelope["error"])
        : undefined;
      throw new SharedropApiError(error.code, error.message, res.status, envelope);
    }

    return (body as V1SuccessResponse<T>).data;
  }

  private async requestList<T>(path: string): Promise<{ data: T[]; pagination: V1Pagination }> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${this.apiKey}` },
    });

    const body = await res.json() as V1ListResponse<T> | V1ErrorResponse;

    if (!res.ok) {
      const errorBody = body as V1ErrorResponse;
      const error = errorBody.error || { code: "UNKNOWN", message: res.statusText };
      const envelope = BILLING_CODES.has(error.code)
        ? (error as unknown as BillingErrorEnvelope["error"])
        : undefined;
      throw new SharedropApiError(error.code, error.message, res.status, envelope);
    }

    const listBody = body as V1ListResponse<T>;
    return { data: listBody.data, pagination: listBody.pagination };
  }

  private async requestVoid(path: string, options: RequestInit = {}): Promise<void> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.json() as V1ErrorResponse;
      const error = body.error || { code: "UNKNOWN", message: res.statusText };
      const envelope = BILLING_CODES.has(error.code)
        ? (error as unknown as BillingErrorEnvelope["error"])
        : undefined;
      throw new SharedropApiError(error.code, error.message, res.status, envelope);
    }
  }

  async listPages(params?: ListParams): Promise<{ data: V1Page[]; pagination: V1Pagination }> {
    const queryParams = new URLSearchParams();
    if (params?.workspace) queryParams.set("workspace_id", params.workspace);
    if (params?.limit) queryParams.set("limit", String(params.limit));
    if (params?.cursor) queryParams.set("cursor", params.cursor);
    if (params?.search) queryParams.set("search", params.search);

    const qs = queryParams.toString();
    return this.requestList<V1Page>(`/api/v1/pages${qs ? `?${qs}` : ""}`);
  }

  async getPage(pageId: string): Promise<V1Page> {
    return this.request<V1Page>(`/api/v1/pages/${pageId}`);
  }

  async updatePage(pageId: string, updates: { title?: string; visibility?: string }): Promise<V1Page> {
    return this.request<V1Page>(
      `/api/v1/pages/${pageId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      }
    );
  }

  async deletePage(pageId: string): Promise<void> {
    return this.requestVoid(
      `/api/v1/pages/${pageId}`,
      { method: "DELETE" }
    );
  }

  /**
   * #139 — download a page's complete artefact as a zip. The response body is
   * BINARY (application/zip), so this bypasses the JSON `request` helper and
   * returns a Buffer. On error the body is the JSON v1 error envelope; map it to
   * SharedropApiError (same shape as requestVoid) so handleError picks the right
   * exit code.
   */
  async downloadPage(pageId: string): Promise<Buffer> {
    const res = await fetch(`${this.baseUrl}/api/v1/pages/${pageId}/download`, {
      headers: { "Authorization": `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Partial<V1ErrorResponse>;
      const error = body.error || { code: "UNKNOWN", message: res.statusText };
      throw new SharedropApiError(error.code, error.message, res.status);
    }

    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * #140 — fetch a page's RAW content via token handoff. Two steps: mint a
   * short-lived signed `fetch_url` from the v1 API (JSON envelope — `request`
   * maps any error envelope to SharedropApiError), then HTTP GET that URL (the
   * token is in the URL, no auth header) and return the raw bytes as a Buffer.
   * Distinct from `downloadPage`, which returns a zip of the whole artefact.
   */
  async fetchPage(pageId: string): Promise<Buffer> {
    const mint = await this.request<{
      fetch_url: string;
      expires_at: string;
      content_type: string;
      mode: string;
      size: number;
    }>(`/api/v1/pages/${pageId}/fetch`);

    const res = await fetch(mint.fetch_url);
    if (!res.ok) {
      throw new SharedropApiError(
        "FETCH_FAILED",
        `Failed to fetch page content (HTTP ${res.status})`,
        res.status,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async sharePage(pageId: string, email: string): Promise<V1ShareGrant> {
    return this.request<V1ShareGrant>(
      `/api/v1/pages/${pageId}/share`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      }
    );
  }

  async getMe(): Promise<V1MeResponse> {
    return this.request<V1MeResponse>("/api/v1/me");
  }

  // ─── UPLOAD-07: direct-streamed upload pipeline ───────────────────────
  //
  // The sign → PUT → finalize sequence replaces the legacy direct-POST raw
  // HTML upload path. The PUT step is performed by `streamUpload` below to
  // keep policy (sign / finalize) and transport (PUT) on separate methods —
  // easier to mock in tests.
  //
  // Note: the sign + finalize endpoints return a flat JSON body (not the
  // V1SuccessResponse envelope used elsewhere), so they bypass the
  // `request` helper's `data` unwrap.

  async signUpload(params: SignUploadParams): Promise<SignUploadResponse> {
    const url = `${this.baseUrl}/api/upload/sign`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      // The sign route emits the BillingErrorEnvelope shape on 402 for
      // STORAGE_LIMIT / FILE_SIZE_EXCEEDED. Otherwise the body is
      // { error: "string" }. Normalise both into SharedropApiError.
      const body = await res.json().catch(() => ({})) as
        | { error: { code: string; message: string } | string }
        | Record<string, unknown>;
      const errField = (body as { error?: unknown }).error;
      if (errField && typeof errField === "object" && "code" in errField) {
        const e = errField as { code: string; message: string };
        const envelope = BILLING_CODES.has(e.code)
          ? (e as unknown as BillingErrorEnvelope["error"])
          : undefined;
        throw new SharedropApiError(e.code, e.message, res.status, envelope);
      }
      const msg = typeof errField === "string" ? errField : res.statusText;
      throw new SharedropApiError("SIGN_FAILED", msg, res.status);
    }

    return (await res.json()) as SignUploadResponse;
  }

  async streamUpload(
    uploadUrl: string,
    uploadToken: string,
    body: import("node:stream").Readable,
    contentType: string,
    contentLength: number,
  ): Promise<void> {
    // Node 18.5+ streaming PUT: duplex: "half" is REQUIRED when body is a
    // ReadableStream / Node Readable. engines.node >= 18.5.0 in package.json
    // documents that contract; no Buffer fallback exists by design.
    const res = await fetch(uploadUrl, {
      method: "PUT",
      // @ts-expect-error — `duplex` is part of the RequestInit type in Node
      // 18.5+ but missing from the lib.dom typings TS picks up here.
      duplex: "half",
      headers: {
        "Authorization": `Bearer ${uploadToken}`,
        "Content-Type": contentType,
        "Content-Length": String(contentLength),
      },
      body: body as unknown as BodyInit,
    });

    if (!res.ok) {
      // Worker returns JSON { error: "..." } on 4xx (size exceeded, mime
      // mismatch, etc.). Surface the reason verbatim.
      const body = await res.json().catch(() => ({ error: res.statusText }));
      const reason =
        typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : res.statusText;
      throw new SharedropApiError("UPLOAD_FAILED", reason, res.status);
    }
  }

  async finalizeUpload(
    params: FinalizeUploadParams,
  ): Promise<FinalizeUploadResponse> {
    const url = `${this.baseUrl}/api/upload/finalize`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as
        | { error: { code: string; message: string } | string }
        | Record<string, unknown>;
      const errField = (body as { error?: unknown }).error;
      if (errField && typeof errField === "object" && "code" in errField) {
        const e = errField as { code: string; message: string };
        const envelope = BILLING_CODES.has(e.code)
          ? (e as unknown as BillingErrorEnvelope["error"])
          : undefined;
        throw new SharedropApiError(e.code, e.message, res.status, envelope);
      }
      const msg = typeof errField === "string" ? errField : res.statusText;
      // 401 from finalize = expired upload window — surface a distinct code.
      const code = res.status === 401 ? "TOKEN_EXPIRED" : "FINALIZE_FAILED";
      throw new SharedropApiError(code, msg, res.status);
    }

    return (await res.json()) as FinalizeUploadResponse;
  }

  // ─── Bundle (folder) upload pipeline ──────────────────────────────────
  //
  // Mirrors the single-file sign → PUT → finalize flow but batches the whole
  // manifest: one /api/upload/bundle/sign charge mints a token per file, each
  // file is streamed to its own upload_url via `streamUpload`, then
  // /api/upload/bundle/finalize promotes them into one page. Both endpoints
  // return a flat JSON body (not the V1SuccessResponse envelope), so they
  // bypass `request` and reuse `throwFlatUploadError` for billing-aware errors.

  private async throwFlatUploadError(
    res: Response,
    fallbackCode: string,
  ): Promise<never> {
    const body = (await res.json().catch(() => ({}))) as
      | { error: { code: string; message: string } | string }
      | Record<string, unknown>;
    const errField = (body as { error?: unknown }).error;
    if (errField && typeof errField === "object" && "code" in errField) {
      const e = errField as { code: string; message: string };
      const envelope = BILLING_CODES.has(e.code)
        ? (e as unknown as BillingErrorEnvelope["error"])
        : undefined;
      throw new SharedropApiError(e.code, e.message, res.status, envelope);
    }
    const msg = typeof errField === "string" ? errField : res.statusText;
    throw new SharedropApiError(fallbackCode, msg, res.status);
  }

  async signBundle(params: SignBundleParams): Promise<SignBundleResponse> {
    const url = `${this.baseUrl}/api/upload/bundle/sign`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) await this.throwFlatUploadError(res, "BUNDLE_SIGN_FAILED");
    return (await res.json()) as SignBundleResponse;
  }

  async finalizeBundle(
    params: FinalizeBundleParams,
  ): Promise<FinalizeBundleResponse> {
    const url = `${this.baseUrl}/api/upload/bundle/finalize`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      // 401 from finalize = expired upload window — surface a distinct code.
      await this.throwFlatUploadError(
        res,
        res.status === 401 ? "TOKEN_EXPIRED" : "BUNDLE_FINALIZE_FAILED",
      );
    }
    return (await res.json()) as FinalizeBundleResponse;
  }

  // ─── #185 folder / trash / move methods (flat-body) ──────────────────────
  //
  // These hit the folder/trash/pages-move/tree routes, which return FLAT JSON
  // bodies ({ folder }, { pages }, { items }, { success, ... }) and a flat error
  // shape ({ error, code? }). They copy the signUpload/finalizeUpload direct-fetch
  // spine and must NOT route through request/requestList (those unwrap `.data`).
  // A non-OK body's `code` (e.g. FOLDERS_RESTRICTED) is preserved verbatim so the
  // command layer surfaces the tier error rather than swallowing it.

  private async folderFetch<T>(
    path: string,
    method: string,
    body: unknown | undefined,
    fallbackCode: string,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as {
        error?: unknown;
        code?: unknown;
      };
      const msg = typeof errBody.error === "string" ? errBody.error : res.statusText;
      const code = typeof errBody.code === "string" ? errBody.code : fallbackCode;
      throw new SharedropApiError(code, msg, res.status);
    }

    return (await res.json()) as T;
  }

  async createFolder(p: { name: string; parentId?: string | null }): Promise<{ folder: FolderNode }> {
    return this.folderFetch(
      "/api/folders",
      "POST",
      { name: p.name, parentId: p.parentId ?? null },
      "FOLDER_CREATE_FAILED",
    );
  }

  async listTree(username: string): Promise<{ pages: OwnerNode[] }> {
    return this.folderFetch(
      `/api/tree/${encodeURIComponent(username)}`,
      "GET",
      undefined,
      "TREE_FETCH_FAILED",
    );
  }

  async deleteFolder(
    id: string,
    force: boolean,
  ): Promise<{ success: boolean; pages: number; folders: number }> {
    const qs = force ? "?force=true" : "";
    const res = await fetch(`${this.baseUrl}/api/folders/${id}${qs}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${this.apiKey}` },
    });

    // 409 = non-empty folder without --force. Carry the counts so the command
    // can print the refusal and prompt for --force (parity with UI + MCP, D-A2).
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: unknown;
        pages?: unknown;
        folders?: unknown;
      };
      const pages = typeof body.pages === "number" ? body.pages : 0;
      const folders = typeof body.folders === "number" ? body.folders : 0;
      const msg = typeof body.error === "string" ? body.error : "This folder is not empty.";
      throw new SharedropApiError("FOLDER_NOT_EMPTY", msg, 409, undefined, { pages, folders });
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown; code?: unknown };
      const msg = typeof body.error === "string" ? body.error : res.statusText;
      const code = typeof body.code === "string" ? body.code : "FOLDER_DELETE_FAILED";
      throw new SharedropApiError(code, msg, res.status);
    }

    return (await res.json()) as { success: boolean; pages: number; folders: number };
  }

  async movePage(id: string, parentId: string | null): Promise<{ page: OwnerNode }> {
    return this.folderFetch(`/api/pages/${id}`, "PUT", { parentId }, "MOVE_FAILED");
  }

  /**
   * #191 — PATCH /api/folders/:id to rename ({ name }) and/or reparent
   * ({ parentId }). Rename is not tier-gated; a reparent is (the server returns
   * FOLDERS_RESTRICTED 403 on a free key). Any flat error code (404 not found,
   * 400 cycle/depth, 409 duplicate sibling, FOLDERS_RESTRICTED) is preserved
   * verbatim so the command layer can route it (parity with UI + MCP).
   */
  async updateFolder(
    id: string,
    patch: { name?: string; parentId?: string | null },
  ): Promise<{ folder: FolderNode }> {
    return this.folderFetch(`/api/folders/${id}`, "PATCH", patch, "FOLDER_UPDATE_FAILED");
  }

  async restoreNode(id: string): Promise<{ success: boolean; reparentedToRoot: boolean }> {
    return this.folderFetch(
      `/api/trash/${id}/restore`,
      "POST",
      undefined,
      "RESTORE_FAILED",
    );
  }

  async listTrash(): Promise<{ items: TrashItem[] }> {
    return this.folderFetch("/api/trash", "GET", undefined, "TRASH_FETCH_FAILED");
  }
}
