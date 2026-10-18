import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

// Hand-written to match shadcn/ui's Base UI input (ADR-022).
type InputProps = Omit<InputPrimitive.Props, "className"> & { className?: string };

function Input({ className, type, ...props }: InputProps) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-surface px-3 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
