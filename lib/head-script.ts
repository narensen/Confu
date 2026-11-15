// The script app/layout.tsx puts in <head>, so the chosen theme and motion
// apply before the first paint (no light flash on a dark page). A plain
// module on purpose: imported from a "use client" file into the server
// layout, a constant arrives as a client reference, not a string, and the
// page got a script that couldn't run (the choice was lost on every load).
export const THEME_KEY = "confu:theme";
export const MOTION_KEY = "confu:motion";

export const HEAD_SCRIPT = [
  `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`,
  `try{if(localStorage.getItem("${MOTION_KEY}")==="reduce")document.documentElement.dataset.motion="reduce"}catch(e){}`,
].join(";");
