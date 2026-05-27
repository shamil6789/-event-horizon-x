import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function BlackHole() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    const W = mount.clientWidth;
    const H = mount.clientHeight;

    // ── Renderer ──────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    mount.appendChild(renderer.domElement);

    // ── Scene / Camera ────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 2000);
    camera.position.set(0, 2.5, 7);
    camera.lookAt(0, 0, 0);

    // ── Mouse-orbit state ─────────────────────────────────────────────────────
    let isDragging = false;
    let prevMouse = { x: 0, y: 0 };
    let spherical = { theta: 0, phi: Math.PI / 5 };   // azimuth, polar
    const ORBIT_R = 7;

    const onMouseDown = (e) => { isDragging = true; prevMouse = { x: e.clientX, y: e.clientY }; };
    const onMouseUp   = () => { isDragging = false; };
    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dx = (e.clientX - prevMouse.x) * 0.005;
      const dy = (e.clientY - prevMouse.y) * 0.005;
      spherical.theta -= dx;
      spherical.phi    = Math.max(0.08, Math.min(Math.PI * 0.9 - 0.05, spherical.phi + dy));
      prevMouse = { x: e.clientX, y: e.clientY };
    };
    // Touch support
    const onTouchStart = (e) => { isDragging = true; prevMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
    const onTouchEnd   = () => { isDragging = false; };
    const onTouchMove  = (e) => {
      if (!isDragging) return;
      const dx = (e.touches[0].clientX - prevMouse.x) * 0.005;
      const dy = (e.touches[0].clientY - prevMouse.y) * 0.005;
      spherical.theta -= dx;
      spherical.phi    = Math.max(0.08, Math.min(Math.PI * 0.9 - 0.05, spherical.phi + dy));
      prevMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    mount.addEventListener("mousedown",  onMouseDown);
    mount.addEventListener("mouseup",    onMouseUp);
    mount.addEventListener("mousemove",  onMouseMove);
    mount.addEventListener("touchstart", onTouchStart, { passive: true });
    mount.addEventListener("touchend",   onTouchEnd);
    mount.addEventListener("touchmove",  onTouchMove, { passive: true });

    // ── Helpers ───────────────────────────────────────────────────────────────
    function makeCanvas(size, draw) {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      draw(c.getContext("2d"), size);
      return new THREE.CanvasTexture(c);
    }

    // ── 1. STAR FIELD (sphere) ────────────────────────────────────────────────
    const starGeo  = new THREE.BufferGeometry();
    const starCount = 6000;
    const starPos   = new Float32Array(starCount * 3);
    const starCol   = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const r     = 500 + Math.random() * 400;
      starPos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
      starPos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
      starPos[i*3+2] = r * Math.cos(phi);
      const warm = Math.random();
      starCol[i*3]   = 0.7 + warm * 0.3;
      starCol[i*3+1] = 0.75 + warm * 0.1;
      starCol[i*3+2] = 0.95 + (1-warm)*0.05;
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute("color",    new THREE.BufferAttribute(starCol, 3));
    const starMat = new THREE.PointsMaterial({ size: 0.6, vertexColors: true, transparent: true, opacity: 0.9 });
    scene.add(new THREE.Points(starGeo, starMat));

    // ── 2. EVENT HORIZON (black sphere) ──────────────────────────────────────
    const ehGeo = new THREE.SphereGeometry(1, 64, 64);
    const ehMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const ehMesh = new THREE.Mesh(ehGeo, ehMat);
    scene.add(ehMesh);

    // ── 3. PHOTON RING (thin bright torus) ───────────────────────────────────
    const photonTex = makeCanvas(256, (ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, s, 0);
      g.addColorStop(0,    "rgba(0,0,0,0)");
      g.addColorStop(0.35, "rgba(220,230,255,0.0)");
      g.addColorStop(0.5,  "rgba(255,252,240,1)");
      g.addColorStop(0.65, "rgba(220,230,255,0.0)");
      g.addColorStop(1,    "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
    const photonGeo = new THREE.TorusGeometry(1.08, 0.045, 32, 256);
    const photonMat = new THREE.MeshBasicMaterial({
      map: photonTex, color: 0xffffff, transparent: true,
      opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    scene.add(new THREE.Mesh(photonGeo, photonMat));

    // Inner secondary ring (slightly dimmer)
    const photonGeo2 = new THREE.TorusGeometry(1.04, 0.022, 32, 256);
    const photonMat2 = new THREE.MeshBasicMaterial({
      color: 0xaac0ff, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    scene.add(new THREE.Mesh(photonGeo2, photonMat2));

    // ── 4. ACCRETION DISC ────────────────────────────────────────────────────
    // Built from stacked thin rings with additive blending → glowing disc
    function makeDiscRingTex(innerHot) {
      return makeCanvas(512, (ctx, s) => {
        const g = ctx.createLinearGradient(0, 0, s, 0);
        if (innerHot) {
          g.addColorStop(0,    "rgba(0,0,0,0)");
          g.addColorStop(0.05, "rgba(255,245,200,0.0)");
          g.addColorStop(0.18, "rgba(255,252,230,0.95)");  // near-white hot
          g.addColorStop(0.35, "rgba(255,220,100,0.75)");  // golden
          g.addColorStop(0.55, "rgba(210,130,30,0.45)");   // orange
          g.addColorStop(0.75, "rgba(120,60,10,0.20)");    // brown
          g.addColorStop(0.90, "rgba(40,15,5,0.06)");
          g.addColorStop(1,    "rgba(0,0,0,0)");
        } else {
          g.addColorStop(0,    "rgba(0,0,0,0)");
          g.addColorStop(0.10, "rgba(180,130,40,0.12)");
          g.addColorStop(0.40, "rgba(140,90,20,0.18)");
          g.addColorStop(0.70, "rgba(80,45,10,0.10)");
          g.addColorStop(1,    "rgba(0,0,0,0)");
        }
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      });
    }

    const discGroup = new THREE.Group();
    scene.add(discGroup);

    // Layer 1 – bright hot inner disc
    const disc1Geo = new THREE.RingGeometry(1.10, 2.6, 256, 8);
    const disc1Mat = new THREE.MeshBasicMaterial({
      map: makeDiscRingTex(true),
      transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    discGroup.add(new THREE.Mesh(disc1Geo, disc1Mat));

    // Layer 2 – wide outer dust halo (golden brown)
    const disc2Geo = new THREE.RingGeometry(2.0, 5.5, 256, 4);
    const disc2Mat = new THREE.MeshBasicMaterial({
      map: makeDiscRingTex(false),
      transparent: true, opacity: 0.65,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    discGroup.add(new THREE.Mesh(disc2Geo, disc2Mat));

    // Layer 3 – extra glow bloom on inner edge
    const disc3Geo = new THREE.RingGeometry(1.05, 1.80, 256, 4);
    const disc3Mat = new THREE.MeshBasicMaterial({
      map: makeCanvas(256, (ctx, s) => {
        const g = ctx.createLinearGradient(0,0,s,0);
        g.addColorStop(0,    "rgba(0,0,0,0)");
        g.addColorStop(0.15, "rgba(255,255,255,0.0)");
        g.addColorStop(0.30, "rgba(255,250,220,0.85)");
        g.addColorStop(0.55, "rgba(200,160,60,0.3)");
        g.addColorStop(1,    "rgba(0,0,0,0)");
        ctx.fillStyle = g; ctx.fillRect(0,0,s,s);
      }),
      transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    discGroup.add(new THREE.Mesh(disc3Geo, disc3Mat));

    // ── 5. GRAVITATIONAL LENSING GLOW (sprites / billboard quads) ────────────
    function makeGlowTex(r, g, b, innerOpacity) {
      return makeCanvas(512, (ctx, s) => {
        const cx = s/2, cy = s/2;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, s/2);
        grad.addColorStop(0,   `rgba(${r},${g},${b},${innerOpacity})`);
        grad.addColorStop(0.25,`rgba(${r},${g},${b},${innerOpacity*0.7})`);
        grad.addColorStop(0.5, `rgba(${r},${g},${b},${innerOpacity*0.3})`);
        grad.addColorStop(0.75,`rgba(${r},${g},${b},0.04)`);
        grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0,0,s,s);
      });
    }

    // Core intense white glow
    const glowSprite1 = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTex(255, 250, 235, 0.95),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glowSprite1.scale.set(4.5, 4.5, 1);
    scene.add(glowSprite1);

    // Wider soft blue-white halo
    const glowSprite2 = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTex(180, 210, 255, 0.55),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glowSprite2.scale.set(9, 9, 1);
    scene.add(glowSprite2);

    // Outermost ultra-soft halo
    const glowSprite3 = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTex(100, 140, 220, 0.25),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glowSprite3.scale.set(18, 18, 1);
    scene.add(glowSprite3);

    // ── 6. LENS FLARE RING (the sharp thin ring around EH, camera-facing) ────
    const lensRingTex = makeCanvas(512, (ctx, s) => {
      const cx=s/2, cy=s/2, r=s*0.46;
      for (let a=0; a<360; a+=0.5) {
        const rad = a * Math.PI/180;
        const x = cx + Math.cos(rad)*r;
        const y = cy + Math.sin(rad)*r;
        const g = ctx.createRadialGradient(x,y,0,x,y,s*0.045);
        g.addColorStop(0,"rgba(255,252,240,0.9)");
        g.addColorStop(1,"rgba(0,0,0,0)");
        ctx.fillStyle=g;
        ctx.beginPath(); ctx.arc(x,y,s*0.045,0,Math.PI*2); ctx.fill();
      }
    });
    const lensRingSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: lensRingTex, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    lensRingSprite.scale.set(3.0, 3.0, 1);
    scene.add(lensRingSprite);

    // ── 7. RELATIVISTIC JETS (vertical elongated glow) ────────────────────────
    function makeJetTex() {
      return makeCanvas(128, (ctx, s) => {
        const g = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
        g.addColorStop(0,   "rgba(160,190,255,0.9)");
        g.addColorStop(0.3, "rgba(100,140,255,0.45)");
        g.addColorStop(0.7, "rgba(50, 80,200,0.1)");
        g.addColorStop(1,   "rgba(0,0,0,0)");
        ctx.fillStyle=g; ctx.fillRect(0,0,s,s);
      });
    }
    const jetMat = new THREE.SpriteMaterial({
      map: makeJetTex(), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const jetTop = new THREE.Sprite(jetMat.clone());
    const jetBot = new THREE.Sprite(jetMat.clone());
    jetTop.scale.set(0.9, 4.5, 1); jetTop.position.set(0, 3.2, 0);
    jetBot.scale.set(0.9, 4.5, 1); jetBot.position.set(0, -3.2, 0);
    scene.add(jetTop, jetBot);

    // ── 8. BACKGROUND NEBULA GLOW (subtle deep colour) ───────────────────────
    const nebulaTex = makeCanvas(512, (ctx, s) => {
      const g = ctx.createRadialGradient(s*0.4, s*0.55, 0, s*0.5, s*0.5, s*0.7);
      g.addColorStop(0,   "rgba(10,20,60,0.5)");
      g.addColorStop(0.4, "rgba(5,10,40,0.3)");
      g.addColorStop(1,   "rgba(0,0,0,0)");
      ctx.fillStyle=g; ctx.fillRect(0,0,s,s);
    });
    const nebulaSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: nebulaTex, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8,
    }));
    nebulaSprite.scale.set(60, 40, 1);
    nebulaSprite.position.set(0, 0, -50);
    scene.add(nebulaSprite);

    // ── Resize handler ────────────────────────────────────────────────────────
    const onResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    // ── Animate ───────────────────────────────────────────────────────────────
    let raf;
    const clock = new THREE.Clock();
    function animate() {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      // Rotate accretion disc slowly
      discGroup.rotation.z = t * 0.04;

      // Auto-gentle drift when not dragging
      if (!isDragging) spherical.theta += 0.0008;

      // Update camera from spherical
      const sinPhi = Math.sin(spherical.phi);
      camera.position.set(
        ORBIT_R * sinPhi * Math.sin(spherical.theta),
        ORBIT_R * Math.cos(spherical.phi),
        ORBIT_R * sinPhi * Math.cos(spherical.theta),
      );
      camera.lookAt(0, 0, 0);

      // Pulse glow slightly
      const pulse = 1 + 0.04 * Math.sin(t * 1.3);
      glowSprite1.scale.set(4.5 * pulse, 4.5 * pulse, 1);

      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      mount.removeEventListener("mousedown",  onMouseDown);
      mount.removeEventListener("mouseup",    onMouseUp);
      mount.removeEventListener("mousemove",  onMouseMove);
      mount.removeEventListener("touchstart", onTouchStart);
      mount.removeEventListener("touchend",   onTouchEnd);
      mount.removeEventListener("touchmove",  onTouchMove);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", background: "#000", overflow: "hidden", cursor: "grab" }}>
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />

      {/* HUD */}
      <div style={{
        position: "absolute", bottom: "1.8rem", left: "50%", transform: "translateX(-50%)",
        color: "rgba(160,190,255,0.45)", fontFamily: "'Courier New', monospace",
        fontSize: "0.72rem", letterSpacing: "0.22em", userSelect: "none", pointerEvents: "none",
        textAlign: "center", lineHeight: 1.8,
      }}>
        DRAG TO ORBIT &nbsp;·&nbsp; GARGANTUA CLASS · M ≈ 10⁸ M☉
         by <span style={{color:"#ffdd00"}}>Shamil</span>
      </div>
      
    </div>
  );
}
