import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  width?: number | string;
  children: ReactNode;
}

export function Modal({ open, onClose, title, width, children }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-overlay" />
        <Dialog.Content
          className="ui-dialog-content"
          style={width ? { width: typeof width === "number" ? `${width}px` : width } : undefined}
        >
          {title && <Dialog.Title className="ui-dialog-title">{title}</Dialog.Title>}
          <Dialog.Close asChild>
            <button className="ui-dialog-close" aria-label="Close">{"\u2715"}</button>
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
