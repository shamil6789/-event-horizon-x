import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const vert = `varying vec2 vUv;
void main(){ vUv=uv; gl_Position=vec4(position,1.0); }`;

// ── Cinematic star field: pure black, tiny crisp white dots ───────────────
const STARS_GLSL = `
vec3 cinematicStars(vec3 rd){
  // Pure black space with sharp white stars — no noise haze
  vec3 col = vec3(0.0);
  vec2 uv = vec2(atan(rd.z, rd.x) / 6.28318, asin(clamp(rd.y,-1.,1.)) / 3.14159);

  // Layer 1: ultra-tiny dim stars (dense)
  for(float s = 80.; s <= 320.; s += 80.){
    vec2 id = floor(uv * s);
    float h = fract(sin(dot(id + s, vec2(127.1, 311.7))) * 43758.5453);
    if(h > 0.78){
      vec2 center = (id + 0.5) / s;
      float dist = length(fract(uv * s) - 0.5);
      float bright = pow((h - 0.78) / 0.22, 4.0) * smoothstep(0.12, 0.0, dist);
      // Colour: 70% pure white, 20% blue-white, 10% warm white
      float tc = fract(sin(dot(id, vec2(91.3, 171.7))) * 34758.5);
      vec3 tint = tc < 0.15 ? vec3(0.78, 0.88, 1.0)
                : tc < 0.25 ? vec3(1.0, 0.92, 0.78)
                : vec3(1.0, 1.0, 1.0);
      col += bright * tint * 0.55;
    }
  }

  // Layer 2: medium bright stars
  {
    vec2 id = floor(uv * 40.);
    float h = fract(sin(dot(id + 40., vec2(127.1, 311.7))) * 43758.5453);
    if(h > 0.91){
      float dist = length(fract(uv * 40.) - 0.5);
      float bright = pow((h - 0.91) / 0.09, 3.0) * smoothstep(0.18, 0.0, dist);
      float tc = fract(sin(dot(id, vec2(55.1, 231.7))) * 27348.5);
      vec3 tint = tc < 0.3 ? vec3(0.82, 0.90, 1.0) : vec3(1.0, 1.0, 1.0);
      col += bright * tint * 1.2;
    }
  }

  // Layer 3: hero bright stars with diffraction spikes
  {
    vec2 id = floor(uv * 16.);
    float h = fract(sin(dot(id + 16., vec2(127.1, 311.7))) * 43758.5453);
    if(h > 0.972){
      vec2 f = fract(uv * 16.) - 0.5;
      float dist = length(f);
      float core = exp(-dist * dist * 500.) * 5.0;
      float spikeH = exp(-f.y * f.y * 1200.) * exp(-abs(f.x) * 28.) * 1.5;
      float spikeV = exp(-f.x * f.x * 1200.) * exp(-abs(f.y) * 28.) * 1.5;
      float tc = fract(sin(dot(id, vec2(33.1, 91.7))) * 19348.5);
      vec3 tint = tc < 0.35 ? vec3(0.75, 0.87, 1.0)
                : tc < 0.55 ? vec3(1.0, 0.95, 0.82)
                : vec3(1.0, 1.0, 1.0);
      col += (core + spikeH + spikeV) * tint;
    }
  }

  // Milky Way: extremely subtle, just barely visible density increase
  float mwBand = exp(-pow(rd.y * 5.5, 2.0));
  float mwNoise = fract(sin(dot(uv * 12., vec2(127.1, 311.7))) * 43758.5) * 
                  fract(sin(dot(uv * 8. + 0.5, vec2(91.3, 171.7))) * 31748.5);
  col += mwBand * mwNoise * vec3(0.012, 0.014, 0.022) * 1.8;

  return col;
}
`;

const NOISE_GLSL = `
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p){
  float v=0.,a=0.5;
  for(int i=0;i<6;i++){v+=a*noise(p);p=p*2.1+vec2(0.13,0.29);a*=0.5;}
  return v;
}
#define PI  3.14159265358979323846
#define TAU 6.28318530717958647692
`;

