# Stelladream Product Roadmap

Last updated: 2026-08-27

## Overview

Stelladream should continue evolving as a `retrieval explainability workbench`, not just a search animation demo.

The product already proves one important idea:

- it can turn an abstract retrieval pipeline into a visible spatial process
- it can help people understand `BM25 -> kNN -> RRF -> reranker final`
- it has started to grow from a single-query experience into an evaluation and diagnosis surface

The next stage is to make that value explicit and productized.

## Product Positioning

One-sentence definition:

> Visualize retrieval, fusion, reranking, and evaluation as an interactive system for explanation, replay, diagnosis, and experimentation.

This product serves two core user groups:

1. Retrieval / backend / ranking engineers
2. Product, solution, and business-facing stakeholders

For engineers, the system should answer:

- Why was this result selected?
- Where did a bad query fail?
- What changed after tuning parameters?

For non-engineering audiences, the system should answer:

- What is the system doing?
- Why does it behave this way?
- What makes one result more relevant than another?

## Product Axes

The roadmap should be advanced along two parallel axes.

### 1. Search Explainability

Focus on single-query understanding.

Key question:

> Why did this query end up on this final star?

### 2. Evaluation and Diagnosis

Focus on batch replay, metrics, and failure analysis.

Key question:

> Why is retrieval quality good or bad across many queries?

These two axes should stay connected. A good product flow is:

- see a batch-level problem in evaluation
- jump into a bad case
- inspect the retrieval path
- compare candidates near the final result
- adjust parameters and replay

## Current State

The project already has a strong foundation:

- 3D star map
- search animation flow
- star detail panel and jump interaction
- evaluation replay
- metrics trend chart

As of 2026-08-27, the single-query explainability layer is no longer just animation. It now includes:

- a retrieval phase timeline for `BM25 / kNN / RRF / FINAL`
- phase filtering and phase-aware camera focus
- meteor-style intermediate hit animations with persistent hit labels
- preserved query artifacts after `星跃`, so users can continue inspecting the same query path
- a retrieval summary strip that exposes counts and top documents by phase
- a detail panel that explains whether the selected star was hit in each stage, plus rank and score when available
- automatic `FINAL` activation after a successful query so the timeline state matches the visible final-hit panel
- the active star dataset is now rebuilt from the real `lecard_m3_doc` Elasticsearch index instead of the original demo-only star map

It also already has an important experimental direction:

- cluster-to-nebula style visual aggregation during evaluation replay

That means the roadmap should not treat eval replay as a side feature. It is now part of the product core.

## Design Principle

The project should avoid becoming "a beautiful but opaque animation".

The next versions should prioritize:

1. Explainability
2. Diagnosis
3. Operability
4. Presentation quality

Visual polish still matters, but it should support comprehension instead of competing with it.

## Version Plan

## v0.2 - Search Explainability Foundation

Goal:

> Make a single query understandable from start to finish.

### Scope

1. Retrieval stage timeline
- Query
- BM25
- kNN
- RRF
- Final

2. Stage filtering
- show only BM25
- show only kNN
- show only RRF
- show only Final
- show overlap
- show differences

3. Result explanation panel
- document id
- title
- which stages hit this star
- per-stage scores
- distance to final star
- why it was selected or not selected

4. Final-hit neighborhood explanation
- show 3 to 5 nearby competing stars
- indicate which stages touched them
- explain why they lost to the final star

5. Search animation polish
- control information density around the final star
- continue improving label collision handling
- keep macro view readable while preserving local detail

6. Evaluation replay controls v1
- play
- pause
- speed
- step forward
- current query display
- current metrics display

7. Nebula effect v1
- move away from dense hard connection lines
- use cluster center, soft particle fog, and restrained glow boundaries
- make the active region legible first, beautiful second

### Status on 2026-08-27

Already in place:

- retrieval stage timeline
- stage filtering
- automatic final-stage focus after query completion
- retrieval summary panel
- per-document stage explanation inside the detail panel
- query-result preservation across `星跃`
- evaluation replay controls baseline

Still missing or incomplete:

- overlap / difference comparison views across stages
- explicit explanation of why nearby candidates lost to the final star
- richer distance-based comparison around the final star neighborhood
- stronger product polish for nebula-style eval playback
- tighter layout integration between top controls, summary strip, and detail panel

