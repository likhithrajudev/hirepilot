# Open interview call stage

The live room now follows the supplied call-stage reference: a nearly black graphite background, a slim branded header, a large candidate camera tile on the right, lightweight current AI text on the left, a blue perspective point wave across the bottom, and a compact centered dock. Illustrated portraits and the large square AI matrix are removed.

The current spoken text appears directly on the stage, with a small nine-dot AI indicator. The full transcript is optional through the conversation-history button. On phones the camera and text stack. Coding retains its editor and pinned constraints, with the camera/current conversation in a separate desktop column; a bounded conversation area sits below the editor on smaller screens. Text and captions do not float over the code pane.

The wave uses canvas and follows actual speaker/microphone audio levels. An idle surface drifts gently; speech changes its amplitude. Reduced-motion preferences produce a static surface. Microphone, camera, history and settings are the primary dock controls; typing, captions, voice and pause sensitivity remain available in settings. Audio recording disclosures and controls, existing automatic turn detection, and behavioral scope protections are retained.

The clock shows elapsed time, not an invented countdown. End interview still uses the existing confirmation and report flow. The automatically assigned AI name and voice remain consistent with the selected round.

Verification: TypeScript and the production build pass. The shared CallStage component and production CSS were rendered into `design/interview-stage.html` and visually inspected in Safari at 1440×900 and 390×844. That layout preview uses a camera-off placeholder and static wave geometry; it does not access microphones/cameras or test live voice playback. No active interview was refreshed. Existing backend behavior is unchanged by this visual update.
