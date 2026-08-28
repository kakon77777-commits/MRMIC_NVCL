from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class RuntimePlan:
    decision: dict[str, Any]
    block_size: int | None
    algorithm: str | None
    runtime_workload: Any
    spatialization_plan: Any


@dataclass(frozen=True)
class RuntimeMaterialization:
    carrier_bytes: bytes
    block_size: int
    algorithm: str
    oracle_used: bool
    decision: dict[str, Any]


class HdsrcRuntimeAdapter:
    """Thin adapter over the canonical HDSRC v0.10 planning/materialization APIs.

    Production uses the real hdsrc_exp modules. CI may opt into a deterministic
    fixture backend only by explicitly setting HDSRC_TEST_STUB_RUNTIME=1.
    """

    def __init__(self, profile_root: Path) -> None:
        self.profile_root = Path(profile_root).resolve()
        self._stub = None
        if os.environ.get('HDSRC_TEST_STUB_RUNTIME') == '1':
            from hdsrc_exp.bridge_api import StubBridgeRuntime

            self._stub = StubBridgeRuntime(self.profile_root)
            return

        from hdsrc_exp.codec import decode_hds1
        from hdsrc_exp.materialization_features import extract_candidate_features
        from hdsrc_exp.multiscale_block_tiff_carrier import decode_hmbt1, encode_hmbt1_from_state
        from hdsrc_exp.multiscale_relation_router import (
            MultiScaleRelationWorkload,
            evaluate_workload_on_materialized_bank,
            materialize_multiscale_view_bank,
        )
        from hdsrc_exp.multiscale_spatializer import compile_multiscale_spatialization
        from hdsrc_exp.predictive_cost_model import PredictiveCostModel
        from hdsrc_exp.predictive_uncertainty import (
            EmpiricalUncertaintyCalibrator,
            MarginConfidencePolicy,
            select_uncertainty_aware_view,
        )

        self._decode_hds1 = decode_hds1
        self._extract_candidate_features = extract_candidate_features
        self._decode_hmbt1 = decode_hmbt1
        self._encode_hmbt1_from_state = encode_hmbt1_from_state
        self._MultiScaleRelationWorkload = MultiScaleRelationWorkload
        self._evaluate_workload_on_materialized_bank = evaluate_workload_on_materialized_bank
        self._materialize_multiscale_view_bank = materialize_multiscale_view_bank
        self._compile_multiscale_spatialization = compile_multiscale_spatialization
        self._select_uncertainty_aware_view = select_uncertainty_aware_view
        self._model = PredictiveCostModel.from_json(self._read_profile('predictive_cost_model_v0.10.json'))
        self._calibrator = EmpiricalUncertaintyCalibrator.from_json(
            self._read_profile('predictive_uncertainty_calibrator_v0.10.json')
        )
        self._confidence = MarginConfidencePolicy.from_json_dict(
            __import__('json').loads(self._read_profile('predictive_confidence_policy_v0.10.json'))
        )

    def _read_profile(self, filename: str) -> str:
        candidates = (
            self.profile_root / filename,
            self.profile_root / 'artifacts_image_v010' / filename,
        )
        for path in candidates:
            if path.is_file():
                return path.read_text(encoding='utf-8')
        raise FileNotFoundError(f'HDSRC profile artifact not found: {filename}')

    def decode_state(self, data: bytes):
        if self._stub is not None:
            return self._stub.decode_state(data)
        return self._decode_hds1(data)

    @staticmethod
    def _validated_workload_payload(workload: dict[str, Any]) -> tuple[int, int]:
        span = workload.get('expectedSpan')
        reuse = workload.get('expectedReuse', 1)
        if not isinstance(span, int) or isinstance(span, bool) or span < 1:
            raise ValueError('expectedSpan must be a positive integer')
        if not isinstance(reuse, int) or isinstance(reuse, bool) or reuse < 1:
            raise ValueError('expectedReuse must be a positive integer')
        return span, reuse

    def plan(self, state: Any, workload: dict[str, Any]) -> RuntimePlan:
        if self._stub is not None:
            return self._stub.plan(state, workload)
        span, reuse = self._validated_workload_payload(workload)
        runtime_workload = self._MultiScaleRelationWorkload(query_span=span, expected_reuse=reuse)
        spatialization_plan = self._compile_multiscale_spatialization(state)
        candidates = self._extract_candidate_features(state, runtime_workload, spatialization_plan)
        selected = self._select_uncertainty_aware_view(
            candidates,
            expected_reuse=reuse,
            model=self._model,
            calibrator=self._calibrator,
            confidence_policy=self._confidence,
        )
        if selected.requires_oracle:
            decision = {
                'schema': 'hdsrc-materialization-decision/v1',
                'decision': 'oracle_fallback',
                'confidence': {
                    'mode': 'empirical',
                    'requiresOracle': True,
                    'reason': 'outside_current_trust_region',
                },
            }
        else:
            decision = {
                'schema': 'hdsrc-materialization-decision/v1',
                'decision': 'fast_path',
                'selectedCarrier': 'HMBT1',
                'logicalScale': int(selected.selected_block_size),
                'confidence': {'mode': 'empirical', 'requiresOracle': False},
            }
        return RuntimePlan(
            decision=decision,
            block_size=int(selected.selected_block_size),
            algorithm=str(selected.selected_algorithm),
            runtime_workload=runtime_workload,
            spatialization_plan=spatialization_plan,
        )

    def materialize(self, state: Any, workload: dict[str, Any], plan: RuntimePlan) -> RuntimeMaterialization:
        if self._stub is not None:
            return self._stub.materialize(state, workload, plan)
        if plan.decision['decision'] == 'fast_path':
            if plan.block_size is None or plan.algorithm is None:
                raise RuntimeError('fast HDSRC plan is missing selected view')
            view = plan.spatialization_plan.view_for(plan.block_size)
            carrier = self._encode_hmbt1_from_state(
                state,
                block_size=plan.block_size,
                node_order=view.plan.physical_to_canonical,
                spatialization_id=view.plan.selected_algorithm,
            )
            decoded = self._decode_hmbt1(carrier)
            if decoded.state != state:
                raise RuntimeError('selected HMBT1 failed exact round-trip validation')
            return RuntimeMaterialization(
                carrier_bytes=carrier,
                block_size=plan.block_size,
                algorithm=str(view.plan.selected_algorithm),
                oracle_used=False,
                decision=plan.decision,
            )

        with tempfile.TemporaryDirectory(prefix='hdsrc-oracle-') as temp_dir:
            bank = self._materialize_multiscale_view_bank(state, temp_dir)
            oracle = self._evaluate_workload_on_materialized_bank(state, plan.runtime_workload, bank)
            selected = bank.view_for(oracle.selected_block_size)
            carrier = selected.path.read_bytes()
            return RuntimeMaterialization(
                carrier_bytes=carrier,
                block_size=int(oracle.selected_block_size),
                algorithm=str(oracle.selected_algorithm),
                oracle_used=True,
                decision=plan.decision,
            )
