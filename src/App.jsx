import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const vert = `varying vec2 vUv;
void main(){ vUv=uv; gl_Position=vec4(position,1.0); }`;

// ── Shared GLSL ────────────────────────────────────────────────────────────
const SHARED = `
#define PI  3.14159265358979323846
#define TAU 6.28318530717958647692

float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float hash1(float n){ return fract(sin(n)*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p){
  float v=0.,a=0.5;
  for(int i=0;i<7;i++){v+=a*noise(p);p=p*2.1+vec2(0.13,0.29);a*=0.5;}
  return v;
}
float fbm4(vec2 p){
  float v=0.,a=0.5;
  for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.1+vec2(0.13,0.29);a*=0.5;}
  return v;
}

// Pure cinematic deep-space: pure black + crisp white stars only
vec3 deepSpace(vec3 rd){
  vec3 col=vec3(0.);
  vec2 uv=vec2(atan(rd.z,rd.x)/TAU, asin(clamp(rd.y,-1.,1.))/PI);

  // Tiny dense background stars
  for(float s=120.;s<=480.;s+=120.){
    vec2 id=floor(uv*s);
    float h=fract(sin(dot(id+s,vec2(127.1,311.7)))*43758.5453);
    if(h>0.82){
      float dist=length(fract(uv*s)-0.5);
      float b=pow((h-0.82)/0.18,5.)*smoothstep(0.10,0.,dist);
      float tc=fract(sin(dot(id,vec2(91.3,171.7)))*34758.5);
      vec3 tint=tc<0.12?vec3(0.78,0.87,1.0):tc<0.22?vec3(1.0,0.93,0.80):vec3(1.0,1.0,1.0);
      col+=b*tint*0.5;
    }
  }
  // Medium stars
  {
    vec2 id=floor(uv*55.);
    float h=fract(sin(dot(id+55.,vec2(127.1,311.7)))*43758.5453);
    if(h>0.915){
      float dist=length(fract(uv*55.)-0.5);
      float b=pow((h-0.915)/0.085,3.)*smoothstep(0.16,0.,dist);
      col+=b*mix(vec3(0.82,0.90,1.0),vec3(1.),fract(sin(dot(id,vec2(55.1,231.7)))*27348.5))*1.1;
    }
  }
  // Hero stars with spikes
  {
    vec2 id=floor(uv*18.);
    float h=fract(sin(dot(id+18.,vec2(127.1,311.7)))*43758.5453);
    if(h>0.975){
      vec2 f=fract(uv*18.)-0.5;
      float core=exp(-dot(f,f)*600.)*6.;
      float sH=exp(-f.y*f.y*1600.)*exp(-abs(f.x)*35.)*1.8;
      float sV=exp(-f.x*f.x*1600.)*exp(-abs(f.y)*35.)*1.8;
      float tc=fract(sin(dot(id,vec2(33.1,91.7)))*19348.5);
      vec3 tint=tc<0.3?vec3(0.75,0.87,1.0):tc<0.55?vec3(1.0,0.95,0.82):vec3(1.,1.,1.);
      col+=(core+sH+sV)*tint;
    }
  }
  // Milky Way: barely-there density smear
  float mw=exp(-pow(rd.y*6.,2.));
  float mwn=fract(sin(dot(uv*14.,vec2(127.1,311.7)))*43758.5)*fract(sin(dot(uv*9.+.5,vec2(91.3,171.7)))*31748.5);
  col+=mw*mwn*vec3(0.009,0.010,0.018)*1.5;

  return col;
}
`;

