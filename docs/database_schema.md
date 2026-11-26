# Database Schema & Entity-Relationship Diagram

## Entity-Relationship Diagram

![Kestrel PostgreSQL Database ER Diagram](./er_diagram.jpg)

```mermaid
erDiagram
    USERS ||--o{ ORDERS : "places"
    USERS ||--o{ TICKETS : "raises"
    USERS ||--o{ INTERNAL_NOTES : "authors"
    USERS ||--o{ AUDIT_LOGS : "triggers"
    ORDERS ||--o{ TICKETS : "referenced_by"
    ORDERS ||--o{ REFUNDS : "refunded_for"
    TICKETS ||--o{ MESSAGES : "contains"
    TICKETS ||--o{ REFUNDS : "tracks"
    TICKETS ||--o{ ESCALATIONS : "escalates_to"
    TICKETS ||--o{ INTERNAL_NOTES : "annotated_with"
    REFUNDS ||--o{ ESCALATIONS : "reviewed_via"

    USERS {
        string id PK
        string name
        string email UK
        string password_hash
        string role
        datetime created_at
    }

    ORDERS {
        string id PK
        string customer_id FK
        string status
        datetime delivery_date
        float total_amount
        string currency
        string item_name
        string category
        json item_details
        datetime created_at
    }

    TICKETS {
        string id PK
        string customer_id FK
        string order_id FK
        string subject
        text description
        string category
        string status
        string priority
        datetime created_at
        datetime updated_at
    }

    MESSAGES {
        string id PK
        string ticket_id FK
        string sender_type
        string sender_id FK
        text content
        json metadata_json
        datetime created_at
    }

    REFUNDS {
        string id PK
        string order_id FK
        string ticket_id FK
        float amount
        text reason
        string status
        string idempotency_key UK
        string requested_by FK
        string reviewed_by FK
        text decision_note
        datetime created_at
        datetime updated_at
    }

    ESCALATIONS {
        string id PK
        string ticket_id FK
        string refund_id FK
        text summary
        string reason_code
        string priority
        string assigned_to FK
        string decision
        text internal_note
        datetime created_at
        datetime updated_at
    }

    INTERNAL_NOTES {
        string id PK
        string ticket_id FK
        string author_id FK
        text note
        datetime created_at
    }

    AUDIT_LOGS {
        string id PK
        string actor_id FK
        string actor_role
        string action
        string resource_type
        string resource_id
        json details_json
        datetime created_at
    }
```

## Indexes & Constraints

- **Unique Constraints**: `users.email`, `refunds.idempotency_key` (`uq_refunds_idempotency_key`).
- **Composite Indexes**:
  - `ix_orders_customer_status` on `(customer_id, status)`
  - `ix_tickets_status_priority` on `(status, priority)`
  - `ix_tickets_customer_created` on `(customer_id, created_at)`
  - `ix_messages_ticket_created` on `(ticket_id, created_at)`
  - `ix_refunds_order_status` on `(order_id, status)`
  - `ix_escalations_decision_priority` on `(decision, priority)`
  - `ix_audit_logs_resource` on `(resource_type, resource_id)`
- **Migrations**: Managed via Alembic (`backend/alembic/versions/001_initial_schema.py`) and verified against both SQLite and PostgreSQL dialects.