const SHARED = NOISE_GLSL + STARS_GLSL;

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
        float rz=clamp(sqrt(max(0.,1.-rs/max(length(dp.xz),rs+.01))),0.,1.);
        dc.rgb*=rz; float g=acc.a>.015?.5:1.;
        acc.rgb+=dc.rgb*(1.-acc.a)*dc.a*g; acc.a+=dc.a*(1.-acc.a)*.68*g;
        if(acc.a>.995) break;
      }
    }
    exitDir=dir;
  }
  vec3 bg=hit?vec3(0.):cinematicStars(normalize(exitDir));
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
  vec3 spinAxis=normalize(vec3(sin(tilt),cos(tilt),0.));
  float starR=1.2;
  vec3 oc=cam; float b2=dot(oc,rd),c2=dot(oc,oc)-starR*starR,d2=b2*b2-c2;
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
    col=cinematicStars(rd);
    vec3 bd1=normalize(vec3(sin(tilt)*cos(spin),cos(tilt),sin(tilt)*sin(spin)));
    float bw=.018;
    col+=exp(-pow(1.-dot(rd,bd1),2.)/(bw*bw))*2.5*vec3(.4,.7,1.);
    col+=exp(-pow(1.-dot(rd,-bd1),2.)/(bw*bw))*2.5*vec3(.4,.7,1.);
    col+=exp(-pow(1.-dot(rd,bd1),2.)/(.08*.08))*.4*vec3(.2,.4,.8);
    col+=exp(-pow(1.-dot(rd,-bd1),2.)/(.08*.08))*.4*vec3(.2,.4,.8);
    float cd=length(cross(rd,normalize(-cam)));
    col+=pow(max(0.,1.-cd/(starR*4.)),3.)*vec3(.15,.3,.7)*1.2;
    col+=pow(max(0.,1.-cd/(starR*8.)),5.)*vec3(.05,.1,.4)*.8;
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
  vec3 bg=cinematicStars(rd);
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
  bg=clamp(bg+(hash(gl_FragCoord.xy+fract(uTime)*337.)*2.-1.)*.02,0.,1.);
  gl_FragColor=vec4(bg,1.);
}`;

// ══════════════════════════════════════════════════════
// EARTH
// ══════════════════════════════════════════════════════
const earthFrag = `precision highp float;
uniform float uTime; uniform vec2 uRes; uniform vec2 uMouse; varying vec2 vUv;
${SHARED}
void main(){
  vec2 uv=(gl_FragCoord.xy/uRes)*2.-1.; uv.x*=uRes.x/uRes.y;
  float yaw=uMouse.x+uTime*.008,pitch=clamp(uMouse.y,-.9,.9);
  float cy=cos(yaw),sy=sin(yaw),cp=cos(pitch),sp=sin(pitch);
  mat3 R=mat3(cy,0.,sy,0.,1.,0.,-sy,0.,cy)*mat3(1.,0.,0.,0.,cp,-sp,0.,sp,cp);
  vec3 cam=R*vec3(0.,0.,3.8),fwd=normalize(-cam);
  vec3 rt=normalize(cross(fwd,vec3(0.,1.,0.))),up2=cross(rt,fwd);
  vec3 rd=normalize(fwd+uv.x*rt*.55+uv.y*up2*.55);
  vec3 bg=cinematicStars(rd);
  float eR=1.; vec3 oc=cam; float b2=dot(oc,rd),c2=dot(oc,oc)-eR*eR,d2=b2*b2-c2;
  if(d2>0.){ float t=-b2-sqrt(max(0.,d2)); if(t>0.){
    vec3 hp=cam+rd*t,norm=normalize(hp);
    vec2 sUV=vec2(atan(norm.z,norm.x)/TAU+.5,asin(clamp(norm.y,-1.,1.))/PI+.5);
    sUV.x=mod(sUV.x+uTime*.012,1.);
    float cont=fbm(sUV*3.+vec2(1.2,.5)),cont2=fbm(sUV*5.+vec2(.3,1.1));
    float landMask=smoothstep(.46,.54,cont*.7+cont2*.3);
    vec3 ocean=mix(vec3(.03,.12,.35),vec3(.05,.22,.55),fbm(sUV*8.+vec2(uTime*.02,0.)));
    ocean+=fbm(sUV*20.+vec2(uTime*.1,uTime*.07))*.04*vec3(.3,.6,1.);
    float elev=fbm(sUV*6.+vec2(.8,.4));
    vec3 land=mix(mix(vec3(.12,.38,.08),vec3(.22,.52,.10),elev),vec3(.55,.42,.28),smoothstep(.5,.8,elev));
    land=mix(land,vec3(.72,.58,.32),smoothstep(.4,.7,fbm(sUV*4.+vec2(2.,1.)))*.4);
    land=mix(land,vec3(.92,.95,1.),smoothstep(.75,.95,abs(norm.y)+fbm(sUV*8.)*.15));
    vec3 surface=mix(ocean,land,landMask);
    float c1=fbm(sUV*4.+vec2(uTime*.015,uTime*.008)),c2v=fbm(sUV*7.+vec2(-uTime*.01,uTime*.012));
    float clouds=smoothstep(.42,.68,c1*.6+c2v*.4);
    surface=mix(surface,vec3(.92,.94,.98),clouds*.9);
    vec3 sunDir=normalize(vec3(1.4,.6,.8));
    float diff=max(0.,dot(norm,sunDir));
    surface*=mix(vec3(.05,.08,.15),vec3(1.),smoothstep(-.08,.08,diff))*(diff+.08);
    surface+=pow(max(0.,dot(normalize(sunDir-rd),norm)),60.)*.6*vec3(1.,.98,.9)*smoothstep(-.08,.08,diff);
    surface+=pow(1.-abs(dot(norm,-rd)),3.5)*vec3(.15,.4,.9)*.8;
    bg=surface;
  }}
  float atmR=1.06; float b2a=dot(cam,rd),ca=dot(cam,cam)-atmR*atmR,da=b2a*b2a-ca;
  if(da>0.){ float ta=-b2a-sqrt(max(0.,da)); if(ta>0.){
    vec3 an=normalize(cam+rd*ta);
    bg+=pow(1.-abs(dot(an,-rd)),4.)*smoothstep(-.1,.3,dot(an,normalize(vec3(1.4,.6,.8))))*vec3(.1,.3,.8)*.5;
  }}
  bg*=1.-.6*pow(dot(uv*.5,uv*.5),1.5);
  bg=(bg*(2.51*bg+.03))/(bg*(2.43*bg+.59)+.14);
  bg=pow(clamp(bg,0.,1.),vec3(.4545));
  bg=clamp(bg+(hash(gl_FragCoord.xy+fract(uTime)*251.)*2.-1.)*.02,0.,1.);
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
  vec3 bg=cinematicStars(rd);
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
    basCol*=diff*.85+.08;
    basCol+=pow(1.-abs(dot(norm,-rd)),4.)*vec3(.6,.2,.05)*.5;
    bg=basCol;
  }}
  bg*=1.-.6*pow(dot(uv*.5,uv*.5),1.5);
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
  vec3 bg=cinematicStars(rd);
  float jR=1.; vec3 oc=cam; float b2=dot(oc,rd),c2=dot(oc,oc)-jR*jR,d2=b2*b2-c2;
  if(d2>0.){ float t=-b2-sqrt(max(0.,d2)); if(t>0.){
    vec3 hp=cam+rd*t,norm=normalize(hp);
    vec2 sUV=vec2(atan(norm.z,norm.x)/TAU+.5,asin(clamp(norm.y,-1.,1.))/PI+.5);
    sUV.x=mod(sUV.x+uTime*.018,1.);
    float b=sin(sUV.y*PI*14.)+fbm(vec2(sUV.x*2.+uTime*.02,sUV.y*8.))*.3+fbm(vec2(sUV.x*4.-uTime*.015,sUV.y*12.))*.15;
    vec3 col=mix(mix(vec3(.72,.52,.32),vec3(.55,.38,.22),smoothstep(-.3,.3,b)),vec3(.82,.68,.48),smoothstep(.3,.7,b));
    col=mix(col,vec3(.45,.28,.15),smoothstep(.6,.9,abs(b)));
    col=mix(col,mix(vec3(.72,.52,.32),vec3(.45,.28,.15),fbm(sUV*vec2(8.,20.)+vec2(uTime*.025,0.)))*.3+col*.7,fbm(sUV*vec2(8.,20.)+vec2(uTime*.025,0.))*.3);
    vec2 grs=vec2(.35,.38); float gd=length((sUV-grs)*vec2(3.5,6.));
    float gs=atan((sUV.y-grs.y),(sUV.x-grs.x))+gd*8.-uTime*.3;
    col=mix(col,vec3(.55,.18,.08),smoothstep(.3,0.,gd)*.8);
    col=mix(col,vec3(.72,.28,.12),smoothstep(.5,.2,gd)*abs(sin(gs*3.)*exp(-gd*2.5))*.5);
    float diff=max(0.,dot(norm,normalize(vec3(1.2,.4,.9))));
    col*=diff*.9+.1;
    col+=pow(1.-abs(dot(norm,-rd)),3.)*vec3(.4,.25,.12)*.4;
    bg=col;
  }}
  bg*=1.-.6*pow(dot(uv*.5,uv*.5),1.5);
  bg=(bg*(2.51*bg+.03))/(bg*(2.43*bg+.59)+.14);
  bg=pow(clamp(bg,0.,1.),vec3(.4545));
  bg=clamp(bg+(hash(gl_FragCoord.xy+fract(uTime)*199.)*2.-1.)*.02,0.,1.);
  gl_FragColor=vec4(bg,1.);
}`;

// ══════════════════════════════════════════════════════
// SATURN — fixed rings
// ══════════════════════════════════════════════════════
const saturnFrag = `precision highp float;
uniform float uTime; uniform vec2 uRes; uniform vec2 uMouse; varying vec2 vUv;
${SHARED}

