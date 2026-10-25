# Decisions

## ADR 001 — Separate independent desktop app
Teller Tactical lives in /workspace/teller-tactical, outside REA. REA remains an upstream-compatible research tool. No proprietary code, art, binaries or private backend dependency is used.

## ADR 002 — Electron with a measured GPU map
Use Electron native desktop windows, MapLibre GL's WebGL renderer, and a separate Node ingestion boundary. It supports Apple Silicon packages and the Linux test host with the same map implementation. Raster frames upload as georeferenced GPU textures; UI operations do not decode imagery on the JavaScript UI thread. A native Swift/Metal implementation would prevent exercising the actual UI on this host and add significant custom map/projection work before public-data behavior is verified. This choice is conditional on measurements; Chromium/Electron overhead and software GPU tests are explicitly reported, not assumed to meet 60 fps. Eight-map mode is withheld until profiling.

## ADR 003 — Source metadata owns time and meaning
Use provider-published frame times, never wall-clock guesses presented as observations. WMS images cannot establish raw numerical probe values. Mosaics stay labeled mosaics. Keep NWS units and validTime windows in the backend; UI converts only at display. Property coordinates are unset until supplied, and 9,200 ft is editable initial elevation only.

## ADR 004 — Bounded local gateway
Remote requests are allowlisted, deduplicated, cancelled on deadline, limited in bytes and concurrency, and cached on disk with TTL and LRU/size eviction. Return stale cached responses explicitly during outages. Electron renderer has no Node integration; it uses a loopback server with strict host/origin checks. No private credential is embedded. Honor inherited proxy and CA trust.
