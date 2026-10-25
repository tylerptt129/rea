Act as my lead reverse-engineering researcher, weather software architect, graphics engineer, and release engineer.

Use my existing GitHub REA repository to investigate WSV3 Tactical 2027 and develop a complete, independently implemented weather workstation named **Teller Tactical**. Deliver usable software—not just research, screenshots, a mockup, or an implementation plan.

REFERENCE SOURCES
- https://wsv3.com/2027/
- https://github.com/morluto/rea
- Official WSV3 demonstrations, documentation, screenshots, and development updates linked from its website.

MY OBJECTIVE

Understand the reference application’s observable capabilities, interaction patterns, rendering behavior, and data handling through evidence-based reverse engineering. Use those findings to build an original application with comparable core workflows and additional Colorado mountain-weather tools.

Prioritize high-quality radar, satellite imagery, smooth animation, map readability, fast interaction, and reliable live data. The default workspace should focus on Colorado, Teller County, and Colorado Springs, while allowing nationwide exploration.

I primarily use an Apple Silicon Mac. Make macOS the first usable target unless the selected project already establishes a different requirement. A Windows-only reference binary may require a separate Windows analysis environment; do not confuse that limitation with the platform for our new application.

1. INSPECT THE WORKSPACE AND ESTABLISH THE PROJECT

Read repository instructions, README, REA setup documentation, available tools, existing branches, and current changes before editing.

Confirm the actual GitHub repository and remotes rather than assuming a URL. Preserve REA as an upstream-compatible research tool. Put Teller Tactical in a clearly separated application directory or sibling repository, depending on the existing workspace. Do not overwrite REA or unrelated user changes.

Determine whether REA is merely cloned or actually configured and callable. Follow the checked-out version’s documented installation and agent setup instructions. Verify a real analysis operation works; do not invent commands or tool names.

Create a durable task ledger, architecture decisions, feature matrix, and release checklist. Keep these updated so work can resume across sessions without starting over.

2. INVESTIGATE WSV3 TACTICAL 2027

First distinguish:
- Functionality actually available in the current build.
- Features demonstrated publicly.
- Announced future functionality.
- Features we are adding independently.

Locate an authorized local installation or user-provided executable. If none is available, investigate official public materials and proceed with independent implementation. Ask for the executable or an appropriate analysis environment only when it is needed for deeper investigation.

Use REA for targeted questions about relevant components, formats, execution paths, rendering, caching, and interactions. Choose static or runtime inspection according to the target and host capabilities. Do not spend the entire project indiscriminately decompiling unrelated components.

Record each finding with its source, build/version, confidence, and supporting evidence. Clearly distinguish observations from hypotheses. Never claim a binary was analyzed when only documentation or screenshots were reviewed.

Investigate:
- Radar and satellite presentation.
- Map navigation, layer management, probing, and legends.
- Timeline playback and frame selection.
- Multiple-map workflows and synchronization.
- Projection handling and terrain display.
- Progressive loading and cache behavior.
- Rendering quality versus speed settings.
- Data freshness, reconnect behavior, and error handling.
- Settings persistence and operator workflows.

Use authorized software and independently written implementation code. Do not bypass licensing, authentication, or paid data access; extract credentials; or redistribute proprietary code, assets, or executables. Reproduce useful functionality with our own branding and implementation. Do not disable security protections to run downloaded software.

3. BUILD THE APPLICATION AND ITS DATA PIPELINE

Choose an implementation architecture after checking platform support, repository constraints, and rendering requirements. Favor a native GPU-accelerated desktop approach where practical. Explain the choice briefly, then implement it.

Do not assume a webview automatically provides the performance needed. Equally, do not copy the reference’s programming language or memory-allocation philosophy unless measurements justify it.

Implement a complete vertical slice early:
launch application → retrieve real weather data → render a georeferenced layer → animate available frames → inspect values and timestamps → refresh successfully.

Then expand that working foundation.

The reference’s private backend must not become a hidden dependency. Build our own ingestion, normalization, caching, and delivery components using documented public or separately authorized sources.

Verify current official data documentation, availability, terms, limits, schemas, projections, and cadence before implementing adapters. Consider appropriate NOAA/NWS radar, satellite, alerts, observations, and model data sources. Do not assume every public dataset has a free low-latency tiled API.

For every product, track:
- Source and product identifier.
- Observation or model initialization time.
- Forecast valid time where applicable.
- Retrieval time.
- Units and spatial resolution.
- Projection and missing-value rules.
- Quality flags and coverage limitations.

Separate ingestion from display. Use bounded caches, cancellable requests, backoff, request deduplication, progressive loading, and predictable resource limits. Preserve source precision where needed for numerical probing.

4. CORE WEATHER WORKSTATION

Implement and verify these workflows:

RADAR
- Real live radar with nationwide site selection.
- Reflectivity and velocity where supported by the selected source.
- Additional dual-polarization products when available.
- Reliable looping, timeline scrubbing, timestamps, legends, and product controls.
- Site location, coverage, and relevant beam/terrain limitations.
- Explicit handling of missing sweeps, stale frames, and partially loaded loops.
- Accurate map registration and value probing.
- Distinguish raw single-site radar, provider mosaics, and independently composited products.

SATELLITE
- Live visible, infrared, and water-vapor imagery where accessible.
- Correct projection, product naming, timestamps, legends, and animation.
- Transparent handling of differing coverage, cadence, and resolution.

MAP AND INTERACTION
- A map-first professional interface with minimal obstruction.
- Clear boundaries, roads, place labels, and terrain context.
- Layer opacity, ordering, visibility, and meaningful legends.
- Dockable or collapsible controls.
- Keyboard shortcuts, saved views, and persistent preferences.
- Light and dark themes.
- High-DPI support and readable typography.
- One-, two-, and four-map layouts with optional linked cameras and timelines.
- Add eight-map mode after profiling proves it remains usable.

