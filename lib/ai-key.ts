// Shared between client and server: why an AI request couldn't run.
export const KEY_ERRORS = {
  required: "AI_KEY_REQUIRED", // no AI connected (and no free prompts left)
  invalid: "AI_KEY_INVALID", // the provider rejected the saved key
} as const;
