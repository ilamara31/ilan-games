// Generates the 1024x1024 App Store icon: the game's own gradient + stacked blocks,
// drawn straight to RGBA and PNG-encoded (no image libraries needed).
const zlib=require('zlib'),fs=require('fs');
const S=1024, buf=Buffer.alloc(S*S*3);

function px(x,y,r,g,b){if(x<0||y<0||x>=S||y>=S)return;const i=(y*S+x)*3;buf[i]=r;buf[i+1]=g;buf[i+2]=b;}
function rect(x,y,w,h,r,g,b){for(let j=Math.round(y);j<Math.round(y+h);j++)for(let i=Math.round(x);i<Math.round(x+w);i++)px(i,j,r,g,b);}
function mix(a,b,t){return a+(b-a)*t;}
// hsl -> rgb, matching the game's hsl(hue,62%,58%) block colours
function hsl(h,s,l){h/=360;s/=100;l/=100;
  const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;
  const f=t=>{if(t<0)t++;if(t>1)t--;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};
  return [f(h+1/3),f(h),f(h-1/3)].map(v=>Math.round(v*255));}
// wider hue spread than the in-game 9-degree step: the icon is read at 60px, so it needs contrast
const hue=i=>(i*40+195)%360;

// background: the in-game vertical gradient #10204a -> #0a0f24
for(let y=0;y<S;y++){const t=y/(S-1);
  const r=Math.round(mix(0x10,0x0a,t)),g=Math.round(mix(0x20,0x0f,t)),b=Math.round(mix(0x4a,0x24,t));
  for(let x=0;x<S;x++)px(x,y,r,g,b);}

// tower: 6 blocks, each slightly offset, narrowing upward like a real run
const BH=112, BASE_Y=S-150, blocks=[
  {w:600,dx:  0},{w:560,dx: 26},{w:520,dx:-18},
  {w:470,dx: 34},{w:410,dx:-12},{w:340,dx: 22}];
blocks.forEach((b,i)=>{
  const y=BASE_Y-(i+1)*BH, x=(S-b.w)/2+b.dx;
  const [r,g,bl]=hsl(hue(i),64,58);
  rect(x,y,b.w,BH,r,g,bl);
  // top highlight + bottom shadow, same as the canvas renderer
  const [hr,hg,hb]=[Math.min(255,r+40),Math.min(255,g+40),Math.min(255,bl+40)];
  rect(x,y,b.w,10,hr,hg,hb);
  rect(x,y+BH-12,b.w,12,Math.round(r*.72),Math.round(g*.72),Math.round(bl*.72));
});

// PNG encode (8-bit RGB, filter 0 per scanline)
const raw=Buffer.alloc((S*3+1)*S);
for(let y=0;y<S;y++){raw[y*(S*3+1)]=0;buf.copy(raw,y*(S*3+1)+1,y*S*3,(y+1)*S*3);}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);
  const td=Buffer.concat([Buffer.from(type),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td)>>>0);
  return Buffer.concat([len,td,crc]);}
let T=null;function crc32(b){if(!T){T=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;T[n]=c>>>0;}}
  let c=0xffffffff;for(const v of b)c=T[(c^v)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(S,0);ihdr.writeUInt32BE(S,4);ihdr[8]=8;ihdr[9]=2;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
  chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
fs.writeFileSync(process.argv[2]||'AppIcon-1024.png',png);
console.log('wrote',(png.length/1024).toFixed(0)+'KB');
