import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";

interface JoiOrbProps {
  size?: number;
  active?: boolean;
  intensity?: number;
  rings?: number;
  animated?: boolean;
  variant?: "outline" | "firestorm" | "transparent";
  className?: string;
  ariaLabel?: string;
}

interface FirestormParticle {
  seed: number;
  angle: number;
  radius: number;
  size: number;
  tw: number;
  drift: number;
}

interface FirestormFogCloud {
  angle: number;
  radial: number;
  size: number;
  drift: number;
  sway: number;
  seed: number;
  tint: number;
}

export default function JoiOrb({
  size = 28,
  active = false,
  intensity = 0.2,
  rings = 3,
  animated = true,
  variant = "transparent",
  className = "",
  ariaLabel = "JOI",
}: JoiOrbProps) {
  const clampedIntensity = Math.max(0, Math.min(1, intensity));
  const ringCount = Math.max(0, Math.min(4, rings));
  const isFirestorm = variant === "firestorm";
  const isTransparent = variant === "transparent";
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const particlesRef = useRef<FirestormParticle[]>([]);
  const fogCloudsRef = useRef<FirestormFogCloud[]>([]);

  const seed = useMemo(() => {
    // Deterministic per render instance while still varied.
    const seedBase = Math.round(size * 17 + clampedIntensity * 1000);
    return Math.max(1, seedBase);
  }, [size, clampedIntensity]);

  useEffect(() => {
    if (!isFirestorm) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixels = Math.max(20, Math.round(size));
    canvas.width = Math.max(1, Math.round(pixels * dpr));
    canvas.height = Math.max(1, Math.round(pixels * dpr));

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    particlesRef.current = makeParticles(Math.floor(160 + clampedIntensity * 130), seed);
    fogCloudsRef.current = makeFogClouds(Math.floor(120 + clampedIntensity * 120), seed);

    let elapsed = 0;
    let lastTs = performance.now();

    const drawFrame = (time: number) => {
      const dt = Math.max(0, Math.min((time - lastTs) / 1000, 0.05));
      lastTs = time;
      if (animated) {
        elapsed += dt;
      }
      drawFirestormOrb(
        ctx,
        canvas.width,
        canvas.height,
        elapsed,
        active,
        clampedIntensity,
        particlesRef.current,
        fogCloudsRef.current,
      );
      if (animated) {
        rafRef.current = window.requestAnimationFrame(drawFrame);
      }
    };

    if (animated) {
      rafRef.current = window.requestAnimationFrame(drawFrame);
    } else {
      drawFrame(performance.now());
    }

    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [active, animated, clampedIntensity, isFirestorm, seed, size]);

  const style = {
    "--joi-size": `${size}px`,
    "--joi-intensity": String(clampedIntensity),
  } as CSSProperties;

  const classes = [
    "joi-orb",
    active ? "joi-orb-active" : "",
    animated ? "joi-orb-animated" : "joi-orb-static",
    isFirestorm ? "joi-orb-firestorm" : "",
    isTransparent ? "joi-orb-transparent" : "",
    className,
  ]
    .join(" ")
    .trim();

  if (isFirestorm) {
    return (
      <span className={classes} style={style} role="img" aria-label={ariaLabel}>
        <canvas ref={canvasRef} className="joi-orb-firestorm-canvas" />
      </span>
    );
  }

  if (isTransparent) {
    return (
      <span className={classes} style={style} role="img" aria-label={ariaLabel}>
        <span className="joi-orb-transparent-glow" />
        <img
          className="joi-orb-transparent-image"
          src="/joi-firestorm-transparent.png"
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      </span>
    );
  }

  return (
    <span className={classes} style={style} role="img" aria-label={ariaLabel}>
      {Array.from({ length: ringCount }).map((_, index) => (
        <span
          // index is stable because ringCount is deterministic and tiny
          key={index}
          className={`joi-orb-ring joi-orb-ring-${index + 1}`}
        />
      ))}
      <span className="joi-orb-core">
        <svg className="joi-orb-glyph" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.5 20 18.5 15.3 15.6 8.7 15.6 4 18.5Z" />
        </svg>
      </span>
    </span>
  );
}

const FIRESTORM = {
  halo: [208, 90, 30] as const,
  ringA: [232, 132, 58] as const,
  ringB: [242, 196, 124] as const,
  core: [252, 220, 166] as const,
};

const TAU = Math.PI * 2;

function rgba(rgb: readonly [number, number, number], alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, alpha))})`;
}

function seededValue(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function makeParticles(count: number, seedBase: number): FirestormParticle[] {
  const list: FirestormParticle[] = [];
  for (let i = 0; i < count; i += 1) {
    const s1 = seededValue(seedBase + i * 1.3);
    const s2 = seededValue(seedBase + i * 2.1);
    const s3 = seededValue(seedBase + i * 2.7);
    const s4 = seededValue(seedBase + i * 3.2);
    const s5 = seededValue(seedBase + i * 4.4);
    list.push({
      seed: s1 * 1000,
      angle: s2 * TAU,
      radius: Math.pow(s3, 0.56),
      size: 0.2 + s4 * 1.4,
      tw: 0.2 + s5 * 1.6,
      drift: (seededValue(seedBase + i * 5.1) - 0.5) * 0.18,
    });
  }
  return list;
}

function makeFogClouds(count: number, seedBase: number): FirestormFogCloud[] {
  const list: FirestormFogCloud[] = [];
  for (let i = 0; i < count; i += 1) {
    const s1 = seededValue(seedBase + i * 0.9);
    const s2 = seededValue(seedBase + i * 1.7);
    const s3 = seededValue(seedBase + i * 2.6);
    const s4 = seededValue(seedBase + i * 3.8);
    const s5 = seededValue(seedBase + i * 4.5);
    const s6 = seededValue(seedBase + i * 5.3);
    list.push({
      angle: s1 * TAU,
      radial: Math.pow(s2, 0.62),
      size: 0.08 + s3 * 0.46,
      drift: (s4 - 0.5) * 0.08,
      sway: 0.4 + s5 * 1.3,
      seed: s6 * 1000,
      tint: seededValue(seedBase + i * 6.1),
    });
  }
  return list;
}

function drawNebulaFog(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  orbR: number,
  time: number,
  fogClouds: FirestormFogCloud[],
  fogStrength: number,
) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";

  for (const cloud of fogClouds) {
    const angle = cloud.angle + time * (0.08 + cloud.drift);
    const radial = cloud.radial * orbR * 0.97;
    const x = cx + Math.cos(angle) * radial;
    const y = cy + Math.sin(angle) * radial;
    const pulse = 0.72 + Math.sin(time * cloud.sway + cloud.seed) * 0.28;
    const r = orbR * cloud.size * pulse * fogStrength;

    const gradient = ctx.createRadialGradient(x, y, r * 0.06, x, y, r);
    const innerColor = cloud.tint < 0.25
      ? FIRESTORM.halo
      : cloud.tint < 0.55
        ? FIRESTORM.ringA
        : cloud.tint < 0.85
          ? FIRESTORM.ringB
          : FIRESTORM.core;
    gradient.addColorStop(0, rgba(innerColor, 0.34 * fogStrength));
    gradient.addColorStop(1, rgba(innerColor, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  ctx.restore();
}

function drawFirestormOrb(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  elapsed: number,
  active: boolean,
  intensity: number,
  particles: FirestormParticle[],
  fogClouds: FirestormFogCloud[],
) {
  const scale = active ? 0.98 + intensity * 0.46 : 0.70 + intensity * 0.24;
  const speed = active ? 0.82 + intensity * 0.88 : 0.44 + intensity * 0.24;
  const fogStrength = active ? 0.60 + intensity * 0.46 : 0.36 + intensity * 0.22;
  const density = active ? 0.74 + intensity * 0.52 : 0.50 + intensity * 0.22;

  const cx = width * 0.5;
  const cy = height * 0.5;
  const orbR = Math.min(width, height) * (0.365 * scale);

  ctx.clearRect(0, 0, width, height);

  const haloLayers: Array<[number, number]> = [
    [1.54, 0.14],
    [1.22, 0.10],
    [1.00, 0.07],
  ];
  ctx.globalCompositeOperation = "screen";
  for (const [radiusMul, alpha] of haloLayers) {
    const halo = ctx.createRadialGradient(cx, cy, orbR * 0.08, cx, cy, orbR * radiusMul);
    halo.addColorStop(0, rgba(FIRESTORM.halo, alpha));
    halo.addColorStop(1, rgba(FIRESTORM.halo, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, orbR * radiusMul, 0, TAU);
    ctx.fill();
  }

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.beginPath();
  ctx.arc(cx, cy, orbR, 0, TAU);
  ctx.clip();

  const coreShadow = ctx.createRadialGradient(cx, cy, orbR * 0.02, cx, cy, orbR * 1.05);
  coreShadow.addColorStop(0, "rgba(8,7,4,0.20)");
  coreShadow.addColorStop(0.52, "rgba(8,10,12,0.58)");
  coreShadow.addColorStop(1, "rgba(0,0,0,0.92)");
  ctx.fillStyle = coreShadow;
  ctx.fillRect(cx - orbR, cy - orbR, orbR * 2, orbR * 2);

  const time = elapsed * speed;
  drawNebulaFog(ctx, cx, cy, orbR, time, fogClouds, fogStrength);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const count = Math.min(particles.length, Math.max(60, Math.floor(particles.length * density)));
  for (let i = 0; i < count; i += 1) {
    const particle = particles[i];
    const angle = particle.angle + time * (0.2 + particle.drift);
    const rad = particle.radius * orbR * 0.98;
    const x = cx + Math.cos(angle) * rad;
    const y = cy + Math.sin(angle) * rad;
    const tw = 0.25 + Math.sin(time * particle.tw + particle.seed) * 0.35 + 0.35;
    const s = (particle.size * orbR * 0.009) * (0.68 + tw * 0.62);
    const warm = i % 3 !== 0;
    ctx.fillStyle = warm ? rgba(FIRESTORM.ringB, tw * 0.50) : `rgba(255, 255, 255, ${tw * 0.36})`;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  const nucleus = ctx.createRadialGradient(cx, cy, orbR * 0.01, cx, cy, orbR * 0.52);
  nucleus.addColorStop(0, rgba(FIRESTORM.core, 0.50));
  nucleus.addColorStop(0.20, rgba(FIRESTORM.ringB, 0.34));
  nucleus.addColorStop(0.48, rgba(FIRESTORM.ringA, 0.18));
  nucleus.addColorStop(1, rgba(FIRESTORM.ringA, 0));
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = nucleus;
  ctx.beginPath();
  ctx.arc(cx, cy, orbR * 0.52, 0, TAU);
  ctx.fill();

  ctx.restore();

  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = rgba(FIRESTORM.ringB, 0.30);
  ctx.shadowBlur = orbR * 0.11;
  ctx.shadowColor = rgba(FIRESTORM.ringB, 0.18);
  ctx.lineWidth = orbR * 0.034;
  ctx.beginPath();
  ctx.arc(cx, cy, orbR * 1.01, 0, TAU);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = "source-over";
}
