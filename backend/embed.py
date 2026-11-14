"""bge-m3 dense embeddings on the GPU (sentence-transformers). Same model as dataset S's vectors
(computed there with Ollama); tests/test_embeddings.py checks the two agree.

The model is loaded once per process, under a lock: concurrent first requests (e.g. search-as-you-type)
must not each load their own copy (that exhausted the 8 GB GPU). If the GPU runs out of memory anyway,
the allocator cache is freed and the call retried with batch size 1.
"""
from __future__ import annotations

import logging
import os
import threading

import numpy as np

from . import config

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
log = logging.getLogger("muisti.embed")

_load_lock = threading.Lock()
_run_lock = threading.Lock()
_model = None


def model():
    global _model
    if _model is None:
        with _load_lock:
            if _model is None:                      # double-checked: only one load per process
                import torch
                from sentence_transformers import SentenceTransformer

                device = "cuda" if torch.cuda.is_available() else "cpu"
                m = SentenceTransformer(config.MODEL_NAME, device=device,
                                        model_kwargs={"torch_dtype": torch.float16} if device == "cuda" else {})
                _model = m
    return _model


def embed(texts: list[str], batch_size: int = 32, max_length: int = 8192) -> np.ndarray:
    """L2-normalised float32 vectors, shape (len(texts), 1024)."""
    import torch

    m = model()
    with _run_lock:
        m.max_seq_length = max_length
        try:
            v = m.encode(texts, batch_size=batch_size, normalize_embeddings=True,
                         convert_to_numpy=True, show_progress_bar=False)
        except torch.OutOfMemoryError:
            # Free the allocator cache and retry once with small batches (the model stays on the GPU).
            log.warning("GPU out of memory while embedding %d texts; retrying with batch size 1", len(texts))
            torch.cuda.empty_cache()
            v = m.encode(texts, batch_size=1, normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False)
    return v.astype(np.float32)


def embed_one(text: str) -> np.ndarray:
    return embed([text], batch_size=1, max_length=512)[0]
