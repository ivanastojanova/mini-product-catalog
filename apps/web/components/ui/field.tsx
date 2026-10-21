import * as React from "react"
import { Field as FieldPrimitive } from "@base-ui/react/field"

import { cn } from "@/lib/utils"

/** Groups a label, control, and error/description for one form field. Renders a `<div>`. */
function Field({ className, ...props }: FieldPrimitive.Root.Props) {
  return (
    <FieldPrimitive.Root
      data-slot="field"
      className={cn("flex w-full flex-col gap-1.5", className)}
      {...props}
    />
  )
}

/** Accessible label, auto-associated with the field's control via Base UI. Renders a `<label>`. */
function FieldLabel({ className, ...props }: FieldPrimitive.Label.Props) {
  return (
    <FieldPrimitive.Label
      data-slot="field-label"
      className={cn("text-sm font-medium leading-none", className)}
      {...props}
    />
  )
}

/** Helper text below the control, shown when there's no error. Renders a `<p>`. */
function FieldDescription({
  className,
  ...props
}: FieldPrimitive.Description.Props) {
  return (
    <FieldPrimitive.Description
      data-slot="field-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

/** Validation error message, only rendered while the field is actually invalid. Renders a `<div>`. */
function FieldError({ className, ...props }: FieldPrimitive.Error.Props) {
  return (
    <FieldPrimitive.Error
      data-slot="field-error"
      className={cn("text-sm font-normal text-destructive", className)}
      {...props}
    />
  )
}

export { Field, FieldLabel, FieldDescription, FieldError }
