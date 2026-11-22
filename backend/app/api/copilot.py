from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from ..models import CopilotThread
from ..schemas import CopilotAskIn, CopilotMessageOut, CopilotThreadDetail, CopilotThreadOut
from ..services.agents.copilot import answer
from .deps import DB, CurrentUser, ProjectDep, owned

router = APIRouter(prefix="/api", tags=["copilot"])


@router.get("/projects/{project_id}/copilot/threads", response_model=list[CopilotThreadOut])
def list_threads(project: ProjectDep, db: DB, user: CurrentUser) -> list[CopilotThread]:
    return list(db.scalars(select(CopilotThread).where(CopilotThread.project_id == project.id, CopilotThread.user_id == user.id)
                           .order_by(CopilotThread.updated_at.desc())))


@router.get("/copilot/threads/{thread_id}", response_model=CopilotThreadDetail)
def get_thread(thread_id: uuid.UUID, db: DB, user: CurrentUser) -> CopilotThread:
    return owned(db, CopilotThread, thread_id, user)


@router.delete("/copilot/threads/{thread_id}", status_code=204)
def delete_thread(thread_id: uuid.UUID, db: DB, user: CurrentUser) -> None:
    t = owned(db, CopilotThread, thread_id, user)
    db.delete(t)
    db.commit()


@router.post("/projects/{project_id}/copilot/ask")
def ask(body: CopilotAskIn, project: ProjectDep, db: DB, user: CurrentUser) -> dict:
    if body.thread_id:
        thread = owned(db, CopilotThread, body.thread_id, user)
        if thread.project_id != project.id:
            raise HTTPException(404, "Thread not found in this project")
    else:
        thread = CopilotThread(project_id=project.id, user_id=user.id)
        db.add(thread)
        db.commit()
    reply = answer(db, project, user, thread, body.question)
    db.refresh(thread)
    return {"thread": CopilotThreadDetail.model_validate(thread).model_dump(mode="json"),
            "message": CopilotMessageOut.model_validate(reply).model_dump(mode="json")}
