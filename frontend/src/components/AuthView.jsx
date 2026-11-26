import React, { useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Layers,
  Lock,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { api, ApiClientError } from "../api/client";
import { BrandMark } from "./BrandMark";
import { useToast } from "./ToastProvider";

const DEMO_ACCOUNTS = [
  {
    label: "Aarav Mehta",
    roleLabel: "Customer",
    email: "aarav@kestrel.demo",
    pass: "Customer@123",
    note: "5 orders (auto-refund, >₹5k escalation, expired)",
  },
  {
    label: "Diya Kulkarni",
    roleLabel: "Customer",
    email: "diya@kestrel.demo",
    pass: "Customer@123",
    note: "2 orders including escalated audio claim",
  },
  {
    label: "Rohan Sen",
    roleLabel: "Support Agent",
    email: "agent@kestrel.demo",
    pass: "Support@123",
    note: "Triage queue, escalation approvals & notes",
  },
  {
    label: "Meera Nair",
    roleLabel: "Admin",
    email: "admin@kestrel.demo",
    pass: "Admin@123",
    note: "Full operations desk & immutable audit log",
  },
];

export function AuthView({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("aarav@kestrel.demo");
  const [password, setPassword] = useState("Customer@123");
  const [loading, setLoading] = useState(false);
  const [showDemos, setShowDemos] = useState(false);
  const toast = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (mode === "register" && name.trim().length < 2) {
      toast.error("Please enter your full name (at least 2 characters).", "Validation");
      return;
    }
    if (!email.includes("@")) {
      toast.error("Please enter a valid email address.", "Validation");
      return;
    }
    if (mode === "register" && password.length < 8) {
      toast.error("Password must be at least 8 characters long.", "Validation");
      return;
    }

    setLoading(true);
    try {
      const result =
        mode === "login"
          ? await api.login({ email: email.trim(), password })
          : await api.register({ name: name.trim(), email: email.trim(), password });
      onAuthenticated(result);
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error(err.message, "Authentication Failed");
      } else {
        toast.error("Authentication failed. Please retry.", "Authentication Failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const applyDemo = (demoEmail, demoPass) => {
    setMode("login");
    setEmail(demoEmail);
    setPassword(demoPass);
    setShowDemos(false);
    toast.info(`Loaded credentials for ${demoEmail}.`, "Quick-Fill Ready");
  };

  const activeDemo = DEMO_ACCOUNTS.find((acc) => acc.email === email && mode === "login");

  return (
    <div className="landing-canvas">
      <div className="landing-grid">
        {/* Left Editorial Hero Copy layered cleanly on top-left dark botanical wash */}
        <section className="landing-left">
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <BrandMark size={40} inverted />
            <div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 800,
                  lineHeight: 1.05,
                  color: "#F7F3EA",
                  letterSpacing: "-0.02em",
                }}
              >
                Kestrel Supply
              </div>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "#C5CBC4",
                  marginTop: 3,
                  fontWeight: 700,
                }}
              >
                Resolution &amp; Operations Desk
              </div>
            </div>
          </div>

          <h1
            style={{
              fontSize: "clamp(34px, 3.8vw, 52px)",
              lineHeight: 1.08,
              fontWeight: 800,
              color: "#FAF7F0",
              margin: "34px 0 16px",
              maxWidth: 560,
              letterSpacing: "-0.025em",
              textShadow: "0 2px 14px rgba(18, 25, 21, 0.35)",
            }}
          >
            Deterministic commerce support with verifiable human oversight.
          </h1>

          <p
            style={{
              color: "#DCE0D8",
              fontSize: 15.5,
              maxWidth: 500,
              lineHeight: 1.6,
              margin: 0,
              fontWeight: 500,
            }}
          >
            Track orders, consult our policy-grounded AI resolution agent, and manage
            server-verified refunds and specialist escalations inside a unified workspace.
          </p>

          <div className="landing-feature-row">
            <div className="landing-glass-card">
              <div className="landing-glass-title">
                <ShieldCheck size={15} color="#DF6B3E" style={{ flexShrink: 0 }} />
                <span>Category Policy RAG</span>
              </div>
              <p className="landing-glass-desc">
                7-day Electronics, 14-day Apparel, 10-day Homeware windows
              </p>
            </div>

            <div className="landing-glass-card">
              <div className="landing-glass-title">
                <Layers size={15} color="#DF6B3E" style={{ flexShrink: 0 }} />
                <span>Idempotent Execution</span>
              </div>
              <p className="landing-glass-desc">
                Server-enforced ownership, duplicate blocks, and audit trails
              </p>
            </div>
          </div>
        </section>

        {/* Right Floating Parchment Auth Card */}
        <section className="landing-right">
          <div className="landing-auth-card">
            <div
              style={{
                display: "flex",
                gap: 6,
                background: "#EFE9DC",
                padding: 4,
                borderRadius: 10,
                border: "1px solid #E2DDD0",
                marginBottom: 24,
              }}
            >
              <button
                type="button"
                className={`nav-tab ${mode === "login" ? "active" : ""}`}
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => setMode("login")}
              >
                <Lock size={14} />
                Sign In
              </button>
              <button
                type="button"
                className={`nav-tab ${mode === "register" ? "active" : ""}`}
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => {
                  setMode("register");
                  setEmail("");
                  setPassword("");
                }}
              >
                <UserPlus size={14} />
                Create Account
              </button>
            </div>

            <h2
              style={{
                fontSize: 28,
                fontWeight: 800,
                margin: "0 0 6px",
                color: "var(--ink-primary)",
                letterSpacing: "-0.02em",
              }}
            >
              {mode === "login" ? "Welcome back to Kestrel" : "Open a customer account"}
            </h2>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 15 }}>
              {mode === "register" && (
                <div>
                  <label className="field-label" htmlFor="auth-name">
                    Full Name
                  </label>
                  <input
                    id="auth-name"
                    className="input"
                    type="text"
                    placeholder="e.g. Kabir Sharma"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              )}

              <div>
                <label className="field-label" htmlFor="auth-email">
                  Email Address
                </label>
                <input
                  id="auth-email"
                  className="input"
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="field-label" htmlFor="auth-password">
                  Password
                </label>
                <input
                  id="auth-password"
                  className="input"
                  type="password"
                  placeholder="Minimum 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
                style={{
                  marginTop: 6,
                  padding: "12px 18px",
                  fontSize: 14,
                  fontWeight: 700,
                  borderRadius: 8,
                }}
              >
                {loading
                  ? "Verifying credentials..."
                  : mode === "login"
                    ? "Sign In to Workspace"
                    : "Create Customer Account"}
                <ArrowRight size={15} />
              </button>
            </form>

            {/* Smooth Animated Evaluation Account Dropdown */}
            <div style={{ marginTop: 18 }}>
              <button
                type="button"
                aria-expanded={showDemos}
                className={`demo-dropdown-trigger ${showDemos ? "open" : ""}`}
                onClick={() => setShowDemos((prev) => !prev)}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span>Quick-Fill Evaluation Accounts</span>
                  {activeDemo && (
                    <span
                      className="badge badge-copper"
                      style={{ fontSize: 10, padding: "2px 7px", whiteSpace: "nowrap" }}
                    >
                      {activeDemo.label}
                    </span>
                  )}
                </span>
                <ChevronDown size={15} className={`demo-chevron ${showDemos ? "open" : ""}`} />
              </button>

              <div className={`demo-dropdown-panel ${showDemos ? "open" : ""}`}>
                <div className="demo-dropdown-inner">
                  <div className="demo-dropdown-list">
                    {DEMO_ACCOUNTS.map((acc) => {
                      const selected = email === acc.email && mode === "login";
                      const initials = acc.label
                        .split(" ")
                        .map((part) => part[0])
                        .join("");
                      return (
                        <button
                          key={acc.email}
                          type="button"
                          className={`demo-option ${selected ? "selected" : ""}`}
                          onClick={() => applyDemo(acc.email, acc.pass)}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                            <div className="demo-avatar">{initials}</div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: 12.5, color: "var(--ink-primary)", lineHeight: 1.2 }}>
                                {acc.label}
                              </div>
                              <div style={{ fontSize: 11, color: "var(--ink-secondary)", marginTop: 1 }}>
                                {acc.email}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
                            <span
                              className="badge badge-slate"
                              style={{ fontSize: 9.5, padding: "2px 7px", whiteSpace: "nowrap" }}
                            >
                              {acc.roleLabel}
                            </span>
                            {selected && <Check size={14} color="var(--accent-copper)" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
