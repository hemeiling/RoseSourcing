from __future__ import annotations

import uuid

from fastapi import APIRouter
from sqlalchemy import select

from .. import audit
from ..models import BrandConcept
from ..schemas import BrandConceptOut, BrandConceptPatch, BrandGenerateIn
from ..services.agents.generators import generate_brand
from .deps import DB, CurrentUser, ProjectDep, owned

router = APIRouter(prefix="/api", tags=["brand"])

TITLES = {
    "names": "Brand name ideas", "positioning": "Brand positioning", "personas": "Customer personas",
    "voice": "Brand voice", "collections": "Collection concepts", "palettes": "Color palettes", "messaging": "Marketing messages",
    "social_posts": "Social posts", "video_script": "Video script", "image_briefs": "Image briefs",
}


@router.get("/projects/{project_id}/brand-concepts", response_model=list[BrandConceptOut])
def list_concepts(project: ProjectDep, db: DB, kind: str | None = None) -> list[BrandConcept]:
    stmt = select(BrandConcept).where(BrandConcept.project_id == project.id)
    if kind:
        stmt = stmt.where(BrandConcept.kind == kind)
    return list(db.scalars(stmt.order_by(BrandConcept.created_at.desc())))


@router.post("/projects/{project_id}/brand-concepts/generate", response_model=BrandConceptOut, status_code=201)
def generate(body: BrandGenerateIn, project: ProjectDep, db: DB, user: CurrentUser) -> BrandConcept:
    content, ex = generate_brand(db, project, user, body.kind, body.brief)
    concept = BrandConcept(project_id=project.id, kind=body.kind, title=TITLES[body.kind], content=content,
                           brief=body.brief, agent_execution_id=ex.id)
    db.add(concept)
    db.flush()
    audit.record(db, "brand_concept.generated", user_id=user.id, project_id=project.id, actor="agent:brand_strategy",
                 entity_type="brand_concept", entity_id=concept.id, details={"kind": body.kind})
    db.commit()
    return concept


@router.patch("/brand-concepts/{concept_id}", response_model=BrandConceptOut)
def update_concept(concept_id: uuid.UUID, body: BrandConceptPatch, db: DB, user: CurrentUser) -> BrandConcept:
    c = owned(db, BrandConcept, concept_id, user)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    db.commit()
    return c


@router.delete("/brand-concepts/{concept_id}", status_code=204)
def delete_concept(concept_id: uuid.UUID, db: DB, user: CurrentUser) -> None:
    c = owned(db, BrandConcept, concept_id, user)
    db.delete(c)
    db.commit()
