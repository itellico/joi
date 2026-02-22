import type { ReactNode } from "react";
import * as RadixTabs from "@radix-ui/react-tabs";

interface Tab {
  value: string;
  label: ReactNode;
  content: ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  value?: string;
  onValueChange?: (value: string) => void;
  defaultValue?: string;
}

export function Tabs({ tabs, value, onValueChange, defaultValue }: TabsProps) {
  return (
    <RadixTabs.Root
      value={value}
      onValueChange={onValueChange}
      defaultValue={defaultValue || tabs[0]?.value}
    >
      <RadixTabs.List className="ui-tabs-list">
        {tabs.map((tab) => (
          <RadixTabs.Trigger key={tab.value} value={tab.value} className="ui-tabs-trigger">
            {tab.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {tabs.map((tab) => (
        <RadixTabs.Content key={tab.value} value={tab.value} className="ui-tabs-content">
          {tab.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
