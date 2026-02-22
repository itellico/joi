import * as RadixSwitch from "@radix-ui/react-switch";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export function Switch({ checked, onCheckedChange, disabled, label }: SwitchProps) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", cursor: disabled ? "not-allowed" : "pointer" }}>
      <RadixSwitch.Root
        className="ui-switch"
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      >
        <RadixSwitch.Thumb className="ui-switch-thumb" />
      </RadixSwitch.Root>
      {label && <span style={{ fontSize: "var(--text-base)", color: "var(--text-secondary)" }}>{label}</span>}
    </label>
  );
}
