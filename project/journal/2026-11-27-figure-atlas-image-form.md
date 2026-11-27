# Draw figure atlases from authored rig images

QA50. Engine v0.1.99 crossed from Driftwood to Nalati on staging and
then refused the load while preparing the camp figure atlas. The
Chromium trace caught a plain 1024 by 1024 compressed texture
descriptor passed to Canvas2D. Nalati's minimap WebP read back with
the expected digest.

The rig loader now takes an explicit image-form request from the
atlas compositor. The merged geometry and ordinary rig reads still
use the renderer's selected form. The compositor checks that each
source is a decoded image before drawing and releases its bitmap
after the copy. The regression offers a GPU texture on the default
read and checks that only image-backed sources reach the canvas.
