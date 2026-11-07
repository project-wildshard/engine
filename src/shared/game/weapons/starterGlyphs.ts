/** The existing swap glyphs, shared by weapon rows (no equipment-id lookup in the HUD). */
export const SWAP_GLYPHS = {
  "sword": "<path d=\"M20.5 3.5 9.2 14.8M20.5 3.5l-.6 4.2M20.5 3.5l-4.2.6\"/><path d=\"M6.6 12.2l5.2 5.2M8.4 15.6 4 20\"/>",
  "bow": "<path d=\"M6 3c7 3.5 7 14.5 0 18\"/><path d=\"M6 3v18\" stroke-width=\"0.9\"/><path d=\"M4 12h15M16.5 9.5 19 12l-2.5 2.5\"/>",
  "sabre": "<path d=\"M5 19c4-3.5 9.5-9.5 13.5-15.5-1 5-5.5 11.5-11.5 16.5\"/><path d=\"M3.5 16.5l4.5 4.5M4.5 21.5l2-2\"/>",
  "spear": "<path d=\"M4 20 16 8\"/><path d=\"M16 8c.8-2.6 2.6-4.4 5-5-.6 2.4-2.4 4.2-5 5z\"/><path d=\"M13.2 8.6l2.2 2.2\"/>",
  "rifle": "<path d=\"M3 13h14l3-2h1v3h-4l-2 2H9l-1 3H5l1-3H3z\"/>",
  "crossbow": "<path d=\"M4 7c4 3 12 3 16 0M12 5v15M8 17h8\"/>"
} as const;
