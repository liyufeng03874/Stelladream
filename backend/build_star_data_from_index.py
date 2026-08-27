"""
Build Stelladream star_data.json directly from the configured Elasticsearch index.

This script is intended to replace the early demo dataset with real index-backed
stars while keeping the frontend data contract stable.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, UTC
from pathlib import Path
from typing import Any, Dict, Iterable, List

import numpy as np
from elasticsearch import Elasticsearch, helpers
from sklearn.feature_extraction.text import TfidfVectorizer
from umap import UMAP


CONFIG_PATH = Path(__file__).parent.parent / "shared" / "config.json"
DATA_DIR = Path(__file__).parent.parent / "data"

with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    config = json.load(f)

ES_CONFIG = config["elasticsearch"]
DOMAINS = config["domains"]
VISUAL_CONFIG = config["visual"]
UMAP_CONFIG = config["umap"]

INDEX_DOMAIN_OVERRIDES = {
    "lecard_m3_doc": "law",
}
COORD_SCALE = 15.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build star data from Elasticsearch embeddings.")
    parser.add_argument("--index", default=ES_CONFIG["index"], help="Elasticsearch index name")
    parser.add_argument("--host", default=ES_CONFIG["host"], help="Elasticsearch host URL")
    parser.add_argument(
        "--output",
        default=str(DATA_DIR / "star_data.json"),
        help="Output path for generated star data JSON",
    )
    parser.add_argument(
        "--meta-output",
        default=str(DATA_DIR / "star_data.meta.json"),
        help="Output path for generation metadata JSON",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional limit for debugging; 0 means export all documents",
    )
    return parser.parse_args()


def infer_domain(index_name: str, source: str, source_path: str) -> str:
    if index_name in INDEX_DOMAIN_OVERRIDES:
        return INDEX_DOMAIN_OVERRIDES[index_name]

    haystack = f"{source} {source_path}".lower()
    for domain, info in DOMAINS.items():
        for token in info.get("sources", []):
            if token.lower() in haystack:
                return domain
    return "general"


def compute_size(content_length: int) -> float:
    min_size = VISUAL_CONFIG["size"]["min"]
    max_size = VISUAL_CONFIG["size"]["max"]
    log_base = VISUAL_CONFIG["size"]["logBase"]

    log_len = np.log(content_length + 1) / np.log(log_base)
    log_min = np.log(10) / np.log(log_base)
    log_max = np.log(10000) / np.log(log_base)
    normalized = (log_len - log_min) / (log_max - log_min)
    normalized = np.clip(normalized, 0, 1)
    return float(normalized * (max_size - min_size) + min_size)


def stream_docs(es: Elasticsearch, index_name: str, limit: int = 0) -> Iterable[Dict[str, Any]]:
    scanned = 0
    for hit in helpers.scan(
        es,
        index=index_name,
        query={"query": {"match_all": {}}},
        size=ES_CONFIG["scroll_size"],
        scroll="5m",
        _source=["content", "source", "source_path", "doc_id", "chunk_index", "embedding"],
    ):
        source = hit.get("_source", {})
        embedding = source.get("embedding") or []
        if not embedding:
            continue

        source_name = source.get("source") or Path(str(source.get("source_path", ""))).name or hit["_id"]
        source_path = source.get("source_path", "")

        yield {
            "chunk_id": hit["_id"],
            "doc_id": source.get("doc_id"),
            "chunk_index": source.get("chunk_index"),
            "content": source.get("content", ""),
            "source": source_name,
            "source_path": source_path,
            "domain": infer_domain(index_name, source_name, source_path),
            "embedding": embedding,
        }

        scanned += 1
        if scanned % 2000 == 0:
            print(f"  exported {scanned:,} docs")
        if limit > 0 and scanned >= limit:
            break


def load_docs(es: Elasticsearch, index_name: str, limit: int = 0) -> List[Dict[str, Any]]:
    print(f"Connecting to Elasticsearch: {es}")
    print(f"Exporting docs from index: {index_name}")
    docs = list(stream_docs(es, index_name, limit=limit))
    if not docs:
        raise RuntimeError(f"No documents with embeddings found in index {index_name}")
    print(f"Export complete: {len(docs):,} docs")
    return docs


def compute_brightnesses(docs: List[Dict[str, Any]]) -> np.ndarray:
    print("Computing TF-IDF entropy brightness...")
    texts = [doc["content"] if doc["content"] else doc["chunk_id"] for doc in docs]
    vectorizer = TfidfVectorizer(max_features=10000, max_df=0.8, min_df=2)
    tfidf_matrix = vectorizer.fit_transform(texts)

    entropies = np.zeros(tfidf_matrix.shape[0], dtype=np.float64)
    for i in range(tfidf_matrix.shape[0]):
        row = tfidf_matrix[i]
        if row.nnz == 0:
            continue
        probs = row.data / row.data.sum()
        entropies[i] = -np.sum(probs * np.log(probs + 1e-10))

    min_val = float(entropies.min())
    max_val = float(entropies.max())
    brightness_min = VISUAL_CONFIG["brightness"]["min"]
    brightness_max = VISUAL_CONFIG["brightness"]["max"]

    if max_val <= min_val:
        return np.full(len(docs), brightness_max, dtype=np.float64)

    normalized = (entropies - min_val) / (max_val - min_val)
    return normalized * (brightness_max - brightness_min) + brightness_min


def reduce_embeddings(docs: List[Dict[str, Any]]) -> np.ndarray:
    embeddings = np.array([doc["embedding"] for doc in docs], dtype=np.float32)
    print(f"Embedding matrix shape: {embeddings.shape}")
    print("Running UMAP 3D reduction...")

    reducer = UMAP(
        n_components=UMAP_CONFIG["n_components"],
        n_neighbors=UMAP_CONFIG["n_neighbors"],
        min_dist=UMAP_CONFIG["min_dist"],
        random_state=UMAP_CONFIG["random_state"],
        verbose=True,
        n_jobs=1,
    )
    coords = reducer.fit_transform(embeddings).astype(np.float64)
    coords -= coords.mean(axis=0, keepdims=True)
    coords *= COORD_SCALE
    return coords


def build_star_data(docs: List[Dict[str, Any]], coords: np.ndarray, brightnesses: np.ndarray) -> List[Dict[str, Any]]:
    star_data: List[Dict[str, Any]] = []
    for doc, coord, brightness in zip(docs, coords, brightnesses):
        star_data.append(
            {
                "x": float(coord[0]),
                "y": float(coord[1]),
                "z": float(coord[2]),
                "domain": doc["domain"],
                "chunk_id": doc["chunk_id"],
                "doc_id": doc.get("doc_id"),
                "chunk_index": doc.get("chunk_index"),
                "source_path": doc.get("source_path", ""),
                "content": doc["content"],
                "source": doc["source"],
                "size": compute_size(len(doc["content"])),
                "brightness": float(brightness),
            }
        )
    return star_data


def write_outputs(
    star_data: List[Dict[str, Any]],
    docs: List[Dict[str, Any]],
    output_path: Path,
    meta_path: Path,
    index_name: str,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(star_data, f, ensure_ascii=False)

    xs = [item["x"] for item in star_data]
    ys = [item["y"] for item in star_data]
    zs = [item["z"] for item in star_data]
    domain_counts = Counter(doc["domain"] for doc in docs)

    metadata = {
        "generated_at": datetime.now(UTC).isoformat(),
        "index": index_name,
        "count": len(star_data),
        "domains": dict(domain_counts),
        "coordinate_ranges": {
            "x": [min(xs), max(xs)],
            "y": [min(ys), max(ys)],
            "z": [min(zs), max(zs)],
        },
    }
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    print(f"Saved star data to {output_path}")
    print(f"Saved metadata to {meta_path}")


def main() -> None:
    args = parse_args()
    output_path = Path(args.output)
    meta_path = Path(args.meta_output)

    es = Elasticsearch(args.host, meta_header=False)
    if not es.indices.exists(index=args.index):
        raise RuntimeError(f"Index not found: {args.index}")

    docs = load_docs(es, args.index, limit=args.limit)
    brightnesses = compute_brightnesses(docs)
    coords = reduce_embeddings(docs)
    star_data = build_star_data(docs, coords, brightnesses)
    write_outputs(star_data, docs, output_path, meta_path, args.index)


if __name__ == "__main__":
    main()
