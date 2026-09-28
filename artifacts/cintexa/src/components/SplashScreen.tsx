import { useEffect, useState, type CSSProperties } from "react";
import { motion, AnimatePresence } from "framer-motion";

const SPLASH_MS = 15_000;

type SplashScreenProps = {
  forceHide?: boolean;
  minDurationMs?: number;
};

/**
 * Full-screen splash using the official CINTEXA mark from cintexa.com.
 * 3D animated mark, responsive, shown for 5 seconds once per session.
 */
export function SplashScreen({ forceHide = false, minDurationMs = SPLASH_MS }: SplashScreenProps) {
  const [visible, setVisible] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return sessionStorage.getItem("cintexa-splash-shown") !== "1";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => {
      setVisible(false);
      try {
        sessionStorage.setItem("cintexa-splash-shown", "1");
      } catch {
        /* ignore */
      }
    }, minDurationMs);
    return () => window.clearTimeout(timer);
  }, [visible, minDurationMs]);

  useEffect(() => {
    if (forceHide) setVisible(false);
  }, [forceHide]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden bg-[#0B0F14]"
          style={{
            perspective: "1200px",
            perspectiveOrigin: "50% 45%",
          }}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          aria-label="CINTEXA loading"
          role="status"
        >
          {/* Ambient depth layers */}
          <motion.div
            className="pointer-events-none absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
          >
            <motion.div
              className="absolute left-1/2 top-[42%] h-[min(70vw,28rem)] w-[min(70vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(245,197,24,0.18) 0%, rgba(245,197,24,0.05) 40%, transparent 70%)",
              }}
              animate={{
                scale: [1, 1.12, 1],
                opacity: [0.55, 0.85, 0.55],
              }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute left-[18%] top-[22%] h-32 w-32 rounded-full bg-[#F5C518]/10 blur-3xl sm:h-40 sm:w-40"
              animate={{ x: [0, 24, 0], y: [0, -16, 0], opacity: [0.35, 0.6, 0.35] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute bottom-[18%] right-[16%] h-36 w-36 rounded-full bg-[#F5C518]/8 blur-3xl sm:h-48 sm:w-48"
              animate={{ x: [0, -20, 0], y: [0, 18, 0], opacity: [0.3, 0.55, 0.3] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
            />
          </motion.div>

          {/* 3D stage */}
          <div
            className="relative flex flex-col items-center px-6"
            style={{ transformStyle: "preserve-3d" }}
          >
            <motion.div
              className="relative"
              style={{ transformStyle: "preserve-3d" }}
              initial={{ opacity: 0, z: -120, rotateX: 28, rotateY: -32, scale: 0.55 }}
              animate={{
                opacity: 1,
                z: 0,
                rotateX: [18, -12, 10, -6, 0],
                rotateY: [-24, 22, -14, 10, 0],
                rotateZ: [0, 4, -3, 2, 0],
                scale: [0.55, 1.08, 0.98, 1.04, 1],
              }}
              transition={{
                duration: 2.4,
                times: [0, 0.35, 0.55, 0.78, 1],
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              {/* Soft shadow under mark */}
              <motion.div
                className="absolute left-1/2 top-[88%] h-4 w-[70%] -translate-x-1/2 rounded-[100%] bg-black/50 blur-md"
                style={{ transform: "translateZ(-40px)" }}
                animate={{ opacity: [0.25, 0.45, 0.3], scaleX: [0.85, 1.05, 0.9] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
              />

              {/* Orbit ring */}
              <motion.div
                className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[min(72vw,17rem)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#F5C518]/25 sm:w-[18rem]"
                style={{ transformStyle: "preserve-3d" }}
                animate={{ rotateZ: 360, rotateX: [62, 58, 62] }}
                transition={{
                  rotateZ: { duration: 8, repeat: Infinity, ease: "linear" },
                  rotateX: { duration: 3, repeat: Infinity, ease: "easeInOut" },
                }}
              />
              <motion.div
                className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[min(58vw,13.5rem)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#F5C518]/15 sm:w-[14rem]"
                style={{ transformStyle: "preserve-3d" }}
                animate={{ rotateZ: -360, rotateY: [20, 28, 20] }}
                transition={{
                  rotateZ: { duration: 11, repeat: Infinity, ease: "linear" },
                  rotateY: { duration: 4, repeat: Infinity, ease: "easeInOut" },
                }}
              />

              {/* Official cintexa.com mark */}
              <motion.img
                src="/favicon.svg"
                alt="CINTEXA"
                width={128}
                height={128}
                draggable={false}
                className="relative z-10 h-[min(28vw,7.5rem)] w-[min(28vw,7.5rem)] select-none rounded-[22%] sm:h-32 sm:w-32 md:h-36 md:w-36"
                style={{
                  transformStyle: "preserve-3d",
                  filter: "drop-shadow(0 18px 40px rgba(245,197,24,0.35))",
                }}
                animate={{
                  rotateY: [0, 18, -14, 10, 0],
                  rotateX: [0, -8, 6, -4, 0],
                  y: [0, -8, 4, -4, 0],
                }}
                transition={{
                  duration: 4.2,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: 0.6,
                }}
              />
            </motion.div>

            <motion.div
              className="mt-8 text-center sm:mt-10"
              initial={{ opacity: 0, y: 18, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ delay: 0.55, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              <div
                className="text-xl font-bold tracking-[0.22em] text-[#F7F4EE] sm:text-2xl md:text-3xl"
                style={{ fontFamily: '"Space Grotesk", Manrope, system-ui, sans-serif' }}
              >
                CINTEXA
              </div>
              <div className="mt-1.5 text-[11px] tracking-[0.18em] text-[#A8B3C4] sm:text-xs">
                Nexus CMS
              </div>
            </motion.div>

            {/* Custom loading spinner — CSS keyframe driven */}
            <motion.div
              className="relative mt-7 flex h-12 w-12 items-center justify-center sm:mt-8 sm:h-14 sm:w-14"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.65, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              aria-hidden="true"
            >
              <div className="cintexa-halo-breathe absolute inset-0 rounded-full bg-[#F5C518]/10" />

              <div
                className="cintexa-spin-cw absolute inset-0 rounded-full"
                style={{
                  background:
                    "conic-gradient(from 0deg, transparent 0%, transparent 55%, #F5C518 78%, #FFE07A 92%, transparent 100%)",
                  maskImage: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))",
                  WebkitMaskImage:
                    "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))",
                  filter: "drop-shadow(0 0 10px rgba(245,197,24,0.45))",
                }}
              />

              <div className="cintexa-spin-ccw absolute inset-[5px] rounded-full border border-dashed border-[#F5C518]/40 sm:inset-[6px]" />

              <div className="cintexa-spin-cw-slow absolute inset-0">
                <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[#F5C518] shadow-[0_0_8px_rgba(245,197,24,0.9)]" />
                <span className="absolute bottom-[12%] left-[12%] h-1 w-1 rounded-full bg-[#FFE07A]/90" />
                <span className="absolute bottom-[12%] right-[12%] h-1 w-1 rounded-full bg-[#F5C518]/70" />
              </div>

              <div
                className="cintexa-pulse-glow relative h-2 w-2 rounded-full bg-[#F5C518] sm:h-2.5 sm:w-2.5"
              />
            </motion.div>

            {/* Progress rail — CSS keyframe fill synced to splash duration */}
            <motion.div
              className="mt-8 h-0.5 w-[min(48vw,9rem)] overflow-hidden rounded-full bg-white/10 sm:mt-10 sm:w-36"
              initial={{ opacity: 0, scaleX: 0.6 }}
              animate={{ opacity: 1, scaleX: 1 }}
              transition={{ delay: 0.7, duration: 0.45 }}
            >
              <div
                className="cintexa-progress-fill cintexa-shimmer-gold h-full rounded-full"
                style={{ ["--cintexa-splash-ms" as string]: `${minDurationMs}ms` } as CSSProperties}
              />
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Compact brand mark for sidebar / dashboard headers. */
export function CintexaLogo({
  size = 32,
  className = "",
  showWordmark = false,
}: {
  size?: number;
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <img
        src="/favicon.svg"
        alt="CINTEXA"
        width={size}
        height={size}
        className="rounded-lg shrink-0"
        style={{ width: size, height: size }}
      />
      {showWordmark && (
        <span className="font-bold text-lg tracking-tight text-foreground">CINTEXA</span>
      )}
    </div>
  );
}
