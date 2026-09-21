// Small zero-gravity position-based fluid. Units are particle spacings and seconds.
// Density constraints follow Macklin & Müller, Position Based Fluids (2013).
export class Fluid {
  constructor({ width, height, groups, distance, headline }) {
    this.width = width; this.height = height; this.distance = distance;
    this.unit = Math.max(1, ...groups.map(g => g.size)) / (width > 700 ? 6 : 4.85);
    this.groups = groups.map(g => ({ x: (g.x + g.size * .23) / this.unit,
      y: (g.y - g.size * .28) / this.unit, radius: Math.max(1.3, g.size / this.unit - 1) }));
    this.headline = Object.fromEntries(Object.entries(headline).map(([k, v]) => [k, v / this.unit]));
    const points = [], homes = [], lobes = [];
    this.groups.forEach((g, home) => {
      const r = g.radius,angle=home===0?.32:-.48;
      // Three unequal, joined lobes form the seed rather than a distorted sphere.
      g.lobes=[[-.62,-.22,.03,.68],[.42,-.48,-.10,.62],[.18,.56,.10,.70]].map(([x,y,z,size])=>({
        x:(x*Math.cos(angle)-y*Math.sin(angle))*r,
        y:(x*Math.sin(angle)+y*Math.cos(angle))*r,z:z*r,radius:size*r,
      }));
      const bound=Math.ceil(r*1.5),blend=r*.25;
      for (let z = -bound; z <= bound; z++) for (let y = -bound; y <= bound; y++) {
        for (let x = -bound; x <= bound; x++) {
          let distance=Infinity,best=Infinity,lobe=0;
          g.lobes.forEach((center,index)=>{
            const d=Math.hypot(x-center.x,y-center.y,z-center.z)-center.radius;
            if(d<best){best=d;lobe=index;}
            const h=Math.max(blend-Math.abs(distance-d),0)/blend;
            distance=Math.min(distance,d)-h*h*blend*.25;
          });
          if(distance>0)continue;
          const seed = x * 17.7 + y * 43.3 + z * 113.9 + home * 8;
          points.push(g.x+x+.035*Math.sin(seed),g.y+y+.035*Math.cos(seed),z+.035*Math.sin(seed*2));
          homes.push(home);lobes.push(lobe);
        }
      }
    });
    this.count = homes.length;
    this.positions = new Float32Array(points);
    this.previous = new Float32Array(points);
    this.velocities = new Float32Array(points.length);
    this.delta = new Float32Array(points.length);
    this.homes = new Uint8Array(homes);
    this.lobes = new Uint8Array(lobes);
    this.owner = new Int8Array(this.count).fill(-1);
    this.density = new Float32Array(this.count);
    this.lambda = new Float32Array(this.count);
    this.gradients = new Float32Array(points.length);
    this.gradientNorm = new Float32Array(this.count);
    this.normals = new Float32Array(this.count * 2);
    this.next = new Int32Array(this.count);
    this.cells = new Int32Array(this.count * 3);
    this.pairA = new Uint16Array(this.count * 96);
    this.pairB = new Uint16Array(this.count * 96);
    this.pairs = 0;
    this.grid = new Map();
    this.h = 2.15; this.h2 = this.h * this.h;
    this.restDensity = 0;
    for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) for (let z = -2; z <= 2; z++) {
      const q = 1 - (x*x + y*y + z*z) / this.h2;
      if (q > 0) this.restDensity += q*q*q;
    }
    this.time = 14.25; this.transfers = []; this.nextRelease = [this.time+5,this.time+13];
    this.releases = 0; this.reunions = 0; this.contacts = 0;
    this.buildPairs();
    // Relax the initial sampling without giving it an explosive startup velocity.
    for (let i = 0; i < 24; i++) { if(i%4===0)this.buildPairs();this.projectDensity(); this.collide(); }
    this.previous.set(this.positions);
    for(let i=0;i<this.count;i++){
      const a=i*3,g=this.groups[this.homes[i]],rx=this.positions[a]-g.x,ry=this.positions[a+1]-g.y;
      this.velocities[a]=-.018*ry;this.velocities[a+1]=.018*rx;
    }
  }
  prime(){
    if(this.primed)return;this.primed=true;
    // A short hidden physical settling pass gives the first visible frame the
    // same material response as later frames, without displaying startup motion.
    for(let i=0;i<60;i++)this.step();
  }
  hash(x, y, z) { return (x + 128) * 65536 + (y + 128) * 256 + z + 128; }
  buildPairs() {
    const p = this.positions, h = this.h;
    this.grid.clear(); this.pairs = 0;
    for (let i = 0; i < this.count; i++) {
      const x = Math.floor(p[i*3]/h), y = Math.floor(p[i*3+1]/h), z = Math.floor(p[i*3+2]/h);
      this.cells.set([x,y,z], i*3);
      const key = this.hash(x,y,z);
      this.next[i] = this.grid.get(key) ?? -1; this.grid.set(key, i);
    }
    for (let i = 0; i < this.count; i++) {
      const a = i*3, cx = this.cells[a], cy = this.cells[a+1], cz = this.cells[a+2];
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
        for (let j = this.grid.get(this.hash(cx+x,cy+y,cz+z)) ?? -1; j >= 0; j = this.next[j]) {
          if (j <= i) continue;
          const b = j*3, dx = p[a]-p[b], dy = p[a+1]-p[b+1], dz = p[a+2]-p[b+2];
          if (dx*dx+dy*dy+dz*dz >= this.h2 * 1.21) continue;
          if (this.pairs >= this.pairA.length) throw new Error('Fluid neighborhood capacity exceeded');
          this.pairA[this.pairs] = i; this.pairB[this.pairs++] = j;
        }
      }
    }
  }
  projectDensity() {
    const p = this.positions, rho = this.density, grad = this.gradients, norm = this.gradientNorm;
    rho.fill(1); grad.fill(0); norm.fill(0); this.delta.fill(0);
    const scale = -6 / (this.h2 * this.restDensity);
    for (let k = 0; k < this.pairs; k++) {
      const i=this.pairA[k], j=this.pairB[k], a=i*3, b=j*3;
      const x=p[a]-p[b], y=p[a+1]-p[b+1], z=p[a+2]-p[b+2];
      const q=1-(x*x+y*y+z*z)/this.h2;
      if(q<=0)continue;
      const w=q*q*q; rho[i]+=w; rho[j]+=w;
      const factor=scale*q*q, gx=factor*x, gy=factor*y, gz=factor*z;
      grad[a]+=gx; grad[a+1]+=gy; grad[a+2]+=gz;
      grad[b]-=gx; grad[b+1]-=gy; grad[b+2]-=gz;
      const n=gx*gx+gy*gy+gz*gz; norm[i]+=n; norm[j]+=n;
    }
    for(let i=0;i<this.count;i++){
      const a=i*3;
      const constraint=Math.max(0,rho[i]/this.restDensity-1);
      this.lambda[i]=-constraint/(norm[i]+grad[a]**2+grad[a+1]**2+grad[a+2]**2+.025);
    }
    for(let k=0;k<this.pairs;k++){
      const i=this.pairA[k],j=this.pairB[k],a=i*3,b=j*3;
      const x=p[a]-p[b],y=p[a+1]-p[b+1],z=p[a+2]-p[b+2],q=1-(x*x+y*y+z*z)/this.h2;
      if(q<=0)continue;
      const correction=-.00035*(q/.91)**12;
      const f=(this.lambda[i]+this.lambda[j]+correction)*scale*q*q;
      this.delta[a]+=f*x; this.delta[a+1]+=f*y; this.delta[a+2]+=f*z;
      this.delta[b]-=f*x; this.delta[b+1]-=f*y; this.delta[b+2]-=f*z;
    }
    for(let i=0;i<this.count;i++){
      const a=i*3, length=Math.hypot(this.delta[a],this.delta[a+1],this.delta[a+2]);
      const limit=length>.16?.16/length:1;
      p[a]+=this.delta[a]*limit;p[a+1]+=this.delta[a+1]*limit;p[a+2]+=this.delta[a+2]*limit;
    }
  }
  centroid(ids) {
    const center={x:0,y:0,z:0,vx:0,vy:0,vz:0};
    for(const i of ids){const a=i*3;
      center.x+=this.positions[a];center.y+=this.positions[a+1];center.z+=this.positions[a+2];
      center.vx+=this.velocities[a];center.vy+=this.velocities[a+1];center.vz+=this.velocities[a+2];
    }
    for(const key of Object.keys(center))center[key]/=ids.length;
    return center;
  }
  release(home) {
    const g=this.groups[home], side=home===0?1:-1;
    const target={x:this.headline.left+(this.headline.right-this.headline.left)*(home===0?.52:.22),
      y:side>0?this.headline.top:this.headline.bottom};
    const dx=target.x-g.x,dy=target.y-g.y,len=Math.hypot(dx,dy);
    const tip={x:g.x+dx/len*g.radius*.8,y:g.y+dy/len*g.radius*.8,z:.25};
    const candidates=[];
    for(let i=0;i<this.count;i++)if(this.homes[i]===home&&this.owner[i]<0){
      const a=i*3; candidates.push({i,d:(this.positions[a]-tip.x)**2+(this.positions[a+1]-tip.y)**2+(this.positions[a+2]-tip.z)**2});
    }
    const amount=Math.min(14,Math.max(9,Math.round(candidates.length*.035)));
    if(candidates.length<amount*3)return;
    const ids=candidates.sort((a,b)=>a.d-b.d).slice(0,amount).map(p=>p.i);
    const transfer={ids,home,receiver:1-home,stage:'approach',started:this.time,stageAt:this.time,target,side,contact:false};
    let index=this.transfers.findIndex(t=>t.done);
    if(index<0)index=this.transfers.length;
    this.transfers[index]=transfer;
    for(const i of ids)this.owner[i]=index;
    this.releases++;
  }
  drive(dt) {
    if(this.groups.length!==2)return;
    for(let home=0;home<2;home++)if(this.time>=this.nextRelease[home]&&!this.transfers.some(t=>t.home===home&&!t.done)){
      this.release(home);this.nextRelease[home]=this.time+36+home*11;
    }
    const p=this.positions,v=this.velocities;
    const homeCounts=[0,0];for(let i=0;i<this.count;i++)if(this.owner[i]<0)homeCounts[this.homes[i]]++;
    for(const t of this.transfers){
      if(t.done)continue;
      const c=this.centroid(t.ids), g=this.groups[t.receiver], age=this.time-t.stageAt;
      const change=(stage)=>{t.stage=stage;t.stageAt=this.time;};
      const sideY=t.side>0?this.headline.top-2.5:this.headline.bottom+2.5;
      if(t.stage==='approach'&&(t.contact||this.time-t.started>19))change('glide');
      if(t.stage==='glide'&&age>3)change('around');
      if(t.stage==='around'&&c.x>this.headline.right+2.2)change('cross');
      if(t.stage==='cross'&&(t.side>0?c.y>this.headline.bottom+2.5:c.y<this.headline.top-2.5))change('return');
      if(t.stage==='return'&&Math.hypot(c.x-g.x,c.y-g.y,c.z)<g.radius*.85){
        for(const i of t.ids){
          this.homes[i]=t.receiver;this.owner[i]=-1;
          let best=Infinity;
          g.lobes.forEach((lobe,index)=>{
            const d=(p[i*3]-g.x-lobe.x)**2+(p[i*3+1]-g.y-lobe.y)**2+(p[i*3+2]-lobe.z)**2;
            if(d<best){best=d;this.lobes[i]=index;}
          });
        }
        t.done=true;this.reunions++;continue;
      }
      let target=t.target;
      if(t.stage==='glide')target={x:c.x+.5,y:sideY};
      if(t.stage==='around')target={x:this.headline.right+3.6,y:sideY};
      if(t.stage==='cross')target={x:this.headline.right+3.6,y:t.side>0?this.headline.bottom+3.5:this.headline.top-3.5};
      if(t.stage==='return')target=g;
      let ax=(target.x-c.x)*.28-c.vx*.65,ay=(target.y-c.y)*.28-c.vy*.65,az=-c.z*.25-c.vz*.65;
      const magnitude=Math.hypot(ax,ay,az), limit=t.stage==='approach'?1.4:.85;
      if(magnitude>limit){ax*=limit/magnitude;ay*=limit/magnitude;az*=limit/magnitude;}
      const ramp=Math.min(1,(this.time-t.started)/2);ax*=ramp;ay*=ramp;az*=ramp;
      for(const i of t.ids){v[i*3]+=ax*dt;v[i*3+1]+=ay*dt;v[i*3+2]+=az*dt;}
      // Reaction on the donor while the neck is loaded. Mass is never spawned.
      if(this.time-t.started<7){
        const reaction=t.ids.length/Math.max(1,homeCounts[t.home]);
        for(let i=0;i<this.count;i++)if(this.homes[i]===t.home&&this.owner[i]<0){
          v[i*3]-=ax*dt*reaction;v[i*3+1]-=ay*dt*reaction;v[i*3+2]-=az*dt*reaction;
        }
      }
    }
  }
  collide() {
    const p=this.positions,u=this.unit,margin=1.20*u+3;
    for(let i=0;i<this.count;i++){
      const a=i*3,x=p[a]*u,y=p[a+1]*u;
      const d=this.distance(x,y);
      if(d<margin){
        let nx=this.distance(x+2,y)-this.distance(x-2,y),ny=this.distance(x,y+2)-this.distance(x,y-2);
        const length=Math.hypot(nx,ny);if(length>.0001){
          nx/=length;ny/=length;const correction=(margin-d)/u;
          p[a]+=nx*correction;p[a+1]+=ny*correction;
          this.normals[i*2]=nx;this.normals[i*2+1]=ny;
          const transfer=this.transfers[this.owner[i]];
          if(transfer&&!transfer.contact){transfer.contact=true;this.contacts++;}
        }
      }
      // Off-canvas reserve, no visible box or gravity floor.
      p[a]=Math.max(-3,Math.min(this.width/u+3,p[a]));
      p[a+1]=Math.max(-3,Math.min(this.height/u+3,p[a+1]));
      p[a+2]=Math.max(-7,Math.min(7,p[a+2]));
    }
  }
  step(dt=1/60) {
    this.time+=dt;
    const p=this.positions,v=this.velocities;
    this.drive(dt);this.buildPairs();
    // Pairwise cohesion and viscosity share momentum throughout each volume.
    this.delta.fill(0);
    for(let k=0;k<this.pairs;k++){
      const i=this.pairA[k],j=this.pairB[k],a=i*3,b=j*3;
      const x=p[b]-p[a],y=p[b+1]-p[a+1],z=p[b+2]-p[a+2],r=Math.hypot(x,y,z);
      if(r<.001||r>=this.h)continue;
      const q=1-r/this.h;
      const cohesion=1.8*q*q*Math.min(1,Math.max(0,(r-.55)*3))/r*dt;
      const viscosity=.022*(1-r*r/this.h2)**3/this.restDensity;
      for(let axis=0;axis<3;axis++){
        const force=cohesion*(axis===0?x:axis===1?y:z)+viscosity*(v[b+axis]-v[a+axis]);
        this.delta[a+axis]+=force;this.delta[b+axis]-=force;
      }
    }
    this.previous.set(p);this.normals.fill(0);
    for(let i=0;i<this.count;i++){
      const a=i*3,g=this.groups[this.homes[i]],rx=p[a]-g.x,ry=p[a+1]-g.y;
      for(let axis=0;axis<3;axis++)v[a+axis]+=this.delta[a+axis];
      if(this.owner[i]<0){
        const drift=Math.sin(this.time*.13+this.homes[i]*2.3);
        const lobe=g.lobes[this.lobes[i]],turn=.12*Math.sin(this.time*.09+this.homes[i]*1.7);
        const lx=lobe.x*Math.cos(turn)-lobe.y*Math.sin(turn),ly=lobe.x*Math.sin(turn)+lobe.y*Math.cos(turn);
        // Weak, slowly shifting three-center confinement keeps the lobed
        // composition alive; it does not prescribe the surface or the necks.
        v[a]+=(-(rx-lx)*.055-ry*.012*drift)*dt;
        v[a+1]+=(-(ry-ly)*.055+rx*.012*drift)*dt;
        v[a+2]+=(-(p[a+2]-lobe.z)*.055+rx*.009*drift)*dt;
      }
      const speed=Math.hypot(v[a],v[a+1],v[a+2]),limit=speed>2.2?2.2/speed:1;
      for(let axis=0;axis<3;axis++){v[a+axis]*=limit*.9995;p[a+axis]+=v[a+axis]*dt;}
    }
    this.buildPairs();
    for(let iteration=0;iteration<4;iteration++){this.projectDensity();this.collide();}
    for(let i=0;i<this.count;i++){
      const a=i*3;for(let axis=0;axis<3;axis++)v[a+axis]=(p[a+axis]-this.previous[a+axis])/dt;
      const nx=this.normals[i*2],ny=this.normals[i*2+1],inward=v[a]*nx+v[a+1]*ny;
      if(inward<0){v[a]-=inward*nx;v[a+1]-=inward*ny;}
    }
  }
}
