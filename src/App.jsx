import { useEffect, useRef } from "react";
import * as THREE from "three";

const vert = /* glsl */`
varying vec2 vUv;
void main(){ vUv=uv; gl_Position=vec4(position,1.0); }
`;

const frag = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec2  uRes;
uniform vec2  uMouse;
varying vec2  vUv;

#define PI  3.14159265358979323846
#define TAU 6.28318530717958647692

// ── Hash / noise ─────────────────────────────────────────────────────────────
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float hash1(float n){ return fract(sin(n)*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p);
  f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
             mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p){
  float v=0.,a=0.5;
  for(int i=0;i<6;i++){v+=a*noise(p);p=p*2.1+vec2(0.13,0.29);a*=0.5;}
  return v;
}

// ── Realistic deep-space starfield — NO green, pure cold/warm white ──────────
vec3 stars(vec3 rd){
  vec3 col=vec3(0.);
  vec2 uv=vec2(atan(rd.z,rd.x)/TAU, asin(clamp(rd.y,-1.,1.))/PI);

  // Layer 1: ultra-dense tiny stars
  for(float sc=60.;sc<=200.;sc+=40.){
    vec2 id=floor(uv*sc);
    float h=hash(id+sc);
    if(h>0.62){
      float dist=length(fract(uv*sc)-0.5);
      float b=pow((h-0.62)/0.38,3.)*smoothstep(0.22,0.0,dist);
      // Only blue-white, yellow-white, pure white — zero green
      float temp=hash(id+sc*0.3);
      vec3 tint= temp<0.3 ? vec3(0.75,0.85,1.00)   // cool blue-white
               : temp<0.6 ? vec3(1.00,1.00,0.98)   // pure white
               :            vec3(1.00,0.92,0.75);   // warm yellow-white
      col+=b*tint*0.65;
    }
  }

  // Layer 2: bright hero stars with subtle diffraction spikes
  vec2 id2=floor(uv*22.);
  float h2=hash(id2+77.3);
  if(h2>0.982){
    vec2 f2=fract(uv*22.)-0.5;
    float dist=length(f2);
    float core=exp(-dist*dist*300.)*3.5;
    // cross spikes
    float spike=exp(-f2.y*f2.y*800.)*exp(-abs(f2.x)*18.)*.8
               +exp(-f2.x*f2.x*800.)*exp(-abs(f2.y)*18.)*.8;
    float temp2=hash(id2+12.);
    vec3 heroTint= temp2<0.4 ? vec3(0.8,0.9,1.0)
                 :             vec3(1.0,0.95,0.85);
    col+=(core+spike)*heroTint;
  }

  // Layer 3: Milky Way band — pure cold blue-white, NO green
  float band=exp(-pow(rd.y*3.2,2.));
  float mw1=fbm(uv*vec2(5.,3.)+vec2(0.4,0.0));
  float mw2=fbm(uv*vec2(9.,6.)+vec2(1.2,0.5));
  float milky=band*mw1*mw2;
  // Colour: cold blue-white and neutral white only
  col+=milky*vec3(0.055,0.068,0.11)*2.2;   // deep blue-white glow
  col+=milky*milky*vec3(0.12,0.14,0.20)*1.5;

  // Layer 4: distant galaxy smear (very subtle, blue-white)
  float gal=fbm(uv*2.5+vec2(0.9,0.4))*fbm(uv*1.8+vec2(0.2,0.7));
  float galMask=smoothstep(.55,.0,abs(rd.y-.1));
  col+=gal*galMask*vec3(0.018,0.022,0.038)*1.8;

  return col;
}

// ── Accretion disc ────────────────────────────────────────────────────────────
vec4 disc(vec3 pos, float discAngle){
  float r=length(pos.xz);
  float innerR=3.0, outerR=18.;
  if(r<innerR||r>outerR) return vec4(0.);

  float t=(r-innerR)/(outerR-innerR);
  float angle=atan(pos.z,pos.x);

  // Concentric rings
  float rings=0.;
  rings+=0.6*smoothstep(0.,.04,sin((r-innerR)*2.6));
  rings+=0.35*smoothstep(0.,.07,sin((r-innerR)*1.2+0.8));
  rings+=0.20*smoothstep(0.,.10,sin((r-innerR)*0.55+1.9));
  float bandMask=0.4+0.6*clamp(rings,0.,1.);

  // Turbulence
  vec2 uvT=vec2(r*0.16+uTime*0.016, angle*0.3+uTime*0.007);
  float turb=0.55+0.45*fbm(uvT*2.4);

  // Radial falloff — bright inner edge
  float falloff=pow(1.-t,1.6)*smoothstep(0.,.1,t);
  float innerGlow=exp(-pow((r-innerR-.25)*2.2,2.))*2.2;

  // Gargantua colour palette: gold-white inner, warm orange mid, muted brown outer
  vec3 cA=vec3(1.00,0.96,0.82); // brilliant warm white
  vec3 cB=vec3(1.00,0.80,0.48); // gold-orange
  vec3 cC=vec3(0.72,0.40,0.18); // warm brown
  vec3 cD=vec3(0.35,0.16,0.06); // deep brown edge
  vec3 baseCol = t<0.25 ? mix(cA,cB,t/0.25)
               : t<0.6  ? mix(cB,cC,(t-0.25)/0.35)
               :           mix(cC,cD,(t-0.6)/0.4);

  // Doppler shift (no green tint — only brightness + warm/cool shift)
  vec3 tang=normalize(vec3(-pos.z,0.,pos.x));
  float dop=dot(tang,vec3(0.,0.,1.))*0.4;
  baseCol*=1.+dop*0.35;  // approaching side brighter
  baseCol*=1.-max(0.,-dop)*0.25;  // receding side dimmer

  float brightness=(falloff*bandMask*turb+innerGlow*0.55)*3.0;
  float alpha=clamp((falloff*bandMask*0.85+innerGlow*0.45)*1.6,0.,1.)*0.93;

  return vec4(baseCol*brightness, alpha);
}