// ══════════════════════════════════════════════════════
// EARTH — photorealistic Blue Marble with Moon
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// REPLACE YOUR earthFrag with this entire block
// ══════════════════════════════════════════════════════
const earthFrag = `precision highp float;
uniform float uTime; uniform vec2 uRes; uniform vec2 uMouse; varying vec2 vUv;
${SHARED}

void main(){
  vec2 uv=(gl_FragCoord.xy/uRes)*2.-1.; uv.x*=uRes.x/uRes.y;
  float yaw  = uMouse.x + uTime*0.007;
  float pitch = clamp(uMouse.y, -0.9, 0.9);
  float cy=cos(yaw),sy=sin(yaw),cp=cos(pitch),sp=sin(pitch);
  mat3 R=mat3(cy,0.,sy, 0.,1.,0., -sy,0.,cy)*mat3(1.,0.,0., 0.,cp,-sp, 0.,sp,cp);

  // Camera closer, centered
  vec3 cam=R*vec3(0.,0.,2.8);
  vec3 fwd=normalize(-cam);
  vec3 rt=normalize(cross(fwd,vec3(0.,1.,0.)));
  vec3 up2=cross(rt,fwd);
  vec3 rd=normalize(fwd+uv.x*rt*0.45+uv.y*up2*0.45);

  vec3 bg = deepSpace(rd);
  vec3 sunDir = normalize(vec3(2.0, 0.4, 1.0));

  float eR=1.0;
  vec3 oc=cam;
  float b2=dot(oc,rd), c2=dot(oc,oc)-eR*eR, d2=b2*b2-c2;

  if(d2>0.){
    float t=-b2-sqrt(max(0.,d2));
    if(t>0.){
      vec3 hp  = cam+rd*t;
      vec3 norm= normalize(hp);

      // Spherical UV
      vec2 sUV = vec2(atan(norm.z,norm.x)/TAU+0.5, asin(clamp(norm.y,-1.,1.))/PI+0.5);
      sUV.x = mod(sUV.x + uTime*0.008, 1.0);

      // ── Land / Ocean mask ──────────────────────────────
      // Coarse continent shapes
      float lon = sUV.x * TAU - PI;
      float lat = (sUV.y - 0.5) * PI;

      float n1 = fbm(sUV*2.8 + vec2(1.1,0.4));
      float n2 = fbm(sUV*5.2 + vec2(0.4,1.1));

      // Geographic blobs
      float americas  = smoothstep(0.0,0.6, exp(-pow(lon+1.55,2.)*0.4)*exp(-pow(lat*1.1,2.)*0.5));
      float eurasia   = smoothstep(0.0,0.6, exp(-pow(lon-0.9, 2.)*0.3)*exp(-pow(lat-0.18,2.)*0.8));
      float africa    = smoothstep(0.0,0.5, exp(-pow(lon-0.28,2.)*0.55)*exp(-pow(lat+0.30,2.)*0.6));
      float australia = smoothstep(0.0,0.4, exp(-pow(lon-2.15,2.)*1.4)*exp(-pow(lat+0.52,2.)*2.2));
      float geo = clamp(americas+eurasia+africa+australia, 0., 1.);
      float landMask = smoothstep(0.35, 0.55, n1*0.55 + n2*0.25 + geo*0.5);

      // ── Ocean ─────────────────────────────────────────
      float depth   = fbm(sUV*4.5 + vec2(0.2,0.4));
      float shallow = fbm(sUV*11. + vec2(0.7,1.1));
      vec3 deepOcean  = mix(vec3(0.02,0.06,0.24), vec3(0.03,0.10,0.32), depth);
      vec3 shallowOcean = mix(vec3(0.04,0.18,0.38), vec3(0.08,0.28,0.48), shallow);
      vec3 ocean = mix(deepOcean, shallowOcean, shallow*0.22);
      // Specular
      vec3 halfV = normalize(sunDir - rd);
      ocean += vec3(0.7,0.85,1.0)*pow(max(0.,dot(norm,halfV)),90.)*0.7;

      // ── Land biomes ────────────────────────────────────
      float elev     = fbm(sUV*7.  + vec2(0.5,0.3));
      float moisture = fbm(sUV*4.5 + vec2(1.3,0.8));
      float absLat   = abs(lat) / (PI*0.5);

      vec3 jungle    = mix(vec3(0.04,0.20,0.04), vec3(0.06,0.28,0.06), moisture);
      vec3 forest    = mix(vec3(0.09,0.26,0.07), vec3(0.14,0.34,0.09), elev);
      vec3 savanna   = mix(vec3(0.42,0.36,0.12), vec3(0.55,0.46,0.18), moisture);
      vec3 desert    = mix(vec3(0.68,0.54,0.26), vec3(0.80,0.64,0.32), fbm(sUV*10.+vec2(1.,1.)));
      vec3 mountain  = mix(vec3(0.40,0.32,0.22), vec3(0.55,0.44,0.30), elev);
      vec3 tundra    = mix(vec3(0.36,0.34,0.20), vec3(0.46,0.42,0.26), moisture);
      vec3 snow      = vec3(0.88,0.90,0.92);

      // Blend biomes
      vec3 land = forest;
      land = mix(land, jungle,   smoothstep(0.3,0.0,absLat)*smoothstep(0.3,0.6,moisture));
      land = mix(land, savanna,  smoothstep(0.2,0.45,absLat)*smoothstep(0.5,0.3,moisture));
      land = mix(land, desert,   smoothstep(0.15,0.35,absLat)*smoothstep(0.4,0.2,moisture));
      land = mix(land, mountain, smoothstep(0.60,0.82,elev));
      land = mix(land, tundra,   smoothstep(0.55,0.72,absLat));
      land = mix(land, snow,     smoothstep(0.78,0.95,absLat + fbm(sUV*6.)*0.08));

      vec3 surface = mix(ocean, land, landMask);

      // ── Clouds — sparse & realistic ────────────────────
      // TWO separate cloud layers at different scales
      vec2 cUV1 = vec2(mod(sUV.x + uTime*0.011, 1.), sUV.y);
      vec2 cUV2 = vec2(mod(sUV.x - uTime*0.006, 1.), sUV.y);

      float c1 = fbm(cUV1*3.2 + vec2(0.4, 0.2));
      float c2 = fbm(cUV1*6.8 + vec2(1.2, 0.8));
      float c3 = fbm(cUV2*2.5 + vec2(0.8, 1.4));

      // High threshold = sparse clouds (not total cover)
      float cloudMask = smoothstep(0.60, 0.80, c1*0.5 + c2*0.3 + c3*0.2);

      // No clouds over poles (ice instead)
      cloudMask *= smoothstep(0.85, 0.65, absLat);

      // Cloud shading
      float cDiff = max(0., dot(norm, sunDir));
      vec3 cloudLit  = mix(vec3(0.82,0.84,0.88), vec3(0.96,0.97,1.0), cDiff);
      vec3 cloudDark = vec3(0.50,0.52,0.56); // shadowed underside
      vec3 cloudCol  = mix(cloudDark, cloudLit, cDiff*0.8+0.2);

      surface = mix(surface, cloudCol, cloudMask*0.88);

      // ── Lighting ───────────────────────────────────────
      float diff = max(0., dot(norm, sunDir));
      float terminator = smoothstep(-0.05, 0.12, diff);

      // Night side
      vec3 night = vec3(0.008, 0.012, 0.025);
      // City lights on night side land areas
      float city = step(0.88, fbm(sUV*16.+vec2(2.3,1.7))) * landMask * (1.-cloudMask);
      night += city * vec3(1.0, 0.65, 0.15) * 0.28;

      surface = mix(night, surface*(diff*0.88+0.10), terminator);

      // ── Atmosphere rim — thin, subtle ──────────────────
      float rim = pow(1.-abs(dot(norm,-rd)), 5.0);
      // Only on day side
      surface += rim * vec3(0.10,0.30,0.80) * 0.45 * terminator;
      // Very faint on night side
      surface += rim * vec3(0.02,0.04,0.15) * 0.20 * (1.-terminator);

      bg = surface;
    }
  }

  // Thin atmosphere halo outside sphere
  {
    float atmR=1.040;
    float b2a=dot(cam,rd), ca=dot(cam,cam)-atmR*atmR, da=b2a*b2a-ca;
    if(da>0.){
      float ta=-b2a-sqrt(max(0.,da));
      if(ta>0.){
        vec3 an=normalize(cam+rd*ta);
        float dayFace=smoothstep(0.0,0.4,dot(an,sunDir));
        float rimA=pow(1.-abs(dot(an,-rd)),4.0)*dayFace;
        // Thin blue line, not a thick glow
        bg += rimA*vec3(0.08,0.22,0.70)*0.30;
      }
    }
  }

  // Moon — upper right
  {
    float moonR=0.13;
    vec3 moonPos=vec3(1.8, 1.1, -1.2);
    vec3 ocM=cam-moonPos;
    float b2m=dot(ocM,rd), c2m=dot(ocM,ocM)-moonR*moonR, d2m=b2m*b2m-c2m;
    if(d2m>0.){
      float tm=-b2m-sqrt(max(0.,d2m));
      if(tm>0.){
        vec3 hm=cam+rd*tm, nm=normalize(hm-moonPos);
        vec2 muv=vec2(atan(nm.z,nm.x)/TAU+.5, asin(clamp(nm.y,-1.,1.))/PI+.5);
        float terrain=fbm(muv*8.+vec2(.5,.3));
        float crat=step(.78,fbm(muv*22.+vec2(1.,.7)));
        vec3 ms=mix(vec3(.38,.37,.35),vec3(.56,.54,.50),terrain);
        ms=mix(ms,vec3(.22,.21,.20),crat*.7);
        float mdiff=max(0.,dot(nm,sunDir))*.82+0.10;
        bg=ms*mdiff;
      }
    }
  }

  bg *= 1.-0.55*pow(dot(uv*0.5,uv*0.5),1.4);
  bg=(bg*(2.51*bg+0.03))/(bg*(2.43*bg+0.59)+0.14);
  bg=pow(clamp(bg,0.,1.),vec3(0.4545));
  bg=clamp(bg+(hash(gl_FragCoord.xy+fract(uTime)*251.)*2.-1.)*0.016,0.,1.);
  gl_FragColor=vec4(bg,1.);
}`;

// ══════════════════════════════════════════════════════
// BLACK HOLE
// ══════════════════════════════════════════════════════
const bhFrag = `precision highp float;
uniform float uTime; uniform vec2 uRes; uniform vec2 uMouse; varying vec2 vUv;
${SHARED}
vec4 disc(vec3 pos){
  float r=length(pos.xz); if(r<3.||r>18.) return vec4(0.);
  float t=(r-3.)/15.;
  float rings=.6*smoothstep(0.,.04,sin((r-3.)*2.6))+.35*smoothstep(0.,.07,sin((r-3.)*1.2+.8));
  float bMask=.4+.6*clamp(rings,0.,1.);
  float turb=.55+.45*fbm(vec2(r*.16+uTime*.016,atan(pos.z,pos.x)*.3+uTime*.007)*2.4);
  float falloff=pow(1.-t,1.6)*smoothstep(0.,.1,t);
  float ig=exp(-pow((r-3.-.25)*2.2,2.))*2.2;
  vec3 cA=vec3(1.,.96,.82),cB=vec3(1.,.80,.48),cC=vec3(.72,.40,.18),cD=vec3(.35,.16,.06);
  vec3 bc=t<.25?mix(cA,cB,t/.25):t<.6?mix(cB,cC,(t-.25)/.35):mix(cC,cD,(t-.6)/.4);
  vec3 tang=normalize(vec3(-pos.z,0.,pos.x));
  float dop=dot(tang,vec3(0.,0.,1.))*.4;
  bc*=1.+dop*.35; bc*=1.-max(0.,-dop)*.25;
  return vec4(bc*(falloff*bMask*turb+ig*.55)*3.,(clamp((falloff*bMask*.85+ig*.45)*1.6,0.,1.))*.93);
}
void main(){
  vec2 uv=(gl_FragCoord.xy/uRes)*2.-1.; uv.x*=uRes.x/uRes.y;
  float yaw=uMouse.x+uTime*.04,pitch=clamp(uMouse.y-.16,-.65,.6);
  float cy=cos(yaw),sy=sin(yaw),cp=cos(pitch),sp=sin(pitch);
  mat3 R=mat3(cy,0.,sy,0.,1.,0.,-sy,0.,cy)*mat3(1.,0.,0.,0.,cp,-sp,0.,sp,cp);
  vec3 cam=R*vec3(0.,3.5,26.),fwd=normalize(-cam);
  vec3 rt=normalize(cross(fwd,vec3(0.,1.,0.))),up=cross(rt,fwd);
  vec3 rd=normalize(fwd+uv.x*rt*.65+uv.y*up*.65);
  float rs=3.,dt=.22; vec3 pos=cam,dir=rd; vec4 acc=vec4(0.); bool hit=false; vec3 exitDir=dir;
  for(int i=0;i<200;i++){
    float r=length(pos); if(r<rs*.97){hit=true;break;} if(r>100.) break;
    dir=normalize(dir+(-normalize(pos))*rs/(r*r)*dt*1.65);
    float py=pos.y; pos+=dir*dt;
    if(py*(pos.y)<0.||abs(pos.y)<.42){
      vec3 dp=pos-dir*dt*.5; vec4 dc=disc(dp);
      if(dc.a>.001){
        float rz=clamp(sqrt(max(0.,1.-rs/max(length(dp.xz),rs+.01))),0.,1.); dc.rgb*=rz;
        float g=acc.a>.015?.5:1.;
        acc.rgb+=dc.rgb*(1.-acc.a)*dc.a*g; acc.a+=dc.a*(1.-acc.a)*.68*g;
        if(acc.a>.995) break;
      }
    }
    exitDir=dir;
  }
  vec3 bg=hit?vec3(0.):deepSpace(normalize(exitDir));
  if(!hit){ float bc=2.598*rs,ba=length(cross(cam,rd)); bg+=exp(-pow(ba-bc,2.)*18.)*1.8*vec3(1.,.88,.62); }
  vec3 col=bg*(1.-acc.a)+acc.rgb;
  float lum=dot(col,vec3(.2126,.7152,.0722)); col+=col*clamp(lum-.75,0.,4.)*.45;
  col+=exp(-uv.y*uv.y*220.)*exp(-abs(uv.x)*8.)*.14*vec3(1.,.88,.62);
  col*=1.-.72*pow(dot(uv*.5,uv*.5),1.3);
  col=(col*(2.51*col+.03))/(col*(2.43*col+.59)+.14);
  col=pow(clamp(col,0.,1.),vec3(.4545));
  col=clamp(col+(hash(gl_FragCoord.xy+fract(uTime)*317.)*2.-1.)*.025,0.,1.);
  gl_FragColor=vec4(col,1.);
}`;

