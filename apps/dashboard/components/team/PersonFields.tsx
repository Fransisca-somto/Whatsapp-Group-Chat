"use client";

import { Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { suggestTemporaryPassword } from "@/lib/tempPassword";

export type PersonValues = { displayName: string; email: string; temporaryPassword: string };

/** Name, login email and temporary password: shared by Add staff and New owner. */
export function PersonFields({
  formId,
  values,
  onChange,
}: {
  formId: string;
  values: PersonValues;
  onChange: (values: PersonValues) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${formId}-name`}>Name</Label>
        <Input
          id={`${formId}-name`}
          value={values.displayName}
          onChange={(event) => onChange({ ...values, displayName: event.target.value })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${formId}-email`}>Login email</Label>
        <Input
          id={`${formId}-email`}
          type="email"
          autoComplete="off"
          value={values.email}
          onChange={(event) => onChange({ ...values, email: event.target.value })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${formId}-password`}>Temporary password</Label>
        <div className="flex gap-2">
          <Input
            id={`${formId}-password`}
            className="font-mono"
            autoComplete="off"
            value={values.temporaryPassword}
            onChange={(event) => onChange({ ...values, temporaryPassword: event.target.value })}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange({ ...values, temporaryPassword: suggestTemporaryPassword() })}
          >
            <Wand2 aria-hidden="true" />
            Suggest
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Share the email and this password with them privately. They change it from the menu at the
          top right after logging in.
        </p>
      </div>
    </>
  );
}

export const EMPTY_PERSON: PersonValues = { displayName: "", email: "", temporaryPassword: "" };
