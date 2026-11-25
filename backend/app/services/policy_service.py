from datetime import datetime, timezone
from typing import Optional

from app.core.config import get_settings
from app.db.models import Order
from app.policies.rag import policy_rag
from app.schemas.order import OrderEligibilityInfo

CATEGORY_RETURN_WINDOWS = {
    "electronics": 7,
    "apparel": 14,
    "homeware": 10,
    "beauty": 2,
    "consumables": 2,
}


def get_return_window_days(category: str) -> int:
    normalized = category.strip().lower()
    for key, days in CATEGORY_RETURN_WINDOWS.items():
        if key in normalized:
            return days
    return 7


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def evaluate_order_eligibility(
    order: Order,
    existing_refund_status: Optional[str] = None,
    requested_amount: Optional[float] = None,
) -> OrderEligibilityInfo:
    settings = get_settings()
    window_days = get_return_window_days(order.category)
    amount_to_check = requested_amount if requested_amount is not None else order.total_amount
    requires_escalation = amount_to_check > settings.AUTO_REFUND_LIMIT_INR
    has_existing_refund = existing_refund_status in ("pending_review", "approved", "processed")

    if order.status != "delivered" or order.delivery_date is None:
        return OrderEligibilityInfo(
            return_window_days=window_days,
            days_since_delivery=None,
            days_remaining=None,
            within_return_window=False,
            requires_human_escalation=requires_escalation,
            has_existing_refund=has_existing_refund,
            existing_refund_status=existing_refund_status,
            eligible_for_auto_refund=False,
            reason=f"Order is currently '{order.status}' and has not been delivered yet.",
        )

    now = datetime.now(timezone.utc)
    delivered_at = _ensure_utc(order.delivery_date)
    days_since = max(0, (now - delivered_at).days)
    days_remaining = window_days - days_since
    within_window = days_since <= window_days

    if has_existing_refund:
        reason = f"A refund record already exists with status '{existing_refund_status}'."
    elif not within_window:
        reason = (
            f"Return window expired: {order.category} orders allow {window_days} days from delivery, "
            f"and {days_since} days have elapsed."
        )
    elif requires_escalation:
        reason = (
            f"Within {window_days}-day return window, but amount ₹{amount_to_check:,.2f} exceeds the "
            f"₹{settings.AUTO_REFUND_LIMIT_INR:,.2f} automated approval threshold and requires specialist review."
        )
    else:
        reason = (
            f"Eligible for automated refund ({days_remaining} day(s) remaining in {window_days}-day "
            f"{order.category} return window)."
        )

    return OrderEligibilityInfo(
        return_window_days=window_days,
        days_since_delivery=days_since,
        days_remaining=max(0, days_remaining),
        within_return_window=within_window,
        requires_human_escalation=requires_escalation,
        has_existing_refund=has_existing_refund,
        existing_refund_status=existing_refund_status,
        eligible_for_auto_refund=(within_window and not requires_escalation and not has_existing_refund),
        reason=reason,
    )


def search_return_policy(category_or_query: str):
    return policy_rag.search(category_or_query, top_k=3)
