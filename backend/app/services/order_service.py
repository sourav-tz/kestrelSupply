from typing import List, Optional
from fastapi import status
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.db.models import Order, Refund, User
from app.schemas.order import OrderResponse
from app.services.policy_service import evaluate_order_eligibility


def _latest_refund_status(db: Session, order_id: str) -> Optional[str]:
    refund = (
        db.query(Refund)
        .filter(Refund.order_id == order_id)
        .order_by(Refund.created_at.desc())
        .first()
    )
    return refund.status if refund else None


def to_order_response(db: Session, order: Order) -> OrderResponse:
    latest_status = _latest_refund_status(db, order.id)
    eligibility = evaluate_order_eligibility(order, existing_refund_status=latest_status)
    return OrderResponse(
        id=order.id,
        customer_id=order.customer_id,
        status=order.status,
        delivery_date=order.delivery_date,
        total_amount=order.total_amount,
        currency=order.currency,
        item_name=order.item_name,
        category=order.category,
        item_details=order.item_details,
        created_at=order.created_at,
        eligibility=eligibility,
    )


def list_orders_for_user(db: Session, user: User) -> List[OrderResponse]:
    query = db.query(Order)
    if user.role == "customer":
        query = query.filter(Order.customer_id == user.id)
    orders = query.order_by(Order.created_at.desc()).all()
    return [to_order_response(db, order) for order in orders]


def get_order_details(db: Session, order_id: str, actor: User) -> OrderResponse:
    """
    Retrieves order details strictly verifying customer ownership.
    Never reveals whether an order ID belongs to another customer.
    """
    normalized_id = order_id.strip().upper()
    order = db.get(Order, normalized_id)
    if not order:
        raise AppError(
            status.HTTP_404_NOT_FOUND,
            "order_not_accessible",
            f"Order {normalized_id} was not found for your account.",
        )
    if actor.role == "customer" and order.customer_id != actor.id:
        raise AppError(
            status.HTTP_404_NOT_FOUND,
            "order_not_accessible",
            f"Order {normalized_id} was not found for your account.",
        )
    return to_order_response(db, order)
