# The horizontal biped's tail (ONE-FORMAT CC58b1, CC58b2)

- opus-of-m456: format 0.46.1's horizontal biped (CC58a) reaches the sim and the page. `TailCreatureVolumes` keeps the
  biped's body and head volumes on the rest rig, with the contract's spine pitch applied (`restPose`, shared with the
  sockets), and lays its tail volumes on trail bones that follow the hips' path (CC22's ring, a saved trail step like
  the serpent's). A sweep `from: tail` starts at the tail tip; any other strike socket keeps the rest rig (`posed` may
  now return undefined). On the page the skin driver still walks the legs; `SkinPitch` leans the spine over its pose
  once a frame, and the pose's `trailJoint` lays the tail bones on the same trail (the serpent's CC23c pattern).
- Format 0.46.0 was cut without CC58a (release.sh cuts the newest green main, and its CI was still running), so 0.46.1
  carries it.
