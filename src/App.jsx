import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

/* ── Shared vertex ───────────────────────────────────────────────────────── */
const vert = /* glsl */`
varying vec2 vUv;
void main(){ vUv=uv; gl_Position=vec4(position,1.0); }
`;

/* ══════════════════════════════════════════════════════════════════════════
   BLACK HOLE FRAGMENT SHADER
══════════════════════════════════════════════════════════════════════════ */
const bhFrag = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec2  uRes;
uniform vec2  uMouse;
varying vec2  vUv;

#define PI  3.14159265358979323846
#define TAU 6.28318530717958647692

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
vec3 stars(vec3 rd){
  vec3 col=vec3(0.);
  vec2 uv=vec2(atan(rd.z,rd.x)/TAU,asin(clamp(rd.y,-1.,1.))/PI);
  for(float sc=60.;sc<=200.;sc+=40.){
    vec2 id=floor(uv*sc);
    float h=hash(id+sc);
    if(h>0.62){
      float dist=length(fract(uv*sc)-0.5);
      float b=pow((h-0.62)/0.38,3.)*smoothstep(0.22,0.0,dist);
      float temp=hash(id+sc*0.3);
      vec3 tint=temp<0.3?vec3(0.75,0.85,1.00):temp<0.6?vec3(1.00,1.00,0.98):vec3(1.00,0.92,0.75);
      col+=b*tint*0.65;
    }
  }
  vec2 id2=floor(uv*22.); float h2=hash(id2+77.3);
  if(h2>0.982){
    vec2 f2=fract(uv*22.)-0.5; float dist=length(f2);
    float core=exp(-dist*dist*300.)*3.5;
    float spike=exp(-f2.y*f2.y*800.)*exp(-abs(f2.x)*18.)*.8+exp(-f2.x*f2.x*800.)*exp(-abs(f2.y)*18.)*.8;
    vec3 heroTint=hash(id2+12.)<0.4?vec3(0.8,0.9,1.0):vec3(1.0,0.95,0.85);
    col+=(core+spike)*heroTint;
  }
  float band=exp(-pow(rd.y*3.2,2.));
  float mw1=fbm(uv*vec2(5.,3.)+vec2(0.4,0.0));
  float mw2=fbm(uv*vec2(9.,6.)+vec2(1.2,0.5));
  col+=band*mw1*mw2*vec3(0.055,0.068,0.11)*2.2;
  return col;
}
vec4 disc(vec3 pos,float discAngle){
  float r=length(pos.xz);
  float innerR=3.0,outerR=18.;
  if(r<innerR||r>outerR) return vec4(0.);
  float t=(r-innerR)/(outerR-innerR);
  float angle=atan(pos.z,pos.x);
  float rings=0.6*smoothstep(0.,.04,sin((r-innerR)*2.6))+0.35*smoothstep(0.,.07,sin((r-innerR)*1.2+0.8))+0.20*smoothstep(0.,.10,sin((r-innerR)*0.55+1.9));
  float bandMask=0.4+0.6*clamp(rings,0.,1.);
  vec2 uvT=vec2(r*0.16+uTime*0.016,angle*0.3+uTime*0.007);
  float turb=0.55+0.45*fbm(uvT*2.4);
  float falloff=pow(1.-t,1.6)*smoothstep(0.,.1,t);
  float innerGlow=exp(-pow((r-innerR-.25)*2.2,2.))*2.2;
  vec3 cA=vec3(1.00,0.96,0.82),cB=vec3(1.00,0.80,0.48),cC=vec3(0.72,0.40,0.18),cD=vec3(0.35,0.16,0.06);
  vec3 baseCol=t<0.25?mix(cA,cB,t/0.25):t<0.6?mix(cB,cC,(t-0.25)/0.35):mix(cC,cD,(t-0.6)/0.4);
  vec3 tang=normalize(vec3(-pos.z,0.,pos.x));
  float dop=dot(tang,vec3(0.,0.,1.))*0.4;
  baseCol*=1.+dop*0.35; baseCol*=1.-max(0.,-dop)*0.25;
  float brightness=(falloff*bandMask*turb+innerGlow*0.55)*3.0;
  float alpha=clamp((falloff*bandMask*0.85+innerGlow*0.45)*1.6,0.,1.)*0.93;
  return vec4(baseCol*brightness,alpha);
}
void main(){
  vec2 uv=(gl_FragCoord.xy/uRes)*2.-1.;
  uv.x*=uRes.x/uRes.y;
  float yaw=uMouse.x+uTime*0.04;
  float pitch=clamp(uMouse.y-.16,-.65,.60);
  float cy=cos(yaw),sy=sin(yaw),cp=cos(pitch),sp=sin(pitch);
  mat3 RY=mat3(cy,0.,sy,0.,1.,0.,-sy,0.,cy);
  mat3 RX=mat3(1.,0.,0.,0.,cp,-sp,0.,sp,cp);
  mat3 R=RY*RX;
  vec3 camPos=R*vec3(0.,3.5,26.);
  vec3 forward=normalize(-camPos);
  vec3 right2=normalize(cross(forward,vec3(0.,1.,0.)));
  vec3 up2=cross(right2,forward);
  float fov=0.65;
  vec3 rd=normalize(forward+uv.x*right2*fov+uv.y*up2*fov);
  float rs=3.0,dt=0.22;
  vec3 pos=camPos,dir=rd;
  vec4 discAccum=vec4(0.);
  bool hitHorizon=false;
  vec3 exitDir=dir;
  float discAngle=-uTime*0.20;
  for(int i=0;i<200;i++){
    float r=length(pos);
    if(r<rs*0.97){hitHorizon=true;break;}
    if(r>100.) break;
    float bend=rs/(r*r)*dt*1.65;
    dir=normalize(dir+(-normalize(pos))*bend);
    float prevY=pos.y; pos+=dir*dt; float nextY=pos.y;
    if(prevY*nextY<0.||abs(pos.y)<0.42){
      vec3 dp=pos-dir*(dt*0.5);
      vec4 dc=disc(dp,discAngle);
      if(dc.a>0.001){
        float redshift=clamp(sqrt(max(0.,1.-rs/max(length(dp.xz),rs+0.01))),0.,1.);
        dc.rgb*=redshift;
        float ghost=discAccum.a>0.015?0.50:1.0;
        discAccum.rgb+=dc.rgb*(1.-discAccum.a)*dc.a*ghost;
        discAccum.a+=dc.a*(1.-discAccum.a)*0.68*ghost;
        if(discAccum.a>0.995) break;
      }
    }
    exitDir=dir;
  }
  vec3 bg=hitHorizon?vec3(0.):stars(normalize(exitDir));
  if(!hitHorizon){
    float bCrit=2.598*rs;
    float bApprox=length(cross(camPos,rd))/length(camPos)*length(camPos);
    float ringGlow=exp(-pow((bApprox-bCrit),2.)*18.)*1.8;
    bg+=ringGlow*vec3(1.00,0.88,0.62);
  }
  vec3 col=bg*(1.-discAccum.a)+discAccum.rgb;
  float lum=dot(col,vec3(.2126,.7152,.0722));
  col+=col*clamp(lum-0.75,0.,4.)*0.45;
  float sy2=uv.y;
  float streak=exp(-sy2*sy2*220.)*exp(-abs(uv.x)*8.)*0.14;
  col+=streak*vec3(1.0,0.88,0.62);
  float vig=1.-0.72*pow(dot(uv*0.5,uv*0.5),1.3);
  col*=vig;
  col=(col*(2.51*col+0.03))/(col*(2.43*col+0.59)+0.14);
  col=pow(clamp(col,0.,1.),vec3(0.4545));
  float grain=(hash(gl_FragCoord.xy+fract(uTime)*317.)*2.-1.)*0.032;
  col=clamp(col+grain,0.,1.);
  gl_FragColor=vec4(col,1.);
}
`;

/* ══════════════════════════════════════════════════════════════════════════
   PULSAR FRAGMENT SHADER
   — Rapidly spinning neutron star with twin EM beams sweeping the sky,
     hot polar caps, magnetosphere glow, and surrounding nebula
══════════════════════════════════════════════════════════════════════════ */
const pulsarFrag = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec2  uRes;
uniform vec2  uMouse;
varying vec2  vUv;

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
  for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.1+vec2(0.31,0.17);a*=0.5;}
  return v;
}

// Deep space background
vec3 deepSpace(vec3 rd){
  vec3 col=vec3(0.);
  vec2 uv=vec2(atan(rd.z,rd.x)/TAU,asin(clamp(rd.y,-1.,1.))/PI);
  // Stars
  for(float sc=50.;sc<=180.;sc+=40.){
    vec2 id=floor(uv*sc);
    float h=hash(id+sc);
    if(h>0.65){
      float dist=length(fract(uv*sc)-0.5);
      float b=pow((h-0.65)/0.35,3.)*smoothstep(0.2,0.0,dist);
      float temp=hash(id+sc*0.4);
      vec3 tint=temp<0.3?vec3(0.7,0.8,1.0):temp<0.65?vec3(1.,1.,0.97):vec3(1.,0.9,0.72);
      col+=b*tint*0.7;
    }
  }
  // Supernova remnant nebula (pulsar is born from supernova)
  // Subtle red-blue shell around the pulsar region
  float nebR=fbm(uv*3.+vec2(0.5,0.3));
  float nebB=fbm(uv*2.5+vec2(1.2,0.8));
  float shell=smoothstep(0.3,0.5,nebR)*smoothstep(0.7,0.5,nebR);
  col+=shell*vec3(0.08,0.02,0.12)*nebB*2.; // purple remnant
  col+=fbm(uv*4.+vec2(0.2,0.6))*0.02*vec3(0.1,0.15,0.3); // faint blue wisps
  return col;
}

// Neutron star surface
vec3 neutronStar(vec3 rd, float spinAngle){
  // Surface: ultra-hot, blueish-white with polar hotspots
  vec3 base=vec3(0.55,0.75,1.0)*2.5; // blue-white hot plasma

  // Polar caps (hottest regions — X-ray bright)
  float polarN=dot(rd,vec3(0.,1.,0.));
  float polarS=dot(rd,vec3(0.,-1.,0.));
  float capN=pow(max(0.,polarN-.6)/.4,1.5)*3.;
  float capS=pow(max(0.,polarS-.6)/.4,1.5)*3.;
  vec3 capCol=vec3(0.8,0.9,1.0);
  base+=capCol*(capN+capS);

  // Surface texture (magnetic field lines)
  vec2 uvS=vec2(atan(rd.z,rd.x)/TAU+spinAngle/TAU, asin(clamp(rd.y,-1.,1.))/PI);
  float fieldLines=0.5+0.5*sin(uvS.y*PI*8.)*sin(uvS.x*TAU*4.);
  base*=0.85+0.15*fieldLines;

  return base;
}

void main(){
  vec2 uv=(gl_FragCoord.xy/uRes)*2.-1.;
  uv.x*=uRes.x/uRes.y;

  // Camera
  float yaw  =uMouse.x+uTime*0.025;
  float pitch=clamp(uMouse.y-.05,-.8,.8);
  float cy=cos(yaw),sy=sin(yaw),cp=cos(pitch),sp=sin(pitch);
  mat3 RY=mat3(cy,0.,sy,0.,1.,0.,-sy,0.,cy);
  mat3 RX=mat3(1.,0.,0.,0.,cp,-sp,0.,sp,cp);
  mat3 R=RY*RX;
  vec3 camPos=R*vec3(0.,1.5,22.);
  vec3 forward=normalize(-camPos);
  vec3 right2=normalize(cross(forward,vec3(0.,1.,0.)));
  vec3 up2=cross(right2,forward);
  vec3 rd=normalize(forward+uv.x*right2*0.7+uv.y*up2*0.7);

  // Pulsar spin — very fast (millisecond pulsar ~700 rotations/sec, we slow for visual)
  float spinRate=4.5; // visual rotations per second
  float spinAngle=mod(uTime*spinRate*TAU, TAU);

  // Spin axis tilted ~30 degrees from vertical (realistic misalignment)
  float tiltAngle=0.52; // radians
  vec3 spinAxis=normalize(vec3(sin(tiltAngle),cos(tiltAngle),0.));

  // Star radius & position
  float starR=1.2;
  vec3 starPos=vec3(0.);

  // Ray-sphere intersection
  vec3 oc=camPos-starPos;
  float b2=dot(oc,rd);
  float c=dot(oc,oc)-starR*starR;
  float disc2=b2*b2-c;
  bool hitStar=disc2>0.&&(-b2-sqrt(max(0.,disc2)))>0.;

  vec3 col=vec3(0.);

  if(hitStar){
    // Hit the neutron star surface
    float t=-b2-sqrt(max(0.,disc2));
    vec3 hitP=camPos+rd*t;
    vec3 norm=normalize(hitP-starPos);
    col=neutronStar(norm, spinAngle);

  } else {
    // Background
    col=deepSpace(rd);

    // ── Electromagnetic beams (twin jets along spin axis) ──────────────────
    // Rotate beam direction with spin
    float beamSpin=spinAngle;
    // Beam sweeps in a cone around spin axis
    vec3 beamDir1=normalize(vec3(
      sin(tiltAngle)*cos(beamSpin),
      cos(tiltAngle),
      sin(tiltAngle)*sin(beamSpin)
    ));
    vec3 beamDir2=-beamDir1; // opposite beam

    // How aligned is our ray with the beam?
    float beam1=dot(rd,beamDir1);
    float beam2=dot(rd,beamDir2);

    // Narrow pencil beam (pulsars have very narrow emission)
    float beamWidth=0.018;
    float b1=exp(-pow(1.-beam1,2.)/(beamWidth*beamWidth))*2.5;
    float b2v=exp(-pow(1.-beam2,2.)/(beamWidth*beamWidth))*2.5;

    // Beam colour: blue-white radio/X-ray
    vec3 beamCol=vec3(0.4,0.7,1.0);
    col+=beamCol*(b1+b2v);

    // Beam halo (wider softer glow around beam)
    float halo1=exp(-pow(1.-beam1,2.)/(0.08*0.08))*0.4;
    float halo2=exp(-pow(1.-beam2,2.)/(0.08*0.08))*0.4;
    col+=vec3(0.2,0.4,0.8)*(halo1+halo2);

    // ── Magnetosphere ────────────────────────────────────────────────────
    // Distance from star centre projected on screen
    vec3 toStar=starPos-camPos;
    float closestDist=length(cross(rd,normalize(toStar)));
    float starDist=length(toStar);

    // Inner magnetosphere glow
    float magR=max(0.,1.-(closestDist/(starR*4.)));
    col+=pow(magR,3.)*vec3(0.15,0.3,0.7)*1.2;

    // Outer corona
    float corona=max(0.,1.-(closestDist/(starR*8.)));
    col+=pow(corona,5.)*vec3(0.05,0.1,0.4)*0.8;

    // ── Pulsar wind nebula (toroidal X-ray ring) ──────────────────────────
    // Ring perpendicular to spin axis
    // Project ray onto spin-axis plane
    float along=dot(rd,spinAxis);
    vec3 perp=rd-along*spinAxis;
    float perpDist=length(perp);
    float ringR=3.5; // ring radius
    float torusDist=abs(perpDist-ringR/starDist*0.0);

    // Torus in world space (approximate)
    // Find closest point on ring to ray
    vec3 ringCenter=starPos;
    vec3 perpRay=rd-dot(rd,spinAxis)*spinAxis;
    float perpLen=length(perpRay);
    if(perpLen>0.001){
      vec3 perpDir=perpRay/perpLen;
      float tRing=dot(ringCenter-camPos,perpDir)/dot(rd,perpDir+0.0001);
      vec3 ringPoint=camPos+rd*max(0.,tRing);
      float distToAxis=length((ringPoint-ringCenter)-dot(ringPoint-ringCenter,spinAxis)*spinAxis);
      float torusGlow=exp(-pow(distToAxis-ringR,2.)*0.8)*0.3;
      col+=torusGlow*vec3(0.3,0.5,1.0);
    }

    // Spin-down radiation (faint blue wisps spiraling out)
    vec2 uvWind=vec2(atan(rd.z,rd.x)/TAU,asin(clamp(rd.y,-1.,1.))/PI);
    float windPattern=fbm(uvWind*5.+vec2(uTime*0.05,0.))*fbm(uvWind*3.-vec2(0.,uTime*0.03));
    float windMask=smoothstep(0.6,0.,closestDist/6.)*smoothstep(0.,0.1,closestDist/starR);
    col+=windPattern*windMask*vec3(0.05,0.1,0.25)*1.5;
  }

  // ── Post processing ───────────────────────────────────────────────────────
  // Bloom
  float lum=dot(col,vec3(.2126,.7152,.0722));
  col+=col*clamp(lum-0.8,0.,5.)*0.6;

  // Vignette
  float vig=1.-0.65*pow(dot(uv*0.5,uv*0.5),1.4);
  col*=vig;

  // Blue tint for X-ray feel
  col*=vec3(0.92,0.96,1.0);

  // Tone map
  col=(col*(2.51*col+0.03))/(col*(2.43*col+0.59)+0.14);
  col=pow(clamp(col,0.,1.),vec3(0.4545));

  // Film grain
  float grain=(hash(gl_FragCoord.xy+fract(uTime)*431.)*2.-1.)*0.028;
  col=clamp(col+grain,0.,1.);

  gl_FragColor=vec4(col,1.);
}
`;

