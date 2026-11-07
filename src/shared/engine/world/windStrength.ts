/**
 * The legacy tree / undergrowth sway strength (`uWindStrength`, 1 = Pine Hollow's calm day), a plain box with no renderer
 * edge: TreeFactory's shaders read it as a uniform and the steppe's one Wind (steppeWind.ts) writes it every update, so a
 * renderer-free host can load the Wind without the shader patches in wind.ts.
 */
export const windStrength = { value: 1.0 };
