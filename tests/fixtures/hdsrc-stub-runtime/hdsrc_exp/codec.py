class StubState:
    dimension = 4096
    vector_ids = ("v0", "v1", "v2", "v3")
    relations = ()
    components = (0, 0, 0, 0)
    degree_bands = (0, 0, 0, 0)
    source_digest = "stub-source"
    profile_id = "stub-profile"
    quantization_scale = 127
    k_neighbors = 0
    relation_payload_digest = "stub-relations"
    basis_profile_id = "stub-basis"
    basis_scales = (1.0, 1.0, 1.0, 1.0)
    basis_qvalues = bytes(4 * 4096)
    basis_payload_digest = "stub-basis-payload"


def decode_hds1(data: bytes):
    if not data.startswith(b"HDSRC-STUB-STATE-v1"):
        raise ValueError("invalid stub HDS1")
    return StubState()