// ══════════════════════════════════════════════════════
// PULSAR
// ══════════════════════════════════════════════════════
const pulsarFrag = `precision highp float;
uniform float uTime; uniform vec2 uRes; uniform vec2 uMouse; varying vec2 vUv;
${SHARED}
void main(){
  vec2 uv=(gl_FragCoord.xy/uRes)*2.-1.; uv.x*=uRes.x/uRes.y;
  float yaw=uMouse.x+uTime*.025,pitch=clamp(uMouse.y-.05,-.8,.8);
  float cy=cos(yaw),sy=sin(yaw),cp=cos(pitch),sp=sin(pitch);
  mat3 R=mat3(cy,0.,sy,0.,1.,0.,-sy,0.,cy)*mat3(1.,0.,0.,0.,cp,-sp,0.,sp,cp);
  vec3 cam=R*vec3(0.,1.5,22.),fwd=normalize(-cam);
  vec3 rt=normalize(cross(fwd,vec3(0.,1.,0.))),up2=cross(rt,fwd);
  vec3 rd=normalize(fwd+uv.x*rt*.7+uv.y*up2*.7);
  float spin=mod(uTime*4.5*TAU,TAU),tilt=.52;
  float starR=1.2; vec3 oc=cam; float b2=dot(oc,rd),c2=dot(oc,oc)-starR*starR,d2=b2*b2-c2;
  bool hitStar=d2>0.&&(-b2-sqrt(max(0.,d2)))>0.;
  vec3 col=vec3(0.);
  if(hitStar){
    float t=-b2-sqrt(max(0.,d2)); vec3 hp=cam+rd*t,norm=normalize(hp);
    vec3 base=vec3(.55,.75,1.)*2.5;
    base+=vec3(.8,.9,1.)*(pow(max(0.,dot(norm,vec3(0.,1.,0.))-.6)/.4,1.5)*3.+pow(max(0.,dot(norm,vec3(0.,-1.,0.))-.6)/.4,1.5)*3.);
    vec2 uvS=vec2(atan(norm.z,norm.x)/TAU+spin/TAU,asin(clamp(norm.y,-1.,1.))/PI+.5);
    base*=.85+.15*(sin(uvS.y*PI*8.)*sin(uvS.x*TAU*4.)*.5+.5);
    col=base;
  } else {
    col=deepSpace(rd);
    vec3 bd1=normalize(vec3(sin(tilt)*cos(spin),cos(tilt),sin(tilt)*sin(spin)));
    float bw=.018;
    col+=exp(-pow(1.-dot(rd,bd1),2.)/(bw*bw))*2.5*vec3(.4,.7,1.);
    col+=exp(-pow(1.-dot(rd,-bd1),2.)/(bw*bw))*2.5*vec3(.4,.7,1.);
    col+=exp(-pow(1.-dot(rd,bd1),2.)/(.08*.08))*.4*vec3(.2,.4,.8);
    col+=exp(-pow(1.-dot(rd,-bd1),2.)/(.08*.08))*.4*vec3(.2,.4,.8);
    float cd=length(cross(rd,normalize(-cam)));
    col+=pow(max(0.,1.-cd/(starR*4.)),3.)*vec3(.15,.3,.7)*1.2;
  }
  float lum=dot(col,vec3(.2126,.7152,.0722)); col+=col*clamp(lum-.8,0.,5.)*.6;
  col*=(1.-.65*pow(dot(uv*.5,uv*.5),1.4))*vec3(.92,.96,1.);
  col=(col*(2.51*col+.03))/(col*(2.43*col+.59)+.14);
  col=pow(clamp(col,0.,1.),vec3(.4545));
  col=clamp(col+(hash(gl_FragCoord.xy+fract(uTime)*431.)*2.-1.)*.025,0.,1.);
  gl_FragColor=vec4(col,1.);
}`;

// ══════════════════════════════════════════════════════
// SUN
// ══════════════════════════════════════════════════════
const sunFrag = `precision highp float;
uniform float uTime; uniform vec2 uRes; uniform vec2 uMouse; varying vec2 vUv;
${SHARED}
void main(){
  vec2 uv=(gl_FragCoord.xy/uRes)*2.-1.; uv.x*=uRes.x/uRes.y;
  float yaw=uMouse.x+uTime*.003,pitch=clamp(uMouse.y,-.9,.9);
  float cy=cos(yaw),sy=sin(yaw),cp=cos(pitch),sp=sin(pitch);
  mat3 R=mat3(cy,0.,sy,0.,1.,0.,-sy,0.,cy)*mat3(1.,0.,0.,0.,cp,-sp,0.,sp,cp);
  vec3 cam=R*vec3(0.,0.,3.5),fwd=normalize(-cam);
  vec3 rt=normalize(cross(fwd,vec3(0.,1.,0.))),up2=cross(rt,fwd);
  vec3 rd=normalize(fwd+uv.x*rt*.6+uv.y*up2*.6);
  vec3 bg=deepSpace(rd);
  float sR=1.; vec3 oc=cam; float b2=dot(oc,rd),c2=dot(oc,oc)-sR*sR,d2=b2*b2-c2;
  if(d2>0.){ float t=-b2-sqrt(max(0.,d2)); if(t>0.){
    vec3 hp=cam+rd*t,norm=normalize(hp);
    vec2 sUV=vec2(atan(norm.z,norm.x)/TAU+.5,asin(clamp(norm.y,-1.,1.))/PI+.5);
    sUV.x=mod(sUV.x+uTime*.012,1.);
    float gran=fbm(sUV*30.+vec2(uTime*.04,uTime*.02));
    float gran2=fbm(sUV*60.+vec2(-uTime*.03,uTime*.05));
    vec3 base=mix(vec3(1.,.55,.0),vec3(1.,.82,.2),gran);
    base=mix(base,vec3(.9,.3,.0),gran2*.4);
    float spot1=exp(-length((sUV-vec2(.3+sin(uTime*.05)*.05,.5))*vec2(8.,10.))*3.);
    float spot2=exp(-length((sUV-vec2(.7+cos(uTime*.04)*.04,.52))*vec2(10.,8.))*3.5);
    base=mix(base,vec3(.25,.05,.0),(spot1+spot2)*.8);
    base*=pow(max(0.,dot(norm,-rd)),0.4)*.5+.5;
    bg=base;
  }}
  float cd=length(cross(rd,normalize(-cam)));
  bg+=exp(-pow(cd-sR,2.)*8.)*vec3(1.,.6,.1)*.6*smoothstep(sR+.5,sR-.1,cd);
  bg+=exp(-pow(cd-sR,2.)*1.5)*vec3(.8,.3,.0)*.3;
  bg*=1.-.5*pow(dot(uv*.5,uv*.5),1.5);
  bg=(bg*(2.51*bg+.03))/(bg*(2.43*bg+.59)+.14);
  bg=pow(clamp(bg,0.,1.),vec3(.4545));
  gl_FragColor=vec4(bg,1.);
}`;

