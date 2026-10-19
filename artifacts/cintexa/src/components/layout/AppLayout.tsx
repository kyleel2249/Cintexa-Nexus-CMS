import { ReactNode, useCallback, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { motion } from "framer-motion";
import { useLocation } from "wouter";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const close = useCallback(() => setNavOpen(false), []);

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <Sidebar mobileOpen={navOpen} onClose={close} />
      <div className="flex-1 flex flex-col min-w-0 lg:ml-64">
        <Topbar onMenu={() => setNavOpen(true)} />
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-hidden">
          <motion.div
            key={location}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="h-full w-full max-w-7xl mx-auto"
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
