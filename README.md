# Praxsec — for an alien mind

A quiet typographic teaser with black, dithered liquid on a pale background.
Primary text and the favicon use charcoal (`#252823`); the second headline and
footer use muted ink (`#6b7065`). The liquid uses deep black (`#000000`) on paper
(`#f7f7f2`), with its apparent tones coming only from dither density.
The page presents **Praxsec**, **Verifiable exploits**, **oracle-based remediation**,
and **for an alien mind**. These phrases describe the intended product direction;
the page is not an Oracle interface or a claim that verification is available.

## Liquid

`fluid.mjs` implements a small three-dimensional particle fluid, using the density
constraint approach in [Position Based Fluids, Macklin and Müller (2013)](https://mmacklin.com/pbf_sig_preprint.pdf).
A spatial hash builds local neighborhoods. Four density-projection iterations,
pairwise cohesion, and viscosity update the shared liquid at a fixed 60 Hz.
There is no gravity, prescribed droplet shape, animated radius, or painted ripple.
Stretching, neck formation, separation, pressure disturbances, and coalescence
come from moving the fluid particles and reconstructing their common surface.
Particles persist throughout a transfer: material is neither spawned nor faded.

This is a coarse, visually tuned fluid model, not a calibrated simulation of water.
The deterministic seed is a smooth union of three unequal lobes per body, with
small initial circulation. A hidden 60-step settling pass runs once before the
first visible frame, including for reduced motion. Startup therefore displays an
already composed, moving fluid state rather than exposing lattice relaxation.
Weak, slowly shifting three-center confinement and stirring keep the lobed
composition alive; this is an artistic force, not a closed zero-gravity system.
A small external force guides a selected parcel toward the type and then around
it to the other body. Forces act on the parcel's center of mass; its particles
remain free to deform and exchange momentum with their neighbors. During initial
pulling, a reaction force acts on the donor. These artistic controls keep the
scene active; the webpage is not an isolated physical system.

The text remains native HTML. A hidden distance grid is built from the actual
letter shapes on layout changes. Individual fluid particles resolve contact
against that grid without explicit bounce restitution. Density and cohesion
supply the liquid's response. Wrapped mobile text uses the same contact model.

`fluid-renderer.mjs` projects the particles into a continuous silhouette and
smooths its coverage before applying a hard boundary. `fluid-shading.mjs` finds
connected projected bodies on a padded grid, including material outside the
viewport. Each body gets the same smooth, rounded shading frame lit from the top
left. The frame follows its continuous bounds; depth and velocity do not affect
its shading. There are no individual particle normals or volume-density lighting.

A per-body cumulative tone distribution maps this canonical lighting to a shared
ink ramp. Light, middle, and dark tone ranges each cover approximately one third
of a full body, regardless of its size, deformation, or amount of material. Split
bodies eventually normalize independently and rejoining material shares a frame.
Particle membership detects splits and merges. During that handoff, lighting is
reprojected with particle displacement and eased into the new tonal map over up
to 2.4 seconds. A tapering response returns to the common tonal balance without
snapping at the end; near-contact split/merge fluctuations retain continuity.
Small rasterization differences remain at contours and on tiny droplets. Clipping
at a viewport edge does not change the complete body's tonal balance.

The Bayer grid uses chunky **4 × 4 CSS-pixel cells**, anchored at the top left.
Its pitch is independent of device pixel ratio, viewport resolution, and the
adaptive fluid-surface buffer. The canvas displays each output texel at exactly
four CSS pixels using nearest-neighbor scaling. A fixed, clipped wrapper absorbs
up to three surplus pixels on odd-sized viewports without stretching the grid or
introducing scroll overflow. The wrapper supplies layout dimensions so repeated
resizes cannot grow the canvas. Browser zoom still scales CSS pixels normally.

Each dither cell remembers its binary ink state. A 3% threshold tolerance rejects
small reversals; a larger requested change must persist for 120 ms before the
cell switches. This rejects momentary shading fluctuations without resampling the
grid, averaging black and white, or freezing the lighting. Current coverage clears
state outside the silhouette immediately. Newly covered cells initialize from
current shading; resize and context restoration reset all cell state.

Every interior pixel is opaque black or paper-colored; only the exterior is
transparent. Shape reconstruction and tonal mapping happen before dithering and
never soften the visible dots. Lighting is transported during a topology handoff;
the silhouette and native-text contact still follow the current simulation.

## Runtime and accessibility

No dependencies, external fonts, analytics, pointer-driven animation, or data sources.
The page uses WebGL 2 with three single-channel 8-bit coverage targets, a bounded
CPU silhouette grid, a small tonal texture, and two 8-bit RGBA buffers for dither
state. It does not need floating-point render targets. Surface reconstruction is capped at 360,000
pixels independently of the final fixed-pitch dither buffer, with a 30 fps cap.
Simulation steps use a bounded catch-up budget.
The fluid sources ship as one deferred classic script, `metaballs.bundle.js`,
to avoid a serial import download chain and support direct `file://` previews in
Chrome without module CORS failures. Once the first seeded frame is rendered, the canvas enters
from beyond the right edge over 700 ms with an ease-out. The entrance is a single
compositor transform: no extra fluid steps, faded dots, or loading placeholder.
It runs once per page load, skips reduced motion, and does not replay on resize,
tab return, or graphics-context recovery. The page remains readable while the
animation code downloads; this makes its arrival intentional rather than hiding
the network wait or delaying the text.
Hidden pages stop; reduced-motion preferences show a still frame. Resize rebuilds
the fluid for the new layout. Context restoration rebuilds the renderer and retains
the fluid state. Unsupported graphics leave the plain, readable page.

The phrase “for an alien mind” sits at the lower right in small, lightly spaced
system monospace type, as a quiet signature.
A small contact control at the lower left reveals a mail link only on activation.
The address is encoded in `contact.js` and absent from the initial DOM; this deters
basic harvesting, not browser automation. Keyboard activation preserves focus on
the revealed link. Contact works independently of WebGL; JavaScript is required.
Mailbox provisioning and spam filtering are managed outside this repository.
The native lowercase “oracle” matches its surrounding text. The phrase
“oracle-based” stays together on wrapping. High contrast and forced colors retain
readable text. There is no footer rule or extra explanatory interface.

Desktop and mobile viewport rendering are checked locally. Viewport checks are
not measurements on a physical mobile device; device power use remains unmeasured.

## Local preview and validation

```sh
node scripts/build-site.mjs
python3 -m http.server 8765 --bind 127.0.0.1
node --test fluid.test.mjs fluid-shading.test.mjs
node scripts/build-site.mjs --check
```

After changing the fluid sources, regenerate the checked-in bundle. The small
build script uses only Node built-ins and updates the HTML's content-hashed script
URL. Pages checks freshness before deploying. Edit the source modules, not the
generated bundle. Opening `index.html` directly also works; HTTP preview remains
useful for checking the site's normal hosted behavior.

Open <http://127.0.0.1:8765/>. The tests exercise complete release/contact/reunion
cycles, density bounds, particle-count preservation, collision clearance, reused
transfer slots, and a single-body layout. Shading checks cover tonal balance across
size, asymmetric deformation, scale, translation, depth, viewport clipping,
detachment, and reunion, without modifying simulation positions. Additional checks
exercise tonal continuity through an actual split/rejoin sequence, convergence
back to the shared balance, and the idempotent pre-render settling pass.

GitHub Pages publishes `main` to <https://praxsec.com/> through the existing
deployment workflow. Keep new iterations local until publication is explicitly
requested.
