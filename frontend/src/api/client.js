const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const TOKEN_KEY = "kestrel_auth_token";

export class ApiClientError extends Error {
  constructor(message, status, code = "api_error") {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function request(path, options = {}) {
  const token = getStoredToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new ApiClientError(
      "Unable to reach the Kestrel API server. Please ensure the backend service is running.",
      0,
      "network_error"
    );
  }

  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    const errMsg =
      body?.error?.message ||
      body?.detail ||
      `Request failed with status ${response.status}.`;
    const errCode = body?.error?.code || "http_error";
    throw new ApiClientError(errMsg, response.status, errCode);
  }

  return body;
}

export const api = {
  register(payload) {
    return request("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  login(payload) {
    return request("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  logout() {
    return request("/auth/logout", { method: "POST" });
  },
  me() {
    return request("/auth/me");
  },
  listOrders() {
    return request("/orders");
  },
  getOrder(orderId) {
    return request(`/orders/${encodeURIComponent(orderId)}`);
  },
  listTickets(params) {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.priority) qs.set("priority", params.priority);
    if (params?.search) qs.set("search", params.search);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/tickets${suffix}`);
  },
  createTicket(payload) {
    return request("/tickets", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getTicketDetail(ticketId) {
    return request(`/tickets/${encodeURIComponent(ticketId)}`);
  },
  updateTicketStatus(ticketId, payload) {
    return request(`/tickets/${encodeURIComponent(ticketId)}/status`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  sendChatTurn(ticketId, payload) {
    return request(`/tickets/${encodeURIComponent(ticketId)}/chat`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  sendStaffReply(ticketId, payload) {
    return request(`/tickets/${encodeURIComponent(ticketId)}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  addInternalNote(ticketId, payload) {
    return request(`/tickets/${encodeURIComponent(ticketId)}/notes`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  listRefunds() {
    return request("/refunds");
  },
  createRefund(payload) {
    return request("/refunds", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  decideRefund(refundId, payload) {
    return request(`/refunds/${encodeURIComponent(refundId)}/decision`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  listEscalations(decision) {
    const suffix = decision ? `?decision=${encodeURIComponent(decision)}` : "";
    return request(`/escalations${suffix}`);
  },
  decideEscalation(escalationId, payload) {
    return request(`/escalations/${encodeURIComponent(escalationId)}/decision`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  listAuditLogs(limit = 100) {
    return request(`/audit-logs?limit=${limit}`);
  },
  getPolicies() {
    return request("/policies");
  },
  searchPolicies(query) {
    return request(`/policies/search?q=${encodeURIComponent(query)}`);
  },
};
