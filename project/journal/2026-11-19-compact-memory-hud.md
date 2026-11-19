# Compact the phone memory HUD

QA mini row 24. The memory button shows a chip icon and the playing
estimate. It opens the existing memory breakdown. The FPS button
keeps its worst frame time in its details.

The panel's peak includes both boot samples and all playing values
shown by this overlay. The regression test raises the playing value
past the boot sample, then lowers it and checks the peak stays high.

On the 390×844 Nine capture, the 58 px memory button leaves 54 px
before the minimap. The FPS button is 47 px wide. Both captures used
the same spawn and the same phone viewport.
