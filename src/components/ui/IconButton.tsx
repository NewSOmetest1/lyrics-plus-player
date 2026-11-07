import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: "ghost" | "soft" | "solid" | "accent";
  size?: "sm" | "md" | "lg";
  active?: boolean;
  children: ReactNode;
}

const sizes = {
  sm: "h-7 w-7",
  md: "h-9 w-9",
  lg: "h-11 w-11",
};

const variants = {
  ghost: "text-white/60 hover:bg-white/[0.08] hover:text-white",
  soft: "bg-white/[0.06] text-white/75 hover:bg-white/[0.12] hover:text-white",
  solid: "bg-white text-black hover:scale-105",
  accent: "bg-accent text-black hover:brightness-110",
};

export function IconButton({
  label,
  variant = "ghost",
  size = "md",
  active = false,
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent/70 disabled:pointer-events-none disabled:opacity-35",
        sizes[size],
        variants[variant],
        active && "text-accent",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
