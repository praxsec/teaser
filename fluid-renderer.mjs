import { FluidShading } from './fluid-shading.mjs?v=liquid-seed-8';

// Visual pitch is in CSS pixels, never device pixels or adaptive surface texels.
const DITHER_PITCH=4;

// A common rounded tonal recipe is fitted to every connected fluid silhouette.
export class FluidRenderer {
  constructor(canvas) {
    this.canvas=canvas;this.shading=new FluidShading();
    const gl=this.gl=canvas.getContext('webgl2',{alpha:true,antialias:false,depth:false,
      stencil:false,premultipliedAlpha:false,powerPreference:'low-power'});
    if(!gl)throw new Error('WebGL 2 unavailable');
    const full=`#version 300 es
      precision highp float;
      const vec2 corners[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));
      void main(){gl_Position=vec4(corners[gl_VertexID],0,1);}`;
    this.particle=this.program(`#version 300 es
      precision highp float;
      layout(location=0) in vec3 aCenter;
      uniform vec2 uViewport;
      uniform float uUnit,uRadius;
      out vec2 vPoint;
      const vec2 corners[6]=vec2[6](vec2(-1,-1),vec2(1,-1),vec2(-1,1),vec2(-1,1),vec2(1,-1),vec2(1,1));
      void main(){
        vPoint=corners[gl_VertexID];
        vec2 screen=(aCenter.xy+vPoint*uRadius)*uUnit/uViewport;
        gl_Position=vec4(screen.x*2.0-1.0,1.0-screen.y*2.0,0,1);
      }`, `#version 300 es
      precision highp float;
      in vec2 vPoint;
      out vec4 color;
      void main(){
        float r2=dot(vPoint,vPoint);if(r2>1.0)discard;
        color=vec4(1);
      }`);
    this.smooth=this.program(full,`#version 300 es
      precision highp float;
      uniform sampler2D uSurface;uniform vec2 uResolution,uDirection;
      out vec4 color;
      void main(){
        vec2 uv=gl_FragCoord.xy/uResolution;
        float coverage=0.0,total=0.0;
        for(int i=-4;i<=4;i++){
          float tap=texture(uSurface,uv+float(i)*uDirection/uResolution).r;
          float weight=exp(-float(i*i)*0.18);
          coverage+=tap*weight;total+=weight;
        }
        color=vec4(coverage/total);
      }`);
    this.dither=this.program(full,`#version 300 es
      precision highp float;
      uniform sampler2D uSurface,uTones,uHistory;
      uniform vec2 uResolution,uViewport,uField;
      uniform float uHistoryReady,uDelta;
      out vec4 color;
      float bayer2(vec2 p){p=mod(floor(p),2.0);return mod(2.0*p.x+3.0*p.y,4.0);}
      void main(){
        float coverage=texture(uSurface,gl_FragCoord.xy/uResolution).r;
        // Visibility always uses current coverage. No history survives outside
        // the moving silhouette, and newly covered cells start at their true tone.
        if(coverage<.48){color=vec4(0);return;}
        vec2 point=vec2(gl_FragCoord.x/uResolution.x,1.0-gl_FragCoord.y/uResolution.y)*uViewport;
        vec2 uv=(point+uField.x)/(uField.y*vec2(textureSize(uTones,0)));
        float tone=texture(uTones,uv).r;
        // Top-left anchoring keeps the grid phase independent of viewport height.
        vec2 p=vec2(gl_FragCoord.x,uResolution.y-gl_FragCoord.y);
        float threshold=(16.0*bayer2(p)+4.0*bayer2(p/2.0)+bayer2(p/4.0)+.5)/64.0;
        vec4 previous=texelFetch(uHistory,ivec2(gl_FragCoord.xy),0);
        bool valid=uHistoryReady>.5&&previous.a>.5;
        float ink=step(threshold,tone),pending=0.0;
        if(valid){
          ink=previous.r;
          // Schmitt thresholds reject small reversals; a candidate must then
          // persist for 120 ms. Neither step blends or softens visible pixels.
          float boundary=clamp(threshold+(ink>.5?-.03:.03),.001,.999);
          float wanted=step(boundary,tone);
          if(abs(wanted-ink)>.5){
            pending=previous.g+uDelta/.12;
            if(pending>=1.0){ink=wanted;pending=0.0;}
          }
        }
        color=vec4(ink,pending,0,1);
      }`);
    this.present=this.program(full,`#version 300 es
      precision highp float;
      uniform sampler2D uSurface;out vec4 color;
      void main(){
        vec4 state=texelFetch(uSurface,ivec2(gl_FragCoord.xy),0);
        if(state.a<.5)discard;
        float ink=state.r;
        vec3 paper=vec3(247.0,247.0,242.0)/255.0;
        color=vec4(mix(paper,vec3(0),ink),1);
      }`);
    this.buffer=gl.createBuffer();this.vao=gl.createVertexArray();
    gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);gl.vertexAttribDivisor(0,1);
    gl.bindVertexArray(null);this.targets=[];
    this.maps=Array.from({length:1},()=>{
      const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      return texture;
    });
  }
  program(vertex,fragment){
    const gl=this.gl,program=gl.createProgram();
    for(const [type,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){
      const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(message);}
      gl.attachShader(program,shader);gl.deleteShader(shader);
    }
    gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
    return {program,uniforms:new Map()};
  }
  use(pass){this.gl.useProgram(pass.program);this.pass=pass;}
  uniform(name,...values){
    const {gl,pass}=this;
    if(!pass.uniforms.has(name))pass.uniforms.set(name,gl.getUniformLocation(pass.program,name));
    const location=pass.uniforms.get(name);
    if(values.length===2)gl.uniform2f(location,...values);else gl.uniform1f(location,values[0]);
  }
  resize(width,height){
    const gl=this.gl;
    this.width=width;this.height=height;this.shadingLayout=null;
    this.canvas.width=Math.max(1,Math.ceil(width/DITHER_PITCH));
    this.canvas.height=Math.max(1,Math.ceil(height/DITHER_PITCH));
    this.renderWidth=this.canvas.width*DITHER_PITCH;this.renderHeight=this.canvas.height*DITHER_PITCH;
    // Overscan by at most three CSS pixels. The fixed wrapper crops the surplus,
    // avoiding fractional dot sizes when a viewport is not divisible by four.
    this.canvas.style.width=`${this.renderWidth}px`;this.canvas.style.height=`${this.renderHeight}px`;
    const scale=Math.min(1,Math.sqrt(360000/(this.canvas.width*this.canvas.height)));
    this.surfaceWidth=Math.max(1,Math.floor(this.canvas.width*scale));
    this.surfaceHeight=Math.max(1,Math.floor(this.canvas.height*scale));
    for(const target of this.targets){gl.deleteTexture(target.texture);gl.deleteFramebuffer(target.fbo);}
    this.targets=[];this.historyIndex=3;this.hasHistory=false;this.lastTime=0;
    for(let i=0;i<5;i++){
      const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
      const history=i>=3,width=history?this.canvas.width:this.surfaceWidth,height=history?this.canvas.height:this.surfaceHeight;
      gl.texImage2D(gl.TEXTURE_2D,0,history?gl.RGBA8:gl.R8,width,height,0,history?gl.RGBA:gl.RED,gl.UNSIGNED_BYTE,null);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,history?gl.NEAREST:gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,history?gl.NEAREST:gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      const fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Fluid surface framebuffer incomplete');
      this.targets.push({texture,fbo});
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }
  draw(fluid){
    if(this.shadingLayout!==fluid){
      this.shading.resize(this.width,this.height,fluid.unit);this.shadingLayout=fluid;
    }
    const shading=this.shading.update(fluid);
    const gl=this.gl,w=this.surfaceWidth,h=this.surfaceHeight;
    gl.viewport(0,0,w,h);gl.disable(gl.BLEND);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.targets[0].fbo);
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    this.use(this.particle);this.uniform('uViewport',this.renderWidth,this.renderHeight);this.uniform('uUnit',fluid.unit);this.uniform('uRadius',1.15);
    gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER,fluid.positions,gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLES,0,6,fluid.count);
    gl.bindVertexArray(null);
    this.use(this.smooth);this.uniform('uResolution',w,h);
    const step=Math.min(3.5,Math.max(.5,fluid.unit*.16*w/this.renderWidth));
    let input=this.targets[0];
    for(let i=0;i<6;i++){
      const output=this.targets[i%2+1];
      gl.bindFramebuffer(gl.FRAMEBUFFER,output.fbo);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,input.texture);
      this.uniform('uDirection',i%2===0?step:0,i%2?step:0);gl.drawArrays(gl.TRIANGLES,0,3);input=output;
    }
    const nextHistory=this.historyIndex===3?4:3;
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.targets[nextHistory].fbo);gl.viewport(0,0,this.canvas.width,this.canvas.height);
    this.use(this.dither);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,input.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.maps[0]);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,shading.width,shading.height,0,gl.RED,gl.UNSIGNED_BYTE,shading.tones);
    gl.uniform1i(gl.getUniformLocation(this.dither.program,'uTones'),1);
    gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.targets[this.historyIndex].texture);
    gl.uniform1i(gl.getUniformLocation(this.dither.program,'uHistory'),2);
    this.uniform('uResolution',this.canvas.width,this.canvas.height);this.uniform('uViewport',this.renderWidth,this.renderHeight);
    this.uniform('uField',shading.padding,shading.cell);
    this.uniform('uHistoryReady',this.hasHistory?1:0);
    this.uniform('uDelta',Math.max(0,Math.min(.1,fluid.time-this.lastTime)));
    gl.drawArrays(gl.TRIANGLES,0,3);
    this.historyIndex=nextHistory;this.hasHistory=true;this.lastTime=fluid.time;
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.clear(gl.COLOR_BUFFER_BIT);
    this.use(this.present);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.targets[nextHistory].texture);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
}
