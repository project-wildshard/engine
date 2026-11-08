# LS7: first-frame GPU units

> Written by: Claude

Sunscar Dunes, headless Chromium (SwiftShader), 4x CPU: the boot's firstFrame was two GPU flushes, 2.0 s for the world draw and 3.3 s for the post chain. The page's main thread sat in the canvas read-back for both. Three allocates a light's shadow map only at its first render. Until then the parked slices had no stand-in for the casters' depth pipelines, and lit draws were dropped on the unbound sampler. firstFrame now allocates the due maps with an empty scene first. It then counts fenced GPU units: parked slices, each shadow map alone, the view, and each post pass. A unit counts only once its WebGL2 fence signals. The longest unit is now about 0.5 s. The first-frame row's bar weight goes from 3 to 4. Strict proof: template passes in both browsers. Dunes WebKit passes. Dunes Chromium keeps one 2.1 to 2.2 s stretch where the bar moves every 0.2 to 0.4 s but gains under 1 %, because the row's share is small for 7 s of work.
