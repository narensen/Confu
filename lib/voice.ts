// Voice in a private room is a mesh: each browser talks to the others directly.
// Eight is the cap because every extra person is another connection each way.
// Nothing here is recorded or sent to Confu's servers. A screen share is the
// same: live between the browsers, not recorded. Signaling rides the same
// realtime channel study rooms already use.

export const VOICE_CAP = 8;

// The lower id creates the offer, so two browsers never both offer at once.
export function shouldOffer(myId: string, peerId: string) {
  return myId < peerId;
}

// Loud enough to draw the speaking ring. Silence sits at 128; speech moves away from it.
export function isSpeaking(samples: Uint8Array) {
  if (samples.length === 0) return false;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = ((samples[i] ?? 128) - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length) > 0.06;
}

export const ICE_SERVERS: { urls: string }[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];
