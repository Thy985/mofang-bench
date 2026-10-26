from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from ...store.benchmarks import (
    get_benchmark,
    list_benchmarks,
    save_benchmark,
)
from ...tasks.generator import generate_benchmark
from ...tasks.models import Benchmark
from ..schemas import BenchmarkCreate, BenchmarkDetail, BenchmarkOut

router = APIRouter(prefix="/api/benchmarks", tags=["benchmarks"])


def _benchmark_out(benchmark: Benchmark) -> BenchmarkOut:
    return BenchmarkOut(
        id=benchmark.id,
        name=benchmark.name,
        version=benchmark.version,
        kind=benchmark.kind,
        cube=benchmark.cube,
        content_hash=benchmark.content_hash,
        frozen_at=benchmark.created_at,
        task_count=len(benchmark.tasks),
    )


def _detail(benchmark: Benchmark) -> BenchmarkDetail:
    return BenchmarkDetail(
        **_benchmark_out(benchmark).model_dump(),
        tasks=[task.model_dump() for task in benchmark.tasks],
    )


@router.post("", response_model=BenchmarkDetail, status_code=201)
def create(payload: BenchmarkCreate, request: Request) -> BenchmarkDetail:
    if not payload.depths or any(depth < 1 for depth in payload.depths):
        raise HTTPException(400, "depths must be positive")
    if payload.cube == "2x2" and payload.solver != "table":
        raise HTTPException(400, "2x2 requires table solver")
    if payload.cube == "3x3" and payload.solver != "rubik":
        raise HTTPException(400, "3x3 requires rubik solver")
    benchmark_id = f"{payload.name}-{payload.cube}-{payload.seed}"
    if get_benchmark(request.app.state.db, benchmark_id) is not None:
        raise HTTPException(
            409,
            {"message": "benchmark already exists", "id": benchmark_id},
        )
    solver = None
    try:
        solver = request.app.state.solver_factory(payload.cube)
        benchmark = generate_benchmark(
            name=payload.name,
            cube=payload.cube,
            depths=payload.depths,
            per_depth=payload.per_depth,
            seed=payload.seed,
            solver=solver,
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(400, str(exc)) from exc
    finally:
        close = getattr(solver, "close", None)
        if close is not None:
            close()
    benchmark.content_hash = benchmark.compute_hash()
    save_benchmark(
        request.app.state.db,
        benchmark,
        payload.model_dump(),
    )
    return _detail(benchmark)


@router.get("", response_model=list[BenchmarkOut])
def list_all(request: Request) -> list[BenchmarkOut]:
    return [BenchmarkOut(**item) for item in list_benchmarks(request.app.state.db)]


@router.get("/{benchmark_id}", response_model=BenchmarkDetail)
def detail(benchmark_id: str, request: Request) -> BenchmarkDetail:
    benchmark = get_benchmark(request.app.state.db, benchmark_id)
    if benchmark is None:
        raise HTTPException(404, "benchmark not found")
    return _detail(benchmark)
