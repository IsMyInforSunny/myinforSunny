'use client';

import {useEffect, useId, useRef, type ReactNode} from 'react';
import {X} from 'lucide-react';

export default function ReviewSection({open, title, onClose, children}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open) {
      heading.current?.focus({preventScroll: true});
      heading.current?.scrollIntoView({behavior: 'smooth', block: 'start'});
    }
  }, [open]);
  return <section hidden={!open} className="studio-detail-section" aria-labelledby={titleId}>
    <header className="studio-detail-heading">
      <h2 id={titleId} ref={heading} tabIndex={-1}>{title}</h2>
      <button type="button" className="small-button" onClick={onClose} aria-label="분석 화면으로 돌아가기"><X size={18}/> 분석 화면으로</button>
    </header>
    <div className="studio-detail-content">{children}</div>
  </section>;
}
