"use client";

import { useId, useState, useTransition } from "react";
import { keyModels, saveKeyModels } from "@/app/(app)/settings/actions";
import { ghostButtonClass, inputClass } from "@/components/ui";
import { pickModel, type ListedModel, type ModelRoles } from "@/lib/ai/providers";
import type { KeyInfo } from "@/lib/ai-keys";

const ROLES: [keyof ModelRoles, string, string][] = [
  ["chat", "Tutor, plans and practice", "Most of what Confu does. Pick a capable model."],
  ["fast", "Progress notes", "Runs after each answer. A small, cheap model is plenty."],
  ["vision", "Figures and scans", "Reads the region you capture. Must take images."],
];

// Which model does which job, for one saved key. The provider's list is
// fetched when the picker opens; any model name can also be typed.
// OpenRouter can limit that list to models with published weights, and the
// figures job only offers models that accept an image.
export function ModelPicker({ info, scope, known, onSaved }: { info: KeyInfo; scope: string | null; known?: ListedModel[]; onSaved: (info: KeyInfo) => void }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelRoles>(info.models);
  const [catalog, setCatalog] = useState<ListedModel[] | null>(known?.length ? known : null);
  const [openOnly, setOpenOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const listId = useId();
  const changed = ROLES.some(([role]) => models[role].trim() !== info.models[role]);
  const openRouter = info.provider === "openrouter";
  const freeIds = catalog?.filter((m) => m.free === true).map((m) => m.id) ?? [];

  function forRole(role: keyof ModelRoles): string[] {
    if (!catalog) return [];
    return catalog
      .filter((m) => {
        if (openOnly && m.open !== true) return false;
        if (role === "vision" && m.vision === false) return false;
        return true;
      })
      .map((m) => m.id);
  }

  // The vision model region capture should use, chosen from the live list.
  const suggestedVision = (() => {
    if (!openRouter || !catalog) return null;
    const ids = catalog.filter((m) => m.vision === true && m.open === true).map((m) => m.id);
    const id = pickModel("openrouter", "vision", ids);
    return ids.includes(id) ? id : null;
  })();

  function openPicker() {
    setOpen(true);
    setModels(info.models);
    if (catalog) return;
    start(async () => {
      const res = await keyModels(scope);
      if (res.ok) setCatalog(res.catalog);
      else setError(res.error);
    });
  }

  function save() {
    setError(null);
    start(async () => {
      const res = await saveKeyModels(scope, models);
      if (!res.ok) return setError(res.error);
      onSaved(res.info);
      setSaved(true);
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <p className="min-w-0">
          <span className="text-ink">Models:</span>{" "}
          <span className="font-mono break-all">
            {[...new Set([info.models.chat, info.models.fast, info.models.vision])].join(" · ")}
          </span>
          {saved && <span className="ml-2 text-ok">Saved.</span>}
        </p>
        <button type="button" onClick={openPicker} className="shrink-0 underline underline-offset-2 hover:text-ink">
          Change models
        </button>
      </div>
    );
  }

  const shown = forRole("chat");
  return (
    <div className="animate-enter space-y-3 rounded-lg border border-line bg-paper p-3">
      {openRouter && (
        <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} className="accent-[var(--ink)]" />
          Open source only
          <span className="text-muted">— models with published weights</span>
        </label>
      )}
      {openRouter && freeIds.length > 0 && (
        <div>
          <p className="text-sm font-medium">
            Free models <span className="text-xs font-normal text-muted">— {freeIds.length}. Choosing one fills the tutor. Save models to keep it.</span>
          </p>
          <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-line">
            {freeIds.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setModels((m) => ({ ...m, chat: id }))}
                className={`block w-full truncate px-2 py-1 text-left font-mono text-[11px] hover:text-ink ${models.chat === id ? "font-medium text-ink" : "text-muted"}`}
              >
                {id}
              </button>
            ))}
          </div>
        </div>
      )}
      {ROLES.map(([role, label, hint]) => (
        <div key={role}>
          <label className="block">
            <span className="text-sm font-medium">{label}</span> <span className="text-xs text-muted">— {hint}</span>
            <input
              list={`${listId}-${role}`}
              value={models[role]}
              onChange={(e) => setModels((m) => ({ ...m, [role]: e.target.value }))}
              spellCheck={false}
              autoComplete="off"
              className={`${inputClass} mt-1 py-1.5 font-mono text-xs`}
            />
          </label>
          <datalist id={`${listId}-${role}`}>
            {forRole(role).map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
          {role === "vision" && suggestedVision && models.vision.trim() !== suggestedVision && (
            <button
              type="button"
              onClick={() => setModels((m) => ({ ...m, vision: suggestedVision }))}
              className="mt-1 text-left text-[11px] text-muted underline decoration-line underline-offset-2 hover:text-ink"
            >
              Use <span className="font-mono">{suggestedVision}</span> for region capture
            </button>
          )}
        </div>
      ))}
      <p className="text-[11px] text-muted">
        {catalog === null && pending
          ? "Loading the models this key can use…"
          : shown.length
            ? `${shown.length} ${openOnly ? "open-source models" : "models available"}. Start typing to search them.${
                catalog?.some((m) => m.vision !== null) ? " Figures and scans only lists the ones that read images." : ""
              }`
            : openOnly
              ? "No open-source models were listed. Uncheck Open source only, or type a model id."
              : "Type the model's name as the provider writes it."}
      </p>
      {error && <p className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={pending || !changed || ROLES.some(([role]) => !models[role].trim())} className={`${ghostButtonClass} py-1.5 text-xs`}>
          Save models
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-2 text-xs text-muted hover:text-ink">
          Cancel
        </button>
      </div>
    </div>
  );
}
