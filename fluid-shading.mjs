// Give each connected silhouette the same tonal distribution, independently of
// particle depth, amount of material, or velocity. This never changes the fluid.
export class FluidShading {
  resize(width,height,unit){
    this.padding=Math.ceil(unit*5);
    const w=width+this.padding*2,h=height+this.padding*2;
    this.cell=Math.max(4,Math.sqrt(w*h/160000));
    this.width=Math.ceil(w/this.cell);this.height=Math.ceil(h/this.cell);
    const size=this.width*this.height;
    this.mask=new Uint8Array(size);this.labels=new Uint8Array(size);
    this.queue=new Uint32Array(size);this.extended=new Uint32Array(size);
    this.nearest=new Int32Array(size);this.nearestDistance=new Float32Array(size);
    this.history=new Float32Array(size).fill(-1);this.nextHistory=new Float32Array(size).fill(-1);
    this.tones=new Uint8Array(size);this.lastPositions=null;this.previousBodies=null;
    this.previousParticleBodies=null;this.lastTime=null;
  }
  update(fluid){
    const {width:w,height:h,cell,padding,mask,labels,queue,extended}=this;
    mask.fill(0);labels.fill(0);this.nearest.fill(-1);this.nearestDistance.fill(Infinity);
    const p=fluid.positions,u=fluid.unit,r=u*1.15/cell,r2=r*r;
    for(let i=0;i<fluid.count;i++){
      const x=(p[i*3]*u+padding)/cell,y=(p[i*3+1]*u+padding)/cell;
      const left=Math.max(0,Math.ceil(x-r-.5)),right=Math.min(w-1,Math.floor(x+r-.5));
      const top=Math.max(0,Math.ceil(y-r-.5)),bottom=Math.min(h-1,Math.floor(y+r-.5));
      for(let row=top;row<=bottom;row++)for(let col=left;col<=right;col++){
        const d=(col+.5-x)**2+(row+.5-y)**2,at=row*w+col;
        if(d<=r2){
          mask[at]=1;
          if(d<this.nearestDistance[at]){this.nearestDistance[at]=d;this.nearest[at]=i;}
        }
      }
    }
    const bodies=[];let end=0;
    for(let seed=0;seed<mask.length;seed++){
      if(!mask[seed]||labels[seed])continue;
      if(bodies.length===254)throw new Error('Too many fluid silhouettes');
      const id=bodies.length+1,start=end;
      labels[seed]=id;queue[end++]=seed;
      for(let head=start;head<end;head++){
        const at=queue[head],x=at%w;
        for(let side=0;side<4;side++){
          const next=side===0?(x?at-1:-1):side===1?(x+1<w?at+1:-1):side===2?at-w:at+w;
          if(next>=0&&next<mask.length&&mask[next]&&!labels[next]){labels[next]=id;queue[end++]=next;}
        }
      }
      bodies.push({start,end,left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity,parents:new Set(),until:0});
    }
    // Use continuous particle extents for the frame, rather than rounded grid
    // bounds. Translating a body cannot make its lighting frame jump by a cell.
    const particleBodies=new Uint8Array(fluid.count),children=new Map();
    const now=fluid.time??0,dt=this.lastTime===null?0:Math.max(0,Math.min(.1,now-this.lastTime));
    for(let i=0;i<fluid.count;i++){
      const x=p[i*3]*u,y=p[i*3+1]*u;
      const at=Math.floor((y+padding)/cell)*w+Math.floor((x+padding)/cell);
      const body=bodies[labels[at]-1];if(!body)continue;
      particleBodies[i]=labels[at];
      const parent=this.previousParticleBodies?.[i];
      if(parent){
        body.parents.add(parent);
        if(!children.has(parent))children.set(parent,new Set());
        children.get(parent).add(labels[at]);
        body.until=Math.max(body.until,this.previousBodies[parent-1]?.until??0);
      }
      const radius=u*1.15;
      body.left=Math.min(body.left,x-radius);body.right=Math.max(body.right,x+radius);
      body.top=Math.min(body.top,y-radius);body.bottom=Math.max(body.bottom,y+radius);
    }
    const rows=Math.max(1,bodies.length);
    const frames=new Float32Array(rows*4),curves=new Uint8Array(rows*256);
    bodies.forEach((body,index)=>{
      if(!Number.isFinite(body.left)){
        for(let j=body.start;j<body.end;j++){
          const at=queue[j],x=(at%w+.5)*cell-padding,y=(Math.floor(at/w)+.5)*cell-padding;
          body.left=Math.min(body.left,x-cell/2);body.right=Math.max(body.right,x+cell/2);
          body.top=Math.min(body.top,y-cell/2);body.bottom=Math.max(body.bottom,y+cell/2);
        }
      }
      const cx=(body.left+body.right)/2,cy=(body.top+body.bottom)/2;
      const rx=Math.max(cell,(body.right-body.left)/2),ry=Math.max(cell,(body.bottom-body.top)/2);
      frames.set([cx,cy,rx,ry],index*4);
      const histogram=new Uint32Array(256);
      for(let j=body.start;j<body.end;j++){
        const at=queue[j],x=(at%w+.5)*cell-padding,y=(Math.floor(at/w)+.5)*cell-padding;
        const light=roundedLight((x-cx)/rx,(y-cy)/ry);
        histogram[Math.min(255,Math.floor(light*256))]++;
      }
      const count=body.end-body.start;let sum=0;
      for(let bin=0;bin<256;bin++){
        // A per-body CDF gives the same light/middle/dark area balance even
        // when the silhouette stretches, changes scale, divides, or rejoins.
        curves[index*256+bin]=Math.round(255*(sum+histogram[bin]*.5)/count);
        sum+=histogram[bin];
      }
      body.histogram=histogram;
      if(body.parents.size>1||[...body.parents].some(parent=>children.get(parent).size>1))body.until=now+2.4;
    });
    // Extend labels just beyond the silhouette for the GPU's smooth edge.
    // Padding includes offscreen material, so clipping cannot relight a blob.
    extended.set(queue.subarray(0,end));let head=0,tail=end;
    for(let layer=0;layer<3;layer++){
      const stop=tail;
      for(;head<stop;head++){
        const at=extended[head],x=at%w,id=labels[at];
        for(let side=0;side<4;side++){
          const next=side===0?(x?at-1:-1):side===1?(x+1<w?at+1:-1):side===2?at-w:at+w;
          if(next>=0&&next<labels.length&&!labels[next]){
            labels[next]=id;this.nearest[next]=this.nearest[at];extended[tail++]=next;
          }
        }
      }
    }
    const {history,nextHistory,tones,lastPositions}=this;
    nextHistory.fill(-1);tones.fill(0);
    for(let at=0;at<labels.length;at++){
      const id=labels[at]-1;if(id<0)continue;
      const x=at%w,y=Math.floor(at/w),f=id*4;
      const light=roundedLight(((x+.5)*cell-padding-frames[f])/frames[f+2],
        ((y+.5)*cell-padding-frames[f+1])/frames[f+3]);
      const bin=Math.max(0,Math.min(255,light*256-.5)),lo=Math.floor(bin),frac=bin-lo;
      const rank=(curves[id*256+lo]*(1-frac)+curves[id*256+Math.min(255,lo+1)]*frac)/255;
      let tone=.125+.875*(1-rank);
      const remaining=bodies[id].until-now,particle=this.nearest[at];
      if(remaining>0&&lastPositions&&particle>=0){
        // Reproject lighting with the same particles across both split and merge.
        // The new silhouette is immediate; only the material's tonal recipe eases.
        const a=particle*3,ox=x-(p[a]-lastPositions[a])*u/cell,oy=y-(p[a+1]-lastPositions[a+1])*u/cell;
        const ix=Math.floor(ox),iy=Math.floor(oy),fx=ox-ix,fy=oy-iy;
        let value=0,weight=0;
        for(let tap=0;tap<4;tap++){
          const tx=ix+(tap%2),ty=iy+(tap>>1);
          if(tx<0||tx>=w||ty<0||ty>=h)continue;
          const old=history[ty*w+tx];if(old<0)continue;
          const a=(tap%2?fx:1-fx)*(tap>>1?fy:1-fy);value+=old*a;weight+=a;
        }
        if(weight>.01){
          const tau=.65*Math.min(1,remaining/1.2),retain=Math.exp(-dt/Math.max(.001,tau));
          tone=tone*(1-retain)+value/weight*retain;
        }
      }
      nextHistory[at]=tone;tones[at]=Math.round(tone*255);
    }
    this.history=nextHistory;this.nextHistory=history;
    this.lastPositions=new Float32Array(p);this.previousParticleBodies=particleBodies;
    this.lastTime=now;this.previousBodies=bodies;
    this.bodies=bodies;this.frames=frames;this.curves=curves;
    return this;
  }
}

export function roundedLight(x,y){
  // A smooth canonical dome; no particle-level normals or volume gradients.
  const z=Math.sqrt(Math.max(.04,1-x*x-y*y));
  return Math.max(0,Math.min(1,(-.48*x-.55*y+.9*z)/Math.hypot(x,y,z)/1.1588369163));
}
