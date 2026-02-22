import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger" | "accent";
  size?: "sm" | "md";
}

export function Button({ variant = "ghost", size = "md", className = "", ...props }: ButtonProps) {
  const base = variant === "primary"
    ? "btn-primary"
    : variant === "danger"
    ? "btn-small ui-btn-danger"
    : variant === "accent"
    ? "btn-accent"
    : "btn-small";

  const sizeClass = size === "sm" ? "ui-btn-sm" : "";

  return (
    <button
      className={`${base} ${sizeClass} ${className}`.trim()}
      {...props}
    />
  );
}
