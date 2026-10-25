# Reference research and evidence register

Last reviewed: 2026-10-25 UTC. This register distinguishes observations from requirements and hypotheses. It does **not** establish feature parity with WSV3.

## Scope and authority

The requested reference is **WSV3 Tactical 2027** at <https://wsv3.com/2027/>. The objective is to understand publicly observable workflows and implement an independent weather workstation, Teller Tactical. No WSV3 executable, licensed installation, credentials, proprietary assets, source code, or captured network sessions were supplied. No licensing or data-access protections were bypassed.

The workspace research tool is the user's checkout of `tylerptt129/rea`, at `/workspace/rea`, branch `work`, commit `80673b22a46d01899718e22584cf95d9f0529ab7`. Its package identifies the upstream as `morluto/rea`. The upstream reference URL is <https://github.com/morluto/rea>; the actual checkout remote is the user's fork. Teller Tactical lives in the separate sibling directory `/workspace/teller-tactical` so the tool can remain upstream-compatible.

## Evidence register

| ID | Source/operation | Version/build | Observation | Confidence and limitation |
| --- | --- | --- | --- | --- |
| REA-001 | Local `git remote -v`, branch/HEAD, `AGENTS.md`, package documentation | REA commit above | The actual repository is the user's REA fork, with a clean tracked working tree at initial inspection. | High; local checkout metadata only, not a WSV3 claim. |
| REF-001 | `https://wsv3.com/2027/`, attempted 2026-10-25T07:01–07:02Z | Requested product name only; actual build unknown | The request could not retrieve origin content through the managed environment. A normal sandbox attempt could not connect to the inherited proxy; a supported escalated request retaining that proxy returned HTTP 403, and a diagnostic attempt reported `CONNECT tunnel failed, response 403`. | High for the observed request failure; no evidence about the origin site's availability or contents. See [request record](evidence/wsv3-access-2026-10-25.md). |
| REF-002 | Workspace filename discovery excluding Git internals and dependency/build/cache trees | No target found | No WSV3-named artifact or installer/executable in the searched project files was found. | Medium; filename discovery cannot prove that an unidentified binary is not WSV3, and external disks or the user's Mac were not inspected. |

## What is established about WSV3

| Classification | Established findings |
| --- | --- |
| Available in a current build | **Unknown.** No running installation or versioned release documentation was available for inspection. |
| Publicly demonstrated | **Unknown.** No official demonstration was retrieved or watched in this environment. |
| Announced future functionality | **Unknown.** The target name and page URL alone do not establish a release date or announced feature list. |
| Independently requested Teller Tactical functionality | Radar, satellite, timeline playback, multi-map operation, alerts, observations, property forecasts, and Colorado terrain-aware tools are requirements from the user's brief. They are not attributed to WSV3 without evidence. |

Do not relabel a requirement from the brief as an observed WSV3 capability. Do not infer internal language, GPU architecture, allocation strategy, caching algorithms, private API endpoints, data providers, precision, or performance from product branding or screenshots.

## Targeted research queue

| Question | Required evidence | Current state |
| --- | --- | --- |
| Which products exist in a current build? | Versioned official release notes and an authorized current installation | Blocked on reference access; no executable supplied |
| What radar/satellite rendering and layer controls are observable? | Official documented screenshots/video with timestamps, or authorized live observation | Not observed |
| How do probing, legends, map navigation, and layer ordering behave? | Reproducible interaction sequence and resulting values/screenshots | Not observed |
| How are frames selected, skipped, loaded, and synchronized? | A recorded timeline sequence with loading and missing-frame states | Not observed |
| What projection/terrain modes exist? | Official projection/terrain description plus known-location comparisons | Not observed |
| What cache/loading behavior is observable? | Authorized capture of repeated requests and offline/reconnect behavior | Not observed; do not inspect private backend credentials |
| What quality/speed controls are available? | Named settings and measurements on identified hardware/data | Not observed |
| How does the product expose freshness, errors, and persistence? | Versioned documentation or a recorded interruption/relaunch sequence | Not observed |

Once allowed network access is available, retrieve the official landing page and follow only its official documentation, release, demonstration, and development-update links. Record the final source URL, retrieval time, product build, video timestamp where applicable, and a concise observation for each claim. Retain only material needed as private research evidence; do not redistribute proprietary assets.

## Binary analysis gate and method

A deeper analysis needs a user-provided, authorized executable or installation and, if the target is Windows-only, an appropriate Windows analysis environment. This is a research dependency, **not** a reason to make Teller Tactical Windows-only.

Before using REA on a target, identify the file format/platform and a specific question. Start with container/package inventory, strings/imports, configuration formats, and static rendering/data-path clues. Use documented REA commands for the installed version. Runtime inspection requires a compatible host, explicit target ownership, and normal licensing. Never describe a source-document review or tool-health check as binary analysis.

No WSV3 binary analysis has been performed. The initial application can proceed independently using documented, authorized public data sources and original code.

## Interpretation rules

- **Observation:** directly supported by the retained source or an executed operation.
- **Derivation:** computed from identified observations using a documented method.
- **Hypothesis:** a possible explanation requiring a stated test.
- **Unknown:** evidence is missing or does not decide the question.

Comparative performance and accuracy claims require reproducible matched datasets, hardware, viewport, elapsed time/frame statistics, memory and network measurements. No such comparison to WSV3 has been conducted.

## Immediate remaining reference dependency

The managed proxy must permit `wsv3.com` before this environment can inspect the official reference page. Additional official linked hosts should be requested only after their URLs and purpose are known. A saved network configuration draft does not prove that access has been applied; retry after a meaningful configuration change. Independent implementation and deterministic tests can continue while reference access is unavailable.
