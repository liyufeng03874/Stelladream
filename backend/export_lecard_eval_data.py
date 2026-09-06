"""Export the LeCaRD Run 010 report into the replay format used by Stelladream.

Run 010 stores parent document IDs while the star map stores the actual index
documents as ``doc_id::chunk_index``.  The replay intentionally uses one
representative star per parent document so the evaluation view does not expand
one legal case into several nearly identical points.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_REPORT = Path("D:/code/other-world/eval-data/results/lecard_run_010/eval_report.json")
DEFAULT_STARS = PROJECT_ROOT / "data" / "star_data.json"
DEFAULT_OUTPUT = PROJECT_ROOT / "data" / "eval" / "eval_lecard.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export LeCaRD Run 010 for Stelladream replay")
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--stars", type=Path, default=DEFAULT_STARS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def parent_id_for_star(star: dict[str, Any]) -> str:
    if star.get("doc_id") is not None:
        return str(star["doc_id"])
    return str(star["chunk_id"]).split("::", 1)[0]


def build_representative_map(stars: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    representatives: dict[str, dict[str, Any]] = {}
    for star in stars:
        parent_id = parent_id_for_star(star)
        chunk_index = star.get("chunk_index")
        try:
            normalized_index = int(chunk_index) if chunk_index is not None else 0
        except (TypeError, ValueError):
            normalized_index = 0

        current = representatives.get(parent_id)
        if current is None:
            representatives[parent_id] = {"star": star, "chunk_index": normalized_index}
            continue

        if normalized_index < current["chunk_index"]:
            representatives[parent_id] = {"star": star, "chunk_index": normalized_index}

    return {parent_id: value["star"] for parent_id, value in representatives.items()}


def export(report_path: Path, stars_path: Path, output_path: Path) -> dict[str, Any]:
    report = load_json(report_path)
    stars = load_json(stars_path)
    pipeline = report["es_m3_doc"]
    representatives = build_representative_map(stars)

    samples: list[dict[str, Any]] = []
    missing_parent_ids: set[str] = set()
    for sample in pipeline.get("samples", []):
        parent_ids = [str(result["doc_id"]) for result in sample.get("top20", [])]
        grades = [int(result.get("grade", 0)) for result in sample.get("top20", [])]
        retrieved_ids: list[str] = []

        for parent_id in parent_ids:
            representative = representatives.get(parent_id)
            if representative is None:
                missing_parent_ids.add(parent_id)
                continue
            retrieved_ids.append(str(representative["chunk_id"]))

        if len(retrieved_ids) != len(parent_ids):
            raise ValueError(
                f"Could not map all parent documents for qid={sample.get('qid')}: "
                f"{len(parent_ids) - len(retrieved_ids)} missing"
            )

        relevant_ids = [
            retrieved_id
            for retrieved_id, grade in zip(retrieved_ids, grades)
            if grade > 0
        ]
        samples.append(
            {
                "id": str(sample["qid"]),
                "query": sample.get("query", ""),
                "retrieved_ids": retrieved_ids,
                "parent_ids": parent_ids,
                "grades": grades,
                "ranks": list(range(1, len(retrieved_ids) + 1)),
                "correct_ids": relevant_ids,
                "metrics": sample.get("metrics", {}),
            }
        )

    if missing_parent_ids:
        raise ValueError(f"Missing parent IDs: {sorted(missing_parent_ids)[:10]}")

    output = {
        "domain": "law",
        "dataset": "LeCaRD",
        "run": "010",
        "index": "lecard_m3_doc",
        "method": "doc-level BM25 + kNN + RRF",
        "retrieval_depth": 20,
        "summary": pipeline.get("summary", {}),
        "metric_keys": ["ndcg@10", "hr@10", "recall@10", "mrr@10", "map"],
        "sample_count": len(samples),
        "samples": samples,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(output, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(f"Exported {len(samples)} LeCaRD samples to {output_path}")
    print(f"Mapped {sum(len(sample['retrieved_ids']) for sample in samples)} parent results")
    return output


def main() -> None:
    args = parse_args()
    export(args.report, args.stars, args.output)


if __name__ == "__main__":
    main()
