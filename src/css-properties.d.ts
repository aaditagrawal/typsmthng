// Allow CSS custom properties (`--foo`) in React style objects so dynamic
// values can be passed through `style` without `as` casts.
declare module 'react' {
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined
  }
}

export {}