float ringDensity(float r){
  // D ring (faint inner)
  float d = smoothstep(1.11,1.13,r)*smoothstep(1.24,1.22,r)*0.15;
  // C ring
  float c = smoothstep(1.24,1.26,r)*smoothstep(1.52,1.50,r)*(0.3+0.3*sin(r*180.));
  // B ring (brightest)
  float b = smoothstep(1.52,1.54,r)*smoothstep(1.95,1.93,r)*(0.7+0.3*sin(r*280.+0.5));
  // Cassini division (dark gap)
  float cassini = smoothstep(1.95,1.97,r)*smoothstep(2.02,2.00,r);
  b *= 1.-cassini*0.95;
  // A ring
  float a = smoothstep(2.02,2.04,r)*smoothstep(2.27,2.25,r)*(0.5+0.25*sin(r*220.+1.2));
  // Encke gap
  float encke = smoothstep(2.19,2.20,r)*smoothstep(2.21,2.20,r);
  a *= 1.-encke*0.9;
  // F ring (thin bright outer)
  float f = exp(-pow(r-2.32,2.)*900.)*0.7;
  return clamp(d+c+b+a+f, 0., 1.);
}

vec3 ringColor(float r, float density){
  vec3 inner = vec3(0.62,0.52,0.36);
  vec3 mid   = vec3(0.80,0.70,0.50);
  vec3 outer = vec3(0.70,0.60,0.42);
  float t = clamp((r-1.11)/(2.35-1.11),0.,1.);
  return t<0.5 ? mix(inner,mid,t*2.) : mix(mid,outer,(t-0.5)*2.);
}