/* ══════════════════════════════════════════════════════════════════════════
   SHARED THREE.JS RENDERER HOOK
══════════════════════════════════════════════════════════════════════════ */
function useShaderRenderer(mountRef, fragShader) {
  const uniformsRef = useRef(null);

  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    let W = mount.clientWidth, H = mount.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(W, H);
    mount.appendChild(renderer.domElement);

    const scene  = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);

    const uniforms = {
      uTime:  { value: 0 },
      uRes:   { value: new THREE.Vector2(W, H) },
      uMouse: { value: new THREE.Vector2(0, 0) },
    };
    uniformsRef.current = uniforms;

    scene.add(new THREE.Mesh(
      new THREE.PlaneGeometry(2,2),
      new THREE.ShaderMaterial({ vertexShader:vert, fragmentShader:fragShader, uniforms })
    ));

    let dragging=false,px=0,py=0,vx=0,vy=0,accX=0,accY=0;
    const onDown=(x,y)=>{ dragging=true;px=x;py=y;vx=0;vy=0; };
    const onMove=(x,y)=>{ if(!dragging)return;vx=(x-px)*0.004;vy=-(y-py)*0.003;px=x;py=y; };
    const onUp=()=>{ dragging=false; };

    renderer.domElement.addEventListener("mousedown", e=>onDown(e.clientX,e.clientY));
    renderer.domElement.addEventListener("mousemove", e=>onMove(e.clientX,e.clientY));
    window.addEventListener("mouseup",onUp);
    renderer.domElement.addEventListener("touchstart",e=>{const t=e.touches[0];onDown(t.clientX,t.clientY);},{passive:true});
    renderer.domElement.addEventListener("touchmove", e=>{const t=e.touches[0];onMove(t.clientX,t.clientY);},{passive:true});
    window.addEventListener("touchend",onUp);

    const onResize=()=>{ W=mount.clientWidth;H=mount.clientHeight;renderer.setSize(W,H);uniforms.uRes.value.set(W,H); };
    window.addEventListener("resize",onResize);

    let frameId;
    const clock=new THREE.Clock();
    const animate=()=>{
      frameId=requestAnimationFrame(animate);
      if(!dragging){vx*=0.88;vy*=0.88;}
      accX+=vx;accY+=vy;
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
      if(mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, [fragShader]);
}

