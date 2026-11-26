# System Architecture — Kestrel Support & Resolution Suite

## High-Level Architecture & Human-Review Flow

![Kestrel System Architecture Diagram](./architecture_diagram.jpg)

```mermaid
flowchart LR
    subgraph Client["React + TypeScript SPA"]
        AUTH["Auth View<br/>(Register / Login)"]
        CUST["Customer Portal<br/>(Orders, Tickets, AI Chat, Refunds)"]
        STAFF["Operations Console<br/>(Triage, Notes, Escalations, Audit)"]
    end

    subgraph API["FastAPI REST Gateway (/api)"]
        RBAC["JWT Auth & RBAC Middleware"]
        ROUTES["REST Routers<br/>(auth, orders, tickets, refunds, escalations, audit, policies)"]
    end

    subgraph Services["Authoritative Backend Services"]
        AGENT["AI Customer Support Agent<br/>(Multi-turn Context + Injection Shield)"]
        RAG["Local Policy RAG<br/>(TF-IDF + Tag Scoring over return_policy.md)"]
        ORDER_SVC["Order Service<br/>(Strict Ownership Verification)"]
        REFUND_SVC["Refund Service<br/>(Idempotency, Window Check, Rs 5000 Cap)"]
        ESC_SVC["Escalation Service<br/>(Specialist Queue & Decisions)"]
        AUDIT_SVC["Audit Service<br/>(Immutable Event Trail)"]
    end

    subgraph Storage["Relational Database (PostgreSQL / SQLite)"]
        DB[("users, orders, tickets,<br/>messages, refunds, escalations,<br/>internal_notes, audit_logs")]
    end

    AUTH --> RBAC
    CUST --> RBAC
    STAFF --> RBAC
    RBAC --> ROUTES

    ROUTES --> AGENT
    ROUTES --> ORDER_SVC
    ROUTES --> REFUND_SVC
    ROUTES --> ESC_SVC
    ROUTES --> AUDIT_SVC

    AGENT -->|"get_order_details"| ORDER_SVC
    AGENT -->|"search_return_policy"| RAG
    AGENT -->|"process_refund"| REFUND_SVC
    AGENT -->|"escalate_to_human"| ESC_SVC

    REFUND_SVC -->|"Amount <= Rs 5,000 & Eligible"| DB
    REFUND_SVC -->|"Amount > Rs 5,000"| ESC_SVC
    ESC_SVC -->|"Pending Human Review"| STAFF
    STAFF -->|"Approve / Reject / Request Info"| ESC_SVC
    ESC_SVC --> AUDIT_SVC
    REFUND_SVC --> AUDIT_SVC
    ORDER_SVC --> DB
    AUDIT_SVC --> DB
```

## AI Agent Tool & Guardrail Pipeline

1. **Prompt-Injection Firewall**: Incoming customer chat turns are screened against policy-override and privilege-escalation patterns before tool invocation. Blocked attempts are logged to `audit_logs` without executing any refund or order tools.
2. **Multi-Turn Context Resolution**: Extracts `ORD-*` references from the active message, linked ticket `order_id`, or earlier conversation turns. If missing on an order-dependent intent, the agent sets ticket status to `awaiting_customer` and asks for clarification without invoking tools prematurely.
3. **Deterministic Tool Binding**:
   - `get_order_details(order_id)` verifies account ownership and prevents cross-customer data leakage.
   - `search_return_policy(category)` retrieves category rules from `backend/app/policies/return_policy.md` using TF-IDF + category tag scoring.
   - `process_refund(order_id, amount, reason)` delegates strictly to `RefundService`, which validates delivery status, calendar return window, idempotency key, duplicate order refunds, and the `₹5,000` automated limit.
   - `escalate_to_human(ticket_id, summary, priority)` creates an `Escalation` record and transitions the ticket to `escalated` for human specialist review.
4. **LLM Separation of Concerns**: Even when an external OpenAI-compatible LLM is enabled (`LLM_PROVIDER=openai_compatible`), the LLM only formats verified server outcomes—it never executes SQL or authorizes refunds.
