from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from ...store.runs import get_episode, get_steps
from ..schemas import EpisodeOut, StepOut

router = APIRouter(prefix="/api/episodes", tags=["episodes"])


@router.get("/{episode_id}", response_model=EpisodeOut)
def detail(episode_id: str, request: Request) -> EpisodeOut:
    episode = get_episode(request.app.state.db, episode_id)
    if episode is None:
        raise HTTPException(404, "episode not found")
    data = dict(episode)
    data["task_key"] = data["task_id"].split(":", 1)[-1]
    return EpisodeOut(**data)


@router.get("/{episode_id}/steps", response_model=list[StepOut])
def steps(episode_id: str, request: Request) -> list[StepOut]:
    if get_episode(request.app.state.db, episode_id) is None:
        raise HTTPException(404, "episode not found")
    return [
        StepOut(**item)
        for item in get_steps(request.app.state.db, episode_id)
    ]
