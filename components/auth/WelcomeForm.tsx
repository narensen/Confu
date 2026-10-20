"use client";

import { useActionState } from "react";
import { saveWelcome } from "@/app/welcome/actions";
import { buttonClass, inputClass, labelClass } from "@/components/ui";
import { HEARD_FROM, OCCUPATIONS, PURPOSES } from "@/lib/signup-survey";

export function WelcomeForm({ next, name }: { next: string; name: string | null }) {
  const [state, action, pending] = useActionState(saveWelcome, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {name && <p className="text-sm">Hi {name.split(" ")[0]}, you&apos;re signed in. One last thing:</p>}
      <Select label="How did you hear about Confu?" name="heardFrom" options={HEARD_FROM} />
      <Select label="What describes you best?" name="occupation" options={OCCUPATIONS} />
      <Select label="What will you mainly use Confu for?" name="purpose" options={PURPOSES} />
      <label className="block">
        <span className={labelClass}>
          Anything more about your goal? <span className="font-normal text-muted">(optional)</span>
        </span>
        <textarea name="purposeDetail" rows={2} maxLength={500} placeholder="e.g. Passing my linear algebra final in May" className={`${inputClass} resize-none`} />
      </label>
      {state?.error && <p role="alert" className="animate-pop rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{state.error}</p>}
      <button className={`${buttonClass} w-full py-2.5`} disabled={pending}>
        {pending ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}

function Select({ label, name, options }: { label: string; name: string; options: readonly string[] }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <select name={name} required defaultValue="" className={`${inputClass} cursor-pointer`}>
        <option value="" disabled>
          Choose one
        </option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