// ══════════════════════════════════════════════════════
// MARS
// ══════════════════════════════════════════════════════
const marsFrag = `precision highp float;
uniform float uTime; uniform vec2 uRes; uniform vec2 uMouse; varying vec2 vUv;
${SHARED}
void main(){
  vec2 uv=(gl_FragCoord.xy/uRes)*2.-1.; uv.x*=uRes.x/uRes.y;
  float yaw=uMouse.x+uTime*.007,pitch=clamp(uMouse.y,-.9,.9);
  float cy=cos(yaw),sy=sin(yaw),cp=cos(pitch),sp=sin(pitch);
  mat3 R=mat3(cy,0.,sy,0.,1.,0.,-sy,0.,cy)*mat3(1.,0.,0.,0.,cp,-sp,0.,sp,cp);
  vec3 cam=R*vec3(0.,0.,3.8),fwd=normalize(-cam);
  vec3 rt=normalize(cross(fwd,vec3(0.,1.,0.))),up2=cross(rt,fwd);
  vec3 rd=normalize(fwd+uv.x*rt*.55+uv.y*up2*.55);
  vec3 bg=deepSpace(rd);
  float mR=1.; vec3 oc=cam; float b2=dot(oc,rd),c2=dot(oc,oc)-mR*mR,d2=b2*b2-c2;
  if(d2>0.){ float t=-b2-sqrt(max(0.,d2)); if(t>0.){
    vec3 hp=cam+rd*t,norm=normalize(hp);
    vec2 sUV=vec2(atan(norm.z,norm.x)/TAU+.5,asin(clamp(norm.y,-1.,1.))/PI+.5);
    sUV.x=mod(sUV.x+uTime*.009,1.);
    float rock=fbm(sUV*6.+vec2(.5,.3)),dust=fbm(sUV*12.+vec2(1.2,.8));
    float craters=step(.74,fbm(sUV*18.+vec2(.1,.6)));
    vec3 basCol=mix(vec3(.62,.22,.08),vec3(.78,.38,.18),rock);
    basCol=mix(basCol,vec3(.52,.18,.06),dust*.4);
    basCol=mix(basCol,vec3(.25,.08,.03),craters*.6);
    basCol=mix(basCol,vec3(.88,.88,.90),smoothstep(.78,.95,abs(norm.y)+fbm(sUV*6.)*.1));
    basCol=mix(basCol,vec3(.45,.15,.05),exp(-length((sUV-vec2(.6,.52))*vec2(5.,8.))*2.5)*.6);
    float diff=max(0.,dot(norm,normalize(vec3(1.3,.5,.8))));
    basCol*=diff*.85+.06;
    basCol+=pow(1.-abs(dot(norm,-rd)),4.)*vec3(.5,.15,.04)*.4;
    bg=basCol;
  }}
  bg*=1.-.65*pow(dot(uv*.5,uv*.5),1.5);
  bg=(bg*(2.51*bg+.03))/(bg*(2.43*bg+.59)+.14);
  bg=pow(clamp(bg,0.,1.),vec3(.4545));
  bg=clamp(bg+(hash(gl_FragCoord.xy+fract(uTime)*211.)*2.-1.)*.02,0.,1.);
  gl_FragColor=vec4(bg,1.);
}`;

// ══════════════════════════════════════════════════════
// JUPITER
// ══════════════════════════════════════════════════════
const jupiterFrag = `precision highp float;
uniform float uTime; uniform vec2 uRes; uniform vec2 uMouse; varying vec2 vUv;
${SHARED}
void main(){
  vec2 uv=(gl_FragCoord.xy/uRes)*2.-1.; uv.x*=uRes.x/uRes.y;
  float yaw=uMouse.x+uTime*.005,pitch=clamp(uMouse.y,-.9,.9);
  float cy=cos(yaw),sy=sin(yaw),cp=cos(pitch),sp=sin(pitch);
  mat3 R=mat3(cy,0.,sy,0.,1.,0.,-sy,0.,cy)*mat3(1.,0.,0.,0.,cp,-sp,0.,sp,cp);
  vec3 cam=R*vec3(0.,0.,3.6),fwd=normalize(-cam);
  vec3 rt=normalize(cross(fwd,vec3(0.,1.,0.))),up2=cross(rt,fwd);
  vec3 rd=normalize(fwd+uv.x*rt*.6+uv.y*up2*.6);
  vec3 bg=deepSpace(rd);
  float jR=1.; vec3 oc=cam; float b2=dot(oc,rd),c2=dot(oc,oc)-jR*jR,d2=b2*b2-c2;
  if(d2>0.){ float t=-b2-sqrt(max(0.,d2)); if(t>0.){
    vec3 hp=cam+rd*t,norm=normalize(hp);
    vec2 sUV=vec2(atan(norm.z,norm.x)/TAU+.5,asin(clamp(norm.y,-1.,1.))/PI+.5);
    sUV.x=mod(sUV.x+uTime*.018,1.);
    float b3=sin(sUV.y*PI*14.)+fbm(vec2(sUV.x*2.+uTime*.02,sUV.y*8.))*.3+fbm(vec2(sUV.x*4.-uTime*.015,sUV.y*12.))*.15;
    vec3 col=mix(mix(vec3(.72,.52,.32),vec3(.55,.38,.22),smoothstep(-.3,.3,b3)),vec3(.82,.68,.48),smoothstep(.3,.7,b3));
    col=mix(col,vec3(.45,.28,.15),smoothstep(.6,.9,abs(b3)));
    col=mix(col,mix(vec3(.72,.52,.32),vec3(.45,.28,.15),fbm(sUV*vec2(8.,20.)+vec2(uTime*.025,0.)))*.3+col*.7,fbm(sUV*vec2(8.,20.)+vec2(uTime*.025,0.))*.3);
    vec2 grs=vec2(.35,.38); float gd=length((sUV-grs)*vec2(3.5,6.));
    float gs=atan((sUV.y-grs.y),(sUV.x-grs.x))+gd*8.-uTime*.3;
    col=mix(col,vec3(.55,.18,.08),smoothstep(.3,0.,gd)*.8);
    col=mix(col,vec3(.72,.28,.12),smoothstep(.5,.2,gd)*abs(sin(gs*3.)*exp(-gd*2.5))*.5);
    float diff=max(0.,dot(norm,normalize(vec3(1.2,.4,.9))));
    col*=diff*.9+.1;
    col+=pow(1.-abs(dot(norm,-rd)),3.)*vec3(.4,.25,.12)*.35;
    bg=col;
  }}
  bg*=1.-.62*pow(dot(uv*.5,uv*.5),1.5);
  bg=(bg*(2.51*bg+.03))/(bg*(2.43*bg+.59)+.14);
  bg=pow(clamp(bg,0.,1.),vec3(.4545));
  bg=clamp(bg+(hash(gl_FragCoord.xy+fract(uTime)*199.)*2.-1.)*.02,0.,1.);
  gl_FragColor=vec4(bg,1.);
}`;

