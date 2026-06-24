import React, { createContext, useContext, useEffect, useState } from "react"

type Theme = "dark" | "light" | "system"
type Accent = "indigo" | "violet" | "emerald" | "rose" | "amber" | "cyan"

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
}

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
  accent: "indigo",
  setAccent: () => null,
}

const ThemeContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
  children,
  defaultTheme = "system",
  defaultAccent = "indigo",
  storageKey = "vite-ui-theme",
  accentStorageKey = "cintexa-accent",
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  )
  const [accent, setAccentState] = useState<Accent>(
    () => (localStorage.getItem(accentStorageKey) as Accent) || defaultAccent
  )

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove("light", "dark")
    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      root.classList.add(systemTheme)
      return
    }
    root.classList.add(theme)
  }, [theme])

  useEffect(() => {
    const root = window.document.documentElement
    if (accent === "indigo") {
      root.removeAttribute("data-accent")
    } else {
      root.setAttribute("data-accent", accent)
    }
  }, [accent])

  const value: ThemeProviderState = {
    theme,
    setTheme: (t: Theme) => {
      localStorage.setItem(storageKey, t)
      setThemeState(t)
    },
    accent,
    setAccent: (a: Accent) => {
      localStorage.setItem(accentStorageKey, a)
      setAccentState(a)
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
  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider")
  return context
}

export type { Theme, Accent }
