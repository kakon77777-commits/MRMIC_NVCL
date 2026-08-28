from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, Callable


def _argument_value(flag: str) -> str:
    try:
        index = sys.argv.index(flag)
    except ValueError as exc:
        raise RuntimeError(f"required HDSRC host argument is missing: {flag}") from exc
    if index + 1 >= len(sys.argv) or not sys.argv[index + 1].strip():
        raise RuntimeError(f"required HDSRC host argument is invalid: {flag}")
    return sys.argv[index + 1].strip()


def _production_codec() -> Callable[[bytes], Any]:
    profile_root = Path(_argument_value("--profile-root")).expanduser().resolve()
    module_root = profile_root / "src"
    package_root = module_root / "hdsrc_exp"
    if not package_root.is_dir():
        raise RuntimeError(f"configured HDSRC module root is missing: {package_root}")

    module_root_text = str(module_root)
    sys.path[:] = [item for item in sys.path if item != module_root_text]
    sys.path.insert(0, module_root_text)

    import hdsrc_exp

    loaded_file = getattr(hdsrc_exp, "__file__", None)
    if not isinstance(loaded_file, str) or not loaded_file:
        raise RuntimeError("loaded hdsrc_exp package has no filesystem identity")
    loaded = Path(loaded_file).resolve()
    if module_root != loaded and module_root not in loaded.parents:
        raise RuntimeError(
            f"loaded hdsrc_exp is outside configured profileRoot: {loaded}"
        )

    from hdsrc_exp.codec import decode_hds1

    codec_file = Path(sys.modules[decode_hds1.__module__].__file__).resolve()
    if module_root != codec_file and module_root not in codec_file.parents:
        raise RuntimeError(
            f"loaded HDSRC codec is outside configured profileRoot: {codec_file}"
        )
    return decode_hds1


def _test_codec() -> Callable[[bytes], Any]:
    from hdsrc_exp.codec import decode_hds1

    return decode_hds1


# The fixture backend is available only when tests opt in explicitly. Normal
# production launches always bind the canonical module tree under profileRoot.
decode_hds1 = _test_codec() if os.environ.get("HDSRC_TEST_STUB_RUNTIME") == "1" else _production_codec()
