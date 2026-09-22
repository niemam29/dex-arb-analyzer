import type { ButtonHTMLAttributes } from "react";

// Przycisk: primary (akcent), secondary (biały z ramką), ghost (bez tła). `type="button"`
// domyślnie — formularze podają `type="submit"` jawnie.

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ variant = "secondary", size = "md", className, type = "button", ...rest }: ButtonProps) {
  const cls = ["btn", `btn--${variant}`, `btn--${size}`, className ?? ""].filter(Boolean).join(" ");
  return <button type={type} className={cls} {...rest} />;
}
