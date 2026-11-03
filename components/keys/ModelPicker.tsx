"use client";

import { useId, useState, useTransition } from "react";
import { keyModels, saveKeyModels } from "@/app/(app)/settings/actions";
import { ghostButtonClass, inputClass } from "@/components/ui";
import type { ModelRoles } from "@/lib/ai/providers";
import type { KeyInfo } from "@/lib/ai-keys";

const ROLES: [keyof ModelRoles, string, string][] = [
  ["chat", "Tutor, plans and practice", "Most of what Confu does. Pick a capable model."],
  ["fast", "Progress notes", "Runs after each answer. A small, cheap model is plenty."],
  ["vision", "Figures and scans", "Must read images."],
];

// Which model does which job, for one saved key. The provider's list is
// fetched when the picker opens; any model name can also be typed.
export function ModelPicker({ info, scope, known, onSaved }: { info: KeyInfo; scope: string | null; known?: string[]; onSaved: (info: KeyInfo) => void }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelRoles>(info.models);
  const [list, setList] = useState<string[] | null>(known?.length ? known : null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const listId = useId();
  const changed = ROLES.some(([role]) => models[role].trim() !== info.models[role]);

  function openPicker() {
    setOpen(true);
    setModels(info.models);
    if (list) return;
    start(async () => {
      const res = await keyModels(scope);
      if (res.ok) setList(res.models);
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

  return (
    <div className="animate-enter space-y-3 rounded-lg border border-line bg-paper p-3">
      {ROLES.map(([role, label, hint]) => (
        <label key={role} className="block">
          <span className="text-sm font-medium">{label}</span> <span className="text-xs text-muted">— {hint}</span>
          <input
            list={listId}
            value={models[role]}
            onChange={(e) => setModels((m) => ({ ...m, [role]: e.target.value }))}
            spellCheck={false}
            autoComplete="off"
            className={`${inputClass} mt-1 py-1.5 font-mono text-xs`}
          />
        </label>
      ))}
      <datalist id={listId}>
        {(list ?? []).map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      <p className="text-[11px] text-muted">
        {list === null && pending
          ? "Loading the models this key can use…"
          : list?.length
            ? `${list.length} models available. Start typing to search them.`
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
