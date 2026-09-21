import test from 'node:test';
import assert from 'node:assert/strict';
import { FluidShading, roundedLight } from './fluid-shading.mjs';

function particles(shapes,unit=12){
  const points=[];
  for(const {x,y,rx,ry=rx,angle=0} of shapes){
    for(let a=-rx;a<=rx;a+=.7)for(let b=-ry;b<=ry;b+=.7){
      if((a/rx)**2+(b/ry)**2>1)continue;
      points.push(x+a*Math.cos(angle)-b*Math.sin(angle),y+a*Math.sin(angle)+b*Math.cos(angle),0);
    }
  }
  return {unit,count:points.length/3,positions:new Float32Array(points)};
}
function measure(fluid,width=800,height=600){
  const field=new FluidShading();field.resize(width,height,fluid.unit);field.update(fluid);
  const stats=field.bodies.map(()=>({zones:[0,0,0],sum:0,count:0}));
  for(let at=0;at<field.mask.length;at++){
    if(!field.mask[at])continue;
    const body=field.labels[at]-1,frame=field.frames.subarray(body*4,body*4+4);
    const x=(at%field.width+.5)*field.cell-field.padding;
    const y=(Math.floor(at/field.width)+.5)*field.cell-field.padding;
    const bin=Math.max(0,Math.min(255,roundedLight((x-frame[0])/frame[2],(y-frame[1])/frame[3])*256-.5));
    const lo=Math.floor(bin),hi=Math.min(255,lo+1),fraction=bin-lo;
    const rank=(field.curves[body*256+lo]*(1-fraction)+field.curves[body*256+hi]*fraction)/255;
    const tone=.125+.875*(1-rank),stat=stats[body];
    stat.zones[Math.min(2,Math.floor((1-rank)*3))]++;stat.sum+=tone;stat.count++;
  }
  return {field,stats:stats.map(s=>({zones:s.zones.map(n=>n/s.count),mean:s.sum/s.count}))};
}
function balanced(stats){
  for(const s of stats){
    for(const fraction of s.zones)assert.ok(Math.abs(fraction-1/3)<.055,JSON.stringify(s));
    assert.ok(Math.abs(s.mean-.5625)<.02,JSON.stringify(s));
  }
}

test('small, large, stretched, and asymmetric bodies share a tonal balance',()=>{
  const shapes=[{x:12,y:12,rx:2},{x:35,y:12,rx:6},{x:17,y:33,rx:6,ry:2,angle:.6}];
  const result=measure(particles(shapes));
  assert.equal(result.stats.length,3);balanced(result.stats);
  const joined=measure(particles([{x:20,y:20,rx:5},{x:25,y:23,rx:3}]));
  assert.equal(joined.stats.length,1);balanced(joined.stats);
});

test('shading is independent of scale, translation, depth, and viewport clipping',()=>{
  const a=particles([{x:12,y:13,rx:4,ry:2.5}]);
  const small=measure(a);balanced(small.stats);
  const b={...a,unit:24,positions:new Float32Array(a.positions)};
  for(let i=0;i<b.count;i++){b.positions[i*3]+=18;b.positions[i*3+1]+=2;b.positions[i*3+2]=Math.sin(i)*6;}
  const copy=new Float32Array(b.positions),large=measure(b,700,600);
  balanced(large.stats);assert.deepEqual(b.positions,copy,'shading must not alter simulation positions');
  assert.ok(Math.abs(small.stats[0].mean-large.stats[0].mean)<.015);
  const depth=measure({...a,positions:Float32Array.from(a.positions,(v,i)=>i%3===2?v+9:v)});
  assert.deepEqual(small.field.curves,depth.field.curves);
});

test('detachment and reunion normalize each current connected shape',()=>{
  for(const separation of [4,7,12,7,4]){
    const result=measure(particles([{x:20,y:20,rx:4},{x:20+separation,y:20,rx:2}]));
    assert.equal(result.stats.length,separation>8?2:1);balanced(result.stats);
  }
  const empty=measure(particles([]));assert.equal(empty.stats.length,0);
});

function toneAt(field,x,y){
  const gx=(x+field.padding)/field.cell-.5,gy=(y+field.padding)/field.cell-.5;
  const ix=Math.floor(gx),iy=Math.floor(gy),fx=gx-ix,fy=gy-iy;
  let sum=0,weight=0;
  for(let tap=0;tap<4;tap++){
    const tx=ix+tap%2,ty=iy+(tap>>1);
    if(tx<0||ty<0||tx>=field.width||ty>=field.height)continue;
    const tone=field.history[ty*field.width+tx];if(tone<0)continue;
    const w=(tap%2?fx:1-fx)*(tap>>1?fy:1-fy);sum+=tone*w;weight+=w;
  }
  return sum/weight;
}

test('material lighting survives a split and reunion without a new-frame pop',()=>{
  const fluid=particles([{x:20,y:20,rx:4},{x:27,y:20,rx:2}]);fluid.time=0;
  const donorCount=particles([{x:20,y:20,rx:4}]).count;
  const field=new FluidShading();field.resize(800,600,fluid.unit);field.update(fluid);
  const base=new Float32Array(fluid.positions);let previousCount=field.bodies.length,events=0;
  for(let frame=1;frame<=260;frame++){
    const prior=new Float32Array(fluid.positions),oldTones=[];
    for(let i=donorCount;i<fluid.count;i++)oldTones.push(toneAt(field,prior[i*3]*fluid.unit,prior[i*3+1]*fluid.unit));
    const shift=frame<=100?frame*.03:frame<=160?3:3-(frame-160)*.03;
    for(let i=donorCount;i<fluid.count;i++)fluid.positions[i*3]=base[i*3]+shift;
    fluid.time+=1/30;field.update(fluid);
    if(field.bodies.length!==previousCount){
      events++;
      const raw=new FluidShading();raw.resize(800,600,fluid.unit);raw.update(fluid);
      let easedChange=0,rawChange=0;
      for(let i=donorCount;i<fluid.count;i++){
        const x=fluid.positions[i*3]*fluid.unit,y=fluid.positions[i*3+1]*fluid.unit;
        easedChange+=Math.abs(toneAt(field,x,y)-oldTones[i-donorCount]);
        rawChange+=Math.abs(toneAt(raw,x,y)-oldTones[i-donorCount]);
      }
      assert.ok(easedChange<rawChange*.4,`split/merge change ${easedChange} vs ${rawChange}`);
    }
    previousCount=field.bodies.length;
  }
  assert.equal(events,2,'exercise both detachment and reunion');
  for(let i=0;i<90;i++){fluid.time+=1/30;field.update(fluid);}
  const settled=new FluidShading();settled.resize(800,600,fluid.unit);settled.update(fluid);
  assert.deepEqual(field.tones,settled.tones,'converge to the same per-body tonal balance');
});
