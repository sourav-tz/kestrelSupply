import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Bot,
  Clock,
  Cpu,
  FileText,
  Headphones,
  Home,
  IndianRupee,
  Info,
  MessageSquare,
  Package,
  Plus,
  RotateCcw,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  User as UserIcon,
  X,
} from "lucide-react";
import { api, ApiClientError } from "../api/client";
import { formatDateTime, formatINR, formatLabel, formatShortDate } from "../utils/format";
import { BrandMark, StatusBadge } from "./BrandMark";
import { useToast } from "./ToastProvider";

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
  const [sessionTimestamp] = useState(() => new Date().toISOString());
  const toast = useToast();

  // Create ticket modal state
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [ticketOrderId, setTicketOrderId] = useState("");
  const [ticketCategory, setTicketCategory] = useState("Refund Request");
  const [ticketPriority, setTicketPriority] = useState("medium");
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketDescription, setTicketDescription] = useState("");
  const [submittingTicket, setSubmittingTicket] = useState(false);

  // Direct refund modal state
  const [refundModalOrder, setRefundModalOrder] = useState(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundIdemKey, setRefundIdemKey] = useState("");
  const [submittingRefund, setSubmittingRefund] = useState(false);

  // Chat state
  const [chatInput, setChatInput] = useState("");
  const [sendingChat, setSendingChat] = useState(false);
  const [pendingUserText, setPendingUserText] = useState(null);
  const chatStreamRef = useRef(null);
  const chatInputRef = useRef(null);

  const scrollChatToBottom = useCallback(() => {
    const el = chatStreamRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const loadWorkspace = useCallback(async () => {
    setLoadingInit(true);
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
      toast.error(err instanceof ApiClientError ? err.message : "Failed to load account data.", "Load Error");
    } finally {
      setLoadingInit(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const loadTicketDetail = useCallback(async (ticketId) => {
    setLoadingDetail(true);
    try {
      const detail = await api.getTicketDetail(ticketId);
      setTicketDetail(detail);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Unable to load ticket conversation.", "Ticket Error");
    } finally {
      setLoadingDetail(false);
    }
  }, [toast]);

  useEffect(() => {
    if (selectedTicketId) {
      void loadTicketDetail(selectedTicketId);
    } else {
      setTicketDetail(null);
    }
  }, [selectedTicketId, loadTicketDetail]);

  useEffect(() => {
    if (tab === "desk") {
      const raf = requestAnimationFrame(() => scrollChatToBottom());
      return () => cancelAnimationFrame(raf);
    }
    return undefined;
  }, [tab, selectedTicketId, ticketDetail?.id, ticketDetail?.messages?.length, pendingUserText, sendingChat, scrollChatToBottom]);

  const openTicketModalForOrder = (orderId) => {
    setTicketOrderId(orderId || "");
    setTicketCategory(orderId ? "Refund Request" : "Policy Inquiry");
    setTicketPriority("medium");
    setTicketSubject(orderId ? `Assistance with order ${orderId}` : "");
    setTicketDescription("");
    setShowTicketModal(true);
  };

  const openRefundModal = (order) => {
    setRefundModalOrder(order);
    setRefundAmount(String(order.total_amount));
    setRefundReason("");
    setRefundIdemKey(`ui-${order.id}-${Date.now()}`);
  };

  const handleCreateTicket = async (e) => {
    e.preventDefault();
    if (ticketSubject.trim().length < 3) {
      toast.error("Subject must be at least 3 characters.", "Validation");
      return;
    }
    if (ticketDescription.trim().length < 5) {
      toast.error("Please describe your issue in at least 5 characters.", "Validation");
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
        auto_reply: true,
      });
      setShowTicketModal(false);
      toast.success(`Ticket ${created.id} created. You can now chat with the AI agent.`, "Ticket Created");
      await loadWorkspace();
      setSelectedTicketId(created.id);
      setTab("desk");
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Failed to create ticket.", "Ticket Error");
    } finally {
      setSubmittingTicket(false);
    }
  };

  const handleCreateRefund = async (e) => {
    e.preventDefault();
    if (!refundModalOrder) return;
    const parsed = Number(refundAmount);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > refundModalOrder.total_amount) {
      toast.error(`Amount must be between ₹1 and ${formatINR(refundModalOrder.total_amount)}.`, "Invalid Amount");
      return;
    }
    if (refundReason.trim().length < 3) {
      toast.error("Please provide a brief reason for the refund request.", "Validation");
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
      if (created.status === "pending_review") {
        toast.info(
          `Refund ${created.id} (${formatINR(created.amount)}) escalated for specialist approval.`,
          "Escalated for Review"
        );
      } else {
        toast.success(
          `Refund ${created.id} (${formatINR(created.amount)}) approved and processed.`,
          "Refund Processed"
        );
      }
      await loadWorkspace();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Refund submission failed.", "Refund Error");
    } finally {
      setSubmittingRefund(false);
    }
  };

  const handleSendChat = async (e, presetText) => {
    e.preventDefault();
    if (!selectedTicketId || sendingChat) return;
    const text = (presetText ?? chatInput).trim();
    if (!text) return;

    if (!presetText) setChatInput("");
    setPendingUserText(text);
    setSendingChat(true);
    try {
      const turn = await api.sendChatTurn(selectedTicketId, { content: text });
      if (turn.guardrail_triggered) {
        toast.error("Policy guardrail triggered. Request blocked by server rules.", "Security Guardrail");
      } else if (turn.refund_created?.status === "processed") {
        toast.success(
          `Refund ${turn.refund_created.id} (${formatINR(turn.refund_created.amount)}) processed.`,
          "Refund Approved"
        );
      } else if (turn.escalation_created) {
        toast.info(
          `Escalation ${turn.escalation_created.id} created for specialist approval.`,
          "Escalated"
        );
      }
      await Promise.all([loadTicketDetail(selectedTicketId), loadWorkspace()]);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Failed to send message.", "Chat Error");
      if (!presetText) setChatInput(text);
    } finally {
      setPendingUserText(null);
      setSendingChat(false);
      requestAnimationFrame(() => {
        scrollChatToBottom();
        chatInputRef.current?.focus();
      });
    }
  };

  const metrics = useMemo(() => {
    const openTickets = tickets.filter((t) => ["open", "awaiting_customer", "escalated"].includes(t.status)).length;
    const processedRefundTotal = refunds
      .filter((r) => r.status === "processed" || r.status === "approved")
      .reduce((acc, r) => acc + r.amount, 0);
    const pendingRefundCount = refunds.filter((r) => r.status === "pending_review").length;
    const capPercent = Math.min(100, Math.round((processedRefundTotal / 5000) * 100));
    return { openTickets, processedRefundTotal, pendingRefundCount, capPercent };
  }, [tickets, refunds]);

  const firstName = useMemo(() => user.name?.split(" ")[0] || user.name || "Customer", [user.name]);

  return (
    <div className="app-shell">
      {/* Deep Botanical Top Navigation Bar */}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-lockup">
            <BrandMark size={34} />
            <div className="brand-title">Kestrel</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => openTicketModalForOrder()}
            >
              <Plus size={14} />
              New Ticket
            </button>
            <button
              type="button"
              onClick={() => setTab("settings")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 11px",
                background: "rgba(247, 243, 234, 0.08)",
                color: "#F7F3EA",
                borderRadius: 8,
                border: "1px solid rgba(247, 243, 234, 0.18)",
                cursor: "pointer",
              }}
            >
              <UserIcon size={14} color="#DF6B3E" />
              <span style={{ fontSize: 12, fontWeight: 600 }}>{user.name}</span>
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onLogout}>
              Log Out
            </button>
          </div>
        </div>
      </header>

      {/* Left Sidebar + Main Workspace */}
      <div className="portal-layout">
        <aside className="portal-sidebar" aria-label="Workspace Sections">
          <nav className="portal-sidebar-nav">
            {[
              { id: "overview", label: "Dashboard", icon: Home },
              { id: "orders", label: "My Orders", icon: Package },
              { id: "desk", label: "Support Tickets", icon: MessageSquare },
              { id: "refunds", label: "Refunds", icon: IndianRupee },
              { id: "settings", label: "Account Settings", icon: Settings },
            ].map((item) => {
              const IconComp = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`sidebar-item ${active ? "active" : ""}`}
                  onClick={() => setTab(item.id)}
                >
                  <IconComp size={16} />
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.id === "desk" && metrics.openTickets > 0 && (
                    <span className="badge badge-copper" style={{ padding: "1px 6px" }}>
                      {metrics.openTickets}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div
            className="portal-sidebar-divider"
            style={{ height: 1, background: "var(--border-hairline)", margin: "20px 6px 22px", position: "relative", zIndex: 2 }}
          />

          <div className="portal-sidebar-help" style={{ position: "relative", zIndex: 2 }}>
            <div
              style={{
                background: "#EDEAE0",
                border: "1px solid #E0DBD0",
                borderRadius: 14,
                padding: "22px 14px",
                textAlign: "center",
              }}
            >
              <div style={{ display: "inline-flex", marginBottom: 8 }}>
                <Headphones size={24} strokeWidth={1.8} color="var(--ink-primary)" />
              </div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "var(--ink-primary)" }}>
                Need Help?
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--ink-secondary)",
                  margin: "5px auto 16px",
                  lineHeight: 1.45,
                  maxWidth: 160,
                }}
              >
                Our support team is here to help you.
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{
                  borderRadius: 999,
                  padding: "8px 16px",
                  background: "#FAF8F3",
                  borderColor: "#CBC4B3",
                  fontWeight: 600,
                }}
                onClick={() => setTab("desk")}
              >
                Contact Support
                <ArrowRight size={13} />
              </button>
            </div>
          </div>

          {/* Smooth Botanical Sage Waves at Bottom */}
          <svg
            className="portal-sidebar-wave"
            viewBox="0 0 224 110"
            preserveAspectRatio="none"
            fill="none"
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              bottom: 0,
              width: "100%",
              height: 110,
              pointerEvents: "none",
              zIndex: 1,
            }}
          >
            <path
              d="M0 18C68 24 136 56 224 94V110H0V18Z"
              fill="rgba(164, 178, 166, 0.28)"
            />
            <path
              d="M0 44C76 58 148 86 224 106V110H0V44Z"
              fill="rgba(148, 165, 150, 0.24)"
            />
          </svg>
        </aside>

        <main className="portal-main">
          {loadingInit ? (
            <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--ink-secondary)" }}>
              Loading your orders, tickets, and refund ledger...
            </div>
          ) : (
            <>
              {/* DASHBOARD / OVERVIEW TAB */}
              {tab === "overview" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
                  {/* Welcome Header Row */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                      gap: 12,
                    }}
                  >
                    <div>
                      <h1
                        style={{
                          fontSize: 30,
                          fontWeight: 800,
                          margin: 0,
                          letterSpacing: "-0.02em",
                          color: "var(--ink-primary)",
                        }}
                      >
                        Welcome back, {firstName}!
                      </h1>
                      <p style={{ margin: "4px 0 0", color: "var(--ink-secondary)", fontSize: 14 }}>
                        Here&apos;s what&apos;s happening with your account.
                      </p>
                    </div>
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 7,
                        fontSize: 12.5,
                        color: "var(--ink-secondary)",
                        fontWeight: 600,
                        paddingTop: 6,
                      }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: "var(--status-pine)",
                          display: "inline-block",
                        }}
                      />
                      <span>Session active: {formatDateTime(sessionTimestamp)}</span>
                    </div>
                  </div>

                  {/* 4 KPI Cards Row */}
                  <section className="metric-grid">
                    {/* Featured Dark Card: Your Orders */}
                    <div
                      className="card"
                      style={{
                        padding: "18px 20px",
                        background: "linear-gradient(145deg, #1E2C25 0%, #26382F 100%)",
                        borderColor: "#2C3E35",
                        color: "#FAF7F0",
                        display: "flex",
                        alignItems: "center",
                        gap: 15,
                      }}
                    >
                      <div
                        style={{
                          width: 52,
                          height: 52,
                          borderRadius: "50%",
                          background: "rgba(250, 247, 240, 0.1)",
                          border: "1px solid rgba(250, 247, 240, 0.14)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <ShoppingBag size={22} color="#FAF7F0" />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, color: "#C8D0C8", fontWeight: 600 }}>
                          Your Orders
                        </div>
                        <div className="font-mono" style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.15, marginTop: 2 }}>
                          {orders.length}
                        </div>
                        <button
                          type="button"
                          onClick={() => setTab("orders")}
                          style={{
                            marginTop: 6,
                            padding: 0,
                            border: "none",
                            background: "transparent",
                            color: "#E4EAE4",
                            fontSize: 12,
                            fontWeight: 600,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            cursor: "pointer",
                          }}
                        >
                          View Orders
                          <ArrowRight size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Card 2: Active Tickets */}
                    <div
                      className="card"
                      style={{
                        padding: "18px 20px",
                        display: "flex",
                        alignItems: "center",
                        gap: 15,
                      }}
                    >
                      <div
                        style={{
                          width: 52,
                          height: 52,
                          borderRadius: "50%",
                          background: "#EBF0ED",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <MessageSquare size={21} color="var(--ink-primary)" />
                      </div>
                      <div>
                        <div style={{ fontSize: 12.5, color: "var(--ink-secondary)", fontWeight: 600 }}>
                          Active Tickets
                        </div>
                        <div className="font-mono" style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.15, marginTop: 2 }}>
                          {metrics.openTickets}
                        </div>
                        <button
                          type="button"
                          onClick={() => setTab("desk")}
                          style={{
                            marginTop: 6,
                            padding: 0,
                            border: "none",
                            background: "transparent",
                            color: "var(--ink-primary)",
                            fontSize: 12,
                            fontWeight: 600,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            cursor: "pointer",
                          }}
                        >
                          View Tickets
                          <ArrowRight size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Card 3: Refunds Credited */}
                    <div
                      className="card"
                      style={{
                        padding: "18px 20px",
                        display: "flex",
                        alignItems: "center",
                        gap: 15,
                      }}
                    >
                      <div
                        style={{
                          width: 52,
                          height: 52,
                          borderRadius: "50%",
                          background: "#EBF0ED",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <IndianRupee size={21} color="var(--ink-primary)" />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, color: "var(--ink-secondary)", fontWeight: 600 }}>
                          Refunds Credited
                        </div>
                        <div className="font-mono" style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.2, marginTop: 2 }}>
                          {formatINR(metrics.processedRefundTotal)}
                        </div>
                        <button
                          type="button"
                          onClick={() => setTab("refunds")}
                          style={{
                            marginTop: 6,
                            padding: 0,
                            border: "none",
                            background: "transparent",
                            color: "var(--ink-primary)",
                            fontSize: 12,
                            fontWeight: 600,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            cursor: "pointer",
                          }}
                        >
                          View Details
                          <ArrowRight size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Card 4: Approval Cap */}
                    <div
                      className="card"
                      style={{
                        padding: "18px 20px",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                        <div
                          style={{
                            width: 46,
                            height: 46,
                            borderRadius: "50%",
                            background: "#E9F2ED",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <ShieldCheck size={20} color="var(--status-pine)" />
                        </div>
                        <div>
                          <div style={{ fontSize: 12.5, color: "var(--ink-secondary)", fontWeight: 600 }}>
                            Approval Cap
                          </div>
                          <div
                            className="font-mono"
                            style={{
                              fontSize: 24,
                              fontWeight: 800,
                              lineHeight: 1.15,
                              marginTop: 2,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <span>₹5,000</span>
                            <span title="Eligible refunds up to ₹5,000 auto-process; higher claims escalate to specialists.">
                              <Info size={14} color="var(--ink-muted)" />
                            </span>
                          </div>
                        </div>
                      </div>

                      <div>
                        <div
                          style={{
                            height: 5,
                            borderRadius: 99,
                            background: "#E5E0D4",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${Math.max(18, metrics.capPercent)}%`,
                              height: "100%",
                              borderRadius: 99,
                              background: "var(--status-pine)",
                            }}
                          />
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--ink-muted)",
                            textAlign: "right",
                            marginTop: 4,
                            fontWeight: 600,
                          }}
                        >
                          {metrics.pendingRefundCount > 0
                            ? `${metrics.pendingRefundCount} pending review`
                            : "Instant auto-approval limit"}
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Lower Split: Recent Orders + Support Activity */}
                  <section className="dashboard-split">
                    {/* Left Card: Recent Orders */}
                    <div className="card" style={{ padding: "20px 22px" }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 14,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <Package size={18} color="var(--ink-primary)" />
                          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Recent Orders</h2>
                        </div>
                        <button
                          type="button"
                          onClick={() => setTab("orders")}
                          style={{
                            border: "none",
                            background: "transparent",
                            color: "var(--ink-primary)",
                            fontSize: 12.5,
                            fontWeight: 700,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            cursor: "pointer",
                          }}
                        >
                          View All Orders
                          <ArrowRight size={13} />
                        </button>
                      </div>

                      {orders.length === 0 ? (
                        <div className="card-inset" style={{ padding: 24, textAlign: "center", color: "var(--ink-secondary)" }}>
                          No orders found on this account yet.
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          {orders.slice(0, 4).map((ord, idx) => (
                            <div
                              key={ord.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 14,
                                padding: "14px 4px",
                                borderTop: idx === 0 ? "1px solid var(--border-hairline)" : "none",
                                borderBottom: "1px solid var(--border-hairline)",
                              }}
                            >
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                                  <span className="font-mono" style={{ fontWeight: 700, fontSize: 13 }}>
                                    {ord.id}
                                  </span>
                                  <span
                                    className="badge badge-slate"
                                    style={{ fontSize: 10, padding: "2px 7px" }}
                                  >
                                    {ord.category}
                                  </span>
                                </div>
                                <div
                                  style={{
                                    fontWeight: 700,
                                    fontSize: 14,
                                    color: "var(--ink-primary)",
                                    marginTop: 2,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {ord.item_name}
                                </div>
                                <div style={{ fontSize: 12, color: "var(--ink-secondary)", marginTop: 2 }}>
                                  {ord.eligibility?.reason}
                                </div>
                              </div>

                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "flex-end",
                                  gap: 5,
                                  flexShrink: 0,
                                }}
                              >
                                <div className="font-mono" style={{ fontWeight: 700, fontSize: 14 }}>
                                  {formatINR(ord.total_amount)}
                                </div>
                                <StatusBadge value={ord.status} />
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  style={{ padding: "4px 11px", fontSize: 11.5, borderRadius: 999 }}
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

                    {/* Right Card: Support Banner + Recent Support Activity Timeline */}
                    <div className="card" style={{ overflow: "hidden" }}>
                      <div
                        style={{
                          background: "linear-gradient(135deg, #1E2C25 0%, #273930 100%)",
                          color: "#FAF7F0",
                          padding: "18px 20px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div
                            style={{
                              width: 42,
                              height: 42,
                              borderRadius: "50%",
                              background: "rgba(250, 247, 240, 0.12)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            <Headphones size={19} color="#FAF7F0" />
                          </div>
                          <div>
                            <div style={{ fontSize: 15.5, fontWeight: 800, lineHeight: 1.2 }}>
                              Support at Your Service
                            </div>
                            <div style={{ fontSize: 12, color: "#C5CEC5", marginTop: 2 }}>
                              Track your support tickets and get help
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setTab("desk")}
                          style={{
                            padding: "7px 14px",
                            borderRadius: 999,
                            border: "1px solid rgba(250, 247, 240, 0.35)",
                            background: "rgba(250, 247, 240, 0.08)",
                            color: "#FAF7F0",
                            fontSize: 12,
                            fontWeight: 700,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            cursor: "pointer",
                          }}
                        >
                          Go to Support
                          <ArrowRight size={12} />
                        </button>
                      </div>

                      <div style={{ padding: "18px 20px" }}>
                        <h3 style={{ fontSize: 17, fontWeight: 800, margin: "0 0 8px" }}>
                          Recent Support Activity
                        </h3>

                        {tickets.length === 0 ? (
                          <div
                            className="card-inset"
                            style={{ padding: 20, textAlign: "center", color: "var(--ink-secondary)", fontSize: 13 }}
                          >
                            No support tickets raised yet. Start a conversation with Kestrel AI anytime.
                          </div>
                        ) : (
                          <div className="activity-timeline">
                            {tickets.slice(0, 4).map((tkt) => (
                              <button
                                key={tkt.id}
                                type="button"
                                className="activity-row"
                                onClick={() => {
                                  setSelectedTicketId(tkt.id);
                                  setTab("desk");
                                }}
                              >
                                <span
                                  className={`activity-dot ${tkt.status === "escalated" ? "is-escalated" : ""}`}
                                  aria-hidden="true"
                                />
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div
                                    className="font-mono"
                                    style={{ fontSize: 11.5, color: "var(--ink-secondary)", fontWeight: 600 }}
                                  >
                                    {tkt.id} {tkt.order_id ? `· ${tkt.order_id}` : ""}
                                  </div>
                                  <div
                                    style={{
                                      fontWeight: 700,
                                      fontSize: 13.5,
                                      color: "var(--ink-primary)",
                                      marginTop: 2,
                                    }}
                                  >
                                    {tkt.subject}
                                  </div>
                                  <div style={{ fontSize: 11.5, color: "var(--ink-muted)", marginTop: 3 }}>
                                    Updated {formatDateTime(tkt.updated_at)}
                                  </div>
                                </div>
                                <div style={{ flexShrink: 0, paddingTop: 2 }}>
                                  <StatusBadge value={tkt.status} />
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {/* MY ORDERS TAB */}
              {tab === "orders" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                  <div>
                    <h1 style={{ fontSize: 30, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>
                      Orders &amp; Return Eligibility
                    </h1>
                    <p style={{ margin: "4px 0 0", color: "var(--ink-secondary)" }}>
                      Inspect return window eligibility per order, submit refund requests, or chat with support.
                    </p>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: 16 }}>
                    {orders.map((ord) => {
                      const stepIdx = ORDER_STEPS.indexOf(ord.status);
                      const elig = ord.eligibility;
                      return (
                        <article
                          key={ord.id}
                          className="card"
                          style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                <span className="font-mono" style={{ fontWeight: 700, fontSize: 13.5 }}>
                                  {ord.id}
                                </span>
                                <span className="badge badge-slate">{ord.category}</span>
                              </div>
                              <h3 style={{ margin: "4px 0 2px", fontSize: 15 }}>{ord.item_name}</h3>
                              <div style={{ fontSize: 12, color: "var(--ink-secondary)" }}>
                                Ordered {formatShortDate(ord.created_at)}
                                {ord.delivery_date ? ` · Delivered ${formatShortDate(ord.delivery_date)}` : " · In transit"}
                              </div>
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <div className="font-mono" style={{ fontSize: 16, fontWeight: 700 }}>
                                {formatINR(ord.total_amount)}
                              </div>
                              <div style={{ marginTop: 4 }}>
                                <StatusBadge value={ord.status} />
                              </div>
                            </div>
                          </div>

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
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  fontWeight: 700,
                                  color: "var(--ink-primary)",
                                }}
                              >
                                <span>
                                  {ord.category} Policy ({elig.return_window_days}-day window)
                                </span>
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
                </div>
              )}

              {/* REFUNDS TAB */}
              {tab === "refunds" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <div>
                    <h1 style={{ fontSize: 30, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>
                      Refund Ledger
                    </h1>
                    <p style={{ margin: "4px 0 0", color: "var(--ink-secondary)" }}>
                      Track automated refunds and specialist review decisions across all orders.
                    </p>
                  </div>

                  <div className="card" style={{ padding: 22 }}>
                    {refunds.length === 0 ? (
                      <div className="card-inset" style={{ padding: 28, textAlign: "center", color: "var(--ink-secondary)" }}>
                        No refund requests submitted yet.
                      </div>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                          <thead>
                            <tr
                              style={{
                                borderBottom: "1px solid var(--border-hairline)",
                                textAlign: "left",
                                color: "var(--ink-secondary)",
                              }}
                            >
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
                                <td className="font-mono" style={{ padding: "12px 8px", fontWeight: 700 }}>{rfd.id}</td>
                                <td className="font-mono" style={{ padding: "12px 8px" }}>{rfd.order_id}</td>
                                <td className="font-mono" style={{ padding: "12px 8px", fontWeight: 700 }}>{formatINR(rfd.amount)}</td>
                                <td style={{ padding: "12px 8px" }}><StatusBadge value={rfd.status} /></td>
                                <td style={{ padding: "12px 8px", color: "var(--ink-secondary)", maxWidth: 360 }}>
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

              {/* SUPPORT DESK / AI CHAT TAB */}
              {tab === "desk" && (
                <div className="ticket-workbench">
                  <aside className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, overflow: "hidden" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
                      <h2 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>
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
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", flex: 1, minHeight: 0, paddingRight: 2 }}>
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
                                <span className="font-mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-secondary)" }}>
                                  {tkt.id}
                                </span>
                                <StatusBadge value={tkt.status} />
                              </div>
                              <div style={{ fontWeight: 700, fontSize: 13, marginTop: 5, color: "var(--ink-primary)" }}>
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
                            flexShrink: 0,
                          }}
                        >
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span className="font-mono" style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-secondary)" }}>
                                {ticketDetail.id}
                              </span>
                              <StatusBadge value={ticketDetail.status} />
                              <StatusBadge value={ticketDetail.priority} prefix="Priority" />
                              <span className="badge badge-slate">{ticketDetail.category}</span>
                            </div>
                            <h2 style={{ margin: "6px 0 0", fontSize: 18, fontWeight: 800 }}>{ticketDetail.subject}</h2>
                          </div>

                          {ticketDetail.order && (
                            <div
                              className="card-inset"
                              style={{ padding: "8px 12px", fontSize: 12, minWidth: 230 }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                                <span className="font-mono">{ticketDetail.order.id}</span>
                                <span className="font-mono">{formatINR(ticketDetail.order.total_amount)}</span>
                              </div>
                              <div style={{ color: "var(--ink-secondary)", marginTop: 2 }}>
                                {ticketDetail.order.item_name}
                              </div>
                            </div>
                          )}
                        </div>

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
                              flexShrink: 0,
                            }}
                          >
                            {ticketDetail.refunds.map((r) => (
                              <div key={r.id} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                <RotateCcw size={13} />
                                <span className="font-mono" style={{ fontWeight: 700 }}>{r.id}</span>
                                <span>{formatINR(r.amount)}</span>
                                <StatusBadge value={r.status} />
                              </div>
                            ))}
                            {ticketDetail.escalations.map((esc) => (
                              <div key={esc.id} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                <ShieldAlert size={13} color="var(--status-ochre)" />
                                <span className="font-mono" style={{ fontWeight: 700 }}>{esc.id}</span>
                                <StatusBadge value={esc.decision} prefix="Escalation" />
                              </div>
                            ))}
                          </div>
                        )}

                        <div ref={chatStreamRef} className="chat-stream">
                          {ticketDetail.messages.map((msg) => {
                            const isCustomer = msg.sender_type === "customer";
                            const isStaff = msg.sender_type === "support_agent";
                            const tools = msg.metadata_json?.tools_used || [];
                            const guardrail = msg.metadata_json?.guardrail_triggered;

                            return (
                              <div
                                key={msg.id}
                                className={`chat-row ${isCustomer ? "is-customer" : "is-agent"}`}
                              >
                                <div className={`chat-avatar ${isCustomer ? "customer" : isStaff ? "staff" : "ai"}`}>
                                  {isCustomer ? (
                                    <UserIcon size={14} />
                                  ) : isStaff ? (
                                    <ShieldCheck size={14} />
                                  ) : (
                                    <Bot size={14} />
                                  )}
                                </div>

                                <div
                                  style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: isCustomer ? "flex-end" : "flex-start",
                                    gap: 5,
                                    minWidth: 0,
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 7,
                                      fontSize: 11,
                                      color: "var(--ink-secondary)",
                                      fontWeight: 700,
                                      paddingInline: 2,
                                    }}
                                  >
                                    <span>
                                      {isCustomer
                                        ? "You"
                                        : isStaff
                                          ? msg.metadata_json?.staff_name || "Support Specialist"
                                          : "Kestrel AI Agent"}
                                    </span>
                                    <span style={{ fontWeight: 500, color: "var(--ink-muted)" }}>
                                      {formatDateTime(msg.created_at)}
                                    </span>
                                  </div>

                                  <div className={`chat-bubble ${isCustomer ? "customer" : isStaff ? "staff" : "ai"}`}>
                                    {msg.content}
                                  </div>

                                  {(tools.length > 0 || guardrail) && (
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 1 }}>
                                      {tools.map((tool, i) => (
                                        <span
                                          key={`${tool}-${i}`}
                                          className="font-mono"
                                          style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 4,
                                            fontSize: 10.5,
                                            padding: "2px 8px",
                                            borderRadius: 999,
                                            background: "var(--bg-surface)",
                                            border: "1px solid var(--border-hairline)",
                                            color: "var(--ink-secondary)",
                                          }}
                                        >
                                          <Cpu size={10} color="var(--accent-copper)" />
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
                              </div>
                            );
                          })}

                          {pendingUserText && (
                            <div className="chat-row is-customer">
                              <div className="chat-avatar customer">
                                <UserIcon size={14} />
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                                <div style={{ fontSize: 11, color: "var(--ink-secondary)", fontWeight: 700 }}>
                                  You · Sending
                                </div>
                                <div className="chat-bubble customer">{pendingUserText}</div>
                              </div>
                            </div>
                          )}

                          {sendingChat && (
                            <div className="chat-row is-agent">
                              <div className="chat-avatar ai">
                                <Bot size={14} />
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                                <div style={{ fontSize: 11, color: "var(--ink-secondary)", fontWeight: 700 }}>
                                  Kestrel AI Agent
                                </div>
                                <div className="chat-bubble ai" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                                  <div className="typing-dots" aria-hidden="true">
                                    <span />
                                    <span />
                                    <span />
                                  </div>
                                  <span style={{ fontSize: 12.5, color: "var(--ink-secondary)" }}>
                                    Checking policy and preparing response...
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <div
                          style={{
                            padding: "12px 20px 16px",
                            borderTop: "1px solid var(--border-hairline)",
                            background: "var(--bg-surface)",
                            flexShrink: 0,
                          }}
                        >
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 10 }}>
                            {[
                              "Please check eligibility and process a refund for my order",
                              "What is the return policy for this item?",
                              "Connect me with a human support specialist",
                            ].map((prompt) => (
                              <button
                                key={prompt}
                                type="button"
                                className="chat-prompt-chip"
                                disabled={sendingChat}
                                onClick={(e) => void handleSendChat(e, prompt)}
                              >
                                {prompt}
                              </button>
                            ))}
                          </div>

                          <form onSubmit={(e) => void handleSendChat(e)} className="chat-composer-shell">
                            <input
                              ref={chatInputRef}
                              className="chat-composer-input"
                              placeholder="Message Kestrel AI (ask a policy question, check an order, or request a refund)..."
                              value={chatInput}
                              onChange={(e) => setChatInput(e.target.value)}
                              disabled={sendingChat}
                            />
                            <button
                              type="submit"
                              className="btn btn-primary"
                              disabled={sendingChat || !chatInput.trim()}
                              style={{ borderRadius: 8, padding: "8px 16px" }}
                            >
                              {sendingChat ? <Clock size={14} /> : <Send size={14} />}
                              {sendingChat ? "Sending..." : "Send"}
                            </button>
                          </form>
                        </div>
                      </>
                    ) : null}
                  </section>
                </div>
              )}

              {/* ACCOUNT SETTINGS TAB */}
              {tab === "settings" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 760 }}>
                  <div>
                    <h1 style={{ fontSize: 30, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>
                      Account Settings
                    </h1>
                    <p style={{ margin: "4px 0 0", color: "var(--ink-secondary)" }}>
                      Verified customer identity and active automated resolution policy limits.
                    </p>
                  </div>

                  <div className="card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
                    <div className="two-col-grid">
                      <div className="card-inset" style={{ padding: 14 }}>
                        <div style={{ fontSize: 11.5, color: "var(--ink-secondary)", fontWeight: 700 }}>Full Name</div>
                        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>{user.name}</div>
                      </div>
                      <div className="card-inset" style={{ padding: 14 }}>
                        <div style={{ fontSize: 11.5, color: "var(--ink-secondary)", fontWeight: 700 }}>Email Address</div>
                        <div className="font-mono" style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{user.email}</div>
                      </div>
                      <div className="card-inset" style={{ padding: 14 }}>
                        <div style={{ fontSize: 11.5, color: "var(--ink-secondary)", fontWeight: 700 }}>Account Role</div>
                        <div style={{ marginTop: 6 }}><StatusBadge value={user.role} /></div>
                      </div>
                      <div className="card-inset" style={{ padding: 14 }}>
                        <div style={{ fontSize: 11.5, color: "var(--ink-secondary)", fontWeight: 700 }}>Member Since</div>
                        <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{formatShortDate(user.created_at)}</div>
                      </div>
                    </div>

                    <div className="card-inset" style={{ padding: 16 }}>
                      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>
                        Active Return &amp; Refund Policy Summary
                      </div>
                      <div style={{ fontSize: 13, color: "var(--ink-secondary)", lineHeight: 1.6 }}>
                        Electronics: 7 days from delivery · Apparel: 14 days · Homeware: 10 days · Beauty &amp; Consumables: 2 days.
                        Eligible refunds up to ₹5,000.00 are processed automatically; requests above ₹5,000.00 route to a human specialist.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

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
              <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>
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
              <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>
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
