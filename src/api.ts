/**
 * Typed API client for Strayl CLI
 * All requests are authenticated via stored credentials.
 */

import { getConfig, getCredentials, type Credentials } from "./config.js";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiCall(
  method: string,
  path: string,
  body?: unknown,
  credentials?: Credentials | null
): Promise<unknown> {
  const config = getConfig();
  const creds = credentials ?? getCredentials();

  if (!creds) {
    throw new ApiError(401, "Not authenticated — run 'st login' first");
  }

  const url = `${config.apiUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${creds.token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    const message = (data as any)?.error || `HTTP ${res.status}`;
    throw new ApiError(res.status, message);
  }

  return data;
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function createProject(
  name: string,
  slug: string,
  visibility: "public" | "private",
  description?: string
): Promise<any> {
  return apiCall("POST", "/projects", { name, slug, visibility, description });
}

export async function getProjectInfo(username: string, slug: string): Promise<any> {
  return apiCall("GET", `/projects/${username}/${slug}`);
}

export async function getRepoStatus(
  username: string,
  slug: string,
  branch?: string
): Promise<{ isEmpty: boolean; branch: string }> {
  const q = branch ? `?branch=${encodeURIComponent(branch)}` : "";
  return apiCall("GET", `/projects/${username}/${slug}/repo/status${q}`) as any;
}

// ── Changes ───────────────────────────────────────────────────────────────────

export async function proposeChangeFromBranch(
  username: string,
  slug: string,
  branchName: string,
  title?: string,
  description?: string
): Promise<{ change: any; changeUrl: string }> {
  return apiCall("POST", `/projects/${username}/${slug}/changes/from-branch`, {
    branchName,
    title,
    description,
  }) as any;
}

export async function listChanges(
  username: string,
  slug: string,
  filters?: { status?: string; mine?: boolean }
): Promise<{ changes: any[] }> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  const q = params.toString() ? `?${params}` : "";
  return apiCall("GET", `/projects/${username}/${slug}/changes${q}`) as any;
}

export async function getChange(
  username: string,
  slug: string,
  changeId: string
): Promise<{ change: any; files: any[] }> {
  return apiCall("GET", `/projects/${username}/${slug}/changes/${changeId}`) as any;
}

export async function mergeChange(
  username: string,
  slug: string,
  changeId: string
): Promise<any> {
  return apiCall("POST", `/projects/${username}/${slug}/changes/${changeId}/merge`);
}

export async function denyChange(
  username: string,
  slug: string,
  changeId: string
): Promise<any> {
  return apiCall("POST", `/projects/${username}/${slug}/changes/${changeId}/deny`);
}

export async function restackChange(
  username: string,
  slug: string,
  changeId: string
): Promise<any> {
  return apiCall("POST", `/projects/${username}/${slug}/changes/${changeId}/restack`);
}

// ── Promote ───────────────────────────────────────────────────────────────────

export async function promoteToMain(username: string, slug: string): Promise<any> {
  return apiCall("POST", `/projects/${username}/${slug}/merge-dev-to-main`);
}

// ── Role ──────────────────────────────────────────────────────────────────────

export async function getProjectRole(username: string, slug: string): Promise<{ role: string }> {
  return apiCall("GET", `/projects/${username}/${slug}/role`) as any;
}
