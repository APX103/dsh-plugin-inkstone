/** CSS-module imports carry no static surface for the settings tab. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
