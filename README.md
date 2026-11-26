# Kestrel — E-Commerce Customer Support, AI Resolution & Operations Suite

A full-stack e-commerce customer support, policy-grounded AI resolution agent, automated/escalated refund engine, and human operations workbench built with **React (JSX)**, **FastAPI**, and **PostgreSQL** (with optional SQLite local fallback).

---

## Architecture & Engineering Choices

- **Frontend (`frontend/`)**: **React 18 (JSX)** + **Vite** with Lucide SVG iconography and Google Sans typography—providing a Customer Resolution Portal (sidebar dashboard, orders & return-window tracking, auto-scrolling AI resolution chat, refund ledger, top-right React toast notifications) and an internal Staff Operations Console (3-pane triage workbench, escalation review, private internal notes, audit ledger, and policy RAG inspector).
- **Backend (`backend/`)**: **Python + FastAPI** chosen for native Pydantic v2 request/response validation, high-performance REST routing, dependency-injected JWT RBAC (`customer`, `support_agent`, `admin`), automatic OpenAPI/Swagger (`/docs`, `/redoc`), and structured JSON logging with secret redaction.
- **Database & Migrations (`backend/alembic/`)**: **PostgreSQL 16** (primary relational database via `psycopg[binary]`, with **SQLite** supported as a zero-setup local fallback) managed through **SQLAlchemy 2.0** and **Alembic** migrations. Enforces foreign keys, composite indexes, and unique `idempotency_key` constraints across 8 tables: `users`, `orders`, `tickets`, `messages`, `refunds`, `escalations`, `internal_notes`, and `audit_logs`.
- **AI Agent & RAG Approach**:
  - **Deterministic Tool Orchestration**: Rather than relying on unconstrained LLM outputs for financial actions, `backend/app/services/agent_service.py` enforces a prompt-injection firewall and binds 4 explicit backend tools (`get_order_details`, `search_return_policy`, `process_refund`, `escalate_to_human`). All ownership, return-window, duplicate-refund, and `₹5,000` threshold checks execute authoritatively on the server inside `RefundService`.
  - **Local Policy RAG (`backend/app/policies/rag.py`)**: Chunks the inspectable source policy document ([backend/app/policies/return_policy.md](backend/app/policies/return_policy.md)) by section and category rule using TF-IDF + category-tag boost scoring. Supports `local_deterministic` (no API key required), **Google Gemini (`LLM_PROVIDER=gemini`, `gemini-2.5-flash`)**, or any `openai_compatible` endpoint for NLU intent classification and natural response phrasing without ever delegating refund authorization to the LLM.

Detailed diagrams and API exports live in:
- Architecture Diagram (Visual): [docs/Kestrel Support Architecture Flowchart.png](docs/Kestrel%20Support%20Architecture%20Flowchart.png)
- Architecture & Agent Flow (Mermaid + Details): [docs/architecture.md](docs/architecture.md)
- Database ER Diagram (Visual): [docs/Kestrel_Support_Suite_ER_Diagram.png](docs/Kestrel_Support_Suite_ER_Diagram.png)
- Database Schema & ER Diagram (Mermaid + Details): [docs/database_schema.md](docs/database_schema.md)
- Exported OpenAPI Spec: [docs/openapi.json](docs/openapi.json)
- Exported Postman API Collection: [docs/api_collection.json](docs/api_collection.json)

---

## Prerequisites

- **Python** 3.11+ (tested on Python 3.14)
- **Node.js** 20+ and **npm** 10+
- **PostgreSQL** 16+ (or **Docker + Docker Compose** for containerized PostgreSQL + full-stack deployment)

---

## Environment Variables

Copy `.env.example` to `.env` before running locally or via Docker (never commit `.env` with real credentials):

```bash
cp .env.example .env
```

