import type { ComponentProps } from 'react'
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes'

type ThemeProviderProps = ComponentProps<typeof NextThemesProvider>

function ThemeProvider({
  attribute = 'class',
  defaultTheme = 'system',
  enableSystem = true,
  disableTransitionOnChange = true,
  ...props
}: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute={attribute}
      defaultTheme={defaultTheme}
      enableSystem={enableSystem}
      disableTransitionOnChange={disableTransitionOnChange}
      {...props}
    />
  )
}

export { ThemeProvider, useTheme }
export type { ThemeProviderProps }
