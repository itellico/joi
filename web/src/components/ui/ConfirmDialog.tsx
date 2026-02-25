import { useState } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { Row } from "./Row";
import { Stack } from "./Stack";

export interface ConfirmAction {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  onConfirm: () => void | Promise<void>;
}

interface ConfirmDialogProps {
  action: ConfirmAction | null;
  onClose: () => void;
}

export function ConfirmDialog({ action, onClose }: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false);

  if (!action) return null;

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await action.onConfirm();
    } finally {
      setLoading(false);
      onClose();
    }
  };

  return (
    <Modal open onClose={onClose} title={action.title} width={400}>
      <Stack gap={4}>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
          {action.message}
        </p>
        <Row justify="end" gap={2}>
          <Button onClick={onClose} disabled={loading}>
            {action.cancelLabel || "Cancel"}
          </Button>
          <Button
            variant={action.variant || "danger"}
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? "..." : (action.confirmLabel || "Delete")}
          </Button>
        </Row>
      </Stack>
    </Modal>
  );
}
