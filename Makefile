# Muisti — reproducible pipeline. `make all` builds everything from the official datasets.
SHELL := /bin/bash
UV := HF_HUB_OFFLINE=$(HF_OFFLINE) uv run
HF_OFFLINE ?= 0
DB := docker exec -i muisti-mariadb mariadb -umuisti -pmuisti muisti
ROOTDB := docker exec -i muisti-mariadb mariadb -uroot -pmuisti-root

.PHONY: all up data schema load-s embed load-m analytics facts snapshots indexes durable api web test perf screenshots

all: up data schema load-s load-m analytics facts embed indexes snapshots durable test perf

up:                 ## MariaDB 12.3 in Docker (port 3309)
	docker compose up -d --wait

data:               ## download datasets S, M, L from MariaDB's releases and verify SHA256
	for t in s m l; do mkdir -p data/raw/$$t; (cd data/raw/$$t && gh release download $$t-2026-10 -R MariaDB/mariadb-wikipedia-datasets --skip-existing && sha256sum -c SHA256SUMS); done

schema:
	$(DB) < db/schema.sql

load-s:             ## 29,460 articles, ready-made vectors, categories, 122,351 passages
	$(UV) python -m pipeline.load_s

load-m:             ## 862,076 versions with real edit times (system_versioning_insert_history)
	$(ROOTDB) -e "SET GLOBAL innodb_flush_log_at_trx_commit = 2"
	$(UV) python -m pipeline.load_m

analytics:          ## revisions, reverts, edit-war metrics (window functions + CTEs)
	$(DB) < db/analytics.sql

facts:              ## bitemporal infobox facts replayed over every version
	$(UV) python -m pipeline.facts

embed:              ## bge-m3 passage vectors on the GPU (resumable)
	$(UV) python -m pipeline.embed_chunks

indexes:            ## FULLTEXT after load + optimizer statistics
	$(DB) < db/indexes.sql

snapshots:          ## yearly snapshots of the most edited articles, embedded
	$(UV) python -m pipeline.snapshots --top 200

durable:            ## back to full durability after bulk loads
	$(ROOTDB) -e "SET GLOBAL innodb_flush_log_at_trx_commit = 1"

api:
	$(UV) uvicorn backend.api:app --host 127.0.0.1 --port 8000

web:
	cd frontend && npm install && npx vite --host 127.0.0.1 --port 5173

test:
	$(UV) pytest -q tests

perf:               ## ANALYZE FORMAT=JSON + p50/p95 of every hot query -> perf/RESULTS.md
	$(UV) python -m pipeline.perf
