'use client';

import {useEffect, useId, useRef} from 'react';
import type {ReactNode} from 'react';
import {X} from 'lucide-react';

export default function ReviewDialog({open, title, onClose, children}: {
  open: boolean; title: string; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className="canva-dialog" aria-labelledby={titleId}
    onCancel={event => {event.preventDefault(); onClose();}}
    onClick={event => {if (event.target === event.currentTarget) onClose();}}>
    <header className="canva-dialog-heading"><h2 id={titleId}>{title}</h2>
      <button type="button" className="canva-dialog-close" onClick={onClose} aria-label="창 닫기"><X size={23}/></button>
    </header>
    <div className="canva-dialog-content">{children}</div>
  </dialog>;
}
