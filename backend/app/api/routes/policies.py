from fastapi import APIRouter, Query
from app.policies.rag import policy_rag
from app.services.policy_service import CATEGORY_RETURN_WINDOWS

router = APIRouter(prefix="/policies", tags=["Return Policies"])


@router.get("")
def get_policy_overview():
    return {
        "category_windows_days": CATEGORY_RETURN_WINDOWS,
        "auto_refund_limit_inr": 5000.0,
        "document": policy_rag.full_document(),
    }


@router.get("/search")
def search_policies(q: str = Query(..., min_length=2, max_length=200)):
    return {"query": q, "results": policy_rag.search(q, top_k=3)}