// ── Main ─────────────────────────────────────────────────────────────────────
void main(){
  vec2 uv=(gl_FragCoord.xy/uRes)*2.-1.;
  uv.x*=uRes.x/uRes.y;

  // Camera
  float yaw  =uMouse.x+uTime*0.04;
  float pitch=clamp(uMouse.y-.16,-.65,.60);

  float cy=cos(yaw),sy=sin(yaw),cp=cos(pitch),sp=sin(pitch);
  mat3 RY=mat3(cy,0.,sy, 0.,1.,0., -sy,0.,cy);
  mat3 RX=mat3(1.,0.,0., 0.,cp,-sp, 0.,sp,cp);
  mat3 R=RY*RX;

  // Pulled closer + wider FOV = bigger black hole on screen
  vec3 camPos=R*vec3(0.,3.5,26.);
  vec3 forward=normalize(-camPos);
  vec3 right2=normalize(cross(forward,vec3(0.,1.,0.)));
  vec3 up2=cross(right2,forward);

  float fov=0.65;  // wider = bigger
  vec3 rd=normalize(forward+uv.x*right2*fov+uv.y*up2*fov);

  // Ray march
  float rs=3.0;
  float dt=0.22;
  vec3  pos=camPos;
  vec3  dir=rd;
  vec4  discAccum=vec4(0.);
  bool  hitHorizon=false;
  vec3  exitDir=dir;
  float discAngle=-uTime*0.20;

  for(int i=0;i<200;i++){
    float r=length(pos);
    if(r<rs*0.97){ hitHorizon=true; break; }
    if(r>100.) break;

    float bend=rs/(r*r)*dt*1.65;
    dir=normalize(dir+(-normalize(pos))*bend);

    float prevY=pos.y;
    pos+=dir*dt;
    float nextY=pos.y;

    if(prevY*nextY<0.||abs(pos.y)<0.42){
      vec3 dp=pos-dir*(dt*0.5);
      vec4 dc=disc(dp,discAngle);
      if(dc.a>0.001){
        float redshift=clamp(sqrt(max(0.,1.-rs/max(length(dp.xz),rs+0.01))),0.,1.);
        dc.rgb*=redshift;
        float ghost=discAccum.a>0.015 ? 0.50 : 1.0;
        discAccum.rgb+=dc.rgb*(1.-discAccum.a)*dc.a*ghost;
        discAccum.a  +=dc.a *(1.-discAccum.a)*0.68*ghost;
        if(discAccum.a>0.995) break;
      }
    }
    exitDir=dir;
  }

  // Background stars
  vec3 bg=hitHorizon ? vec3(0.) : stars(normalize(exitDir));

  // Einstein / photon ring
  if(!hitHorizon){
    float bCrit=2.598*rs;
    float bApprox=length(cross(camPos,rd))/length(camPos)*length(camPos);
    float ringGlow=exp(-pow((bApprox-bCrit),2.)*18.)*1.8;
    bg+=ringGlow*vec3(1.00,0.88,0.62); // warm gold ring, not white
  }

  // Compose
  vec3 col=bg*(1.-discAccum.a)+discAccum.rgb;

  // Bloom
  float lum=dot(col,vec3(.2126,.7152,.0722));
  col+=col*clamp(lum-0.75,0.,4.)*0.45;

  // Anamorphic horizontal streak (cinema lens)
  float sy2=uv.y;
  float streak=exp(-sy2*sy2*220.)*exp(-abs(uv.x)*8.)*0.14;
  col+=streak*vec3(1.0,0.88,0.62);

  // Vignette — strong to frame the black hole
  float vig=1.-0.72*pow(dot(uv*0.5,uv*0.5),1.3);
  col*=vig;

  // ACES filmic tone map
  col=(col*(2.51*col+0.03))/(col*(2.43*col+0.59)+0.14);
  col=pow(clamp(col,0.,1.),vec3(0.4545));

  // Film grain (monochrome, very subtle)
  float grain=(hash(gl_FragCoord.xy+fract(uTime)*317.)*2.-1.)*0.032;
  col=clamp(col+grain,0.,1.);

  gl_FragColor=vec4(col,1.);
}
`;

export default function App() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    let W = mount.clientWidth, H = mount.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(0.75);
    renderer.setSize(W, H);
    mount.appendChild(renderer.domElement);

    const scene  = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);

    const uniforms = {
      uTime:  { value: 0 },
      uRes:   { value: new THREE.Vector2(W, H) },
      uMouse: { value: new THREE.Vector2(0, 0) },
    };

    scene.add(new THREE.Mesh(
      new THREE.PlaneGeometry(2,2),
      new THREE.ShaderMaterial({ vertexShader:vert, fragmentShader:frag, uniforms })
    ));

    let dragging=false, px=0, py=0, vx=0, vy=0, accX=0, accY=0;

    const onDown=(x,y)=>{ dragging=true; px=x; py=y; vx=0; vy=0; };
    const onMove=(x,y)=>{ if(!dragging)return; vx=(x-px)*0.004; vy=-(y-py)*0.003; px=x; py=y; };
    const onUp=()=>{ dragging=false; };

    renderer.domElement.addEventListener("mousedown", e=>onDown(e.clientX,e.clientY));
    renderer.domElement.addEventListener("mousemove", e=>onMove(e.clientX,e.clientY));
    window.addEventListener("mouseup", onUp);
    renderer.domElement.addEventListener("touchstart",e=>{const t=e.touches[0];onDown(t.clientX,t.clientY);},{passive:true});
    renderer.domElement.addEventListener("touchmove", e=>{const t=e.touches[0];onMove(t.clientX,t.clientY);},{passive:true});
    window.addEventListener("touchend",onUp);

    const onResize=()=>{
      W=mount.clientWidth; H=mount.clientHeight;
      renderer.setSize(W,H);
      uniforms.uRes.value.set(W,H);
    };
    window.addEventListener("resize",onResize);

    let frameId;
    const clock=new THREE.Clock();
    const animate=()=>{
      frameId=requestAnimationFrame(animate);
      if(!dragging){ vx*=0.88; vy*=0.88; }
      accX+=vx; accY+=vy;
      accY=Math.max(-1.2,Math.min(1.0,accY));
      uniforms.uTime.value=clock.getElapsedTime();
      uniforms.uMouse.value.set(accX,accY);
      renderer.render(scene,camera);
    };
    animate();

    return ()=>{
      cancelAnimationFrame(frameId);
      window.removeEventListener("mouseup",onUp);
      window.removeEventListener("touchend",onUp);
      window.removeEventListener("resize",onResize);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  },[]);

  return (
    <div style={{width:"100vw",height:"100vh",background:"#000",overflow:"hidden",cursor:"grab"}}>
      <div ref={mountRef} style={{width:"100%",height:"100%"}} />

      <div style={{
        position:"absolute",top:24,left:24,
        fontFamily:"'Courier New',monospace",
        color:"rgba(210,160,80,0.85)",
        fontSize:11,lineHeight:2.1,
        pointerEvents:"none",
        textShadow:"0 0 10px rgba(255,150,50,0.5)",
        letterSpacing:"0.09em",
      }}>
        <div style={{fontSize:13,fontWeight:"bold",marginBottom:6,color:"#ffcc77",letterSpacing:"0.22em"}}>
          ◉ STELLAR BLACK HOLE
        </div>
        <div>MASS ············ ~10 M☉</div>
        <div>SCHWARZSCHILD R · 3 AU</div>
        <div>SPIN ············ DRAG TO ROTATE</div>
        <div>ACCRETION DISC ·· ACTIVE</div>
        <div>RELATIVISTIC JET · BIPOLAR</div>
      </div>

    <div style={{
  position:"absolute",bottom:20,right:20,
  fontFamily:"'Courier New',monospace",
  color:"rgba(150,180,255,0.3)",
  fontSize:10,textAlign:"right",
  pointerEvents:"none",letterSpacing:"0.07em",
}}>
  gravitational lensing · schwarzschild metric
</div>

<div style={{
        position:"absolute",bottom:20,right:20,
        fontFamily:"'Courier New',monospace",
        color:"rgba(150,180,255,0.3)",
        fontSize:10,textAlign:"right",
        pointerEvents:"none",letterSpacing:"0.07em",
      }}>
        gravitational lensing · schwarzschild metric
      </div>

      <div style={{
        position:"absolute",bottom:20,left:20,
        fontFamily:"'Courier New',monospace",
        color:"rgba(255,220,50,0.6)",
        fontSize:10,
        pointerEvents:"none",letterSpacing:"0.07em",
      }}>
        by <span style={{color:"#ffdd00"}}>Shamil</span>
      </div>

    </div>
  );
}