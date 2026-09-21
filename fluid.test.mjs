import test from 'node:test';
import assert from 'node:assert/strict';
import { Fluid } from './fluid.mjs';

function rectangleDistance(x, y) {
  const dx=Math.abs(x-477.5)-397.5,dy=Math.abs(y-452.5)-72.5;
  return Math.hypot(Math.max(dx,0),Math.max(dy,0))+Math.min(Math.max(dx,dy),0);
}

test('liquid survives departures, text contacts and reunions without losing material', () => {
  const fluid=new Fluid({width:1440,height:900,
    groups:[{x:1200,y:252,size:216},{x:1310,y:720,size:132}],
    headline:{left:80,right:875,top:380,bottom:525},distance:rectangleDistance});
  const count=fluid.count;
  for(let frame=0;frame<60*60;frame++){
    fluid.step();
    if(frame%60)continue;
    assert.equal(fluid.count,count);
    assert(fluid.positions.every(Number.isFinite));
    assert(fluid.velocities.every(Number.isFinite));
    assert(Math.max(...fluid.density)/fluid.restDensity<1.08,'density constraints remain bounded');
    assert(fluid.transfers.length<=2,'transfer slots are reused');
    for(let i=0;i<count;i++){
      const x=fluid.positions[i*3]*fluid.unit,y=fluid.positions[i*3+1]*fluid.unit;
      assert(rectangleDistance(x,y)>=fluid.unit*1.20+2.98,'liquid stays outside the solid text');
    }
  }
  assert(fluid.releases>=2);
  assert(fluid.contacts>=2);
  assert(fluid.reunions>=2);
  assert.equal(fluid.homes.length,count);
  for(let i=0;i<count;i++)if(fluid.owner[i]>=0){
    const transfer=fluid.transfers[fluid.owner[i]];
    assert(!transfer.done&&transfer.ids.includes(i),'every guided particle has a live transfer');
  }
});

test('one small body remains stable without emitting orphan parcels', () => {
  const fluid=new Fluid({width:320,height:360,groups:[{x:280,y:100,size:40}],
    headline:{left:24,right:270,top:180,bottom:270},distance:()=>10000});
  for(let i=0;i<600;i++)fluid.step();
  assert(fluid.positions.every(Number.isFinite));
  assert.equal(fluid.releases,0);assert.equal(fluid.transfers.length,0);
});

test('the composed three-lobe seed settles once before its first visible frame',()=>{
  const fluid=new Fluid({width:1440,height:900,
    groups:[{x:1200,y:252,size:216},{x:1310,y:720,size:132}],
    headline:{left:80,right:875,top:380,bottom:525},distance:rectangleDistance});
  const count=fluid.count,time=fluid.time;
  assert(fluid.groups.every(g=>g.lobes.length===3));
  assert.equal(new Set(fluid.lobes).size,3);
  fluid.prime();assert(fluid.time>time+.99);assert.equal(fluid.count,count);
  assert.equal(fluid.releases,0);assert(fluid.positions.every(Number.isFinite));
  assert(Math.max(...fluid.density)/fluid.restDensity<1.08);
  const posed=new Float32Array(fluid.positions),phase=fluid.time;
  fluid.prime();assert.deepEqual(fluid.positions,posed);assert.equal(fluid.time,phase);
});
