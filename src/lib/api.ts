const API_BASE = "";

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem("snapgen_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = {
    ...getAuthHeader(),
    ...options.headers,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    let errMessage = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      errMessage = data.detail || errMessage;
    } catch {
      // ignore
    }
    throw new Error(errMessage);
  }

  return res.json();
}

export const api = {
  auth: {
    bootstrap: () => request<{ open: boolean }>("/api/auth/bootstrap"),
    login: (body: any) =>
      request<{ token: string; media_token: string; user: any }>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    register: (body: any) =>
      request<{ token: string; media_token: string; user: any }>("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    resetPassword: (body: any) =>
      request<any>("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    logout: () =>
      request<any>("/api/auth/logout", {
        method: "POST",
      }),
    getMe: () => request<any>("/api/auth/me"),
  },
  models: {
    list: () => request<{ models: any[]; default_video_model: string; default_image_model: string }>("/api/models"),
  },
  tasks: {
    list: (params: Record<string, any>) => {
      const q = new URLSearchParams(params).toString();
      return request<{ tasks: any[]; total: number; page: number; limit: number; total_pages?: number }>(`/api/tasks?${q}`);
    },
    generate: (userId: string, body: any) =>
      request<any>(`/api/users/${userId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    upload: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: getAuthHeader(),
        body: fd,
      });
      if (!res.ok) throw new Error("Upload gagal");
      return res.json() as Promise<{ path: string; filename: string }>;
    },
    delete: (taskId: string) =>
      request<any>(`/api/tasks/${taskId}`, { method: "DELETE" }),
    getQuota: (userId: string) =>
      request<any>(`/api/users/${userId}/quota`),
    getStats: (userId: string) =>
      request<any>(`/api/users/${userId}/stats`),
    downloadZip: async (userId: string, taskIds: string[]) => {
      const res = await fetch(`/api/users/${userId}/tasks/zip`, {
        method: "POST",
        headers: {
          ...getAuthHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ task_ids: taskIds }),
      });
      if (!res.ok) throw new Error("Gagal mengunduh ZIP");
      return res.blob();
    },
  },
  admin: {
    getOverview: () => request<any>("/api/admin/overview"),
    getCredits: (refresh: number = 0) => request<any>(`/api/admin/credits?refresh=${refresh}`),
    getDivisions: () => request<any>("/api/admin/divisions"),
    createDivision: (body: any) =>
      request<any>("/api/admin/divisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    updateDivisionModels: (id: string, body: any) =>
      request<any>(`/api/admin/divisions/${id}/models`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    getAccounts: () => request<any>("/api/admin/accounts"),
    createAccount: (body: any) =>
      request<any>("/api/admin/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    updateAccount: (id: string, body: any) =>
      request<any>(`/api/admin/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    deleteAccount: (id: string) =>
      request<any>(`/api/admin/accounts/${id}`, {
        method: "DELETE",
      }),
    testAccountKey: (id: string) =>
      request<any>(`/api/admin/accounts/${id}/test`, {
        method: "POST",
      }),
    makeAccountPrimary: (id: string) =>
      request<any>(`/api/admin/accounts/${id}/primary`, {
        method: "POST",
      }),
    getUsers: () => request<any>("/api/admin/users"),
    createUser: (body: any) =>
      request<any>("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    getResetCode: () => request<any>("/api/admin/reset-code"),
    rotateResetCode: () =>
      request<any>("/api/admin/reset-code/rotate", { method: "POST" }),
  },
};