| Variable | Default / Example | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql+psycopg://postgres:your_postgres_password@localhost:5432/support_desk` | Primary PostgreSQL connection URL (or `sqlite:///./kestrel_support.db` for zero-setup fallback) |
| `TEST_DATABASE_URL` | *(auto-derived `<DATABASE_URL>_test`)* | Optional explicit PostgreSQL URL for `pytest` isolation |
| `JWT_SECRET_KEY` | `replace-with-a-secure-random-secret-key-at-least-32-chars` | HS256 signing key for JWT bearer tokens |
| `JWT_ALGORITHM` | `HS256` | JWT signing algorithm |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `720` | Token lifetime in minutes |
| `AUTO_REFUND_LIMIT_INR` | `5000` | Maximum automated refund cap in INR; higher amounts escalate to human review |
| `LLM_PROVIDER` | `local_deterministic` | `local_deterministic` (no API key needed), `gemini`, or `openai_compatible` |
| `LLM_API_KEY` | *(placeholder)* | Optional Gemini or OpenAI-compatible API key |
| `LLM_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` | Base URL for Gemini or OpenAI-compatible endpoint |
| `LLM_MODEL` | `gemini-2.5-flash` | Model name used when external LLM phrasing/NLU is enabled |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000` | Allowed frontend origins |
| `VITE_API_BASE_URL` | `http://localhost:8000/api` | API base URL used by Vite dev/build |
| `DOCKERHUB_REPO` | `souravoz/assignment3` | Docker Hub repository mapping for `backend` & `frontend` tags |

---

## Quick Start (Local Development)

### 1. Backend Setup, Database Migrations & Seed Data

Ensure PostgreSQL is running (and create the target database, e.g. `support_desk`, or switch `DATABASE_URL` in `.env` to `sqlite:///./kestrel_support.db`), then run:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Apply Alembic schema migrations and populate seed data idempotently
alembic upgrade head
python -m app.db.init_db

# Start FastAPI server (Swagger UI at http://localhost:8000/docs, ReDoc at /redoc)
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend Setup & Launch

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## Quick Start (Docker Compose with PostgreSQL)

```bash
cp .env.example .env
docker compose up --build -d
```

- **Frontend**: http://localhost:3000
- **Backend API & Swagger Docs**: http://localhost:8000/docs
- **PostgreSQL**: host port `5433` (container `5432`, database `kestrel_support` — avoids colliding with any local PostgreSQL on `5432`)

To push or pull mapped Docker Hub images (`souravoz/assignment3:backend` and `souravoz/assignment3:frontend`):

```bash
docker login
docker compose build && docker compose push
```

---

## Seeded Evaluation Accounts & Scenarios

All demo accounts are seeded idempotently by `backend/app/db/seed.py` and are accessible via the **Quick-Fill Evaluation Accounts** dropdown on the Sign-In screen:

| Role | Name | Email | Password | Seeded Scenarios |
| --- | --- | --- | --- | --- |
| Customer | Aarav Mehta | `aarav@kestrel.demo` | `Customer@123` | `ORD-1041` (₹4,299 eligible), `ORD-1042` (₹7,850 > ₹5,000 escalation), `ORD-1043` (expired 22d Apparel), `ORD-1044` (already refunded), `ORD-1045` (in transit) |
| Customer | Diya Kulkarni | `diya@kestrel.demo` | `Customer@123` | `ORD-2001` (₹3,600 eligible & cross-account isolation check), `ORD-2002` (escalated ₹6,499 audio defect `ESC-100001`) |
| Support Agent | Rohan Sen | `agent@kestrel.demo` | `Support@123` | Triage queue, internal notes, escalation approve/reject/request-info |
| Admin | Meera Nair | `admin@kestrel.demo` | `Admin@123` | Full operations console, refund authority, and immutable audit ledger |

---

## Automated Tests & Build Verification

The backend integration suite (`17` automated end-to-end tests in [backend/tests/test_e2e_workflows.py](backend/tests/test_e2e_workflows.py)) runs against an isolated PostgreSQL test database (`<DATABASE_URL>_test`, e.g. `support_desk_test`, or `TEST_DATABASE_URL` if set) and covers all mandatory business rules, RBAC isolation, multi-turn missing order ID clarification, ticket auto-reply, partial refunds, expired windows, `> ₹5,000` escalation & approval, idempotency/duplicate protection, prompt-injection guardrails, RAG retrieval, and DB failure handling:

```bash
cd backend
.venv/bin/pytest -v
```

Build verification for the React (JSX) frontend:

```bash
cd frontend
npm run build
```
