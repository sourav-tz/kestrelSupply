# Kestrel — E-Commerce Customer Support, AI Resolution & Operations Suite

A full-stack customer support, policy-grounded AI agent, automated refund engine, and human escalation workbench built with **React (JSX)**, **FastAPI**, and **PostgreSQL / SQLite**.

---

## Architecture & Engineering Highlights

- **Frontend (`frontend/`)**: React 18 (JSX), Vite, Lucide SVG iconography, responsive Customer Resolution Portal and Staff Operations Console using the Nunito Variable typeface.
- **Backend (`backend/`)**: Python + FastAPI REST API with OpenAPI/Swagger (`/docs`, `/redoc`), Pydantic v2 validation, bcrypt password hashing, JWT role-based access control (`customer`, `support_agent`, `admin`), and structured JSON logging with secret scrubbing.
- **Database Choice & Migrations (`backend/alembic/`)**: **PostgreSQL 16** (configured in `docker-compose.yml` via `psycopg[binary]`) is the primary relational database, with **SQLite** supported as a zero-setup local fallback via SQLAlchemy 2.0 + Alembic migrations. This lets evaluators run locally in one command while preserving strict foreign keys, composite indexes, and unique `idempotency_key` constraints across `users`, `orders`, `tickets`, `messages`, `refunds`, `escalations`, `internal_notes`, and `audit_logs`.
- **AI Agent & RAG Choice**:
  - **Why custom deterministic tool orchestration**: Rather than depending on a paid external framework or risking LLM-hallucinated refund approvals, the AI agent runs an explicit deterministic tool router (`get_order_details`, `search_return_policy`, `process_refund`, `escalate_to_human`) with a prompt-injection firewall and multi-turn conversation state.
  - **RAG Approach**: `backend/app/policies/rag.py` chunks the inspectable source policy document (`backend/app/policies/return_policy.md`) by policy section and category bullet, computing TF-IDF + category-tag boost scores so policy rules are transparent, auditable, and zero-cost to run locally. An optional OpenAI-compatible phrasing layer (`LLM_PROVIDER=openai_compatible`) can be enabled via environment variables without ever delegating authorization or refund execution to the LLM.

Detailed diagrams and API exports live in:
- Architecture & Agent Flow: [docs/architecture.md](docs/architecture.md)
- Database Schema & ER Diagram: [docs/database_schema.md](docs/database_schema.md)
- Exported OpenAPI Spec: [docs/openapi.json](docs/openapi.json)
- Exported Postman API Collection: [docs/api_collection.json](docs/api_collection.json)

---

## Prerequisites

- **Python** 3.11+ (tested on Python 3.14)
- **Node.js** 20+ and **npm** 10+
- **Docker + Docker Compose** (optional, for containerized PostgreSQL + full-stack launch)

---

## Environment Variables

Copy `.env.example` to `.env` before customizing configuration (never commit `.env` with real credentials):

| Variable | Default / Example | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///./kestrel_support.db` | SQLite for zero-config local run, or `postgresql+psycopg://...` for PostgreSQL |
| `JWT_SECRET_KEY` | `replace-with-a-secure-random-secret-key-at-least-32-chars` | HS256 signing key for JWT bearer tokens |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `720` | Token lifetime in minutes |
| `AUTO_REFUND_LIMIT_INR` | `5000` | Maximum automated refund threshold in INR; higher values escalate to human review |
| `LLM_PROVIDER` | `local_deterministic` | `local_deterministic` (no API key needed) or `openai_compatible` |
| `LLM_API_KEY` | *(empty)* | Optional API key when using `openai_compatible` phrasing |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000` | Allowed frontend origins |

---

## Quick Start (Local Development — Zero External Dependencies)

### 1. Backend Setup, Migrations & Seed Data

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Run Alembic schema migrations and seed realistic evaluation data
alembic upgrade head
python -m app.db.init_db

# Start FastAPI server (Swagger UI available at http://localhost:8000/docs)
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
docker compose up --build
```

- **Frontend**: http://localhost:3000
- **Backend API & Swagger Docs**: http://localhost:8000/docs
- **PostgreSQL**: `localhost:5432` (database `kestrel_support`)

---

## Seeded Evaluation Accounts & Scenarios

All demo accounts are pre-seeded idempotently by `app/db/seed.py` (and also available as quick-fill cards on the Sign-In screen):

| Role | Name | Email | Password | Highlights |
| --- | --- | --- | --- | --- |
| Customer | Aarav Mehta | `aarav@kestrel.demo` | `Customer@123` | `ORD-1041` (₹4,299 eligible), `ORD-1042` (₹7,850 > ₹5,000 escalation), `ORD-1043` (expired 22d Apparel), `ORD-1044` (already refunded), `ORD-1045` (in transit) |
| Customer | Diya Kulkarni | `diya@kestrel.demo` | `Customer@123` | `ORD-2001` (cross-account isolation check), `ORD-2002` (escalated ₹6,499 audio defect `ESC-100001`) |
| Support Agent | Rohan Sen | `agent@kestrel.demo` | `Support@123` | Triage queue, internal notes, escalation approve/reject/request-info |
| Admin | Meera Nair | `admin@kestrel.demo` | `Admin@123` | Full operations console, refund authority, and immutable audit ledger |

---

## Automated Tests

The backend integration suite verifies all mandatory business rules, RBAC isolation, multi-turn agent clarification, idempotency, prompt-injection defense, RAG retrieval, and DB failure handling:

```bash
cd backend
.venv/bin/pytest -v
```

Build verification for the React (JSX) frontend:

```bash
cd frontend
npm run build
```
