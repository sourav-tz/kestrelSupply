from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db.models import (
    AuditLog,
    Escalation,
    InternalNote,
    Message,
    Order,
    Refund,
    Ticket,
    User,
)


def seed_database(db: Session) -> None:
    """Idempotently populates users, orders, tickets, messages, refunds, and escalations."""
    if db.query(User).first() is not None:
        return

    now = datetime.now(timezone.utc)

    aarav = User(
        id="USR-CUST0001",
        name="Aarav Mehta",
        email="aarav@kestrel.demo",
        password_hash=hash_password("Customer@123"),
        role="customer",
        created_at=now - timedelta(days=45),
    )
    diya = User(
        id="USR-CUST0002",
        name="Diya Kulkarni",
        email="diya@kestrel.demo",
        password_hash=hash_password("Customer@123"),
        role="customer",
        created_at=now - timedelta(days=30),
    )
    agent = User(
        id="USR-STAF0001",
        name="Rohan Sen",
        email="agent@kestrel.demo",
        password_hash=hash_password("Support@123"),
        role="support_agent",
        created_at=now - timedelta(days=120),
    )
    admin = User(
        id="USR-ADMN0001",
        name="Meera Nair",
        email="admin@kestrel.demo",
        password_hash=hash_password("Admin@123"),
        role="admin",
        created_at=now - timedelta(days=180),
    )
    db.add_all([aarav, diya, agent, admin])
    db.flush()

    orders = [
        Order(
            id="ORD-1041",
            customer_id=aarav.id,
            status="delivered",
            delivery_date=now - timedelta(days=2),
            total_amount=4299.00,
            currency="INR",
            item_name="Keychron K2 Mechanical Keyboard (Gateron Brown)",
            category="Electronics",
            item_details={
                "sku": "ELC-K2-BRN",
                "qty": 1,
                "seller": "Kestrel Direct",
                "warranty": "12 months",
                "tracking_id": "KSL8849201IN",
            },
            created_at=now - timedelta(days=5),
        ),
        Order(
            id="ORD-1042",
            customer_id=aarav.id,
            status="delivered",
            delivery_date=now - timedelta(days=3),
            total_amount=7850.00,
            currency="INR",
            item_name="Aether Studio DAC & Aluminum Monitor Riser",
            category="Electronics",
            item_details={
                "sku": "ELC-ATH-785",
                "qty": 1,
                "seller": "Kestrel Direct",
                "warranty": "24 months",
                "tracking_id": "KSL8849104IN",
            },
            created_at=now - timedelta(days=6),
        ),
        Order(
            id="ORD-1043",
            customer_id=aarav.id,
            status="delivered",
            delivery_date=now - timedelta(days=22),
            total_amount=2450.00,
            currency="INR",
            item_name="Kestrel Merino Crewneck Knit (Charcoal, M)",
            category="Apparel",
            item_details={
                "sku": "APR-MRN-CHM",
                "qty": 1,
                "size": "M",
                "seller": "Kestrel Atelier",
                "tracking_id": "KSL8810342IN",
            },
            created_at=now - timedelta(days=26),
        ),
        Order(
            id="ORD-1044",
            customer_id=aarav.id,
            status="delivered",
            delivery_date=now - timedelta(days=5),
            total_amount=1890.00,
            currency="INR",
            item_name="Linen Modular Desk Tray Set (3-Piece)",
            category="Homeware",
            item_details={
                "sku": "HMW-LIN-003",
                "qty": 1,
                "finish": "Raw Flax",
                "seller": "Kestrel Home",
                "tracking_id": "KSL8845011IN",
            },
            created_at=now - timedelta(days=8),
        ),
        Order(
            id="ORD-1045",
            customer_id=aarav.id,
            status="shipped",
            delivery_date=None,
            total_amount=3190.00,
            currency="INR",
            item_name="Selvedge Canvas Overshirt (Olive, L)",
            category="Apparel",
            item_details={
                "sku": "APR-SLV-OLV",
                "qty": 1,
                "size": "L",
                "seller": "Kestrel Atelier",
                "tracking_id": "KSL8890122IN",
            },
            created_at=now - timedelta(days=1),
        ),
        Order(
            id="ORD-2001",
            customer_id=diya.id,
            status="delivered",
            delivery_date=now - timedelta(days=3),
            total_amount=3600.00,
            currency="INR",
            item_name="Artisan Ceramic Pour-Over Carafe Set",
            category="Homeware",
            item_details={
                "sku": "HMW-CER-401",
                "qty": 1,
                "finish": "Stone Glaze",
                "seller": "Kestrel Home",
                "tracking_id": "KSL8847701IN",
            },
            created_at=now - timedelta(days=6),
        ),
        Order(
            id="ORD-2002",
            customer_id=diya.id,
            status="delivered",
            delivery_date=now - timedelta(days=2),
            total_amount=6499.00,
            currency="INR",
            item_name="Sennheiser Studio Reference IEMs",
            category="Electronics",
            item_details={
                "sku": "ELC-SEN-649",
                "qty": 1,
                "seller": "Kestrel Direct",
                "warranty": "24 months",
                "tracking_id": "KSL8850019IN",
            },
            created_at=now - timedelta(days=5),
        ),
    ]
    db.add_all(orders)
    db.flush()

    # Seed one completed ticket + processed refund for Aarav (ORD-1044)
    tkt_resolved = Ticket(
        id="TKT-100001",
        customer_id=aarav.id,
        order_id="ORD-1044",
        subject="Damaged corner on desk tray divider",
        description="The smallest tray arrived with a cracked rim inside the inner sleeve.",
        category="Refund Request",
        status="resolved",
        priority="medium",
        created_at=now - timedelta(days=4),
        updated_at=now - timedelta(days=4),
    )
    # Seed one escalated high-value ticket for Diya (ORD-2002) for Support Staff inspection
    tkt_escalated = Ticket(
        id="TKT-100002",
        customer_id=diya.id,
        order_id="ORD-2002",
        subject="Left driver audio imbalance on studio IEMs",
        description="Left channel output drops intermittently below 30% volume. Requesting full refund.",
        category="Refund Request",
        status="escalated",
        priority="high",
        created_at=now - timedelta(hours=14),
        updated_at=now - timedelta(hours=14),
    )
    db.add_all([tkt_resolved, tkt_escalated])
    db.flush()

    db.add_all([
        Message(
            id="MSG-100001",
            ticket_id=tkt_resolved.id,
            sender_type="customer",
            sender_id=aarav.id,
            content="Hi, my Linen Modular Desk Tray Set (ORD-1044) arrived with a chipped inner divider. Can I get a refund?",
            metadata_json={},
            created_at=now - timedelta(days=4, minutes=5),
        ),
        Message(
            id="MSG-100002",
            ticket_id=tkt_resolved.id,
            sender_type="ai_agent",
            sender_id=None,
            content=(
                "I verified order ORD-1044 (Linen Modular Desk Tray Set, ₹1,890.00), delivered within the 10-day Homeware "
                "return window. Because the amount is within the ₹5,000 automated limit, I have processed your full refund "
                "of ₹1,890.00 (Reference: RFD-100001). Funds will reflect in 3-5 business days."
            ),
            metadata_json={
                "tools_used": ["get_order_details", "search_return_policy", "process_refund"],
                "outcome": "refund_processed",
            },
            created_at=now - timedelta(days=4, minutes=4),
        ),
        Message(
            id="MSG-100003",
            ticket_id=tkt_escalated.id,
            sender_type="customer",
            sender_id=diya.id,
            content="Requesting a full refund for ORD-2002 because the left earpiece cuts out.",
            metadata_json={},
            created_at=now - timedelta(hours=14),
        ),
        Message(
            id="MSG-100004",
            ticket_id=tkt_escalated.id,
            sender_type="ai_agent",
            sender_id=None,
            content=(
                "I checked order ORD-2002 (Sennheiser Studio Reference IEMs, ₹6,499.00). It is within the 7-day Electronics "
                "return window, however refunds above ₹5,000 require human specialist approval under Kestrel policy. "
                "I have created escalation ESC-100001 and logged your pending refund request (RFD-100002) for immediate review."
            ),
            metadata_json={
                "tools_used": ["get_order_details", "search_return_policy", "escalate_to_human"],
                "outcome": "escalated",
            },
            created_at=now - timedelta(hours=13, minutes=59),
        ),
    ])

    rfd_resolved = Refund(
        id="RFD-100001",
        order_id="ORD-1044",
        ticket_id=tkt_resolved.id,
        amount=1890.00,
        reason="Damaged inner divider on arrival",
        status="processed",
        idempotency_key="seed-rfd-ord-1044",
        requested_by=aarav.id,
        reviewed_by=None,
        decision_note="Auto-approved within Homeware 10-day return window and ₹5,000 limit.",
        created_at=now - timedelta(days=4),
        updated_at=now - timedelta(days=4),
    )
    rfd_pending = Refund(
        id="RFD-100002",
        order_id="ORD-2002",
        ticket_id=tkt_escalated.id,
        amount=6499.00,
        reason="Left channel audio imbalance defect",
        status="pending_review",
        idempotency_key="seed-rfd-ord-2002",
        requested_by=diya.id,
        reviewed_by=None,
        decision_note="Queued for specialist review: amount ₹6,499.00 exceeds ₹5,000.00 auto-approval limit.",
        created_at=now - timedelta(hours=13, minutes=59),
        updated_at=now - timedelta(hours=13, minutes=59),
    )
    db.add_all([rfd_resolved, rfd_pending])
    db.flush()

    esc = Escalation(
        id="ESC-100001",
        ticket_id=tkt_escalated.id,
        refund_id=rfd_pending.id,
        summary="High-value Electronics refund (₹6,499.00) on ORD-2002 for hardware defect; within 7-day window.",
        reason_code="high_value_refund",
        priority="high",
        assigned_to=agent.id,
        decision="pending",
        internal_note="Customer reported intermittent left driver drop-out; eligible window verified.",
        created_at=now - timedelta(hours=13, minutes=59),
        updated_at=now - timedelta(hours=13, minutes=59),
    )
    db.add(esc)

    note = InternalNote(
        id="NTE-100001",
        ticket_id=tkt_escalated.id,
        author_id=agent.id,
        note="Verified courier POD timestamp and serial SKU batch. Ready for refund approval decision.",
        created_at=now - timedelta(hours=10),
    )
    db.add(note)

    db.add_all([
        AuditLog(
            id="AUD-100001",
            actor_id=aarav.id,
            actor_role="customer",
            action="refund_processed",
            resource_type="refund",
            resource_id="RFD-100001",
            details_json={"order_id": "ORD-1044", "amount": 1890.00, "mode": "automated"},
            created_at=now - timedelta(days=4),
        ),
        AuditLog(
            id="AUD-100002",
            actor_id=diya.id,
            actor_role="customer",
            action="escalation_created",
            resource_type="escalation",
            resource_id="ESC-100001",
            details_json={"order_id": "ORD-2002", "amount": 6499.00, "reason_code": "high_value_refund"},
            created_at=now - timedelta(hours=13, minutes=59),
        ),
    ])

    db.commit()
