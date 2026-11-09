# Automatic interview audio

Joining an interview starts audio recording automatically; there is no opt-in checkbox. Setup and join screens disclose storage and admin access. The room shows a recording indicator. Camera footage is not stored.

The microphone (voice mode) and the AI speaker's Web Audio output are mixed into one MediaRecorder stream. Text mode records the AI output only. A device's speech-synthesis fallback cannot be captured; the room and report disclose this, and the transcript retains the words. Browser microphone permissions still apply.

Audio is uploaded every ten seconds in ordered chunks. Uploads retry with the same recording ID and sequence number; duplicate retries do not append duplicate bytes. Finalizing waits for the recorder's last data event and queued uploads before opening the report. Failed uploads retain chunks in the open page and display a retry control. Successful background recovery clears the warning; retrying an active capture resumes uploads without stopping recording. Reloading or forcibly closing the page can lose unsaved audio; completed uploads remain available as a partial recording. Rejoining creates a separate recording, never concatenates unrelated container headers.

Reports provide authenticated playback, download, and deletion. Candidates can access only their own sessions. Platform admins can listen/delete, with an audit event for each audio read or deletion. Admins cannot inject audio into another user's session. Deleting an interview removes its audio and chunks too. There is no public recording URL.

Limits: 4 MB per upload, 64 MB total per interview, twenty captures per session, and one thousand chunks per capture. Recordings are stored in database binary columns in the existing database volume, and share that volume's backup and operational policies. No retention scheduler or external object-storage integration is included.

The voice room also now uses automatic answer completion, with adjustable pause sensitivity and incomplete-thought deferral. The Finish answer control and left prompt panel have been removed; the transcript toggle and captions remain.

Verification: 159 backend tests pass, including four new recording tests for authorization, audited admin access, ordered/idempotent uploads, limits, deletion, and final chunks after completion. Six existing frontend tests pass; TypeScript and production builds pass. Chrome verification confirmed the join disclosure and report audio section, including the truthful empty state for an older interview. Live microphone capture, audible mixing, and playback across Chrome/Safari have not been verified end to end with a real microphone in this update. Existing sessions have no retroactive audio.

This update does not implement the separately requested coding runner, HLD canvas, human pairing, expanded provider catalog, credit grants, revised pricing, or PDF editing. Those remain separate outstanding work; the current pricing catalog must not advertise them as delivered.
