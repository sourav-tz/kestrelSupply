import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Bot,
  Check,
  ClipboardList,
  Filter,
  HelpCircle,
  Lock,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  StickyNote,
  User as UserIcon,
  X,
} from "lucide-react";
import { api, ApiClientError } from "../api/client";
import { formatDateTime, formatINR, formatLabel, formatShortDate } from "../utils/format";
import { BrandMark, StatusBadge } from "./BrandMark";
import { useToast } from "./ToastProvider";

export function StaffConsole({ user, onLogout }) {
  const [tab, setTab] = useState("triage");
  const [tickets, setTickets] = useState([]);
  const [escalations, setEscalations] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [policyDoc, setPolicyDoc] = useState("");
  const [policyQuery, setPolicyQuery] = useState("electronics return window");
  const [policyMatches, setPolicyMatches] = useState([]);

  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [ticketDetail, setTicketDetail] = useState(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [escalationFilter, setEscalationFilter] = useState("pending");

  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const toast = useToast();

  // Staff actions
  const [replyText, setReplyText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [busyAction, setBusyAction] = useState(false);
  const staffChatStreamRef = useRef(null);

  const loadTicketsAndEscalations = useCallback(async () => {
    setLoading(true);
    try {
      const [tktList, escList] = await Promise.all([
        api.listTickets({
          status: statusFilter || undefined,
          priority: priorityFilter || undefined,
          search: searchTerm || undefined,
        }),
        api.listEscalations(),
      ]);
      setTickets(tktList);
      setEscalations(escList);
      setSelectedTicketId((prev) => prev || (tktList[0]?.id ?? null));
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Failed to load operations queue.", "Queue Error");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, priorityFilter, searchTerm, toast]);

  useEffect(() => {
    void loadTicketsAndEscalations();
  }, [loadTicketsAndEscalations]);

  const loadDetail = useCallback(async (ticketId) => {
    setLoadingDetail(true);
    try {
      const detail = await api.getTicketDetail(ticketId);
      setTicketDetail(detail);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Failed to inspect ticket.", "Ticket Error");
    } finally {
      setLoadingDetail(false);
    }
  }, [toast]);

  useEffect(() => {
    if (selectedTicketId) {
      void loadDetail(selectedTicketId);
    } else {
      setTicketDetail(null);
    }
  }, [selectedTicketId, loadDetail]);

  useEffect(() => {
    if (tab === "triage" && staffChatStreamRef.current) {
      staffChatStreamRef.current.scrollTop = staffChatStreamRef.current.scrollHeight;
    }
  }, [tab, selectedTicketId, ticketDetail?.messages?.length]);

  useEffect(() => {
    if (tab === "audit") {
      void api.listAuditLogs(100).then(setAuditLogs).catch(() => {});
    }
    if (tab === "policies" && !policyDoc) {
      void api.getPolicies().then((p) => setPolicyDoc(p.document)).catch(() => {});
      void api.searchPolicies(policyQuery).then((r) => setPolicyMatches(r.results)).catch(() => {});
    }
  }, [tab, policyDoc, policyQuery]);

  const handleSendStaffReply = async (e) => {
    e.preventDefault();
    if (!selectedTicketId || !replyText.trim()) return;
    setBusyAction(true);
    try {
      await api.sendStaffReply(selectedTicketId, { content: replyText.trim() });
      setReplyText("");
      toast.success("Specialist reply sent to customer.", "Reply Sent");
      await Promise.all([loadDetail(selectedTicketId), loadTicketsAndEscalations()]);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Failed to send reply.", "Reply Error");
    } finally {
      setBusyAction(false);
    }
  };

  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!selectedTicketId || noteText.trim().length < 2) return;
    setBusyAction(true);
    try {
      await api.addInternalNote(selectedTicketId, { note: noteText.trim() });
      setNoteText("");
      await loadDetail(selectedTicketId);
      toast.success("Internal staff note recorded.", "Note Saved");
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Failed to save note.", "Note Error");
    } finally {
      setBusyAction(false);
    }
  };

  const handleStatusChange = async (newStatus, newPriority) => {
    if (!selectedTicketId) return;
    setBusyAction(true);
    try {
      await api.updateTicketStatus(selectedTicketId, { status: newStatus, priority: newPriority });
      await Promise.all([loadDetail(selectedTicketId), loadTicketsAndEscalations()]);
      toast.success("Ticket metadata updated.", "Ticket Updated");
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Failed to update ticket.", "Update Error");
    } finally {
      setBusyAction(false);
    }
  };

  const handleEscalationDecision = async (escalationId, decision, noteOverride) => {
    const note = (noteOverride ?? decisionNote).trim() || `Reviewed by ${user.name} (${decision})`;
    setBusyAction(true);
    try {
      await api.decideEscalation(escalationId, {
        decision,
        internal_note: note,
      });
      setDecisionNote("");
      toast.success(`Escalation ${escalationId} marked as ${formatLabel(decision)}.`, "Decision Recorded");
      await loadTicketsAndEscalations();
      if (selectedTicketId) {
        await loadDetail(selectedTicketId);
      }
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Failed to submit escalation decision.", "Decision Error");
    } finally {
      setBusyAction(false);
    }
  };

  const handleRefundDecision = async (refundId, decision) => {
    const note = decisionNote.trim() || `Specialist ${user.name} ${decision} refund request.`;
    setBusyAction(true);
    try {
      await api.decideRefund(refundId, { decision, decision_note: note });
      setDecisionNote("");
      toast.success(`Refund ${refundId} ${decision}.`, "Refund Updated");
      await loadTicketsAndEscalations();
      if (selectedTicketId) {
        await loadDetail(selectedTicketId);
      }
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Refund decision failed.", "Refund Error");
    } finally {
      setBusyAction(false);
    }
  };

  const handlePolicySearch = async (e) => {
    e.preventDefault();
    if (policyQuery.trim().length < 2) return;
    try {
      const res = await api.searchPolicies(policyQuery.trim());
      setPolicyMatches(res.results);
    } catch {
      // ignore
    }
  };

  const pendingEscalations = useMemo(
    () => escalations.filter((e) => e.decision === "pending"),
    [escalations]
  );

  const filteredEscalations = useMemo(
    () => (escalationFilter ? escalations.filter((e) => e.decision === escalationFilter) : escalations),
    [escalations, escalationFilter]
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-lockup">
            <BrandMark size={34} />
            <div>
              <div className="brand-title">Kestrel Operations</div>
              <div className="brand-subtitle">Internal Support &amp; Escalation Desk</div>
            </div>
          </div>

          <nav className="nav-tabs" aria-label="Staff Navigation">
            <button
              type="button"
              className={`nav-tab ${tab === "triage" ? "active" : ""}`}
              onClick={() => setTab("triage")}
            >
              <ClipboardList size={14} />
              Triage Queue
              <span className="badge badge-slate" style={{ padding: "1px 6px" }}>{tickets.length}</span>
            </button>
            <button
              type="button"
              className={`nav-tab ${tab === "escalations" ? "active" : ""}`}
              onClick={() => setTab("escalations")}
            >
              <ShieldAlert size={14} />
              Escalation Review
              {pendingEscalations.length > 0 && (
                <span className="badge badge-ochre" style={{ padding: "1px 6px" }}>
                  {pendingEscalations.length}
                </span>
              )}
            </button>
            <button
              type="button"
              className={`nav-tab ${tab === "audit" ? "active" : ""}`}
              onClick={() => setTab("audit")}
            >
              <Lock size={14} />
              Audit Ledger
            </button>
            <button
              type="button"
              className={`nav-tab ${tab === "policies" ? "active" : ""}`}
              onClick={() => setTab("policies")}
            >
              <BookOpen size={14} />
              Policy KB
            </button>
          </nav>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 10px",
                background: "rgba(247, 243, 234, 0.08)",
                color: "#F7F3EA",
                borderRadius: 8,
                border: "1px solid rgba(247, 243, 234, 0.18)",
              }}
            >
              <ShieldCheck size={14} color="#DF6B3E" />
              <span style={{ fontSize: 12, fontWeight: 600 }}>{user.name}</span>
              <span className="badge badge-copper" style={{ fontSize: 10 }}>
                {formatLabel(user.role)}
              </span>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onLogout}>
              Log Out
            </button>
          </div>
        </div>
      </header>

      <main className="page-container">
        {/* TRIAGE QUEUE TAB */}
        {tab === "triage" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Filter Ribbon */}
            <div className="card" style={{ padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <div style={{ position: "relative", flex: "1 1 240px" }}>
                <Search size={14} style={{ position: "absolute", left: 10, top: 11, color: "var(--ink-muted)" }} />
                <input
                  className="input"
                  style={{ paddingLeft: 32 }}
                  placeholder="Search ticket ID, subject, order ID, or customer..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Filter size={14} color="var(--ink-secondary)" />
                <select
                  className="select"
                  style={{ width: 160 }}
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="">All Statuses</option>
                  <option value="open">Open</option>
                  <option value="awaiting_customer">Awaiting Customer</option>
                  <option value="escalated">Escalated</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
                <select
                  className="select"
                  style={{ width: 145 }}
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                >
                  <option value="">All Priorities</option>
                  <option value="urgent">Urgent</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setSearchTerm("");
                    setStatusFilter("");
                    setPriorityFilter("");
                  }}
                >
                  Reset
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadTicketsAndEscalations()}>
                  <RefreshCw size={13} />
                </button>
              </div>
            </div>

            <div className="staff-workbench">
              {/* Left: Ticket Queue */}
              <aside className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-secondary)" }}>
                  Queue ({tickets.length})
                </div>
                {loading ? (
                  <div style={{ padding: 24, textAlign: "center", color: "var(--ink-secondary)" }}>Loading queue...</div>
                ) : tickets.length === 0 ? (
                  <div className="card-inset" style={{ padding: 20, textAlign: "center", color: "var(--ink-secondary)", fontSize: 13 }}>
                    No tickets match the current filters.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", maxHeight: 620 }}>
                    {tickets.map((t) => {
                      const selected = t.id === selectedTicketId;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setSelectedTicketId(t.id)}
                          style={{
                            textAlign: "left",
                            padding: "11px 12px",
                            borderRadius: 9,
                            border: selected ? "1px solid var(--accent-copper)" : "1px solid var(--border-hairline)",
                            background: selected ? "var(--accent-copper-soft)" : "var(--bg-surface)",
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                            <span className="font-mono" style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-secondary)" }}>
                              {t.id}
                            </span>
                            <StatusBadge value={t.status} />
                          </div>
                          <div style={{ fontWeight: 600, fontSize: 13, marginTop: 4, color: "var(--ink-primary)" }}>
                            {t.subject}
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--ink-secondary)", marginTop: 6 }}>
                            <span>{t.customer_name || "Customer"}</span>
                            <span className="font-mono">{t.order_id || "No Order"}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </aside>

              {/* Center: Conversation + Internal Notes */}
              <section className="card" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
                {!ticketDetail ? (
                  <div style={{ padding: 48, textAlign: "center", color: "var(--ink-secondary)", margin: "auto" }}>
                    {loadingDetail ? "Inspecting ticket context..." : "Select a ticket from the queue to inspect."}
                  </div>
                ) : (
                  <>
                    <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-hairline)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="font-mono" style={{ fontWeight: 600, fontSize: 12 }}>{ticketDetail.id}</span>
                          <StatusBadge value={ticketDetail.status} />
                          <StatusBadge value={ticketDetail.priority} prefix="Priority" />
                        </div>
                        <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                          Created {formatDateTime(ticketDetail.created_at)}
                        </span>
                      </div>
                      <h2 style={{ margin: "6px 0 0", fontSize: 17 }}>{ticketDetail.subject}</h2>
                    </div>

                    <div ref={staffChatStreamRef} style={{ flex: 1, padding: 16, overflowY: "auto", maxHeight: 360, background: "#F4EFE4", display: "flex", flexDirection: "column", gap: 12 }}>
                      {ticketDetail.messages.map((msg) => (
                        <div key={msg.id} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--ink-secondary)", fontWeight: 600 }}>
                            {msg.sender_type === "customer" ? (
                              <UserIcon size={12} />
                            ) : msg.sender_type === "ai_agent" ? (
                              <Bot size={12} color="var(--accent-copper)" />
                            ) : (
                              <ShieldCheck size={12} color="var(--status-pine)" />
                            )}
                            <span>{formatLabel(msg.sender_type)}</span>
                            <span style={{ fontWeight: 400, color: "var(--ink-muted)" }}>{formatDateTime(msg.created_at)}</span>
                          </div>
                          <div
                            style={{
                              padding: "10px 12px",
                              borderRadius: 9,
                              fontSize: 13,
                              whiteSpace: "pre-wrap",
                              background:
                                msg.sender_type === "support_agent"
                                  ? "var(--status-pine-soft)"
                                  : msg.sender_type === "customer"
                                    ? "var(--bg-surface)"
                                    : "var(--bg-inset)",
                              border: "1px solid var(--border-hairline)",
                            }}
                          >
                            {msg.content}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Staff Public Reply */}
                    <form
                      onSubmit={handleSendStaffReply}
                      style={{ padding: "12px 16px", borderTop: "1px solid var(--border-hairline)", display: "flex", gap: 8 }}
                    >
                      <input
                        className="input"
                        placeholder="Send visible specialist reply to customer..."
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        disabled={busyAction}
                      />
                      <button type="submit" className="btn btn-dark btn-sm" disabled={busyAction || !replyText.trim()}>
                        <Send size={13} />
                        Reply
                      </button>
                    </form>

                    {/* Private Internal Notes */}
                    <div style={{ padding: "14px 16px", borderTop: "1px solid var(--border-hairline)", background: "var(--bg-inset)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
                        <StickyNote size={13} color="var(--status-ochre)" />
                        Internal Staff Notes ({ticketDetail.internal_notes.length})
                      </div>
                      {ticketDetail.internal_notes.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10, maxHeight: 130, overflowY: "auto" }}>
                          {ticketDetail.internal_notes.map((n) => (
                            <div
                              key={n.id}
                              style={{
                                padding: "8px 10px",
                                borderRadius: 7,
                                background: "var(--bg-surface)",
                                border: "1px solid var(--border-hairline)",
                                fontSize: 12,
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 11, color: "var(--ink-secondary)" }}>
                                <span>{n.author_name || "Staff"}</span>
                                <span>{formatDateTime(n.created_at)}</span>
                              </div>
                              <div style={{ marginTop: 3 }}>{n.note}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      <form onSubmit={handleAddNote} style={{ display: "flex", gap: 8 }}>
                        <input
                          className="input"
                          placeholder="Add private internal note (not visible to customer)..."
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          disabled={busyAction}
                        />
                        <button type="submit" className="btn btn-secondary btn-sm" disabled={busyAction || noteText.trim().length < 2}>
                          Add Note
                        </button>
                      </form>
                    </div>
                  </>
                )}
              </section>

              {/* Right: Context & Decision Rail */}
              <aside className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                {!ticketDetail ? (
                  <div style={{ color: "var(--ink-secondary)", fontSize: 13 }}>Select a ticket to view order and escalation context.</div>
                ) : (
                  <>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-secondary)" }}>
                        Customer Profile
                      </div>
                      <div style={{ fontWeight: 600, marginTop: 4 }}>{ticketDetail.customer_name}</div>
                      <div className="font-mono" style={{ fontSize: 12, color: "var(--ink-secondary)" }}>
                        {ticketDetail.customer_email}
                      </div>
                    </div>

                    <div style={{ borderTop: "1px solid var(--border-hairline)", paddingTop: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-secondary)", marginBottom: 8 }}>
                        Ticket Controls
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div>
                          <label className="field-label">Status</label>
                          <select
                            className="select"
                            value={ticketDetail.status}
                            disabled={busyAction}
                            onChange={(e) => void handleStatusChange(e.target.value, undefined)}
                          >
                            <option value="open">Open</option>
                            <option value="awaiting_customer">Awaiting Customer</option>
                            <option value="escalated">Escalated</option>
                            <option value="resolved">Resolved</option>
                            <option value="closed">Closed</option>
                          </select>
                        </div>
                        <div>
                          <label className="field-label">Priority</label>
                          <select
                            className="select"
                            value={ticketDetail.priority}
                            disabled={busyAction}
                            onChange={(e) => void handleStatusChange(undefined, e.target.value)}
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                            <option value="urgent">Urgent</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {ticketDetail.order && (
                      <div style={{ borderTop: "1px solid var(--border-hairline)", paddingTop: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-secondary)", marginBottom: 6 }}>
                          Order Verification
                        </div>
                        <div className="card-inset" style={{ padding: 10, fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                            <span className="font-mono">{ticketDetail.order.id}</span>
                            <span className="font-mono">{formatINR(ticketDetail.order.total_amount)}</span>
                          </div>
                          <div>{ticketDetail.order.item_name}</div>
                          <div style={{ color: "var(--ink-secondary)" }}>
                            Category: {ticketDetail.order.category} · Status: {formatLabel(ticketDetail.order.status)}
                          </div>
                          <div style={{ color: "var(--ink-secondary)" }}>
                            Delivered: {formatShortDate(ticketDetail.order.delivery_date)}
                          </div>
                          {ticketDetail.order.eligibility && (
                            <div style={{ marginTop: 4, paddingTop: 6, borderTop: "1px solid var(--border-hairline)", color: "var(--ink-primary)" }}>
                              {ticketDetail.order.eligibility.reason}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Escalation & Refund Decision Controls */}
                    {(ticketDetail.escalations.length > 0 || ticketDetail.refunds.length > 0) && (
                      <div style={{ borderTop: "1px solid var(--border-hairline)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-secondary)" }}>
                          Refund &amp; Escalation Authority
                        </div>

                        <div>
                          <label className="field-label">Decision / Review Note</label>
                          <textarea
                            className="textarea"
                            rows={2}
                            placeholder="Record verification rationale..."
                            value={decisionNote}
                            onChange={(e) => setDecisionNote(e.target.value)}
                          />
                        </div>

                        {ticketDetail.escalations.map((esc) => (
                          <div key={esc.id} className="card-inset" style={{ padding: 10, fontSize: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span className="font-mono" style={{ fontWeight: 600 }}>{esc.id}</span>
                              <StatusBadge value={esc.decision} />
                            </div>
                            <div>{esc.summary}</div>
                            {esc.decision === "pending" && (
                              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                <button
                                  type="button"
                                  className="btn btn-pine btn-sm"
                                  disabled={busyAction}
                                  onClick={() => void handleEscalationDecision(esc.id, "approved")}
                                >
                                  <Check size={13} />
                                  Approve &amp; Process
                                </button>
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button
                                    type="button"
                                    className="btn btn-danger btn-sm"
                                    style={{ flex: 1 }}
                                    disabled={busyAction}
                                    onClick={() => void handleEscalationDecision(esc.id, "rejected")}
                                  >
                                    <X size={13} />
                                    Reject
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    style={{ flex: 1 }}
                                    disabled={busyAction}
                                    onClick={() => void handleEscalationDecision(esc.id, "more_info_requested")}
                                  >
                                    <HelpCircle size={13} />
                                    Ask Info
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}

                        {ticketDetail.refunds
                          .filter((r) => r.status === "pending_review")
                          .map((rfd) => (
                            <div key={rfd.id} className="card-inset" style={{ padding: 10, fontSize: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                                <span className="font-mono">{rfd.id}</span>
                                <span className="font-mono">{formatINR(rfd.amount)}</span>
                              </div>
                              <StatusBadge value={rfd.status} />
                              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                                <button
                                  type="button"
                                  className="btn btn-pine btn-sm"
                                  style={{ flex: 1 }}
                                  disabled={busyAction}
                                  onClick={() => void handleRefundDecision(rfd.id, "approved")}
                                >
                                  Approve Refund
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-danger btn-sm"
                                  style={{ flex: 1 }}
                                  disabled={busyAction}
                                  onClick={() => void handleRefundDecision(rfd.id, "rejected")}
                                >
                                  Reject Refund
                                </button>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </>
                )}
              </aside>
            </div>
          </div>
        )}

        {/* ESCALATION REVIEW TAB */}
        {tab === "escalations" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div>
                <h1 className="font-serif" style={{ fontSize: 32, margin: 0, fontWeight: 400 }}>
                  Escalation Review Desk
                </h1>
                <p style={{ margin: "4px 0 0", color: "var(--ink-secondary)" }}>
                  Authorize refunds exceeding ₹5,000, reject ineligible claims, or request customer verification.
                </p>
              </div>
              <select
                className="select"
                style={{ width: 200 }}
                value={escalationFilter}
                onChange={(e) => setEscalationFilter(e.target.value)}
              >
                <option value="">All Decisions</option>
                <option value="pending">Pending Review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="more_info_requested">More Info Requested</option>
              </select>
            </div>

            {filteredEscalations.length === 0 ? (
              <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--ink-secondary)" }}>
                No escalations found in this filter state.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 16 }}>
                {filteredEscalations.map((esc) => (
                  <article key={esc.id} className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="font-mono" style={{ fontWeight: 600 }}>{esc.id}</span>
                        <span className="badge badge-slate">{formatLabel(esc.reason_code)}</span>
                      </div>
                      <StatusBadge value={esc.decision} />
                    </div>

                    <p style={{ margin: 0, fontSize: 13.5 }}>{esc.summary}</p>

                    <div style={{ fontSize: 12, color: "var(--ink-secondary)" }} className="font-mono">
                      Ticket: {esc.ticket_id} {esc.refund_id ? `· Refund: ${esc.refund_id}` : ""}
                    </div>

                    {esc.internal_note && (
                      <div className="card-inset" style={{ padding: "8px 10px", fontSize: 12 }}>
                        <strong>Specialist Note:</strong> {esc.internal_note}
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 8, marginTop: "auto", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setSelectedTicketId(esc.ticket_id);
                          setTab("triage");
                        }}
                      >
                        Inspect Ticket Context
                      </button>
                      {esc.decision === "pending" && (
                        <>
                          <button
                            type="button"
                            className="btn btn-pine btn-sm"
                            disabled={busyAction}
                            onClick={() =>
                              void handleEscalationDecision(
                                esc.id,
                                "approved",
                                "Approved via Escalation Review Desk after policy check."
                              )
                            }
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={busyAction}
                            onClick={() =>
                              void handleEscalationDecision(
                                esc.id,
                                "rejected",
                                "Rejected via Escalation Review Desk."
                              )
                            }
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}

        {/* AUDIT LEDGER TAB */}
        {tab === "audit" && (
          <div className="card" style={{ padding: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h1 className="font-serif" style={{ fontSize: 28, margin: 0, fontWeight: 400 }}>
                  Immutable Audit Ledger
                </h1>
                <p style={{ margin: "2px 0 0", color: "var(--ink-secondary)", fontSize: 13 }}>
                  Server-recorded events for refund requests, approvals, rejections, escalations, and prompt-injection guardrails.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void api.listAuditLogs(100).then(setAuditLogs)}
              >
                <RefreshCw size={13} />
                Refresh
              </button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-hairline)", textAlign: "left", color: "var(--ink-secondary)" }}>
                    <th style={{ padding: "10px 8px" }}>Audit ID</th>
                    <th style={{ padding: "10px 8px" }}>Action</th>
                    <th style={{ padding: "10px 8px" }}>Actor Role</th>
                    <th style={{ padding: "10px 8px" }}>Resource</th>
                    <th style={{ padding: "10px 8px" }}>Details</th>
                    <th style={{ padding: "10px 8px" }}>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id} style={{ borderBottom: "1px solid var(--border-hairline)" }}>
                      <td className="font-mono" style={{ padding: "10px 8px", fontWeight: 600 }}>{log.id}</td>
                      <td style={{ padding: "10px 8px" }}><StatusBadge value={log.action} /></td>
                      <td style={{ padding: "10px 8px" }}>{formatLabel(log.actor_role)}</td>
                      <td className="font-mono" style={{ padding: "10px 8px" }}>
                        {log.resource_type}:{log.resource_id}
                      </td>
                      <td className="font-mono" style={{ padding: "10px 8px", color: "var(--ink-secondary)", maxWidth: 380 }}>
                        {JSON.stringify(log.details_json)}
                      </td>
                      <td style={{ padding: "10px 8px", color: "var(--ink-muted)", whiteSpace: "nowrap" }}>
                        {formatDateTime(log.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* POLICY KB TAB */}
        {tab === "policies" && (
          <div className="two-col-grid">
            <div className="card" style={{ padding: 22 }}>
              <h2 className="font-serif" style={{ fontSize: 24, margin: "0 0 12px", fontWeight: 400 }}>
                Source Policy Document
              </h2>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontFamily: "var(--font-sans)",
                  fontSize: 13,
                  lineHeight: 1.6,
                  background: "var(--bg-inset)",
                  padding: 16,
                  borderRadius: 10,
                  border: "1px solid var(--border-hairline)",
                  margin: 0,
                }}
              >
                {policyDoc}
              </pre>
            </div>

            <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
              <h2 className="font-serif" style={{ fontSize: 24, margin: 0, fontWeight: 400 }}>
                RAG Policy Retrieval Inspector
              </h2>
              <form onSubmit={handlePolicySearch} style={{ display: "flex", gap: 8 }}>
                <input
                  className="input"
                  value={policyQuery}
                  onChange={(e) => setPolicyQuery(e.target.value)}
                  placeholder="Test RAG query (e.g. electronics return window, 5000 limit)..."
                />
                <button type="submit" className="btn btn-primary btn-sm">
                  Search RAG
                </button>
              </form>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {policyMatches.map((m) => (
                  <div key={m.section_id} className="card-inset" style={{ padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 13 }}>
                      <span>{m.title}</span>
                      <span className="font-mono" style={{ fontSize: 11, color: "var(--accent-copper)" }}>
                        score {m.score}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--ink-secondary)", marginTop: 4 }}>{m.content}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