void main(){
  vec2 uv=(gl_FragCoord.xy/uRes)*2.-1.; uv.x*=uRes.x/uRes.y;
  // Default tilt to show rings nicely (~25 degrees)
  float yaw  = uMouse.x + uTime*0.004;
  float pitch = clamp(uMouse.y + 0.42, -1.0, 1.0);
  float cy=cos(yaw),sy=sin(yaw),cp=cos(pitch),sp=sin(pitch);
  mat3 R=mat3(cy,0.,sy,0.,1.,0.,-sy,0.,cy)*mat3(1.,0.,0.,0.,cp,-sp,0.,sp,cp);

  // Camera: slightly elevated to see rings
  vec3 cam = R*vec3(0., 0., 5.8);
  vec3 fwd = normalize(-cam);
  vec3 rt  = normalize(cross(fwd, vec3(0.,1.,0.)));
  vec3 up2 = cross(rt, fwd);
  vec3 rd  = normalize(fwd + uv.x*rt*0.70 + uv.y*up2*0.70);

  vec3 bg = cinematicStars(rd);
  vec3 sunDir = normalize(vec3(1.3, 0.5, 0.7));
  float sR = 1.0;

  // ── Ring plane (y=0) intersection ──────────────────
  float ringAlpha = 0.0;
  vec3  ringCol   = vec3(0.0);
  float tRingHit  = -1.0;

  if(abs(rd.y) > 0.0001){
    float tR = -cam.y / rd.y;
    if(tR > 0.001){
      vec3 rp = cam + rd * tR;
      float r  = length(rp.xz);
      float dn = ringDensity(r);
      if(dn > 0.001){
        float shadow = max(0.3, dot(vec3(0.,1.,0.), sunDir));
        ringCol   = ringColor(r, dn) * shadow;
        ringAlpha = dn * 0.92;
        tRingHit  = tR;
      }
    }
  }

  // ── Planet sphere ────────────────────────────────────
  vec3 oc=cam; float b2=dot(oc,rd),c2=dot(oc,oc)-sR*sR,d2=b2*b2-c2;
  bool hitPlanet = false;
  float tPlanet  = 1e9;
  if(d2>0.){
    float t = -b2 - sqrt(max(0.,d2));
    if(t > 0.){ hitPlanet = true; tPlanet = t; }
  }

  if(hitPlanet){
    vec3 hp   = cam + rd * tPlanet;
    vec3 norm = normalize(hp);
    vec2 sUV  = vec2(atan(norm.z,norm.x)/TAU+0.5, asin(clamp(norm.y,-1.,1.))/PI+0.5);
    sUV.x = mod(sUV.x + uTime*0.01, 1.0);
    // Saturn's banded surface
    float b3 = sin(sUV.y*PI*10.) + fbm(vec2(sUV.x*3.+uTime*.01,sUV.y*6.))*.4;
    vec3 sc = mix(mix(vec3(.82,.70,.45),vec3(.68,.55,.32),smoothstep(-.2,.2,b3)),vec3(.90,.78,.52),smoothstep(.3,.6,b3));
    float diff = max(0., dot(norm, sunDir));
    // Ring shadow on planet
    float ringPlanetShadow = 1.0 - ringAlpha * 0.4 * smoothstep(0.3, 0., abs(norm.y));
    sc *= (diff * 0.85 + 0.15) * ringPlanetShadow;
    sc += pow(1.-abs(dot(norm,-rd)),3.)*vec3(.5,.4,.2)*0.3;

    // Composite: ring in front or behind planet?
    if(tRingHit > 0. && tRingHit < tPlanet){
      // Ring in front of planet
      bg = mix(bg, ringCol, ringAlpha);
      bg = mix(bg, sc, 1.0); // planet on top
    } else {
      bg = sc; // just planet
    }
  } else {
    // No planet hit — draw ring if it exists
    if(tRingHit > 0.){
      bg = mix(bg, ringCol, ringAlpha);
    }
  }

  bg *= 1. - 0.55*pow(dot(uv*0.5,uv*0.5), 1.5);
  bg = (bg*(2.51*bg+0.03))/(bg*(2.43*bg+0.59)+0.14);
  bg = pow(clamp(bg,0.,1.), vec3(0.4545));
  bg = clamp(bg+(hash(gl_FragCoord.xy+fract(uTime)*173.)*2.-1.)*0.02,0.,1.);
  gl_FragColor = vec4(bg, 1.);
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
  float n1=fbm(suv*3.+vec2(uTime*.005,0.));
  float n2=fbm(suv*6.+vec2(.5,uTime*.004));
  float n3=fbm(suv*12.+vec2(1.,uTime*.003));
  float n4=fbm(suv*2.+vec2(uTime*.003,.5));
  float pillar=smoothstep(.4,.7,n1)*smoothstep(.4,.7,n2);
  vec3 col=vec3(.05,.1,.4)*n1*n2*3.+vec3(.3,.05,.2)*pillar*2.+vec3(.5,.08,.02)*exp(-pow(length(suv-vec2(.5,.0))-.3,2.)*8.)*n3+vec3(.02,.15,.08)*n4*smoothstep(.3,.8,n3);
  col+=cinematicStars(rd)*.5;
  for(float i=0.;i<5.;i++){
    vec2 sid=vec2(fract(sin(i*7.3)*43758.5),fract(sin(i*13.1)*43758.5))*.4+.3;
    col+=exp(-length(suv-sid)*length(suv-sid)*400.)*vec3(.8,.9,1.)*(1.+sin(uTime*.5+i)*.2);
  }
  col*=1.-.5*pow(dot(uv*.45,uv*.45),1.3);
  col=(col*(2.51*col+.03))/(col*(2.43*col+.59)+.14);
  col=pow(clamp(col,0.,1.),vec3(.4545));
  col=clamp(col+(hash(gl_FragCoord.xy+fract(uTime)*277.)*2.-1.)*.025,0.,1.);
  gl_FragColor=vec4(col,1.);
}`;

// ══════════════════════════════════════════════════════
// DATA
// ══════════════════════════════════════════════════════
const OBJECTS = [
  { id:"blackhole", label:"Black Hole", icon:"◉", category:"EXOTIC", shader:bhFrag,
    info:{ title:"Stellar Black Hole",
      stats:[{k:"Mass",v:"~10 Solar Masses"},{k:"Schwarzschild R",v:"~30 km"},{k:"Accretion Temp",v:"~10⁷ K"},{k:"Event Horizon",v:"Point of no return"},{k:"Time Dilation",v:"Extreme"}],
      desc:"A region of spacetime where gravity is so strong that nothing — not even light — can escape once past the event horizon. Stellar black holes form from the gravitational collapse of massive stars. The glowing disc is superheated matter spiraling inward at relativistic speeds, reaching temperatures of millions of degrees." }},
  { id:"theories", label:"BH Theories", icon:"⚛", category:"EXOTIC", shader:null,
    info:null },
  { id:"pulsar", label:"Pulsar Star", icon:"✦", category:"EXOTIC", shader:pulsarFrag,
    info:{ title:"Millisecond Pulsar",
      stats:[{k:"Mass",v:"~1.4 Solar Masses"},{k:"Radius",v:"~10 km"},{k:"Spin Rate",v:"Up to 716 Hz"},{k:"Magnetic Field",v:"10⁸–10¹² Tesla"},{k:"Beam Type",v:"Radio / X-ray"}],
      desc:"A rapidly rotating neutron star emitting focused beams of electromagnetic radiation from its magnetic poles. As Earth crosses the beam with each rotation, we observe precise regular pulses — like a cosmic lighthouse. Millisecond pulsars are among the most precise natural clocks in the universe, rivaling atomic clocks in accuracy." }},
  { id:"sun", label:"The Sun", icon:"☀", category:"STARS", shader:sunFrag,
    info:{ title:"Sol — G-Type Main Sequence",
      stats:[{k:"Diameter",v:"1.39 million km"},{k:"Surface Temp",v:"5,778 K"},{k:"Core Temp",v:"~15 million K"},{k:"Age",v:"4.6 billion years"},{k:"Composition",v:"73% H, 25% He"}],
      desc:"Our star is a G-type main-sequence star at the center of the Solar System. Nuclear fusion converts 600 million tonnes of hydrogen to helium every second in its core. The photosphere shows granulation from convection cells rising and falling, while dark sunspots mark regions of intense magnetic activity suppressing convection." }},
  { id:"earth", label:"Earth", icon:"🌍", category:"PLANETS", shader:earthFrag,
    info:{ title:"Earth — The Blue Marble",
      stats:[{k:"Diameter",v:"12,742 km"},{k:"Surface Temp",v:"−88 to +58°C"},{k:"Atmosphere",v:"78% N₂, 21% O₂"},{k:"Moons",v:"1 (Luna)"},{k:"Distance from Sun",v:"1 AU"}],
      desc:"The third planet from the Sun and the only known body in the universe confirmed to harbour life. Earth's surface is 71% covered by water, creating the iconic blue appearance from space. Swirling white cloud systems driven by atmospheric circulation patterns are visible from orbit, driven by differential solar heating." }},
  { id:"mars", label:"Mars", icon:"🔴", category:"PLANETS", shader:marsFrag,
    info:{ title:"Mars — The Red Planet",
      stats:[{k:"Diameter",v:"6,779 km"},{k:"Surface Temp",v:"−87 to +20°C"},{k:"Atmosphere",v:"95% CO₂ (thin)"},{k:"Moons",v:"2 (Phobos, Deimos)"},{k:"Largest Volcano",v:"Olympus Mons 21 km"}],
      desc:"Mars is a cold desert world bearing the largest volcano and deepest canyon system in the Solar System. Its rust-red colour derives from iron oxide in the regolith. Ancient riverbeds, delta formations, and polar ice caps strongly suggest Mars once sustained liquid water on its surface — and may have harboured microbial life." }},
  { id:"jupiter", label:"Jupiter", icon:"🟤", category:"PLANETS", shader:jupiterFrag,
    info:{ title:"Jupiter — King of Planets",
      stats:[{k:"Diameter",v:"142,984 km"},{k:"Mass",v:"318× Earth"},{k:"Great Red Spot",v:"400+ year storm"},{k:"Moons",v:"95 confirmed"},{k:"Rotation Period",v:"9.9 hours"}],
      desc:"Jupiter is the largest planet in the Solar System — massive enough to contain all other planets combined. Its iconic banded appearance arises from jet streams of ammonia-ice clouds at different altitudes. The Great Red Spot is a persistent anticyclonic storm wider than Earth that has raged for centuries." }},
  { id:"saturn", label:"Saturn", icon:"🪐", category:"PLANETS", shader:saturnFrag,
    info:{ title:"Saturn — Lord of the Rings",
      stats:[{k:"Diameter",v:"116,460 km"},{k:"Ring Span",v:"282,000 km wide"},{k:"Ring Thickness",v:"~10 meters"},{k:"Moons",v:"146 confirmed"},{k:"Density",v:"Lower than water"}],
      desc:"Saturn's spectacular ring system spans 282,000 km but is extraordinarily thin — only about 10 meters in places. The rings consist of billions of ice and rock particles ranging from grains to boulders. Titan, Saturn's largest moon, possesses a thick nitrogen atmosphere and lakes of liquid methane, making it a prime candidate for prebiotic chemistry." }},
  { id:"nebula", label:"Nebula", icon:"🌌", category:"DEEP SPACE", shader:nebulaFrag,
    info:{ title:"Stellar Emission Nebula",
      stats:[{k:"Type",v:"Emission Nebula"},{k:"Size",v:"~50–100 light years"},{k:"Composition",v:"H, He, dust"},{k:"Temperature",v:"~10,000 K ionized"},{k:"Role",v:"Stellar nursery"}],
      desc:"Nebulae are vast interstellar clouds of gas and dust where new stars are born. Ultraviolet radiation from young embedded stars ionizes surrounding hydrogen gas, causing it to emit characteristic red Hα light. Blue regions arise from starlight scattered by dust. These stellar nurseries are among the most visually spectacular objects in the cosmos." }},
];

// ══════════════════════════════════════════════════════
// BLACK HOLE THEORIES PAGE
// ══════════════════════════════════════════════════════
const THEORIES = [
  { title:"General Relativity & Spacetime Curvature",
    body:`Einstein's General Theory of Relativity (1915) provides the foundational mathematical framework describing black holes. The Einstein field equations, Gμν + Λgμν = (8πG/c⁴)Tμν, relate the curvature of spacetime geometry to the distribution of matter and energy. A sufficiently massive, compact object warps spacetime so severely that within the Schwarzschild radius rs = 2GM/c², the escape velocity exceeds the speed of light. The Schwarzschild metric describes the geometry of spacetime surrounding a non-rotating, electrically neutral black hole and predicts infinite time dilation at the event horizon as measured by a distant observer, though a freely-falling observer crosses the horizon in finite proper time without local incident.` },
  { title:"Penrose Singularity Theorem",
    body:`Roger Penrose proved in 1965 — earning him the Nobel Prize in Physics (2020) — that the formation of trapped light surfaces under general relativity inevitably leads to spacetime singularities, regions where curvature becomes infinite and our current physical laws break down. The Penrose-Hawking singularity theorems established that singularities are a generic feature of gravitational collapse, not mere artifacts of idealised symmetry. This implies that classical GR is necessarily incomplete: a quantum theory of gravity is required to describe physics at the Planck scale (lP ≈ 1.616 × 10⁻³⁵ m) near the singularity.` },
  { title:"Hawking Radiation & Black Hole Thermodynamics",
    body:`Stephen Hawking demonstrated in 1974 that quantum field theory effects in curved spacetime cause black holes to emit thermal radiation with temperature TH = ℏc³/(8πGMkB), now called Hawking temperature. This profoundly unites general relativity, quantum mechanics, and thermodynamics. A black hole possesses genuine entropy SBH = kBABH/(4lP²) — the Bekenstein-Hawking entropy — proportional to the area of its event horizon. This area-entropy relationship underpins the Holographic Principle. Hawking radiation causes black holes to slowly evaporate; a solar-mass black hole has a Hawking temperature of ~60 nanokelvins and an evaporation timescale of ~10⁶⁷ years.` },
  { title:"The Information Paradox",
    body:`When matter falls into a black hole and the black hole subsequently evaporates via Hawking radiation, the radiation appears to be purely thermal — carrying no information about the infalling matter. This creates a profound paradox: quantum mechanics demands that the evolution of a closed system is unitary, meaning information cannot be destroyed. The apparent destruction of information violates unitarity. Proposed resolutions include: (1) black hole complementarity, where information is both absorbed and reflected at the horizon for different observers; (2) the firewall hypothesis, suggesting infalling observers encounter high-energy radiation at the horizon; (3) ER=EPR conjecture, linking Einstein-Rosen bridges (wormholes) to Einstein-Podolsky-Rosen entanglement; and (4) the island formula in holography, suggesting contributions from gravitational path integral islands restore unitarity in the Page curve.` },
  { title:"The Holographic Principle & AdS/CFT",
    body:`The Bekenstein-Hawking entropy formula suggests that the maximum information content of a region of space scales with its surface area, not volume — this is the Holographic Principle, formalized by 't Hooft and Susskind. The Anti-de Sitter/Conformal Field Theory (AdS/CFT) correspondence, discovered by Maldacena in 1997, provides a concrete realization: a gravitational theory in (d+1)-dimensional anti-de Sitter spacetime is exactly dual to a non-gravitational conformal field theory on its d-dimensional boundary. This duality has become the most powerful tool in theoretical physics for studying quantum gravity, black hole formation, thermalization, and entanglement entropy, with the Ryu-Takayanagi formula S = Area(γ)/(4G) relating boundary entanglement entropy to minimal bulk surfaces.` },
  { title:"Kerr Black Holes & Frame Dragging",
    body:`Roy Kerr solved the Einstein field equations for a rotating black hole in 1963, revealing a far richer geometry than Schwarzschild's non-rotating solution. A Kerr black hole is characterized by mass M and angular momentum J = aMc. It possesses two distinct surfaces: the (inner) event horizon and the outer ergosphere — an oblate region where spacetime itself is dragged into rotation faster than light. No object within the ergosphere can remain stationary relative to distant stars; the Lense-Thirring effect is maximal here. Penrose (1969) showed energy can be extracted from a Kerr black hole via the Penrose process, with a theoretical maximum extraction efficiency of ~20.7% for maximal spin (a=M). Blandford-Znajek processes extend this to relativistic jets powered by electromagnetic extraction from the ergosphere, explaining the powerful jets observed in active galactic nuclei.` },
  { title:"Black Hole Mergers & Gravitational Waves",
    body:`The 2015 detection of gravitational waves by LIGO from the merger of two stellar-mass black holes (GW150914) confirmed the most dramatic prediction of general relativity and opened an entirely new observational window on the universe. Binary black hole mergers proceed through three phases: the inspiral (quasi-circular orbital decay driven by gravitational wave emission, governed by the Peters formula dE/dt ∝ (Gm)⁵/r⁵), the merger (a brief violent phase requiring full numerical relativity), and the ringdown (the resulting Kerr black hole radiating quasi-normal modes until settling). The final mass is less than the sum of the progenitors — the mass deficit ΔM is radiated as gravitational wave energy ΔE = ΔMc², amounting to ~5% of the total mass in the most energetic events, momentarily outshining the observable universe in gravitational wave luminosity.` },
  { title:"Supermassive Black Holes & Galaxy Co-evolution",
    body:`Virtually every massive galaxy harbours a supermassive black hole (SMBH) at its centre, with masses ranging from millions to tens of billions of solar masses. The Event Horizon Telescope collaboration produced the first direct image of a black hole shadow — M87* (2019) and Sagittarius A* (2022) — confirming general relativistic predictions of photon ring structure with unprecedented precision. Tightly observed correlations between SMBH mass and host galaxy bulge velocity dispersion (the M–σ relation) imply that black holes and galaxies co-evolve through coupled feedback processes: AGN feedback heats and expels gas, quenching star formation across scales millions of times larger than the black hole itself. The formation mechanisms of the first seed black holes at cosmic dawn remain one of the deepest open questions in astrophysics.` },
];

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
      overflowY:"auto",scrollbarWidth:"thin",scrollbarColor:"rgba(255,200,80,.2) transparent",
    }}>
      {/* Subtle dot-grid background */}
      <div style={{
        position:"fixed",inset:0,pointerEvents:"none",zIndex:0,
        backgroundImage:"radial-gradient(rgba(255,200,80,0.04) 1px, transparent 1px)",
        backgroundSize:"28px 28px",
      }}/>

      <div style={{position:"relative",zIndex:1,maxWidth:820,margin:"0 auto",padding:"48px 32px 80px"}}>
        <div style={{marginBottom:48}}>
          <div style={{color:"rgba(255,200,80,.4)",fontSize:10,letterSpacing:".25em",marginBottom:12,fontFamily:"'Courier New',monospace"}}>
            ⚛ BLACK HOLE PHYSICS
          </div>
          <h1 style={{color:"#fff",fontSize:28,fontWeight:300,letterSpacing:".06em",margin:0,fontFamily:"'Courier New',monospace",lineHeight:1.3}}>
            Theoretical Foundations
          </h1>
          <div style={{height:1,background:"linear-gradient(90deg,rgba(255,200,80,.5),transparent)",marginTop:20,width:180}}/>
          <p style={{color:"rgba(255,255,255,.45)",fontSize:12,lineHeight:1.9,marginTop:20,maxWidth:600,fontFamily:"'Courier New',monospace"}}>
            A comprehensive survey of the major theoretical frameworks governing black hole physics, from classical general relativity through quantum gravitational approaches.
          </p>
        </div>

        {THEORIES.map((th,i)=>(
          <div key={i} style={{
            marginBottom:36,
            background:"rgba(255,255,255,0.018)",
            border:"1px solid rgba(255,200,80,0.08)",
            borderLeft:"2px solid rgba(255,200,80,0.35)",
            borderRadius:"0 4px 4px 0",
            padding:"24px 28px",
            backdropFilter:"blur(4px)",
          }}>
            <div style={{display:"flex",alignItems:"flex-start",gap:14,marginBottom:14}}>
              <div style={{
                background:"rgba(255,200,80,0.1)",border:"1px solid rgba(255,200,80,0.2)",
                borderRadius:3,padding:"2px 8px",
                color:"rgba(255,200,80,.7)",fontSize:9,letterSpacing:".15em",
                fontFamily:"'Courier New',monospace",flexShrink:0,marginTop:2,
              }}>
                {String(i+1).padStart(2,"0")}
              </div>
              <h2 style={{color:"rgba(255,220,100,.9)",fontSize:13,fontWeight:"bold",margin:0,fontFamily:"'Courier New',monospace",letterSpacing:".07em",lineHeight:1.5}}>
                {th.title.toUpperCase()}
              </h2>
            </div>
            <p style={{color:"rgba(255,255,255,.6)",fontSize:11.5,lineHeight:1.95,margin:0,fontFamily:"'Courier New',monospace",letterSpacing:".02em"}}>
              {th.body}
            </p>
          </div>
        ))}

        <div style={{textAlign:"center",marginTop:48,color:"rgba(255,200,80,.2)",fontSize:9,fontFamily:"'Courier New',monospace",letterSpacing:".15em"}}>
          ── END OF THEORETICAL OVERVIEW ──
        </div>
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
  const activeObj = OBJECTS.find(o=>o.id===activeId);
  const categories = [...new Set(OBJECTS.map(o=>o.category))];
  const isTheories = activeId === "theories";

  return (
    <div style={{width:"100vw",height:"100vh",background:"#000",overflow:"hidden",display:"flex",fontFamily:"'Courier New',monospace"}}>

      {/* ── LEFT SIDEBAR ─────────────────────────────── */}
      <div style={{
        width:172,flexShrink:0,
        background:"rgba(3,3,6,0.97)",
        borderRight:"1px solid rgba(255,200,100,0.09)",
        display:"flex",flexDirection:"column",
        overflowY:"auto",zIndex:10,
        scrollbarWidth:"none",
      }}>
        <div style={{padding:"18px 14px 12px",borderBottom:"1px solid rgba(255,200,100,0.07)"}}>
          <div style={{color:"rgba(255,200,80,.9)",fontSize:12,fontWeight:"bold",letterSpacing:".18em"}}>⬡ COSMOS</div>
          <div style={{color:"rgba(255,255,255,.2)",fontSize:9,letterSpacing:".12em",marginTop:3}}>EXPLORER v2.0</div>
        </div>

        {categories.map(cat=>(
          <div key={cat}>
            <div style={{padding:"10px 14px 3px",color:"rgba(255,200,80,.35)",fontSize:8,letterSpacing:".2em"}}>{cat}</div>
            {OBJECTS.filter(o=>o.category===cat).map(obj=>{
              const on=activeId===obj.id;
              return (
                <button key={obj.id} onClick={()=>setActiveId(obj.id)} style={{
                  width:"100%",background:on?"rgba(255,200,80,.09)":"transparent",
                  border:"none",borderLeft:on?"2px solid rgba(255,200,80,.75)":"2px solid transparent",
                  color:on?"rgba(255,220,100,.95)":"rgba(255,255,255,.32)",
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

        <div style={{marginTop:"auto",padding:"14px",borderTop:"1px solid rgba(255,200,100,0.06)",color:"rgba(255,200,80,.2)",fontSize:9,letterSpacing:".1em"}}>
          by <span style={{color:"rgba(255,220,50,.6)"}}>Shamil</span>
        </div>
      </div>

      {/* ── MAIN CANVAS ──────────────────────────────── */}
      <div style={{flex:1,position:"relative",cursor:isTheories?"default":"grab"}}>

        {/* Shader canvases */}
        {OBJECTS.filter(o=>o.shader).map(obj=>(
          <ShaderCanvas key={obj.id} fragShader={obj.shader} active={activeId===obj.id} />
        ))}

        {/* Theories page */}
        <TheoriesPage active={isTheories} />

        {/* HUD — only for space objects */}
        {!isTheories && activeObj?.info && (
          <div style={{
            position:"absolute",top:20,left:20,
            color:"rgba(255,200,80,.8)",fontSize:10,lineHeight:2,
            pointerEvents:"none",textShadow:"0 0 10px rgba(255,150,50,.4)",letterSpacing:".08em",
          }}>
            <div style={{fontSize:12,fontWeight:"bold",marginBottom:4,color:"#ffcc77",letterSpacing:".2em"}}>
              {activeObj.icon} {activeObj.info.title.toUpperCase()}
            </div>
            {activeObj.info.stats.map((s,i)=>(
              <div key={i}>{s.k} ···· {s.v}</div>
            ))}
          </div>
        )}

        {/* Bottom label */}
        {!isTheories && (
          <div style={{
            position:"absolute",bottom:18,right:infoOpen?216:50,
            color:"rgba(150,180,255,.25)",fontSize:9,textAlign:"right",
            pointerEvents:"none",letterSpacing:".07em",transition:"right .35s",
          }}>
            drag to rotate · real-time glsl shader
          </div>
        )}

        {/* ── INFO PANEL ──────────────────────────────── */}
        {!isTheories && activeObj?.info && (
          <div style={{
            position:"absolute",top:0,right:0,bottom:0,
            width:infoOpen?200:32,
            background:"rgba(3,3,8,.9)",
            borderLeft:"1px solid rgba(255,200,100,0.09)",
            transition:"width .32s ease",
            display:"flex",flexDirection:"column",
            overflow:"hidden",zIndex:10,
          }}>
            <button onClick={()=>setInfoOpen(v=>!v)} style={{
              background:"transparent",border:"none",
              color:"rgba(255,200,80,.6)",fontSize:14,
              padding:"14px 0",cursor:"pointer",
              flexShrink:0,alignSelf:"flex-start",width:32,
            }}>
              {infoOpen?"›":"‹"}
            </button>
            {infoOpen && (
              <div style={{padding:"0 14px 14px",overflowY:"auto",flex:1,scrollbarWidth:"none"}}>
                <div style={{color:"rgba(255,200,80,.85)",fontSize:10,fontWeight:"bold",letterSpacing:".1em",marginBottom:10,lineHeight:1.5}}>
                  {activeObj.info.title.toUpperCase()}
                </div>
                <div style={{color:"rgba(255,255,255,.48)",fontSize:9.5,lineHeight:1.85,marginBottom:14}}>
                  {activeObj.info.desc}
                </div>
                <div style={{borderTop:"1px solid rgba(255,200,80,.09)",paddingTop:10}}>
                  {activeObj.info.stats.map((s,i)=>(
                    <div key={i} style={{marginBottom:9}}>
                      <div style={{color:"rgba(255,200,80,.45)",fontSize:8,letterSpacing:".12em"}}>{s.k.toUpperCase()}</div>
                      <div style={{color:"rgba(255,255,255,.82)",fontSize:10,marginTop:2}}>{s.v}</div>
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
