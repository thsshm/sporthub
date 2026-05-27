/**
 * Composant DropdownMenu minimal (sans Radix UI pour le scaffold).
 * Implémentation simplifiée — remplacer par `pnpm dlx shadcn add dropdown-menu`
 * une fois les packages installés (nécessite @radix-ui/react-dropdown-menu).
 *
 * Cette version utilise uniquement l'état React + positionnement CSS.
 */
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type DropdownMenuContextType = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const DropdownMenuContext = React.createContext<DropdownMenuContextType>({
  open: false,
  setOpen: () => {},
});

function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);

  // Ferme le menu si on clique ailleurs
  React.useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [open]);

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen }}>
      <div className="relative inline-block">{children}</div>
    </DropdownMenuContext.Provider>
  );
}

function DropdownMenuTrigger({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { open, setOpen } = React.useContext(DropdownMenuContext);
  return (
    <button
      className={cn("outline-none", className)}
      onClick={(e) => {
        e.stopPropagation();
        setOpen(!open);
      }}
      aria-haspopup="menu"
      aria-expanded={open}
      {...props}
    >
      {children}
    </button>
  );
}

function DropdownMenuContent({
  children,
  className,
  align = "start",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { align?: "start" | "end" }) {
  const { open } = React.useContext(DropdownMenuContext);
  if (!open) return null;

  return (
    <div
      role="menu"
      className={cn(
        "absolute z-50 mt-1 min-w-[8rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        align === "end" ? "right-0" : "left-0",
        className
      )}
      onClick={(e) => e.stopPropagation()}
      {...props}
    >
      {children}
    </div>
  );
}

function DropdownMenuItem({
  children,
  className,
  onSelect,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { onSelect?: () => void }) {
  const { setOpen } = React.useContext(DropdownMenuContext);
  return (
    <div
      role="menuitem"
      tabIndex={0}
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
        className
      )}
      onClick={() => {
        onSelect?.();
        setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          onSelect?.();
          setOpen(false);
        }
      }}
      {...props}
    >
      {children}
    </div>
  );
}

function DropdownMenuSeparator({ className, ...props }: React.HTMLAttributes<HTMLHRElement>) {
  return <hr className={cn("-mx-1 my-1 border-border", className)} {...props} />;
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
};
