const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('index.html','utf8');
const fn = html.match(/function chorusLighting\(t, meta, beat\) \{[\s\S]*?\n\}/)[0];
const data = JSON.parse(html.match(/<script type="application\/json" id="fc-data">([\s\S]*?)<\/script>/)[1]);
function create(reduceMotion,stage){return new Function('clamp','reduceMotion','STAGE',fn+';return chorusLighting;')((v,a,b)=>Math.max(a,Math.min(b,v)),reduceMotion,stage)}
for(const s of data.stages){
 const f=create(false,s.id-1), m=s.meta, b=m.beat, start=s.id===1?m.clipEnd-35:m.chorusStart,end=Math.min(start+32*b,m.soloStart);
 assert.equal(f(start-1,m,b).strength,0); assert.equal(f(start,m,b).accent,1);
 assert.equal(f(start+1,m,b).strength,1); assert.equal(f(end+1,m,b).strength,0);
 assert.equal(f(start+2,m,b).accent,0);
 assert.equal(create(true,s.id-1)(start,m,b).accent,0);
 const shorter={...m,chorusEnd:start+4};assert.equal(f(start+5,shorter,b).strength,0);
 for(let t=start-1;t<=end+1;t+=.05){let x=f(t,m,b);assert.ok(Number.isFinite(x.strength)&&x.strength>=0&&x.strength<=1);}
 console.log('stage',s.id,'start',start,'provisional end',end.toFixed(3));
}
