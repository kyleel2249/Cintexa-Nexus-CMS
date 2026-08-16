import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const SPLASH_MS = 1800;

type SplashScreenProps = {
  /** When true, force-hide immediately (e.g. after auth ready). */
  forceHide?: boolean;
  minDurationMs?: number;
};

/**
 * Full-screen splash using the official CINTEXA brand mark from cintexa.com.
 * Shows once per browser session on app open.
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
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#070D1A]"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45, ease: "easeInOut" }}
          aria-label="CINTEXA loading"
          role="status"
        >
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            className="relative"
          >
            <motion.img
              src="/favicon.svg"
              alt="CINTEXA"
              width={88}
              height={88}
              className="w-22 h-22 drop-shadow-[0_0_28px_rgba(25,211,255,0.35)]"
              animate={{
                filter: [
                  "drop-shadow(0 0 12px rgba(25,211,255,0.25))",
                  "drop-shadow(0 0 28px rgba(25,211,255,0.55))",
                  "drop-shadow(0 0 12px rgba(25,211,255,0.25))",
                ],
              }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute -inset-3 rounded-2xl border border-[#19D3FF]/30"
              animate={{ opacity: [0.2, 0.6, 0.2], scale: [1, 1.06, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            />
          </motion.div>
          <motion.div
            className="mt-6 text-center"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
          >
            <div className="text-xl font-bold tracking-[0.2em] text-white">CINTEXA</div>
            <div className="text-xs text-[#9AAEC6] mt-1 tracking-wide">Nexus CMS</div>
          </motion.div>
          <motion.div
            className="mt-8 h-0.5 w-24 overflow-hidden rounded-full bg-white/10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            <motion.div
              className="h-full bg-gradient-to-r from-[#1E6BFF] via-[#19D3FF] to-[#7C4DFF]"
              initial={{ x: "-100%" }}
              animate={{ x: "100%" }}
              transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
            />
          </motion.div>
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