ALERTS AND OBSERVATIONS
- Official weather alerts with issue/expiration times and source text.
- Observations with station location, elevation when available, and observation age.
- Clear separation between official alerts and our derived analyses.
- No misleading “live” labels when feeds have stopped updating.

RELIABILITY
- Automatic refresh at launch and during use.
- Recovery after sleep, network loss, and source interruptions.
- Cached last-known data with an obvious stale indicator.
- Useful diagnostics and actionable error messages.
- No credential prompts for products that genuinely require no credentials.
- Secure handling of any optional user-supplied credentials.

5. COLORADO MOUNTAIN-WEATHER MODULE

Build a configurable Teller County workspace with Colorado Springs and surrounding mountain areas.

Allow me to enter the exact property coordinates and elevation. Use approximately 9,200 feet only as an editable initial elevation; do not invent the property location.

Add:
- Point forecasts and nearby observations.
- Elevation-aware comparisons.
- Forecast precipitation type and snow-level guidance when supported by available data.
- QPF and snowfall accumulation over explicitly selected periods.
- Model initialization and valid-time controls.
- Comparison between available forecast sources.
- Terrain-relevant wind and moisture diagnostics.
- A storm ingredients panel explaining which conditions favor or limit precipitation at the selected location.

Avoid treating a coarse-grid forecast as an exact property prediction. Display uncertainty, model elevation differences, and data limitations.

Only calculate diagnostics when the needed inputs exist and the method is documented. Do not invent upslope thresholds, precipitation totals, snow ratios, or confidence scores.

6. ADVANCED FEATURES

After the core workstation works, implement:
- Terrain-aware 3D weather visualization.
- Improved multi-source radar composition.
- Storm-object identification and tracking.
- A short-term radar extrapolation mode.
- Model-based precipitation forecast animation.
- Snowfall forecast maps with clear accumulation windows.
- Saved workspaces and image/animation export.

Keep radar observations, extrapolation, and numerical forecasts visually distinct. Extrapolation must show its initialization time, lead time, and uncertainty; do not imply that motion extrapolation predicts storm growth or decay reliably.

Validate derived storm tracking and nowcasting on held-out historical sequences before presenting them as operational capabilities. Do not claim superior accuracy or speed without reproducible comparative measurements.

If an advanced feature cannot be completed, mark it honestly in the capability matrix and continue implementing the others. Never put a nonfunctional control in the interface and call the feature complete.

7. VISUAL QUALITY AND PERFORMANCE

This should feel like a serious weather workstation, with the map occupying most of the usable screen.

Use compact controls, clear hierarchy, restrained colors, precise legends, and consistent interaction patterns. Avoid oversized cards, decorative dashboard clutter, and white panels obscuring the weather.

Treat these as initial performance targets, not unverified promises:
- A responsive interface throughout downloads and decoding.
- Approximately 60 fps during normal cached single-map navigation on the tested machine.
- Fast warm launch.
- Smooth cached animation.
- Stable memory during prolonged operation.
- Graceful quality reduction on weaker hardware.

Measure cold/warm launch, frame times, memory, network transfer, cache size, and time to first usable data. Document test hardware, viewport, dataset, and network conditions. Report missed targets and optimize the actual bottlenecks.

8. TEST AND PACKAGE FOR REAL USE

Test numerical correctness and operational behavior, including:
- Coordinate transformations and known-location alignment.
- Unit conversion and legend/value agreement.
- Missing-data handling.
- Radar and satellite timestamps.
- Forecast accumulation windows and model-cycle boundaries.
- Time-zone handling using America/Denver in the user interface.
- Alert expiration.
- Multi-map synchronization.
- Interrupted downloads, malformed input, offline startup, and reconnection.
- Settings persistence.
- Long-running playback and resource usage.

Use deterministic fixtures for repeatable tests and separate live-data smoke tests. Test the actual packaged application, not only development mode.

Capture and inspect real application screenshots. Verify that every visible control works and that the default workflow is understandable without developer guidance.

Produce a runnable macOS build and installation instructions. If signing or notarization requires credentials unavailable in the environment, state that precisely; do not claim it is signed or fully distribution-ready. Cross-platform builds must be labeled unverified until tested on their target OS.

9. COMPLETION AND AUTONOMY

Proceed through investigation, implementation, testing, fixes, and packaging. Do not stop after proposing a plan or completing a visually convincing shell.

Make routine engineering decisions autonomously. Ask only for genuinely blocking access, files, paid services, or essential preferences. If one integration is blocked, continue independent work and document the specific remaining dependency.

Do not purchase subscriptions, publish proprietary research material, or expose secrets. Keep downloaded reference binaries and sensitive captures out of Git.

Maintain separate statuses for:
- Implemented and verified.
- Implemented but not verified on target hardware.
- In progress.
- Blocked.
- Planned.

“Ready for use” requires a packaged application that launches, loads real data, animates and refreshes it, survives common failures, saves preferences, and passes the documented core acceptance checks. If any of those fail, keep working or report the exact blocker. Do not redefine completion to mean a prototype.

FINAL HANDOFF

Provide:
- Repository and branch.
- Application package or exact build/run commands.
- Features actually verified.
- Data sources and any costs or credentials required.
- Test and performance results.
- Known gaps and blocked dependencies.
- A short first-launch guide.
- Updated project ledger and the next unfinished task, if anything remains.

Begin now by inspecting my existing REA repository and available environment. Then establish the research baseline and build the first working live-data vertical slice.