### Exit Criteria

- A user can understand a single query path without verbal explanation from the author
- A user can isolate any retrieval stage and inspect it independently
- Evaluation replay is usable, but still secondary to single-query explainability

## v0.3 - Replay and Diagnosis

Goal:

> Upgrade from "visible search" to "diagnosable retrieval".

### Scope

1. Failed query diagnosis mode
- whether the correct document was retrieved
- whether it was lost in recall, fusion, or reranking
- where the path broke

2. Query comparison mode
- compare two queries
- compare intermediate hits
- compare final stars
- compare overlap and divergence

3. Evaluation replay enhancement
- replay by domain
- replay only failed samples
- jump to a specific step
- jump to a specific query

4. Final-star competition view
- reveal the closest alternatives around the final star
- explain what nearly won
- support side-by-side comparison of candidate scores

5. Nebula effect v2
- stable cluster centers
- density reflects sample concentration
- only active clusters stay bright
- non-active clusters fade into background context

### Exit Criteria

- An engineer can use the UI to identify why a bad query failed
- Evaluation replay can support diagnosis, not just presentation

## v0.4 - Parameter Experiment Workbench

Goal:

> Turn the system from an observer into an experiment tool.

### Scope

1. Parameter control panel
- BM25 top-k
- kNN top-k
- RRF weights
- reranker on/off
- reranker top-n

2. Before/after replay
- re-run the same query with different settings
- compare path changes and final-hit changes

3. Metrics linkage
- Recall
- MRR
- NDCG
- Hit@k
- parameter-change impact

4. Case collection
- save good cases
- save bad cases
- build a practical regression set for future tuning

### Exit Criteria

- Parameter tuning can be inspected visually rather than only through logs and spreadsheets
- Users can observe not just metric deltas, but path and candidate changes

## v1.0 - Retrieval Explainability Workbench

Goal:

> Deliver a complete internal product for explanation, replay, diagnosis, and comparison.

### Product Modes

1. Search mode
- single-query explainability

2. Evaluation mode
- batch replay
- metrics linkage
- failed-case diagnosis

3. Compare mode
- query vs query
- parameter vs parameter
- model vs model

4. Export mode
- report export
- screenshot export
- replay clip export
- structured case export

### Exit Criteria

- The product can support internal engineering diagnosis
- The product can support external demos and stakeholder explanation
- Search, eval, and comparison views form one coherent workflow

## Priority Order

If work must be sequenced strictly by impact, the recommended order is:

1. v0.2
- stage timeline
- stage filtering
- result explanation panel
- evaluation replay controls
- nebula effect v1

2. v0.3
- failed query diagnosis
- query comparison
- final-star neighborhood explanation
- nebula effect v2

3. v0.4
- parameter workbench
- metrics linkage
- case collection

4. v1.0
- export
- model / parameter comparison system
- workbench-level product polish

## Nebula Direction

The current evaluation replay already experiments with a star-cluster-to-nebula effect, but the visual result is not yet satisfactory.

The likely mistake to avoid is:

- adding more and more lines

The better direction is:

- fewer lines, possibly none by default
- stronger cluster centers
- density and fog as the primary cluster signal
- soft boundaries and layered brightness
- bright active clusters, subdued inactive clusters

The nebula should feel like a `semantic weather map`, not an electrical circuit diagram.

### Nebula Iteration Guidance

#### Nebula v1
- cluster center markers
- sparse ambient particles
- soft local glow
- minimal connective lines

#### Nebula v2
- density-aware cloud volume
- active-cluster emphasis
- temporal accumulation during replay
- domain-aware color hierarchy

#### Nebula v3
- support drill-down from cloud to cluster to star
- support correlation with metrics and query segments

## Suggested Working Model

For implementation rhythm, the project should be developed in loops:

1. Improve visibility
2. Improve explainability
3. Improve diagnosis
4. Improve experimentation
5. Improve export and polish

This keeps the system from over-investing in visuals before it becomes operationally useful.

## Summary

The roadmap can be summarized in one line:

> First explain one query well, then diagnose many queries well, then tune retrieval through the same interface.

That translates to:

- `v0.2`: single-query explainability
- `v0.3`: replay and failure diagnosis
- `v0.4`: parameter experimentation
- `v1.0`: complete retrieval explainability workbench
