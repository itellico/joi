import type { ReactNode } from "react";
import * as RadixCollapsible from "@radix-ui/react-collapsible";

interface CollapsibleProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
}

export function Collapsible({ open, onOpenChange, trigger, children }: CollapsibleProps) {
  return (
    <RadixCollapsible.Root open={open} onOpenChange={onOpenChange}>
      <RadixCollapsible.Trigger asChild className="ui-collapsible-trigger">
        {trigger}
      </RadixCollapsible.Trigger>
      <RadixCollapsible.Content>
        {children}
      </RadixCollapsible.Content>
    </RadixCollapsible.Root>
  );
}