// ══════════════════════════════════════════════════════
// SATURN
// ══════════════════════════════════════════════════════
const saturnFrag = `precision highp float;
uniform float uTime; uniform vec2 uRes; uniform vec2 uMouse; varying vec2 vUv;
${SHARED}
float ringDensity(float r){
  float d=smoothstep(1.11,1.13,r)*smoothstep(1.24,1.22,r)*0.15;
  float c=smoothstep(1.24,1.26,r)*smoothstep(1.52,1.50,r)*(0.3+0.3*sin(r*180.));
  float b=smoothstep(1.52,1.54,r)*smoothstep(1.95,1.93,r)*(0.7+0.3*sin(r*280.+0.5));
  b*=1.-smoothstep(1.95,1.97,r)*smoothstep(2.02,2.00,r)*0.95;
  float a=smoothstep(2.02,2.04,r)*smoothstep(2.27,2.25,r)*(0.5+0.25*sin(r*220.+1.2));
  a*=1.-smoothstep(2.19,2.20,r)*smoothstep(2.21,2.20,r)*0.9;
  float f=exp(-pow(r-2.32,2.)*900.)*0.7;
  return clamp(d+c+b+a+f,0.,1.);
}
vec3 ringColor(float r){
  float t=clamp((r-1.11)/(2.35-1.11),0.,1.);
  vec3 inner=vec3(0.62,0.52,0.36),mid=vec3(0.80,0.70,0.50),outer=vec3(0.70,0.60,0.42);
  return t<0.5?mix(inner,mid,t*2.):mix(mid,outer,(t-0.5)*2.);
}
void main(){
  vec2 uv=(gl_FragCoord.xy/uRes)*2.-1.; uv.x*=uRes.x/uRes.y;
  float yaw=uMouse.x+uTime*.004,pitch=clamp(uMouse.y+0.42,-1.,1.);
  float cy=cos(yaw),sy=sin(yaw),cp=cos(pitch),sp=sin(pitch);
  mat3 R=mat3(cy,0.,sy,0.,1.,0.,-sy,0.,cy)*mat3(1.,0.,0.,0.,cp,-sp,0.,sp,cp);
  vec3 cam=R*vec3(0.,0.,5.8),fwd=normalize(-cam);
  vec3 rt=normalize(cross(fwd,vec3(0.,1.,0.))),up2=cross(rt,fwd);
  vec3 rd=normalize(fwd+uv.x*rt*.70+uv.y*up2*.70);
  vec3 bg=deepSpace(rd);
  vec3 sunDir=normalize(vec3(1.3,.5,.7));
  float sR=1.;
  float ringAlpha=0.; vec3 ringCol=vec3(0.); float tRingHit=-1.;
  if(abs(rd.y)>0.0001){
    float tR=-cam.y/rd.y;
    if(tR>0.001){
      vec3 rp=cam+rd*tR; float r=length(rp.xz);
      float dn=ringDensity(r);
      if(dn>0.001){
        ringCol=ringColor(r)*max(0.3,dot(vec3(0.,1.,0.),sunDir));
        ringAlpha=dn*0.92; tRingHit=tR;
      }
    }
  }
  vec3 oc=cam; float b2=dot(oc,rd),c2=dot(oc,oc)-sR*sR,d2=b2*b2-c2;
  bool hitPlanet=false; float tPlanet=1e9;
  if(d2>0.){ float t=-b2-sqrt(max(0.,d2)); if(t>0.){hitPlanet=true;tPlanet=t;}}
  if(hitPlanet){
    vec3 hp=cam+rd*tPlanet,norm=normalize(hp);
    vec2 sUV=vec2(atan(norm.z,norm.x)/TAU+.5,asin(clamp(norm.y,-1.,1.))/PI+.5);
    sUV.x=mod(sUV.x+uTime*.01,1.);
    float b3=sin(sUV.y*PI*10.)+fbm(vec2(sUV.x*3.+uTime*.01,sUV.y*6.))*.4;
    vec3 sc=mix(mix(vec3(.82,.70,.45),vec3(.68,.55,.32),smoothstep(-.2,.2,b3)),vec3(.90,.78,.52),smoothstep(.3,.6,b3));
    sc*=(max(0.,dot(norm,sunDir))*.85+.15)*(1.-ringAlpha*.4*smoothstep(.3,0.,abs(norm.y)));
    sc+=pow(1.-abs(dot(norm,-rd)),3.)*vec3(.5,.4,.2)*.3;
    if(tRingHit>0.&&tRingHit<tPlanet) bg=mix(bg,ringCol,ringAlpha);
    bg=sc;
  } else {
    if(tRingHit>0.) bg=mix(bg,ringCol,ringAlpha);
  }
  bg*=1.-.55*pow(dot(uv*.5,uv*.5),1.5);
  bg=(bg*(2.51*bg+.03))/(bg*(2.43*bg+.59)+.14);
  bg=pow(clamp(bg,0.,1.),vec3(.4545));
  bg=clamp(bg+(hash(gl_FragCoord.xy+fract(uTime)*173.)*2.-1.)*.02,0.,1.);
  gl_FragColor=vec4(bg,1.);
}`;

// ══════════════════════════════════════════════════════
// NEBULA
// ══════════════════════════════════════════════════════
const nebulaFrag = `precision highp float;
uniform float uTime; uniform vec2 uRes; uniform vec2 uMouse; varying vec2 vUv;
${SHARED}
void main(){
  vec2 uv=(gl_FragCoord.xy/uRes)*2.-1.; uv.x*=uRes.x/uRes.y;
  float yaw=uMouse.x+uTime*.008,pitch=clamp(uMouse.y,-.9,.9);
  float cy=cos(yaw),sy=sin(yaw),cp=cos(pitch),sp=sin(pitch);
  mat3 R=mat3(cy,0.,sy,0.,1.,0.,-sy,0.,cy)*mat3(1.,0.,0.,0.,cp,-sp,0.,sp,cp);
  vec3 rd=normalize(R*vec3(uv,1.4));
  vec2 suv=vec2(atan(rd.z,rd.x)/TAU,asin(clamp(rd.y,-1.,1.))/PI);
  float n1=fbm(suv*3.+vec2(uTime*.005,0.)),n2=fbm(suv*6.+vec2(.5,uTime*.004));
  float n3=fbm(suv*12.+vec2(1.,uTime*.003)),n4=fbm(suv*2.+vec2(uTime*.003,.5));
  vec3 col=vec3(.05,.1,.4)*n1*n2*3.+vec3(.3,.05,.2)*smoothstep(.4,.7,n1)*smoothstep(.4,.7,n2)*2.+vec3(.5,.08,.02)*exp(-pow(length(suv-vec2(.5,.0))-.3,2.)*8.)*n3+vec3(.02,.15,.08)*n4*smoothstep(.3,.8,n3);
  col+=deepSpace(rd)*.5;
  for(float i=0.;i<5.;i++){
    vec2 sid=vec2(fract(sin(i*7.3)*43758.5),fract(sin(i*13.1)*43758.5))*.4+.3;
    col+=exp(-length(suv-sid)*length(suv-sid)*400.)*vec3(.8,.9,1.)*(1.+sin(uTime*.5+i)*.2);
  }
  col*=1.-.5*pow(dot(uv*.45,uv*.45),1.3);
  col=(col*(2.51*col+.03))/(col*(2.43*col+.59)+.14);
  col=pow(clamp(col,0.,1.),vec3(.4545));
  gl_FragColor=vec4(col,1.);
}`;

