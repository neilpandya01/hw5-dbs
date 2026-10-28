import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "sm";

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90",
  secondary: "border border-control bg-surface text-ink hover:bg-bg",
  ghost: "text-accent hover:bg-accent-soft",
  danger: "text-danger hover:bg-bg",
};

const sizes: Record<Size, string> = {
  md: "min-h-11 px-4 text-sm",
  sm: "min-h-8 px-2.5 text-sm",
};

type Style = { variant?: Variant; size?: Size };

export function buttonClass({ variant = "primary", size = "md" }: Style = {}) {
  return `${base} ${variants[variant]} ${sizes[size]}`;
}

export function Button({ variant, size, className = "", type = "button", ...props }: ComponentProps<"button"> & Style) {
  return <button type={type} className={`${buttonClass({ variant, size })} ${className}`} {...props} />;
}

export function ButtonLink({ variant, size, className = "", ...props }: ComponentProps<typeof Link> & Style) {
  return <Link className={`${buttonClass({ variant, size })} ${className}`} {...props} />;
}
