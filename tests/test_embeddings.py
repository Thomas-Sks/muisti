"""Our bge-m3 (sentence-transformers, GPU, fp16) must agree with dataset S's vectors (Ollama bge-m3),
otherwise questions embedded by us would not match the ready-made article vectors."""
import numpy as np
import pyarrow.parquet as pq

from backend import config
from backend.embed import embed

S = config.DATA_RAW / "s"


def test_embeddings_match_dataset_vectors():
    arts = pq.read_table(S / "articles-fi.parquet", columns=["page_id", "title", "text"]).to_pylist()
    vecs = pq.read_table(S / "vectors-bge-m3-fi.parquet")
    by_id = {int(p): i for i, p in enumerate(vecs.column("page_id").to_pylist())}
    truncated = vecs.column("truncated").to_pylist()
    emb = np.asarray(vecs.column("embedding").combine_chunks().values.to_numpy(zero_copy_only=False),
                     dtype=np.float32).reshape(-1, 1024)
    sample = [a for a in arts if a["page_id"] in by_id and not truncated[by_id[a["page_id"]]]
              and 200 < len(a["text"]) < 6000][:24]
    ours = embed([f"{a['title']}\n\n{a['text']}" for a in sample], batch_size=8)
    theirs = np.stack([emb[by_id[a["page_id"]]] for a in sample])
    theirs /= np.linalg.norm(theirs, axis=1, keepdims=True)
    cos = (ours * theirs).sum(axis=1)
    print("cosine ours vs dataset: min %.4f mean %.4f" % (cos.min(), cos.mean()))
    assert cos.min() > 0.98, cos