// ══════════════════════════════════════════════════════
// DATA
// ══════════════════════════════════════════════════════
const OBJECTS = [
  { id:"blackhole", label:"Black Hole", icon:"◉", category:"EXOTIC", shader:bhFrag,
    info:{ title:"Stellar Black Hole", stats:[{k:"Mass",v:"~10 Solar Masses"},{k:"Schwarzschild R",v:"~30 km"},{k:"Accretion Temp",v:"~10⁷ K"},{k:"Event Horizon",v:"Point of no return"},{k:"Time Dilation",v:"Extreme"}], desc:"A region of spacetime where gravity is so strong that nothing — not even light — can escape once past the event horizon. The glowing disc is superheated matter spiraling inward at relativistic speeds, reaching millions of degrees." }},
  { id:"theories", label:"BH Theories", icon:"⚛", category:"EXOTIC", shader:null, info:null },
  { id:"pulsar", label:"Pulsar Star", icon:"✦", category:"EXOTIC", shader:pulsarFrag,
    info:{ title:"Millisecond Pulsar", stats:[{k:"Mass",v:"~1.4 Solar Masses"},{k:"Radius",v:"~10 km"},{k:"Spin Rate",v:"Up to 716 Hz"},{k:"Magnetic Field",v:"10⁸–10¹² Tesla"},{k:"Beam Type",v:"Radio / X-ray"}], desc:"A rapidly rotating neutron star emitting focused beams of electromagnetic radiation from its magnetic poles. As Earth crosses the beam with each rotation, we observe regular pulses — like a cosmic lighthouse. Among the most precise natural clocks in the universe." }},
  { id:"sun", label:"The Sun", icon:"☀", category:"STARS", shader:sunFrag,
    info:{ title:"Sol — G-Type Main Sequence", stats:[{k:"Diameter",v:"1.39 million km"},{k:"Surface Temp",v:"5,778 K"},{k:"Core Temp",v:"~15 million K"},{k:"Age",v:"4.6 billion years"},{k:"Composition",v:"73% H, 25% He"}], desc:"Our star fuses 600 million tonnes of hydrogen to helium every second in its core. The photosphere shows granulation from convection cells rising and falling, while dark sunspots mark regions of intense magnetic activity." }},
  { id:"earth", label:"Earth", icon:"🌍", category:"PLANETS", shader:earthFrag,
    info:{ title:"Earth — The Blue Marble", stats:[{k:"Diameter",v:"12,742 km"},{k:"Surface Temp",v:"−88 to +58°C"},{k:"Atmosphere",v:"78% N₂, 21% O₂"},{k:"Moon",v:"Luna (3,474 km dia.)"},{k:"Distance from Sun",v:"1 AU (150M km)"}], desc:"The third planet and only confirmed harbour of life. 71% ocean surface creates the iconic blue appearance. Swirling cloud systems, the Amazon rainforest, Sahara desert, and polar ice caps are all visible from orbit." }},
  { id:"mars", label:"Mars", icon:"🔴", category:"PLANETS", shader:marsFrag,
    info:{ title:"Mars — The Red Planet", stats:[{k:"Diameter",v:"6,779 km"},{k:"Surface Temp",v:"−87 to +20°C"},{k:"Atmosphere",v:"95% CO₂ (thin)"},{k:"Moons",v:"2 (Phobos, Deimos)"},{k:"Olympus Mons",v:"21 km tall volcano"}], desc:"A cold desert bearing the Solar System's largest volcano and deepest canyon. Iron oxide gives it the rust-red colour. Ancient riverbeds suggest Mars once had liquid water — and may have harboured microbial life." }},
  { id:"jupiter", label:"Jupiter", icon:"🟤", category:"PLANETS", shader:jupiterFrag,
    info:{ title:"Jupiter — King of Planets", stats:[{k:"Diameter",v:"142,984 km"},{k:"Mass",v:"318× Earth"},{k:"Great Red Spot",v:"400+ year storm"},{k:"Moons",v:"95 confirmed"},{k:"Rotation",v:"9.9 hours"}], desc:"The Solar System's largest planet, with banded jet streams of ammonia clouds. The Great Red Spot is an anticyclonic storm wider than Earth that has raged for centuries. Jupiter's gravity shields inner planets from asteroid impacts." }},
  { id:"saturn", label:"Saturn", icon:"🪐", category:"PLANETS", shader:saturnFrag,
    info:{ title:"Saturn — Lord of the Rings", stats:[{k:"Diameter",v:"116,460 km"},{k:"Ring Span",v:"282,000 km wide"},{k:"Ring Thickness",v:"~10 meters"},{k:"Moons",v:"146 confirmed"},{k:"Density",v:"Lower than water"}], desc:"Saturn's ring system spans 282,000 km but is only ~10 meters thick — made of billions of ice and rock particles. Its moon Titan has a thick nitrogen atmosphere and lakes of liquid methane, a prime candidate for extraterrestrial chemistry." }},
  { id:"nebula", label:"Nebula", icon:"🌌", category:"DEEP SPACE", shader:nebulaFrag,
    info:{ title:"Stellar Emission Nebula", stats:[{k:"Type",v:"Emission Nebula"},{k:"Size",v:"~50–100 light years"},{k:"Composition",v:"H, He, dust"},{k:"Temperature",v:"~10,000 K ionized"},{k:"Role",v:"Stellar nursery"}], desc:"Vast interstellar clouds of gas and dust where new stars are born. Ultraviolet radiation from young embedded stars ionizes surrounding hydrogen, causing vivid emission of light. Blue regions arise from starlight scattered by dust particles." }},
];

const THEORIES = [
  { title:"General Relativity & Spacetime Curvature", body:`Einstein's General Theory of Relativity (1915) provides the foundational mathematical framework. The Einstein field equations Gμν + Λgμν = (8πG/c⁴)Tμν relate spacetime curvature to matter-energy distribution. Within the Schwarzschild radius rs = 2GM/c², escape velocity exceeds c. The Schwarzschild metric predicts infinite time dilation at the horizon for a distant observer, while a freely-falling observer crosses in finite proper time without local incident.` },
  { title:"Penrose Singularity Theorem", body:`Roger Penrose proved in 1965 that trapped light surfaces under GR inevitably lead to spacetime singularities — regions where curvature diverges and physical laws break down. The Penrose-Hawking singularity theorems established that singularities are a generic feature of gravitational collapse, not mere artifacts of idealised symmetry. This implies classical GR is incomplete: a quantum theory of gravity is required near the Planck scale (lP ≈ 1.616 × 10⁻³⁵ m).` },
  { title:"Hawking Radiation & Black Hole Thermodynamics", body:`Hawking demonstrated in 1974 that quantum field theory effects in curved spacetime cause black holes to radiate thermally at temperature TH = ℏc³/(8πGMkB). Black holes possess genuine entropy SBH = kBABH/(4lP²) — the Bekenstein-Hawking entropy — proportional to horizon area. A solar-mass black hole has TH ≈ 60 nanokelvin and evaporation timescale ~10⁶⁷ years, profoundly uniting GR, quantum mechanics, and thermodynamics.` },
  { title:"The Information Paradox", body:`When a black hole evaporates via Hawking radiation, the radiation appears purely thermal — carrying no information about infalling matter. This violates quantum unitarity. Proposed resolutions include: black hole complementarity (information both absorbed and reflected for different observers); the firewall hypothesis (infalling observers encounter high-energy radiation at the horizon); ER=EPR conjecture linking wormholes to quantum entanglement; and the island formula restoring unitarity in the Page curve via gravitational path integral contributions.` },
  { title:"The Holographic Principle & AdS/CFT", body:`The Bekenstein-Hawking entropy formula implies maximum information in a region scales with surface area, not volume — the Holographic Principle. Maldacena's 1997 AdS/CFT correspondence provides a concrete realisation: a gravitational theory in (d+1)-dimensional anti-de Sitter spacetime is exactly dual to a non-gravitational CFT on its d-dimensional boundary. The Ryu-Takayanagi formula S = Area(γ)/(4G) relates boundary entanglement entropy to minimal bulk surfaces, revolutionizing quantum gravity research.` },
  { title:"Kerr Black Holes & Frame Dragging", body:`Roy Kerr's 1963 solution for rotating black holes reveals a far richer geometry than Schwarzschild's. A Kerr black hole has mass M and angular momentum J = aMc, with two surfaces: the event horizon and ergosphere — where spacetime itself rotates faster than light. The Penrose process (1969) extracts energy with theoretical maximum efficiency ~20.7% for maximal spin. Blandford-Znajek processes extend this electromagnetically, explaining the relativistic jets of active galactic nuclei.` },
  { title:"Black Hole Mergers & Gravitational Waves", body:`LIGO's 2015 detection of gravitational waves from binary black hole merger GW150914 opened an entirely new observational window. Mergers proceed through inspiral (orbital decay via gravitational wave emission, governed by the Peters formula dE/dt ∝ (Gm)⁵/r⁵), merger (requiring full numerical relativity), and ringdown (Kerr black hole radiating quasi-normal modes). The mass deficit ΔM is radiated as ΔE = ΔMc², momentarily outshining the observable universe in gravitational wave luminosity.` },
  { title:"Supermassive Black Holes & Galaxy Co-evolution", body:`Virtually every massive galaxy harbours a supermassive black hole (SMBH) of millions to billions of solar masses. The Event Horizon Telescope imaged M87* (2019) and Sagittarius A* (2022), confirming GR predictions of photon ring structure. Tight M–σ correlations between SMBH mass and host galaxy velocity dispersion imply co-evolution through AGN feedback: black holes heat and expel gas, quenching star formation across scales millions of times larger than the black hole itself.` },
];

