from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .codec import decode_hds1


@dataclass(frozen=True)
class StubPlan:
    decision: dict
    block_size: int | None
    algorithm: str | None
    runtime_workload: object = None
    spatialization_plan: object = None


@dataclass(frozen=True)
class StubMaterialization:
    carrier_bytes: bytes
    block_size: int
    algorithm: str
    oracle_used: bool
    decision: dict


class StubBridgeRuntime:
    def __init__(self, profile_root: Path) -> None:
        self.profile_root = Path(profile_root)

    def decode_state(self, data: bytes):
        return decode_hds1(data)

    def plan(self, state, workload: dict) -> StubPlan:
        span = workload.get('expectedSpan')
        if not isinstance(span, int) or isinstance(span, bool) or span < 1:
            raise ValueError('expectedSpan must be a positive integer')
        if span >= 32:
            decision = {
                'schema': 'hdsrc-materialization-decision/v1',
                'decision': 'oracle_fallback',
                'confidence': {
                    'mode': 'empirical',
                    'requiresOracle': True,
                    'reason': 'outside_current_trust_region',
                },
            }
            return StubPlan(decision, 64, 'RCM_PP')
        decision = {
            'schema': 'hdsrc-materialization-decision/v1',
            'decision': 'fast_path',
            'selectedCarrier': 'HMBT1',
            'logicalScale': 16,
            'confidence': {'mode': 'empirical', 'requiresOracle': False},
        }
        return StubPlan(decision, 16, 'RCM_PP')

    def materialize(self, state, workload: dict, plan: StubPlan) -> StubMaterialization:
        oracle_used = plan.decision['decision'] == 'oracle_fallback'
        block_size = 32 if oracle_used else int(plan.block_size)
        algorithm = 'BLOCK_GREEDY' if oracle_used else str(plan.algorithm)
        carrier = (
            f'HMBT1-STUB|d={int(state.dimension)}|b={block_size}|algorithm={algorithm}'
        ).encode('utf-8')
        return StubMaterialization(
            carrier_bytes=carrier,
            block_size=block_size,
            algorithm=algorithm,
            oracle_used=oracle_used,
            decision=plan.decision,
        )
