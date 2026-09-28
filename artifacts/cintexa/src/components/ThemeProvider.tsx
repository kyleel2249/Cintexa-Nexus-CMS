import React, { createContext, useContext, useEffect, useState } from "react"

type Theme = "dark" | "light" | "system"
type Accent = "indigo" | "violet" | "emerald" | "rose" | "amber" | "cyan" | "gold" | "custom"
type Radius = "sharp" | "default" | "round"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  defaultAccent?: Accent
  storageKey?: string
  accentStorageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
  accent: Accent
  setAccent: (accent: Accent) => void
  customColor: string
  setCustomColor: (hex: string) => void
  radius: Radius
  setRadius: (r: Radius) => void
  reduceMotion: boolean
  setReduceMotion: (v: boolean) => void
  resetAppearance: () => void
}

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
  accent: "gold",
  setAccent: () => null,
  customColor: "#d4af37",
  setCustomColor: () => null,
  radius: "default",
  setRadius: () => null,
  reduceMotion: false,
  setReduceMotion: () => null,
  resetAppearance: () => null,
}

const ThemeContext = createContext<ThemeProviderState>(initialState)

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage may be blocked (private mode) - the setting still applies for this session */
  }
}

/** #rrggbb -> "h s% l%" (the format the CSS tokens use) */
function hexToHslTriplet(hex: string): { triplet: string; lightness: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h = Math.round(h * 60)
    if (h < 0) h += 360
  }
  return { triplet: `${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`, lightness: l }
}

const CUSTOM_VARS = ["--primary", "--primary-foreground", "--sidebar-primary", "--sidebar-primary-foreground", "--sidebar-ring", "--ring", "--chart-1"]

export function ThemeProvider({
  children,
  defaultTheme = "system",
  defaultAccent = "gold",
  storageKey = "vite-ui-theme",
  accentStorageKey = "cintexa-accent",
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => (read(storageKey) as Theme) || defaultTheme)
  const [accent, setAccentState] = useState<Accent>(() => (read(accentStorageKey) as Accent) || defaultAccent)
  const [customColor, setCustomColorState] = useState<string>(() => read(`${accentStorageKey}-custom`) || "#d4af37")
  const [radius, setRadiusState] = useState<Radius>(() => (read(`${storageKey}-radius`) as Radius) || "default")
  const [reduceMotion, setReduceMotionState] = useState<boolean>(() => read(`${storageKey}-reduce-motion`) === "1")

  // Light / dark / follow-the-OS (and react live when the OS switches)
  useEffect(() => {
    const root = window.document.documentElement
    const apply = () => {
      root.classList.remove("light", "dark")
      if (theme === "system") {
        root.classList.add(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      } else {
        root.classList.add(theme)
      }
    }
    apply()
    if (theme !== "system") return
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [theme])

  // Accent colour (presets via data-accent; custom via inline CSS variables)
  useEffect(() => {
    const root = window.document.documentElement
    CUSTOM_VARS.forEach((v) => root.style.removeProperty(v))
    if (accent === "indigo") {
      root.removeAttribute("data-accent")
      return
    }
    if (accent === "custom") {
      root.setAttribute("data-accent", "custom")
      const hsl = hexToHslTriplet(customColor)
      if (hsl) {
        const fg = hsl.lightness > 0.55 ? "210 40% 8%" : "0 0% 100%"
        root.style.setProperty("--primary", hsl.triplet)
        root.style.setProperty("--primary-foreground", fg)
        root.style.setProperty("--sidebar-primary", hsl.triplet)
        root.style.setProperty("--sidebar-primary-foreground", fg)
        root.style.setProperty("--sidebar-ring", hsl.triplet)
        root.style.setProperty("--ring", hsl.triplet)
        root.style.setProperty("--chart-1", hsl.triplet)
      }
      return
    }
    root.setAttribute("data-accent", accent)
  }, [accent, customColor])

  useEffect(() => {
    const root = window.document.documentElement
    root.style.setProperty("--radius", radius === "sharp" ? "0.125rem" : radius === "round" ? "1rem" : "0.5rem")
  }, [radius])

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.toggle("reduce-motion", reduceMotion)
  }, [reduceMotion])

  const value: ThemeProviderState = {
    theme,
    setTheme: (t: Theme) => {
      write(storageKey, t)
      setThemeState(t)
    },
    accent,
    setAccent: (a: Accent) => {
      write(accentStorageKey, a)
      setAccentState(a)
    },
    customColor,
    setCustomColor: (hex: string) => {
      write(`${accentStorageKey}-custom`, hex)
      setCustomColorState(hex)
      write(accentStorageKey, "custom")
      setAccentState("custom")
    },
    radius,
    setRadius: (r: Radius) => {
      write(`${storageKey}-radius`, r)
      setRadiusState(r)
    },
    reduceMotion,
    setReduceMotion: (v: boolean) => {
      write(`${storageKey}-reduce-motion`, v ? "1" : "0")
      setReduceMotionState(v)
    },
    resetAppearance: () => {
      write(storageKey, defaultTheme)
      write(accentStorageKey, defaultAccent)
      write(`${storageKey}-radius`, "default")
      write(`${storageKey}-reduce-motion`, "0")
      setThemeState(defaultTheme)
      setAccentState(defaultAccent)
      setRadiusState("default")
      setReduceMotionState(false)
    },
  }

  return (
    <ThemeContext.Provider {...props} value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (context === undefined) throw new Error("useTheme must be used within a ThemeProvider")
  return context
}

export type { Theme, Accent, Radius }
