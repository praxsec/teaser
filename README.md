# Praxsec — for an alien mind

The existing composition is retained: the same dark background, small Praxsec
name, dedication, two gold striped panels, and central marks. Only the panels'
geometry and motion change. There are no controls, pointer responses, hover
effects, or additional visible words.

## Local preview

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open <http://127.0.0.1:8765/>. No dependencies, build step, remote fonts,
analytics, images, or API requests are needed. The existing Pages workflow
publishes `main` to the public teaser site.

## Physical structure and motion

Each panel contains 23 solid ribbons, with front, rear, side, and end faces.
Ribbons retain their 14-unit breadth and 24-unit pitch, with 12 units of depth.
Perspective, visible side faces, occlusion, and restrained diffuse shading
establish their volume. Their original inscriptions stay attached to the
front surfaces; the central marks remain stationary.

The left panel rotates primarily about Y and the right primarily about X,
using independent angular ranges up to 30 degrees. Their main cycles are
approximately 84.85 and 103.92 seconds, with offset phases chosen to make the
perspective change apparent during the first 5–10 seconds. The two panels
approach and recede independently while retaining their place in the composition.

A modulated strain front travels through each mesh, bending its actual depth
and slightly compressing the spacing between neighboring ribbons. Different
travel directions, phases, main periods, and secondary drift periods avoid
synchronized movement and a shared animation reset. No brightness sweep,
particles, bloom, or specular glow is used.

The inscriptions and three-state marks are synthetic artistic conventions,
not live product inputs, verification results, or security claims.

## Rendering

A dependency-free WebGL 2 renderer uploads two solid meshes once. There are
53,544 vertices in total, with 48 segments per ribbon. Each rendered frame
updates uniforms and submits two depth-tested draws. Geometry deformation runs
in the vertex shader; there are no per-frame DOM changes or mesh uploads.

Rendering is capped at 30 frames per second. The backing buffer is capped at
1.5 device pixels per CSS pixel and 2.4 million pixels total. Native CSS text
retains its normal rendering. Actual device power consumption is unmeasured.

Hidden pages suspend rendering while preserving elapsed time. Reduced-motion
preferences retain a static pose. Resize preserves motion phase. A WebGL
failure or context loss restores the original SVG composition; context
restoration rebuilds the renderer. An inline still also remains without JavaScript.
