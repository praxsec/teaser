(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const field = document.querySelector('#score');
  const svg = document.querySelector('#inscription');
  const canvas = document.querySelector('#artifact');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const rows = 23, pitch = 24, breadth = 14, depth = 12, extent = 1700, segments = 48;
  const observed = new Set([1, 6, 16, 21]);
  const context = row => ((row + 1) * 3253 ^ 0xa71c) & 65535;
  const verdict = row => row % 7 === 0 ? 2 : ((context(row) & 0x5b39) % 3 ? 1 : 0);
  let width = 0, height = 0, scale = 1, angle = 0;
  let gl, program, uniforms, buffer, ready = false, lost = false;
  let raf = 0, elapsed = 0, lastClock = 0, lastDraw = -Infinity;
  const panelVertices = rows * (segments * 24 + 12);

  const vertexSource = `#version 300 es
    precision highp float;
    layout(location = 0) in vec4 aPositionRow;
    layout(location = 1) in float aFace;
    uniform vec2 uViewport;
    uniform float uScale, uAngle, uTime, uSide;
    out vec2 vCut;
    out float vMaterialX;
    out vec3 vPosition;
    flat out uint vBits;
    flat out float vFace;
    const float TAU = 6.28318530718;
    void main() {
      float row = aPositionRow.w;
      float u = (row - 11.0) / 11.0;
      float edge = 66.0 + 34.0 * (1.0 - u * u);
      float x = aPositionRow.x, y = aPositionRow.y;
      bool left = uSide < 0.0;
      // Independent dominant axes, deliberately visible in the first 8 seconds.
      float turn = uTime * TAU / (left ? 60.0 * sqrt(2.0) : 60.0 * sqrt(3.0))
        + (left ? -0.52 : 0.25);
      float rx = left ? radians(8.0) * cos(turn * 0.67 + 0.7)
                      : radians(30.0) * sin(turn + 0.3);
      float ry = left ? radians(30.0) * sin(turn)
                      : radians(-11.0 + 7.0 * sin(turn * 0.73 + 0.5));
      float rz = radians(0.7) * sin(uTime * TAU / (left ? 60.0 * sqrt(7.0) : 60.0 * sqrt(11.0)) + (left ? 0.0 : 1.8));
      // A broad, modulated strain front travels through the physical ribbons.
      float wave = x * (left ? 0.0071 : -0.0063) + y * (left ? 0.012 : -0.014)
        - uTime * TAU / (left ? 18.0 * sqrt(2.0) : 18.0 * sqrt(3.0))
        + (left ? 0.7 : 2.6);
      float drift = x * 0.0024 - y * 0.0058
        - uTime * TAU / (left ? 30.0 * sqrt(5.0) : 30.0 * sqrt(7.0));
      float envelope = 0.3 + 0.7 * pow(0.5 + 0.5 * cos(drift), 2.0);
      float bend = 27.0 * sin(wave) * envelope + 4.0 * sin(drift);
      float spacing = 2.3 * sin(wave + 0.7) * envelope;
      vec3 p = vec3(x - uSide * 420.0, y + spacing, aPositionRow.z + bend);
      p.yz = mat2(cos(rx), sin(rx), -sin(rx), cos(rx)) * p.yz;
      p.xz = mat2(cos(ry), -sin(ry), sin(ry), cos(ry)) * p.xz;
      p.xy = mat2(cos(rz), sin(rz), -sin(rz), cos(rz)) * p.xy;
      p.x += uSide * 420.0;
      vPosition = p;
      p.xy = mat2(cos(uAngle), sin(uAngle), -sin(uAngle), cos(uAngle)) * p.xy;
      float perspective = 1.0 - p.z / 1900.0;
      gl_Position = vec4(p.xy * vec2(2.0, -2.0) * uScale / uViewport,
        -p.z / 2400.0, perspective);
      vCut = vec2(abs(x) - edge, y - (row - 11.0) * 24.0);
      vMaterialX = x;
      vBits = ((uint(row) + 1u) * 3253u ^ 42780u) & 65535u;
      vFace = aFace;
    }
  `;
  const fragmentSource = `#version 300 es
    precision highp float;
    in vec2 vCut;
    in float vMaterialX;
    in vec3 vPosition;
    flat in uint vBits;
    flat in float vFace;
    out vec4 outColor;
    void main() {
      float tone = clamp(abs(vMaterialX) / 1000.0, 0.0, 1.0);
      vec3 gold = mix(vec3(213.0, 191.0, 141.0), vec3(179.0, 154.0, 104.0), tone) / 255.0;
      vec3 normal = normalize(cross(dFdx(vPosition), dFdy(vPosition)));
      float light = 0.62 + 0.38 * abs(dot(normal, normalize(vec3(-0.3, -0.42, 1.0))));
      float faceTone = vFace < 0.5 ? 1.0 : (vFace < 1.5 ? 0.70 : 0.77);
      vec3 color = gold * light * faceTone;
      // Recessed inscriptions stay attached to the material, including bends.
      if (vFace < 0.5) {
        float cell = floor(vCut.x / 28.0);
        uint bit = (vBits >> uint(mod(cell, 16.0))) & 1u;
        float halfCut = bit == 1u ? 3.0 : 0.1;
        vec2 cut = vec2(mod(vCut.x, 28.0) - 14.0, max(abs(vCut.y) - halfCut, 0.0));
        float distance = length(cut) - 0.9;
        float aa = max(fwidth(distance), 0.15);
        float ink = 1.0 - smoothstep(-aa, aa, distance);
        color = mix(color, vec3(20.0, 23.0, 20.0) / 255.0, ink);
      }
      outColor = vec4(color, 1.0);
    }
  `;

  function node(tag, attrs = {}, parent = svg) {
    const element = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
    parent.append(element);
    return element;
  }
  function buildStill() {
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.replaceChildren();
    const defs = node('defs');
    const gold = node('linearGradient', { id: 'gold', x1: -1000, y1: 0, x2: 1000, y2: 0, gradientUnits: 'userSpaceOnUse' }, defs);
    [[0, '#b39a68'], [.5, '#d5bf8d'], [1, '#b39a68']].forEach(([offset, color]) => node('stop', { offset, 'stop-color': color }, gold));
    const plate = node('g', { transform: `translate(${width / 2} ${height / 2}) rotate(${angle * 180 / Math.PI}) scale(${scale})` });
    const panels = node('g', { class: 'static-panels' }, plate);
    const marks = node('g', {}, plate);
    for (let row = 0; row < rows; row++) {
      const y = (row - 11) * pitch, u = (row - 11) / 11;
      const edge = 66 + 34 * (1 - u * u);
      for (const side of [-1, 1]) {
        node('rect', { x: side < 0 ? -extent : edge, y: y - breadth / 2, width: extent - edge, height: breadth, fill: 'url(#gold)' }, panels);
        let d = '';
        for (let cell = 0; edge + 14 + cell * 28 < extent - 12; cell++) {
          const x = side * (edge + 14 + cell * 28);
          const cut = ((context(row) >> (cell % 16)) & 1) ? 6 : .2;
          d += `M${x.toFixed(2)},${(y - cut / 2).toFixed(2)}v${cut}`;
        }
        node('path', { d, class: 'carving', 'stroke-width': 1.8 }, panels);
      }
      const mark = node('g', { class: observed.has(row) ? 'observed' : '' }, marks);
      const evidence = node('g', { class: 'evidence', fill: 'none', stroke: 'currentColor', 'stroke-width': 1 }, mark);
      if (verdict(row) === 2) node('path', { d: `M-3,${y - 3}v6m6,-6v6` }, evidence);
      else node('circle', { cx: 0, cy: y, r: 3, fill: verdict(row) ? 'currentColor' : 'none' }, evidence);
    }
  }
  function makeMesh() {
    const data = new Float32Array(panelVertices * 2 * 5);
    let index = 0;
    function vertex(p, row, face) {
      data[index++] = p[0]; data[index++] = p[1]; data[index++] = p[2];
      data[index++] = row; data[index++] = face;
    }
    function quad(a, b, c, d, row, face) {
      vertex(a, row, face); vertex(b, row, face); vertex(c, row, face);
      vertex(c, row, face); vertex(b, row, face); vertex(d, row, face);
    }
    for (const side of [-1, 1]) {
      for (let row = 0; row < rows; row++) {
        const y = (row - 11) * pitch, u = (row - 11) / 11;
        const edge = 66 + 34 * (1 - u * u);
        const lo = y - breadth / 2, hi = y + breadth / 2;
        const front = depth / 2, back = -depth / 2;
        for (let segment = 0; segment < segments; segment++) {
          const a = side * (edge + (extent - edge) * segment / segments);
          const b = side * (edge + (extent - edge) * (segment + 1) / segments);
          quad([a,lo,front], [b,lo,front], [a,hi,front], [b,hi,front], row, 0);
          quad([a,lo,back], [a,hi,back], [b,lo,back], [b,hi,back], row, 1);
          quad([a,lo,front], [a,lo,back], [b,lo,front], [b,lo,back], row, 2);
          quad([a,hi,front], [b,hi,front], [a,hi,back], [b,hi,back], row, 2);
        }
        for (const x of [side * edge, side * extent]) {
          quad([x,lo,front], [x,hi,front], [x,lo,back], [x,hi,back], row, 2);
        }
      }
    }
    return data;
  }
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader); throw new Error(message);
    }
    return shader;
  }
  function initialize() {
    ready = false;
    try {
      gl = canvas.getContext('webgl2', { alpha: true, antialias: true, depth: true, stencil: false, powerPreference: 'low-power' });
      if (!gl) return;
      const vertex = compile(gl.VERTEX_SHADER, vertexSource);
      const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
      program = gl.createProgram();
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, makeMesh(), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16);
      uniforms = Object.fromEntries(['uViewport', 'uScale', 'uAngle', 'uTime', 'uSide'].map(name => [name, gl.getUniformLocation(program, name)]));
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      gl.clearColor(0, 0, 0, 0);
      ready = true; draw(); field.classList.add('rendered');
    } catch (error) {
      ready = false; field.classList.remove('rendered');
      console.warn('Retaining the static inscription:', error.message);
    }
  }
  function layout() {
    const rect = field.getBoundingClientRect(); width = rect.width; height = rect.height;
    const mobile = width < 701;
    angle = (mobile ? -72 : -12) * Math.PI / 180;
    scale = mobile ? Math.max(width / 1120, height / 1680) : Math.max(width / 1650, height / 1250);
    const density = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(2400000 / (width * height)));
    canvas.width = Math.max(1, Math.round(width * density));
    canvas.height = Math.max(1, Math.round(height * density));
    buildStill();
    if (ready && !lost) draw();
  }
  function draw() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform2f(uniforms.uViewport, width, height);
    gl.uniform1f(uniforms.uScale, scale); gl.uniform1f(uniforms.uAngle, angle);
    gl.uniform1f(uniforms.uTime, elapsed);
    gl.uniform1f(uniforms.uSide, -1); gl.drawArrays(gl.TRIANGLES, 0, panelVertices);
    gl.uniform1f(uniforms.uSide, 1); gl.drawArrays(gl.TRIANGLES, panelVertices, panelVertices);
  }
  function frame(now) {
    raf = 0;
    if (!ready || lost || document.hidden || reduced.matches) return;
    if (lastClock) elapsed += (now - lastClock) / 1000;
    lastClock = now;
    if (now - lastDraw >= 1000 / 30 - .5) { draw(); lastDraw = now; }
    raf = requestAnimationFrame(frame);
  }
  function sync() {
    cancelAnimationFrame(raf); raf = 0; lastClock = 0;
    if (ready && !lost && !document.hidden) {
      draw();
      if (!reduced.matches) raf = requestAnimationFrame(frame);
    }
  }
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); lost = true; ready = false; field.classList.remove('rendered'); sync();
  });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; initialize(); sync(); });
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', sync);
  window.addEventListener('pagehide', () => { cancelAnimationFrame(raf); raf = 0; lastClock = 0; });
  window.addEventListener('pageshow', sync);
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(layout, 90); }, { passive: true });
  layout(); initialize(); sync();
})();
