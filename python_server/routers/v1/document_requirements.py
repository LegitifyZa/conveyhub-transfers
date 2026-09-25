"""FastAPI Router for DEEDLY Document Requirements Engine & Document Center.

Provides REST endpoints for:
- Evaluating and viewing document requirements for a matter.
- Requesting ad-hoc / additional documents by the conveyancer.
- Uploading and reviewing requirement fulfillment artifacts.
- Marking generated documents as satisfied.
"""

from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from auth.current_user import CurrentUser
from auth.dependencies import require_jwt
from services.document_requirements_service import (
    evaluate_matter_requirements,
    get_matter_requirements,
    get_matter_requirements_summary,
    mark_generation_satisfied,
    record_document_download,
    record_document_upload,
    request_adhoc_document,
    review_document_requirement,
    MatterNotFoundError,
    RequirementNotFoundError,
)

router = APIRouter()


class AdhocRequirementRequest(BaseModel):
    document_code: str = Field(..., description="Document definition code from catalogue")
    title: str = Field(..., description="Human readable title for the requirement")
    instructions: Optional[str] = Field(None, description="Instructions to the party/attorney")
    target_party_id: Optional[UUID] = Field(None, description="Optional target party ID")


class UploadRecordRequest(BaseModel):
    transfer_document_id: UUID = Field(..., description="Uploaded transfer_document ID")


class ReviewRequirementRequest(BaseModel):
    approved: bool = Field(..., description="True if approved/satisfied, False if rejected")
    rejection_reason: Optional[str] = Field(None, description="Reason if rejected")


class GenerationSatisfyRequest(BaseModel):
    generation_id: str = Field(..., description="Generated document ID from Documents service")


@router.get("/matters/{matter_id}/document-requirements")
async def get_requirements(
    matter_id: UUID,
    user: CurrentUser = Depends(require_jwt),
):
    """Retrieve all active document requirements and completion summary for a matter."""
    if not user.has_ability("transfers:read"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    try:
        summary = await get_matter_requirements_summary(user.accountable_institution_id, matter_id)
        return {"message": "OK", "data": summary}
    except MatterNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Matter not found")


@router.post("/matters/{matter_id}/document-requirements/evaluate")
async def evaluate_requirements(
    matter_id: UUID,
    user: CurrentUser = Depends(require_jwt),
):
    """Triggers decision-tree rule evaluation against matter facts and synchronizes requirements."""
    if not user.has_ability("transfers:write"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    try:
        updated_reqs = await evaluate_matter_requirements(user.accountable_institution_id, matter_id)
        summary = await get_matter_requirements_summary(user.accountable_institution_id, matter_id)
        return {
            "message": "Requirements evaluated successfully",
            "data": summary
        }
    except MatterNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Matter not found")


@router.post("/matters/{matter_id}/document-requirements/adhoc")
async def add_adhoc_requirement(
    matter_id: UUID,
    body: AdhocRequirementRequest,
    user: CurrentUser = Depends(require_jwt),
):
    """Allows an attorney/conveyancer to request an ad-hoc or additional document."""
    if not user.has_ability("transfers:write"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    try:
        created = await request_adhoc_document(
            accountable_institution_id=user.accountable_institution_id,
            matter_id=matter_id,
            document_code=body.document_code,
            title=body.title,
            instructions=body.instructions,
            target_party_id=body.target_party_id,
            created_by_user_id=None,
        )
        return {"message": "Requirement added", "data": created}
    except MatterNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Matter not found")


@router.post("/matters/{matter_id}/document-requirements/{requirement_id}/upload")
async def mark_uploaded(
    matter_id: UUID,
    requirement_id: UUID,
    body: UploadRecordRequest,
    user: CurrentUser = Depends(require_jwt),
):
    """Records an uploaded document artifact for a requirement, moving it to review."""
    if not user.has_ability("transfers:write"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    try:
        res = await record_document_upload(
            accountable_institution_id=user.accountable_institution_id,
            requirement_id=requirement_id,
            transfer_document_id=body.transfer_document_id,
            uploaded_by_user_id=None,
        )
        return {"message": "Upload recorded", "data": res}
    except RequirementNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found")


@router.post("/matters/{matter_id}/document-requirements/{requirement_id}/review")
async def review_requirement(
    matter_id: UUID,
    requirement_id: UUID,
    body: ReviewRequirementRequest,
    user: CurrentUser = Depends(require_jwt),
):
    """Approves (satisfies) or rejects a submitted document requirement."""
    if not user.has_ability("transfers:write"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    try:
        res = await review_document_requirement(
            accountable_institution_id=user.accountable_institution_id,
            requirement_id=requirement_id,
            approved=body.approved,
            reviewer_user_id=None,
            rejection_reason=body.rejection_reason,
        )
        return {"message": "Review recorded", "data": res}
    except RequirementNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found")


@router.post("/matters/{matter_id}/document-requirements/{requirement_id}/satisfy-generation")
async def link_generation(
    matter_id: UUID,
    requirement_id: UUID,
    body: GenerationSatisfyRequest,
    user: CurrentUser = Depends(require_jwt),
):
    """Marks a generated document requirement as SATISFIED with its generation ID."""
    if not user.has_ability("transfers:write"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    try:
        res = await mark_generation_satisfied(
            accountable_institution_id=user.accountable_institution_id,
            requirement_id=requirement_id,
            generation_id=body.generation_id,
        )
        return {"message": "Generation satisfied", "data": res}
    except RequirementNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found")


@router.get("/matters/{matter_id}/document-requirements/{requirement_id}/download")
async def download_requirement_document(
    matter_id: UUID,
    requirement_id: UUID,
    user: CurrentUser = Depends(require_jwt),
):
    """Authorizes document download, asserts tenant isolation, and writes an audit log."""
    if not user.has_ability("transfers:read"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    try:
        res = await record_document_download(
            accountable_institution_id=user.accountable_institution_id,
            requirement_id=requirement_id,
            user_id=user.user_id,
        )
        return {"message": "Download authorized", "data": res}
    except RequirementNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found")

