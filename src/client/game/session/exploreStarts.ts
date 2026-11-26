/**
 * Which of a booted page's two Explorer starts runs (src/client/game/session/finish.ts). A tap's Explore arrival starts the
 * viewer through hud.onExplore, which the page's own `?explore=` route (session/play.ts) has already pointed at its view, and
 * that first start re-points it at the hub. The route's own start runs only when no arrival started the viewer: both once
 * opened the route's view and then the hub over it, and the nightly's Explorer, asked for `?explore=model`, waited on a hub
 * (meta QA 11-25 row 144).
 */
export function exploreStarts(arrival: boolean, route: boolean): { readonly arrival: boolean; readonly route: boolean } {
  return { arrival, route: route && !arrival };
}