// ══════════════════════════════════════════════════════
// LOADING SCREEN
// ══════════════════════════════════════════════════════
function LoadingScreen({ progress, done }) {
  const [opacity, setOpacity] = useState(1);
  useEffect(() => {
    if (done) setTimeout(() => setOpacity(0), 200);
  }, [done]);

  if (done && opacity === 0) return null;

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:1000,
      background:"#000",
      display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center",
      transition:"opacity 1.2s ease",
      opacity,
      pointerEvents: done ? "none" : "auto",
    }}>
      {/* Animated star particles */}
      <div style={{ position:"absolute", inset:0, overflow:"hidden" }}>
        {[...Array(80)].map((_,i)=>(
          <div key={i} style={{
            position:"absolute",
            left:`${Math.random()*100}%`,
            top:`${Math.random()*100}%`,
            width: Math.random()>0.9 ? 2 : 1,
            height: Math.random()>0.9 ? 2 : 1,
            background:"white",
            borderRadius:"50%",
            opacity: 0.3 + Math.random()*0.7,
            animation:`twinkle ${1.5+Math.random()*3}s infinite alternate`,
          }}/>
        ))}
      </div>

      <style>{`
        @keyframes twinkle { from{opacity:0.1} to{opacity:1} }
        @keyframes pulse { 0%,100%{opacity:0.4;transform:scale(1)} 50%{opacity:1;transform:scale(1.08)} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* Logo ring */}
      <div style={{ position:"relative", marginBottom:40 }}>
        <div style={{
          width:90, height:90, borderRadius:"50%",
          border:"1px solid rgba(255,200,80,0.15)",
          position:"absolute", top:"50%", left:"50%",
          transform:"translate(-50%,-50%)",
          animation:"spin 8s linear infinite",
          borderTopColor:"rgba(255,200,80,0.6)",
        }}/>
        <div style={{
          width:70, height:70, borderRadius:"50%",
          border:"1px solid rgba(255,200,80,0.08)",
          position:"absolute", top:"50%", left:"50%",
          transform:"translate(-50%,-50%)",
          animation:"spin 5s linear infinite reverse",
          borderRightColor:"rgba(255,200,80,0.4)",
        }}/>
        <div style={{
          fontSize:28, color:"rgba(255,200,80,0.9)",
          animation:"pulse 2s ease-in-out infinite",
          position:"relative", zIndex:1,
          width:50, height:50,
          display:"flex", alignItems:"center", justifyContent:"center",
        }}>⬡</div>
      </div>

      <div style={{
        fontFamily:"'Courier New',monospace",
        color:"rgba(255,200,80,0.9)",
        fontSize:20, fontWeight:"bold",
        letterSpacing:".35em",
        animation:"fadeUp 1s ease forwards",
        marginBottom:8,
      }}>
        COSMOS
      </div>
      <div style={{
        fontFamily:"'Courier New',monospace",
        color:"rgba(255,255,255,.3)",
        fontSize:10, letterSpacing:".25em",
        marginBottom:48,
      }}>
        EXPLORER v2.0
      </div>

      {/* Progress bar */}
      <div style={{ width:240, marginBottom:16 }}>
        <div style={{
          height:1,
          background:"rgba(255,200,80,0.1)",
          borderRadius:1,
          overflow:"hidden",
        }}>
          <div style={{
            height:"100%",
            width:`${progress}%`,
            background:"linear-gradient(90deg, rgba(255,200,80,0.4), rgba(255,200,80,0.9))",
            transition:"width 0.3s ease",
            boxShadow:"0 0 8px rgba(255,200,80,0.5)",
          }}/>
        </div>
      </div>
      <div style={{
        fontFamily:"'Courier New',monospace",
        color:"rgba(255,200,80,.4)",
        fontSize:9, letterSpacing:".2em",
      }}>
        {progress < 30 ? "INITIALIZING SHADERS..." :
         progress < 60 ? "LOADING COSMIC DATA..." :
         progress < 90 ? "CALIBRATING SPACETIME..." :
         "READY FOR LAUNCH"}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// SHADER CANVAS COMPONENT
// ══════════════════════════════════════════════════════
function ShaderCanvas({ fragShader, active }) {
  const ref = useRef(null);
  useEffect(() => {
    const mount = ref.current; if(!mount) return;
    let W=mount.clientWidth,H=mount.clientHeight;
    const renderer=new THREE.WebGLRenderer({antialias:false});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));
    renderer.setSize(W,H);
    mount.appendChild(renderer.domElement);
    const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    const u={uTime:{value:0},uRes:{value:new THREE.Vector2(W,H)},uMouse:{value:new THREE.Vector2(0,0)}};
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({vertexShader:vert,fragmentShader:fragShader,uniforms:u})));
    let drag=false,px=0,py=0,vx=0,vy=0,ax=0,ay=0;
    const onD=(x,y)=>{drag=true;px=x;py=y;vx=0;vy=0;};
    const onM=(x,y)=>{if(!drag)return;vx=(x-px)*.004;vy=-(y-py)*.003;px=x;py=y;};
    const onU=()=>{drag=false;};
    renderer.domElement.addEventListener("mousedown",e=>onD(e.clientX,e.clientY));
    renderer.domElement.addEventListener("mousemove",e=>onM(e.clientX,e.clientY));
    window.addEventListener("mouseup",onU);
    renderer.domElement.addEventListener("touchstart",e=>{const t=e.touches[0];onD(t.clientX,t.clientY);},{passive:true});
    renderer.domElement.addEventListener("touchmove",e=>{const t=e.touches[0];onM(t.clientX,t.clientY);},{passive:true});
    window.addEventListener("touchend",onU);
    const onR=()=>{W=mount.clientWidth;H=mount.clientHeight;renderer.setSize(W,H);u.uRes.value.set(W,H);};
    window.addEventListener("resize",onR);
    let fid; const clk=new THREE.Clock();
    const loop=()=>{fid=requestAnimationFrame(loop);if(!drag){vx*=.88;vy*=.88;}ax+=vx;ay+=vy;ay=Math.max(-1.2,Math.min(1.,ay));u.uTime.value=clk.getElapsedTime();u.uMouse.value.set(ax,ay);renderer.render(scene,camera);};
    loop();
    return()=>{cancelAnimationFrame(fid);window.removeEventListener("mouseup",onU);window.removeEventListener("touchend",onU);window.removeEventListener("resize",onR);renderer.dispose();if(mount.contains(renderer.domElement))mount.removeChild(renderer.domElement);};
  },[fragShader]);
  return <div ref={ref} style={{position:"absolute",inset:0,opacity:active?1:0,pointerEvents:active?"auto":"none",transition:"opacity .7s ease"}} />;
}

// ══════════════════════════════════════════════════════
// THEORIES PAGE
// ══════════════════════════════════════════════════════
function TheoriesPage({ active }) {
  return (
    <div style={{
      position:"absolute",inset:0,
      opacity:active?1:0,pointerEvents:active?"auto":"none",
      transition:"opacity .7s ease",
      background:"#020204",
      overflowY:"auto",scrollbarWidth:"thin",scrollbarColor:"rgba(255,200,80,.15) transparent",
    }}>
      <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:0,backgroundImage:"radial-gradient(rgba(255,200,80,0.035) 1px,transparent 1px)",backgroundSize:"28px 28px"}}/>
      <div style={{position:"relative",zIndex:1,maxWidth:820,margin:"0 auto",padding:"48px 32px 80px"}}>
        <div style={{marginBottom:48}}>
          <div style={{color:"rgba(255,200,80,.4)",fontSize:10,letterSpacing:".25em",marginBottom:12,fontFamily:"'Courier New',monospace"}}>⚛ BLACK HOLE PHYSICS</div>
          <h1 style={{color:"#fff",fontSize:26,fontWeight:300,letterSpacing:".06em",margin:0,fontFamily:"'Courier New',monospace",lineHeight:1.3}}>Theoretical Foundations</h1>
          <div style={{height:1,background:"linear-gradient(90deg,rgba(255,200,80,.5),transparent)",marginTop:18,width:180}}/>
          <p style={{color:"rgba(255,255,255,.4)",fontSize:11,lineHeight:1.9,marginTop:18,maxWidth:600,fontFamily:"'Courier New',monospace"}}>A comprehensive survey of theoretical frameworks governing black hole physics, from classical general relativity through quantum gravitational approaches.</p>
        </div>
        {THEORIES.map((th,i)=>(
          <div key={i} style={{marginBottom:32,background:"rgba(255,255,255,0.016)",border:"1px solid rgba(255,200,80,0.07)",borderLeft:"2px solid rgba(255,200,80,0.3)",borderRadius:"0 4px 4px 0",padding:"22px 26px"}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:12}}>
              <div style={{background:"rgba(255,200,80,0.09)",border:"1px solid rgba(255,200,80,0.18)",borderRadius:3,padding:"2px 7px",color:"rgba(255,200,80,.65)",fontSize:9,letterSpacing:".15em",fontFamily:"'Courier New',monospace",flexShrink:0,marginTop:2}}>{String(i+1).padStart(2,"0")}</div>
              <h2 style={{color:"rgba(255,220,100,.88)",fontSize:12,fontWeight:"bold",margin:0,fontFamily:"'Courier New',monospace",letterSpacing:".07em",lineHeight:1.5}}>{th.title.toUpperCase()}</h2>
            </div>
            <p style={{color:"rgba(255,255,255,.55)",fontSize:11,lineHeight:1.95,margin:0,fontFamily:"'Courier New',monospace",letterSpacing:".02em"}}>{th.body}</p>
          </div>
        ))}
        <div style={{textAlign:"center",marginTop:40,color:"rgba(255,200,80,.18)",fontSize:9,fontFamily:"'Courier New',monospace",letterSpacing:".15em"}}>── END OF THEORETICAL OVERVIEW ──</div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// APP
// ══════════════════════════════════════════════════════
export default function App() {
  const [activeId, setActiveId] = useState("blackhole");
  const [infoOpen, setInfoOpen] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadDone, setLoadDone] = useState(false);
  const [loadOut, setLoadOut] = useState(false);

  // Simulate loading progress
  useEffect(() => {
    const steps = [
      [400,  25], [900,  55], [1600, 80], [2200, 95], [2800, 100]
    ];
    const timers = steps.map(([delay, val]) =>
      setTimeout(() => {
        setLoadProgress(val);
        if (val === 100) setTimeout(() => { setLoadDone(true); setTimeout(() => setLoadOut(true), 1300); }, 400);
      }, delay)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  const activeObj = OBJECTS.find(o=>o.id===activeId);
  const categories = [...new Set(OBJECTS.map(o=>o.category))];
  const isTheories = activeId === "theories";

  return (
    <div style={{width:"100vw",height:"100vh",background:"#000",overflow:"hidden",display:"flex",fontFamily:"'Courier New',monospace"}}>

      {/* Dark grain noise overlay on whole site */}
      <div style={{
        position:"fixed",inset:0,zIndex:999,pointerEvents:"none",
        backgroundImage:`url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E")`,
        backgroundRepeat:"repeat",
        backgroundSize:"200px 200px",
        opacity:0.032,
        mixBlendMode:"overlay",
      }}/>

      {/* Loading screen */}
      {!loadOut && <LoadingScreen progress={loadProgress} done={loadDone} />}

      {/* ── LEFT SIDEBAR ─────────────────────────────── */}
      <div style={{
        width:172,flexShrink:0,
        background:"rgba(3,3,6,0.97)",
        borderRight:"1px solid rgba(255,200,100,0.08)",
        display:"flex",flexDirection:"column",
        overflowY:"auto",zIndex:10,
        scrollbarWidth:"none",
      }}>
        <div style={{padding:"18px 14px 12px",borderBottom:"1px solid rgba(255,200,100,0.06)"}}>
          <div style={{color:"rgba(255,200,80,.9)",fontSize:12,fontWeight:"bold",letterSpacing:".2em"}}>⬡ COSMOS</div>
          <div style={{color:"rgba(255,255,255,.18)",fontSize:9,letterSpacing:".12em",marginTop:3}}>EXPLORER v2.0</div>
        </div>
        {categories.map(cat=>(
          <div key={cat}>
            <div style={{padding:"10px 14px 3px",color:"rgba(255,200,80,.3)",fontSize:8,letterSpacing:".2em"}}>{cat}</div>
            {OBJECTS.filter(o=>o.category===cat).map(obj=>{
              const on=activeId===obj.id;
              return (
                <button key={obj.id} onClick={()=>setActiveId(obj.id)} style={{
                  width:"100%",background:on?"rgba(255,200,80,.08)":"transparent",
                  border:"none",borderLeft:on?"2px solid rgba(255,200,80,.7)":"2px solid transparent",
                  color:on?"rgba(255,220,100,.95)":"rgba(255,255,255,.28)",
                  fontSize:11,letterSpacing:".05em",
                  padding:"8px 14px",textAlign:"left",cursor:"pointer",
                  display:"flex",alignItems:"center",gap:8,transition:"all .2s",
                }}>
                  <span style={{fontSize:13}}>{obj.icon}</span>{obj.label}
                </button>
              );
            })}
          </div>
        ))}
        <div style={{marginTop:"auto",padding:"14px",borderTop:"1px solid rgba(255,200,100,0.05)",color:"rgba(255,200,80,.18)",fontSize:9,letterSpacing:".1em"}}>
          by <span style={{color:"rgba(255,220,50,.55)"}}>Shamil</span>
        </div>
      </div>

      {/* ── MAIN CANVAS ──────────────────────────────── */}
      <div style={{flex:1,position:"relative",cursor:isTheories?"default":"grab"}}>
        {OBJECTS.filter(o=>o.shader).map(obj=>(
          <ShaderCanvas key={obj.id} fragShader={obj.shader} active={activeId===obj.id} />
        ))}
        <TheoriesPage active={isTheories} />

        {/* HUD */}
        {!isTheories && activeObj?.info && (
          <div style={{
            position:"absolute",top:20,left:20,
            color:"rgba(255,200,80,.75)",fontSize:10,lineHeight:2,
            pointerEvents:"none",textShadow:"0 0 10px rgba(255,150,50,.35)",letterSpacing:".08em",
          }}>
            <div style={{fontSize:12,fontWeight:"bold",marginBottom:4,color:"#ffcc77",letterSpacing:".2em"}}>
              {activeObj.icon} {activeObj.info.title.toUpperCase()}
            </div>
            {activeObj.info.stats.map((s,i)=>(
              <div key={i}>{s.k} ···· {s.v}</div>
            ))}
          </div>
        )}

        {!isTheories && (
          <div style={{
            position:"absolute",bottom:18,right:infoOpen?216:50,
            color:"rgba(150,180,255,.2)",fontSize:9,textAlign:"right",
            pointerEvents:"none",letterSpacing:".07em",transition:"right .35s",
          }}>
            drag to rotate · real-time glsl shader
          </div>
        )}

        {/* Info panel */}
        {!isTheories && activeObj?.info && (
          <div style={{
            position:"absolute",top:0,right:0,bottom:0,
            width:infoOpen?200:32,
            background:"rgba(3,3,8,.92)",
            borderLeft:"1px solid rgba(255,200,100,0.07)",
            transition:"width .32s ease",
            display:"flex",flexDirection:"column",
            overflow:"hidden",zIndex:10,
          }}>
            <button onClick={()=>setInfoOpen(v=>!v)} style={{
              background:"transparent",border:"none",
              color:"rgba(255,200,80,.5)",fontSize:14,
              padding:"14px 0",cursor:"pointer",
              flexShrink:0,alignSelf:"flex-start",width:32,
            }}>
              {infoOpen?"›":"‹"}
            </button>
            {infoOpen && (
              <div style={{padding:"0 14px 14px",overflowY:"auto",flex:1,scrollbarWidth:"none"}}>
                <div style={{color:"rgba(255,200,80,.82)",fontSize:10,fontWeight:"bold",letterSpacing:".1em",marginBottom:10,lineHeight:1.5}}>{activeObj.info.title.toUpperCase()}</div>
                <div style={{color:"rgba(255,255,255,.44)",fontSize:9.5,lineHeight:1.85,marginBottom:14}}>{activeObj.info.desc}</div>
                <div style={{borderTop:"1px solid rgba(255,200,80,.08)",paddingTop:10}}>
                  {activeObj.info.stats.map((s,i)=>(
                    <div key={i} style={{marginBottom:9}}>
                      <div style={{color:"rgba(255,200,80,.4)",fontSize:8,letterSpacing:".12em"}}>{s.k.toUpperCase()}</div>
                      <div style={{color:"rgba(255,255,255,.8)",fontSize:10,marginTop:2}}>{s.v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
