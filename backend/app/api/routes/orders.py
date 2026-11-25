from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.models import User
from app.schemas.order import OrderResponse
from app.services.order_service import get_order_details, list_orders_for_user

router = APIRouter(prefix="/orders", tags=["Orders"])


@router.get("", response_model=List[OrderResponse])
def list_orders(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return list_orders_for_user(db, current_user)


@router.get("/{order_id}", response_model=OrderResponse)
def get_order(order_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_order_details(db, order_id, current_user)
