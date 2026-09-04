'use client';

import { Check, MessageSquareMore, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type ManualReviewDecision = {
  decision: 'approve' | 'return';
  reason?: string;
  source?: 'human' | 'timeout';
};

export function ManualReviewActions({
  onReview,
  disabled = false,
  compact = false,
}: {
  onReview: (decision: ManualReviewDecision) => void | Promise<void>;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(7);
  const [autoSubmitted, setAutoSubmitted] = useState(false);
  const submitRef = useRef<((decision: ManualReviewDecision['decision'], source?: ManualReviewDecision['source']) => Promise<void>) | undefined>(undefined);
  const busy = disabled || submitting || submitted;

  const submit = async (decision: ManualReviewDecision['decision'], source: ManualReviewDecision['source'] = 'human') => {
    if (busy) return;
    setSubmitted(true);
    setSubmitting(true);
    try {
      await onReview({
        decision,
        reason: reason.trim() || undefined,
        source,
      });
      if (decision === 'approve') setReason('');
    } finally {
      setSubmitting(false);
    }
  };

  submitRef.current = submit;

  useEffect(() => {
    if (busy || autoSubmitted || submitted) return;
    setSecondsRemaining(7);
    const interval = window.setInterval(() => {
      setSecondsRemaining((current) => Math.max(0, current - 1));
    }, 1000);
    const timeout = window.setTimeout(() => {
      setAutoSubmitted(true);
      void submitRef.current?.('approve', 'timeout');
    }, 7000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [autoSubmitted, busy, submitted]);

  return (
    <section className={`manual-review${compact ? ' manual-review--compact' : ''}`} aria-label="人工复核操作">
      <div className="manual-review__heading">
        <span className="manual-review__icon"><MessageSquareMore size={15} /></span>
        <div><strong>请复核当前预案</strong><p>确认现有证据后，选择继续处理或退回补充。{!busy && !autoSubmitted && <span> {secondsRemaining} 秒无操作将自动继续。</span>}{autoSubmitted && <span> 系统已按超时策略继续，不再重复自动提交。</span>}</p></div>
      </div>
      <label className="manual-review__field">
        <span>退回说明（可选）</span>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} placeholder="例如：请补充七层防火分区" rows={compact ? 2 : 3} />
      </label>
      <div className="manual-review__actions">
        <button type="button" className="button button--return" onClick={() => void submit('return')} disabled={busy}>
          <RotateCcw size={14} />退回补充信息
        </button>
        <button type="button" className="button button--approve" onClick={() => void submit('approve')} disabled={busy}>
          <Check size={14} />复核通过，进入下一步
        </button>
      </div>
    </section>
  );
}