/* ══════════════════════════════════════════════════════════════════════════
   APP
══════════════════════════════════════════════════════════════════════════ */
export default function App() {
  const [active, setActive] = useState("blackhole");
  const bhRef     = useRef(null);
  const pulsarRef = useRef(null);

  useShaderRenderer(bhRef,     bhFrag);
  useShaderRenderer(pulsarRef, pulsarFrag);

  const items = [
    { id:"blackhole", label:"Black Hole",  icon:"◉" },
    { id:"pulsar",    label:"Pulsar Star", icon:"✦" },
  ];

  const hud = {
    blackhole: {
      title: "◉ STELLAR BLACK HOLE",
      lines: ["MASS ············ ~10 M☉","SCHWARZSCHILD R · 3 AU","SPIN ············ DRAG TO ROTATE","ACCRETION DISC ·· ACTIVE","RELATIVISTIC JET · BIPOLAR"],
    },
    pulsar: {
      title: "✦ MILLISECOND PULSAR",
      lines: ["MASS ············ ~1.4 M☉","RADIUS ·········· ~10 KM","SPIN RATE ······· ~700 Hz","EM BEAM ········· ACTIVE","MAGNETOSPHERE ··· ACTIVE"],
    },
  };

  const current = hud[active];

  return (
    <div style={{ width:"100vw", height:"100vh", background:"#000", overflow:"hidden", display:"flex" }}>

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <div style={{
        width:160, flexShrink:0,
        background:"rgba(5,5,10,0.92)",
        borderRight:"1px solid rgba(255,200,100,0.12)",
        display:"flex", flexDirection:"column",
        padding:"24px 0", gap:4,
        zIndex:10,
      }}>
        <div style={{
          fontFamily:"'Courier New',monospace",
          color:"rgba(255,200,80,0.5)",
          fontSize:9, letterSpacing:"0.2em",
          padding:"0 16px 16px",
          borderBottom:"1px solid rgba(255,200,100,0.1)",
          marginBottom:8,
        }}>
          SIMULATIONS
        </div>

        {items.map(item => {
          const isActive = active === item.id;
          return (
            <button key={item.id} onClick={()=>setActive(item.id)} style={{
              background: isActive ? "rgba(255,200,80,0.12)" : "transparent",
              border:"none",
              borderLeft: isActive ? "2px solid rgba(255,200,80,0.8)" : "2px solid transparent",
              color: isActive ? "rgba(255,220,100,0.95)" : "rgba(255,255,255,0.35)",
              fontFamily:"'Courier New',monospace",
              fontSize:11, letterSpacing:"0.08em",
              padding:"10px 16px",
              textAlign:"left", cursor:"pointer",
              display:"flex", alignItems:"center", gap:8,
              transition:"all 0.2s",
            }}>
              <span style={{ fontSize:14 }}>{item.icon}</span>
              {item.label}
            </button>
          );
        })}

        <div style={{
          marginTop:"auto",
          fontFamily:"'Courier New',monospace",
          color:"rgba(255,200,80,0.25)",
          fontSize:9, letterSpacing:"0.1em",
          padding:"16px",
          borderTop:"1px solid rgba(255,200,100,0.08)",
        }}>
          by <span style={{color:"rgba(255,220,50,0.7)"}}>Shamil</span>
        </div>
      </div>

      {/* ── Canvas area ─────────────────────────────────────── */}
      <div style={{ flex:1, position:"relative", cursor:"grab" }}>

        {/* Black hole canvas */}
        <div ref={bhRef} style={{
          position:"absolute", inset:0,
          opacity: active==="blackhole" ? 1 : 0,
          pointerEvents: active==="blackhole" ? "auto" : "none",
          transition:"opacity 0.6s ease",
        }} />

        {/* Pulsar canvas */}
        <div ref={pulsarRef} style={{
          position:"absolute", inset:0,
          opacity: active==="pulsar" ? 1 : 0,
          pointerEvents: active==="pulsar" ? "auto" : "none",
          transition:"opacity 0.6s ease",
        }} />

        {/* HUD */}
        <div style={{
          position:"absolute", top:24, left:24,
          fontFamily:"'Courier New',monospace",
          color:"rgba(210,160,80,0.85)",
          fontSize:11, lineHeight:2.1,
          pointerEvents:"none",
          textShadow:"0 0 10px rgba(255,150,50,0.5)",
          letterSpacing:"0.09em",
          transition:"opacity 0.4s",
        }}>
          <div style={{ fontSize:13, fontWeight:"bold", marginBottom:6, color:"#ffcc77", letterSpacing:"0.22em" }}>
            {current.title}
          </div>
          {current.lines.map((l,i)=><div key={i}>{l}</div>)}
        </div>

        {/* Bottom right label */}
        <div style={{
          position:"absolute", bottom:20, right:20,
          fontFamily:"'Courier New',monospace",
          color:"rgba(150,180,255,0.3)",
          fontSize:10, textAlign:"right",
          pointerEvents:"none", letterSpacing:"0.07em",
        }}>
          {active==="blackhole" ? "gravitational lensing · schwarzschild metric" : "neutron star · electromagnetic pulsar beam"}
        </div>

      </div>
    </div>
  );
}