from datetime import datetime
from typing import Any, Dict, Optional
from pydantic import BaseModel


class OrderEligibilityInfo(BaseModel):
    return_window_days: int
    days_since_delivery: Optional[int] = None
    days_remaining: Optional[int] = None
    within_return_window: bool
    requires_human_escalation: bool
    has_existing_refund: bool
    existing_refund_status: Optional[str] = None
    eligible_for_auto_refund: bool
    reason: str


class OrderResponse(BaseModel):
    id: str
    customer_id: str
    status: str
    delivery_date: Optional[datetime]
    total_amount: float
    currency: str
    item_name: str
    category: str
    item_details: Dict[str, Any]
    created_at: datetime
    eligibility: Optional[OrderEligibilityInfo] = None

    model_config = {"from_attributes": True}
