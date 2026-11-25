import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Clock,
  Cpu,
  FileText,
  LogOut,
  MessageSquare,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  User as UserIcon,
  X,
} from "lucide-react";
import { api, ApiClientError } from "../api/client";
import { formatDateTime, formatINR, formatLabel, formatShortDate } from "../utils/format";
import { BrandMark, StatusBadge } from "./BrandMark";

const ORDER_STEPS = ["processing", "shipped", "delivered"];

export function CustomerPortal({ user, onLogout }) {
  const [tab, setTab] = useState("overview");
  const [orders, setOrders] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [refunds, setRefunds] = useState([]);
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [ticketDetail, setTicketDetail] = useState(null);

  const [loadingInit, setLoadingInit] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [globalError, setGlobalError] = useState(null);
  const [bannerSuccess, setBannerSuccess] = useState(null);

  // Create ticket modal state
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [ticketOrderId, setTicketOrderId] = useState("");
  const [ticketCategory, setTicketCategory] = useState("Refund Request");
  const [ticketPriority, setTicketPriority] = useState("medium");
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketDescription, setTicketDescription] = useState("");
  const [submittingTicket, setSubmittingTicket] = useState(false);
  const [ticketFormError, setTicketFormError] = useState(null);

  // Direct refund modal state
  const [refundModalOrder, setRefundModalOrder] = useState(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundIdemKey, setRefundIdemKey] = useState("");
  const [submittingRefund, setSubmittingRefund] = useState(false);
  const [refundFormError, setRefundFormError] = useState(null);

  // Chat state
  const [chatInput, setChatInput] = useState("");
  const [sendingChat, setSendingChat] = useState(false);
  const [chatError, setChatError] = useState(null);

  const loadWorkspace = useCallback(async () => {
    setLoadingInit(true);
    setGlobalError(null);
    try {
      const [ordList, tktList, rfdList] = await Promise.all([
        api.listOrders(),
        api.listTickets(),
        api.listRefunds(),
      ]);
      setOrders(ordList);
      setTickets(tktList);
      setRefunds(rfdList);
      setSelectedTicketId((prev) => prev || (tktList[0]?.id ?? null));
    } catch (err) {
      setGlobalError(err instanceof ApiClientError ? err.message : "Failed to load account data.");
    } finally {
      setLoadingInit(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const loadTicketDetail = useCallback(async (ticketId) => {
    setLoadingDetail(true);
    setChatError(null);
    try {
      const detail = await api.getTicketDetail(ticketId);
      setTicketDetail(detail);
    } catch (err) {
      setChatError(err instanceof ApiClientError ? err.message : "Unable to load ticket conversation.");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedTicketId) {
      void loadTicketDetail(selectedTicketId);
    } else {
      setTicketDetail(null);
    }
  }, [selectedTicketId, loadTicketDetail]);

  const openTicketModalForOrder = (orderId) => {
    setTicketOrderId(orderId || "");
    setTicketCategory(orderId ? "Refund Request" : "Policy Inquiry");
    setTicketPriority("medium");
    setTicketSubject(orderId ? `Assistance with order ${orderId}` : "");
    setTicketDescription("");
    setTicketFormError(null);
    setShowTicketModal(true);
  };

  const openRefundModal = (order) => {
    setRefundModalOrder(order);
    setRefundAmount(String(order.total_amount));
    setRefundReason("");
    setRefundIdemKey(`ui-${order.id}-${Date.now()}`);
    setRefundFormError(null);
  };

  const handleCreateTicket = async (e) => {
    e.preventDefault();
    setTicketFormError(null);
    if (ticketSubject.trim().length < 3) {
      setTicketFormError("Subject must be at least 3 characters.");
      return;
    }
    if (ticketDescription.trim().length < 5) {
      setTicketFormError("Please describe your issue in at least 5 characters.");
      return;
    }

    setSubmittingTicket(true);
    try {
      const created = await api.createTicket({
        order_id: ticketOrderId || null,
        category: ticketCategory,
        priority: ticketPriority,
        subject: ticketSubject.trim(),
        description: ticketDescription.trim(),
      });
      setShowTicketModal(false);
      setBannerSuccess(`Ticket ${created.id} created. You can now chat with the AI Resolution Agent below.`);
      await loadWorkspace();
      setSelectedTicketId(created.id);
      setTab("desk");
    } catch (err) {
      setTicketFormError(err instanceof ApiClientError ? err.message : "Failed to create ticket.");
    } finally {
      setSubmittingTicket(false);
    }
  };

  const handleCreateRefund = async (e) => {
    e.preventDefault();
    if (!refundModalOrder) return;
    setRefundFormError(null);
    const parsed = Number(refundAmount);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > refundModalOrder.total_amount) {
      setRefundFormError(`Amount must be between ₹1 and ${formatINR(refundModalOrder.total_amount)}.`);
      return;
    }
    if (refundReason.trim().length < 3) {
      setRefundFormError("Please provide a brief reason for the refund request.");
      return;
    }

    setSubmittingRefund(true);
    try {
      const created = await api.createRefund({
        order_id: refundModalOrder.id,
        amount: parsed,
        reason: refundReason.trim(),
        idempotency_key: refundIdemKey,
      });
      setRefundModalOrder(null);
      setBannerSuccess(
        created.status === "pending_review"
          ? `Refund ${created.id} (${formatINR(created.amount)}) submitted and escalated for specialist approval.`
          : `Refund ${created.id} (${formatINR(created.amount)}) approved and processed.`
      );
      await loadWorkspace();
    } catch (err) {
      setRefundFormError(err instanceof ApiClientError ? err.message : "Refund submission failed.");
    } finally {
      setSubmittingRefund(false);
    }
  };

  const handleSendChat = async (e, presetText) => {
    e.preventDefault();
    if (!selectedTicketId) return;
    const text = (presetText ?? chatInput).trim();
    if (!text) return;

    setChatError(null);
    setSendingChat(true);
    try {
      await api.sendChatTurn(selectedTicketId, { content: text });
      if (!presetText) setChatInput("");
      await Promise.all([loadTicketDetail(selectedTicketId), loadWorkspace()]);
    } catch (err) {
      setChatError(err instanceof ApiClientError ? err.message : "Failed to send message.");
    } finally {
      setSendingChat(false);
    }
  };

  const metrics = useMemo(() => {
    const openTickets = tickets.filter((t) => ["open", "awaiting_customer", "escalated"].includes(t.status)).length;
    const processedRefundTotal = refunds
      .filter((r) => r.status === "processed" || r.status === "approved")
      .reduce((acc, r) => acc + r.amount, 0);
    const pendingRefundCount = refunds.filter((r) => r.status === "pending_review").length;
    return { openTickets, processedRefundTotal, pendingRefundCount };
  }, [tickets, refunds]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-lockup">
            <BrandMark size={34} />
            <div>
              <div className="brand-title">Kestrel</div>
              <div className="brand-subtitle">Customer Resolution Portal</div>
            </div>
          </div>

          <nav className="nav-tabs" aria-label="Customer Navigation">
            <button
              type="button"
              className={`nav-tab ${tab === "overview" ? "active" : ""}`}
              onClick={() => setTab("overview")}
            >
              <Package size={14} />
              Overview
            </button>
            <button
              type="button"
              className={`nav-tab ${tab === "orders" ? "active" : ""}`}
              onClick={() => setTab("orders")}
            >
              <RotateCcw size={14} />
              Orders &amp; Refunds
            </button>
            <button
              type="button"
              className={`nav-tab ${tab === "desk" ? "active" : ""}`}
              onClick={() => setTab("desk")}
            >
              <MessageSquare size={14} />
              Support Desk
              {metrics.openTickets > 0 && (
                <span className="badge badge-copper" style={{ padding: "1px 6px" }}>
                  {metrics.openTickets}
                </span>
              )}
            </button>
          </nav>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => openTicketModalForOrder()}
            >
              <Plus size={14} />
              New Ticket
            </button>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 10px",
                background: "var(--bg-inset)",
                borderRadius: 8,
                border: "1px solid var(--border-hairline)",
              }}
            >
              <UserIcon size={14} color="var(--ink-secondary)" />
              <span style={{ fontSize: 12, fontWeight: 600 }}>{user.name}</span>
              <span className="badge badge-slate" style={{ fontSize: 10 }}>
                Customer
              </span>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onLogout}>
              <LogOut size={13} />
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="page-container">
        {globalError && (
          <div className="alert alert-error" style={{ marginBottom: 18 }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1 }}>{globalError}</div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadWorkspace()}>
              Retry
            </button>
          </div>
        )}

        {bannerSuccess && (
          <div className="alert alert-success" style={{ marginBottom: 18 }}>
            <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1 }}>{bannerSuccess}</div>
            <button
              type="button"
              onClick={() => setBannerSuccess(null)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "inherit" }}
              aria-label="Dismiss notification"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {loadingInit ? (
          <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--ink-secondary)" }}>
            Loading your orders, tickets, and refund ledger...
          </div>
        ) : (
          <>
            {/* OVERVIEW TAB */}
            {tab === "overview" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <h1 className="font-serif" style={{ fontSize: 34, margin: 0, fontWeight: 400 }}>
                      Account Resolution Overview
                    </h1>
                    <p style={{ margin: "4px 0 0", color: "var(--ink-secondary)" }}>
                      Live order fulfillment status, category return windows, and automated or specialist refund tracking.
                    </p>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadWorkspace()}>
                    <RefreshCw size={13} />
                    Refresh Data
                  </button>
                </div>

                <section className="metric-grid">
                  <div className="card" style={{ padding: "18px 20px" }}>
                    <div style={{ fontSize: 12, color: "var(--ink-secondary)", fontWeight: 600 }}>Your Orders</div>
                    <div className="font-mono" style={{ fontSize: 28, fontWeight: 600, marginTop: 6 }}>
                      {orders.length}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 4 }}>
                      {orders.filter((o) => o.eligibility?.eligible_for_auto_refund).length} eligible for instant refund
                    </div>
                  </div>
                  <div className="card" style={{ padding: "18px 20px" }}>
                    <div style={{ fontSize: 12, color: "var(--ink-secondary)", fontWeight: 600 }}>Active Tickets</div>
                    <div className="font-mono" style={{ fontSize: 28, fontWeight: 600, marginTop: 6 }}>
                      {metrics.openTickets}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 4 }}>
                      {tickets.length} total conversations logged
                    </div>
                  </div>
                  <div className="card" style={{ padding: "18px 20px" }}>
                    <div style={{ fontSize: 12, color: "var(--ink-secondary)", fontWeight: 600 }}>Refunds Credited</div>
                    <div className="font-mono" style={{ fontSize: 28, fontWeight: 600, marginTop: 6 }}>
                      {formatINR(metrics.processedRefundTotal)}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 4 }}>
                      {metrics.pendingRefundCount} awaiting specialist review
                    </div>
                  </div>
                  <div className="card" style={{ padding: "18px 20px", background: "var(--bg-obsidian)", color: "var(--ink-inverse)" }}>
                    <div style={{ fontSize: 12, color: "#C5CBC4", fontWeight: 600 }}>Automated Approval Cap</div>
                    <div className="font-mono" style={{ fontSize: 28, fontWeight: 600, marginTop: 6 }}>
                      ₹5,000
                    </div>
                    <div style={{ fontSize: 12, color: "#ABB3AA", marginTop: 4 }}>
                      Higher values escalate to human review
                    </div>
                  </div>
                </section>

                <section className="two-col-grid">
                  {/* Recent Orders */}
                  <div className="card" style={{ padding: 22 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                      <h2 className="font-serif" style={{ fontSize: 22, margin: 0, fontWeight: 400 }}>
                        Recent Orders
                      </h2>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTab("orders")}>
                        View All
                        <ArrowUpRight size={13} />
                      </button>
                    </div>
                    {orders.length === 0 ? (
                      <div className="card-inset" style={{ padding: 24, textAlign: "center", color: "var(--ink-secondary)" }}>
                        No orders found on this account yet.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {orders.slice(0, 4).map((ord) => (
                          <div
                            key={ord.id}
                            className="card-inset"
                            style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                              <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span className="font-mono" style={{ fontWeight: 600, fontSize: 13 }}>
                                    {ord.id}
                                  </span>
                                  <span className="badge badge-slate">{ord.category}</span>
                                </div>
                                <div style={{ fontWeight: 600, marginTop: 4 }}>{ord.item_name}</div>
                              </div>
                              <div style={{ textAlign: "right" }}>
                                <div className="font-mono" style={{ fontWeight: 600 }}>
                                  {formatINR(ord.total_amount)}
                                </div>
                                <div style={{ marginTop: 4 }}>
                                  <StatusBadge value={ord.status} />
                                </div>
                              </div>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 12, color: "var(--ink-secondary)" }}>
                              <span>{ord.eligibility?.reason}</span>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => openTicketModalForOrder(ord.id)}
                              >
                                Get Help
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Recent Support Tickets */}
                  <div className="card" style={{ padding: 22 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                      <h2 className="font-serif" style={{ fontSize: 22, margin: 0, fontWeight: 400 }}>
                        Recent Support Threads
                      </h2>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => openTicketModalForOrder()}>
                        <Plus size={13} />
                        New Ticket
                      </button>
                    </div>
                    {tickets.length === 0 ? (
                      <div className="card-inset" style={{ padding: 24, textAlign: "center", color: "var(--ink-secondary)" }}>
                        No support tickets raised yet. Start a conversation with our AI Resolution Agent anytime.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {tickets.slice(0, 4).map((tkt) => (
                          <button
                            key={tkt.id}
                            type="button"
                            onClick={() => {
                              setSelectedTicketId(tkt.id);
                              setTab("desk");
                            }}
                            style={{
                              textAlign: "left",
                              width: "100%",
                              padding: "14px 16px",
                              borderRadius: 10,
                              border: "1px solid var(--border-hairline)",
                              background: "var(--bg-inset)",
                              cursor: "pointer",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                              <span className="font-mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-secondary)" }}>
                                {tkt.id} {tkt.order_id ? `· ${tkt.order_id}` : ""}
                              </span>
                              <StatusBadge value={tkt.status} />
                            </div>
                            <div style={{ fontWeight: 600, marginTop: 5, color: "var(--ink-primary)" }}>
                              {tkt.subject}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 4 }}>
                              Updated {formatDateTime(tkt.updated_at)}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}

            {/* ORDERS & REFUNDS TAB */}
            {tab === "orders" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                <div>
                  <h1 className="font-serif" style={{ fontSize: 32, margin: 0, fontWeight: 400 }}>
                    Orders &amp; Refund Progress
                  </h1>
                  <p style={{ margin: "4px 0 0", color: "var(--ink-secondary)" }}>
                    Inspect return window eligibility per order, submit refund requests, and track specialist decisions.
                  </p>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 16 }}>
                  {orders.map((ord) => {
                    const stepIdx = ORDER_STEPS.indexOf(ord.status);
                    const elig = ord.eligibility;
                    return (
                      <article key={ord.id} className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span className="font-mono" style={{ fontWeight: 600, fontSize: 14 }}>
                                {ord.id}
                              </span>
                              <span className="badge badge-slate">{ord.category}</span>
                            </div>
                            <h3 style={{ margin: "6px 0 2px", fontSize: 16 }}>{ord.item_name}</h3>
                            <div style={{ fontSize: 12, color: "var(--ink-secondary)" }}>
                              Ordered {formatShortDate(ord.created_at)}
                              {ord.delivery_date ? ` · Delivered ${formatShortDate(ord.delivery_date)}` : " · In transit"}
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div className="font-mono" style={{ fontSize: 17, fontWeight: 600 }}>
                              {formatINR(ord.total_amount)}
                            </div>
                            <div style={{ marginTop: 4 }}>
                              <StatusBadge value={ord.status} />
                            </div>
                          </div>
                        </div>

                        {/* Delivery Progress Stepper */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                          {ORDER_STEPS.map((st, idx) => {
                            const active = stepIdx >= idx;
                            return (
                              <div key={st}>
                                <div
                                  style={{
                                    height: 4,
                                    borderRadius: 99,
                                    background: active ? "var(--status-pine)" : "var(--border-hairline)",
                                    marginBottom: 4,
                                  }}
                                />
                                <div
                                  style={{
                                    fontSize: 10,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.06em",
                                    fontWeight: active ? 700 : 500,
                                    color: active ? "var(--status-pine)" : "var(--ink-muted)",
                                  }}
                                >
                                  {formatLabel(st)}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Policy Window Assessment */}
                        {elig && (
                          <div
                            className="card-inset"
                            style={{
                              padding: "10px 12px",
                              fontSize: 12,
                              color: "var(--ink-secondary)",
                              display: "flex",
                              flexDirection: "column",
                              gap: 4,
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, color: "var(--ink-primary)" }}>
                              <span>{ord.category} Policy ({elig.return_window_days}-day window)</span>
                              <span>
                                {elig.within_return_window
                                  ? `${elig.days_remaining}d left`
                                  : ord.status === "delivered"
                                    ? "Window Expired"
                                    : "Not Delivered"}
                              </span>
                            </div>
                            <span>{elig.reason}</span>
                          </div>
                        )}

                        <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            style={{ flex: 1 }}
                            disabled={ord.status !== "delivered" || Boolean(elig?.has_existing_refund)}
                            onClick={() => openRefundModal(ord)}
                          >
                            <RotateCcw size={13} />
                            {elig?.has_existing_refund
                              ? `Refund: ${formatLabel(elig.existing_refund_status || "")}`
                              : "Request Refund"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => openTicketModalForOrder(ord.id)}
                          >
                            <MessageSquare size={13} />
                            Support Chat
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>

                {/* Refund Ledger */}
                <div className="card" style={{ padding: 22 }}>
                  <h2 className="font-serif" style={{ fontSize: 22, margin: "0 0 14px", fontWeight: 400 }}>
                    Refund Ledger
                  </h2>
                  {refunds.length === 0 ? (
                    <div className="card-inset" style={{ padding: 24, textAlign: "center", color: "var(--ink-secondary)" }}>
                      No refund requests submitted yet.
                    </div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid var(--border-hairline)", textAlign: "left", color: "var(--ink-secondary)" }}>
                            <th style={{ padding: "10px 8px" }}>Refund ID</th>
                            <th style={{ padding: "10px 8px" }}>Order</th>
                            <th style={{ padding: "10px 8px" }}>Amount</th>
                            <th style={{ padding: "10px 8px" }}>Status</th>
                            <th style={{ padding: "10px 8px" }}>Resolution Note</th>
                            <th style={{ padding: "10px 8px" }}>Created</th>
                          </tr>
                        </thead>
                        <tbody>
                          {refunds.map((rfd) => (
                            <tr key={rfd.id} style={{ borderBottom: "1px solid var(--border-hairline)" }}>
                              <td className="font-mono" style={{ padding: "12px 8px", fontWeight: 600 }}>{rfd.id}</td>
                              <td className="font-mono" style={{ padding: "12px 8px" }}>{rfd.order_id}</td>
                              <td className="font-mono" style={{ padding: "12px 8px", fontWeight: 600 }}>{formatINR(rfd.amount)}</td>
                              <td style={{ padding: "12px 8px" }}><StatusBadge value={rfd.status} /></td>
                              <td style={{ padding: "12px 8px", color: "var(--ink-secondary)", maxWidth: 340 }}>
                                {rfd.decision_note || rfd.reason}
                              </td>
                              <td style={{ padding: "12px 8px", color: "var(--ink-muted)", whiteSpace: "nowrap" }}>
                                {formatDateTime(rfd.created_at)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SUPPORT DESK TAB */}
            {tab === "desk" && (
              <div className="ticket-workbench">
                {/* Ticket List Sidebar */}
                <aside className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h2 className="font-serif" style={{ fontSize: 22, margin: 0, fontWeight: 400 }}>
                      Your Tickets
                    </h2>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => openTicketModalForOrder()}>
                      <Plus size={13} />
                      Raise
                    </button>
                  </div>

                  {tickets.length === 0 ? (
                    <div className="card-inset" style={{ padding: 20, textAlign: "center", color: "var(--ink-secondary)", fontSize: 13 }}>
                      No tickets yet. Create a support ticket to begin chatting with Kestrel AI.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", maxHeight: 580 }}>
                      {tickets.map((tkt) => {
                        const active = tkt.id === selectedTicketId;
                        return (
                          <button
                            key={tkt.id}
                            type="button"
                            onClick={() => setSelectedTicketId(tkt.id)}
                            style={{
                              textAlign: "left",
                              padding: "12px 13px",
                              borderRadius: 10,
                              border: active ? "1px solid var(--accent-copper)" : "1px solid var(--border-hairline)",
                              background: active ? "var(--accent-copper-soft)" : "var(--bg-surface)",
                              cursor: "pointer",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                              <span className="font-mono" style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-secondary)" }}>
                                {tkt.id}
                              </span>
                              <StatusBadge value={tkt.status} />
                            </div>
                            <div style={{ fontWeight: 600, fontSize: 13, marginTop: 5, color: "var(--ink-primary)" }}>
                              {tkt.subject}
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--ink-muted)", marginTop: 6 }}>
                              <span>{tkt.order_id || "No order linked"}</span>
                              <span>{formatShortDate(tkt.updated_at)}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </aside>

                {/* Conversation Thread & AI Agent Studio */}
                <section className="card" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  {!selectedTicketId ? (
                    <div style={{ padding: 48, textAlign: "center", color: "var(--ink-secondary)", margin: "auto" }}>
                      Select an existing ticket on the left or raise a new support ticket to chat with Kestrel AI.
                    </div>
                  ) : loadingDetail && !ticketDetail ? (
                    <div style={{ padding: 48, textAlign: "center", color: "var(--ink-secondary)", margin: "auto" }}>
                      Loading conversation history...
                    </div>
                  ) : ticketDetail ? (
                    <>
                      {/* Ticket Header */}
                      <div
                        style={{
                          padding: "16px 20px",
                          borderBottom: "1px solid var(--border-hairline)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          flexWrap: "wrap",
                          gap: 12,
                          background: "var(--bg-surface)",
                        }}
                      >
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span className="font-mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-secondary)" }}>
                              {ticketDetail.id}
                            </span>
                            <StatusBadge value={ticketDetail.status} />
                            <StatusBadge value={ticketDetail.priority} prefix="Priority" />
                            <span className="badge badge-slate">{ticketDetail.category}</span>
                          </div>
                          <h2 style={{ margin: "6px 0 0", fontSize: 18 }}>{ticketDetail.subject}</h2>
                        </div>

                        {ticketDetail.order && (
                          <div
                            className="card-inset"
                            style={{ padding: "8px 12px", fontSize: 12, minWidth: 230 }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                              <span className="font-mono">{ticketDetail.order.id}</span>
                              <span className="font-mono">{formatINR(ticketDetail.order.total_amount)}</span>
                            </div>
                            <div style={{ color: "var(--ink-secondary)", marginTop: 2 }}>
                              {ticketDetail.order.item_name}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Linked Refund / Escalation Status Bar */}
                      {(ticketDetail.refunds.length > 0 || ticketDetail.escalations.length > 0) && (
                        <div
                          style={{
                            padding: "10px 20px",
                            background: "var(--bg-inset)",
                            borderBottom: "1px solid var(--border-hairline)",
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 12,
                            fontSize: 12,
                          }}
                        >
                          {ticketDetail.refunds.map((r) => (
                            <div key={r.id} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                              <RotateCcw size={13} />
                              <span className="font-mono" style={{ fontWeight: 600 }}>{r.id}</span>
                              <span>{formatINR(r.amount)}</span>
                              <StatusBadge value={r.status} />
                            </div>
                          ))}
                          {ticketDetail.escalations.map((esc) => (
                            <div key={esc.id} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                              <ShieldAlert size={13} color="var(--status-ochre)" />
                              <span className="font-mono" style={{ fontWeight: 600 }}>{esc.id}</span>
                              <StatusBadge value={esc.decision} prefix="Escalation" />
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Messages Thread */}
                      <div
                        style={{
                          flex: 1,
                          padding: 20,
                          overflowY: "auto",
                          maxHeight: 430,
                          display: "flex",
                          flexDirection: "column",
                          gap: 14,
                          background: "#F5F1E7",
                        }}
                      >
                        {ticketDetail.messages.map((msg) => {
                          const isCustomer = msg.sender_type === "customer";
                          const isStaff = msg.sender_type === "support_agent";
                          const tools = msg.metadata_json?.tools_used || [];
                          const guardrail = msg.metadata_json?.guardrail_triggered;

                          return (
                            <div
                              key={msg.id}
                              style={{
                                alignSelf: isCustomer ? "flex-end" : "flex-start",
                                maxWidth: "82%",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: isCustomer ? "flex-end" : "flex-start",
                                gap: 4,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                  fontSize: 11,
                                  color: "var(--ink-secondary)",
                                  fontWeight: 600,
                                }}
                              >
                                {isCustomer ? (
                                  <>
                                    <UserIcon size={12} />
                                    <span>You</span>
                                  </>
                                ) : isStaff ? (
                                  <>
                                    <ShieldCheck size={12} color="var(--status-pine)" />
                                    <span>{msg.metadata_json?.staff_name || "Support Specialist"}</span>
                                  </>
                                ) : (
                                  <>
                                    <Bot size={12} color="var(--accent-copper)" />
                                    <span>Kestrel AI Resolution Agent</span>
                                  </>
                                )}
                                <span style={{ fontWeight: 400, color: "var(--ink-muted)" }}>
                                  {formatDateTime(msg.created_at)}
                                </span>
                              </div>

                              <div
                                style={{
                                  padding: "11px 14px",
                                  borderRadius: 12,
                                  whiteSpace: "pre-wrap",
                                  fontSize: 13.5,
                                  lineHeight: 1.55,
                                  background: isCustomer
                                    ? "var(--bg-obsidian)"
                                    : isStaff
                                      ? "var(--status-pine-soft)"
                                      : "var(--bg-surface)",
                                  color: isCustomer ? "var(--ink-inverse)" : "var(--ink-primary)",
                                  border: isCustomer
                                    ? "1px solid var(--bg-obsidian)"
                                    : isStaff
                                      ? "1px solid #C6DFD2"
                                      : "1px solid var(--border-hairline)",
                                }}
                              >
                                {msg.content}
                              </div>

                              {(tools.length > 0 || guardrail) && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
                                  {tools.map((tool, i) => (
                                    <span
                                      key={`${tool}-${i}`}
                                      className="font-mono"
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 4,
                                        fontSize: 10,
                                        padding: "2px 7px",
                                        borderRadius: 4,
                                        background: "var(--bg-inset)",
                                        border: "1px solid var(--border-hairline)",
                                        color: "var(--ink-secondary)",
                                      }}
                                    >
                                      <Cpu size={10} />
                                      {tool}
                                    </span>
                                  ))}
                                  {guardrail && (
                                    <span className="badge badge-crimson" style={{ fontSize: 10 }}>
                                      Guardrail: {formatLabel(guardrail)}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Suggested Prompts & Input Composer */}
                      <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border-hairline)", background: "var(--bg-surface)" }}>
                        {chatError && (
                          <div className="alert alert-error" style={{ marginBottom: 10, padding: "8px 12px" }}>
                            <AlertCircle size={15} />
                            <span>{chatError}</span>
                          </div>
                        )}

                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                          {[
                            "Please check eligibility and process a refund for my order",
                            "What is the return policy for this item?",
                            "Connect me with a human support specialist",
                          ].map((prompt) => (
                            <button
                              key={prompt}
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={sendingChat}
                              onClick={(e) => void handleSendChat(e, prompt)}
                              style={{ fontSize: 11, padding: "4px 10px" }}
                            >
                              {prompt}
                            </button>
                          ))}
                        </div>

                        <form onSubmit={(e) => void handleSendChat(e)} style={{ display: "flex", gap: 10 }}>
                          <input
                            className="input"
                            placeholder="Message the AI Support Agent (mention an Order ID like ORD-1041)..."
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            disabled={sendingChat}
                          />
                          <button type="submit" className="btn btn-primary" disabled={sendingChat || !chatInput.trim()}>
                            {sendingChat ? <Clock size={14} /> : <Send size={14} />}
                            {sendingChat ? "Processing..." : "Send"}
                          </button>
                        </form>
                      </div>
                    </>
                  ) : null}
                </section>
              </div>
            )}
          </>
        )}
      </main>

      {/* Create Ticket Modal */}
      {showTicketModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(21, 22, 20, 0.48)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div className="card" style={{ width: "100%", maxWidth: 500, padding: 24, boxShadow: "var(--shadow-elevated)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 className="font-serif" style={{ fontSize: 24, margin: 0, fontWeight: 400 }}>
                Raise a Support Ticket
              </h2>
              <button
                type="button"
                onClick={() => setShowTicketModal(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-secondary)" }}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            {ticketFormError && (
              <div className="alert alert-error" style={{ marginBottom: 14 }}>
                <AlertCircle size={15} />
                <span>{ticketFormError}</span>
              </div>
            )}

            <form onSubmit={handleCreateTicket} style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              <div className="two-col-grid" style={{ gap: 12 }}>
                <div>
                  <label className="field-label" htmlFor="tkt-category">Category</label>
                  <select
                    id="tkt-category"
                    className="select"
                    value={ticketCategory}
                    onChange={(e) => setTicketCategory(e.target.value)}
                  >
                    <option value="Refund Request">Refund Request</option>
                    <option value="Damaged Item">Damaged Item</option>
                    <option value="Delivery Issue">Delivery Issue</option>
                    <option value="Policy Inquiry">Policy Inquiry</option>
                    <option value="Account & Billing">Account &amp; Billing</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="tkt-priority">Priority</label>
                  <select
                    id="tkt-priority"
                    className="select"
                    value={ticketPriority}
                    onChange={(e) => setTicketPriority(e.target.value)}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor="tkt-order">Linked Order (Optional)</label>
                <select
                  id="tkt-order"
                  className="select"
                  value={ticketOrderId}
                  onChange={(e) => setTicketOrderId(e.target.value)}
                >
                  <option value="">No specific order selected</option>
                  {orders.map((ord) => (
                    <option key={ord.id} value={ord.id}>
                      {ord.id} — {ord.item_name} ({formatINR(ord.total_amount)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="field-label" htmlFor="tkt-subject">Subject</label>
                <input
                  id="tkt-subject"
                  className="input"
                  placeholder="Concise summary of the issue"
                  value={ticketSubject}
                  onChange={(e) => setTicketSubject(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="field-label" htmlFor="tkt-desc">Description</label>
                <textarea
                  id="tkt-desc"
                  className="textarea"
                  rows={4}
                  placeholder="Provide details so our AI agent or specialist can assist quickly..."
                  value={ticketDescription}
                  onChange={(e) => setTicketDescription(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowTicketModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submittingTicket}>
                  <FileText size={14} />
                  {submittingTicket ? "Submitting..." : "Create Ticket"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Direct Refund Modal */}
      {refundModalOrder && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(21, 22, 20, 0.48)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div className="card" style={{ width: "100%", maxWidth: 460, padding: 24, boxShadow: "var(--shadow-elevated)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2 className="font-serif" style={{ fontSize: 24, margin: 0, fontWeight: 400 }}>
                Request Refund · {refundModalOrder.id}
              </h2>
              <button
                type="button"
                onClick={() => setRefundModalOrder(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-secondary)" }}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            {refundModalOrder.total_amount > 5000 && (
              <div className="alert alert-info" style={{ marginBottom: 14 }}>
                <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  Orders above ₹5,000.00 require specialist approval. Submitting this form will create a pending
                  refund and escalate the case automatically.
                </span>
              </div>
            )}

            {refundFormError && (
              <div className="alert alert-error" style={{ marginBottom: 14 }}>
                <AlertCircle size={15} />
                <span>{refundFormError}</span>
              </div>
            )}

            <form onSubmit={handleCreateRefund} style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              <div>
                <label className="field-label" htmlFor="rfd-amount">Refund Amount (INR)</label>
                <input
                  id="rfd-amount"
                  className="input font-mono"
                  type="number"
                  step="0.01"
                  max={refundModalOrder.total_amount}
                  min={1}
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="field-label" htmlFor="rfd-reason">Reason for Return / Refund</label>
                <textarea
                  id="rfd-reason"
                  className="textarea"
                  rows={3}
                  placeholder="Describe defect, damage, or return reason..."
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  required
                />
              </div>

              <div style={{ fontSize: 11, color: "var(--ink-muted)" }} className="font-mono">
                Idempotency Key: {refundIdemKey}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setRefundModalOrder(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submittingRefund}>
                  {submittingRefund ? "Validating on Server..." : "Submit Refund Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
