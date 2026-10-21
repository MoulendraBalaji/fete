'use client';

import { useEffect, useRef, useState } from 'react';
import type { Plan } from '@/lib/schemas/plan';
import { summarizePlan } from '@/lib/domain/summary';
import { streamChat } from '@/lib/client/ai';
import { suggestedPromptsFor } from '@/lib/ai/prompts';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Callout } from '@/components/ui/Callout';
import { Rule } from '@/components/ui/Rule';
import styles from './ChatPanel.module.css';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** True when the answer did not come from the model. */
  standard?: boolean;
  pending?: boolean;
}

export interface ChatPanelProps {
  plan: Plan;
  todayIso: string;
}

/**
 * The planning assistant, streamed.
 *
 * Loaded via `next/dynamic` from its parent so none of this code (or the
 * streaming client) is in the initial bundle — the plan is fully usable without
 * ever opening the chat.
 *
 * The conversation is deliberately *not* persisted: it is a scratchpad. Each
 * question re-sends a freshly built digest of the current plan, so answers
 * always reflect the user's latest edits rather than a stale snapshot.
 */
export function ChatPanel({ plan, todayIso }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLOListElement | null>(null);
  const suggestions = suggestedPromptsFor(plan.brief.eventType);

  // Cancel an in-flight stream if the panel unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Keep the newest message in view as tokens arrive.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;

    setError(null);
    setDraft('');
    setBusy(true);

    const assistantId = `a-${Date.now().toString(36)}`;
    setMessages((current) => [
      ...current,
      { id: `u-${Date.now().toString(36)}`, role: 'user', text: question },
      { id: assistantId, role: 'assistant', text: '', pending: true },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    // Rebuilt every turn so the answer reflects the plan as it stands now.
    const context = summarizePlan(plan, todayIso);

    try {
      let standard = false;
      for await (const chunk of streamChat(question, context, { signal: controller.signal })) {
        standard = chunk.standard;
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? { ...message, text: message.text + chunk.delta, standard, pending: true }
              : message,
          ),
        );
      }
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, pending: false, standard } : message,
        ),
      );
    } catch (caught) {
      const aborted = caught instanceof DOMException && caught.name === 'AbortError';
      if (!aborted) {
        setError('The assistant could not answer just now. Try again in a moment.');
        setMessages((current) => current.filter((message) => message.id !== assistantId));
      } else {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, pending: false } : message,
          ),
        );
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <Sheet className={styles.panel}>
      <header className={styles.head}>
        <div>
          <h3 className={styles.title}>Ask the planner</h3>
          <p className={styles.sub}>
            Every answer is written against your current brief, ledger and roster.
          </p>
        </div>
        {busy ? (
          <Button size="sm" variant="ghost" onClick={stop}>
            Stop
          </Button>
        ) : null}
      </header>

      <div className={styles.thread} aria-label="Conversation" role="log" aria-live="polite">
        {messages.length === 0 ? (
          <div className={styles.starter}>
            <p className={styles.starterLead}>Not sure where to start? Try one of these:</p>
            <div className={styles.suggestions}>
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className={styles.suggestion}
                  onClick={() => void send(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className={styles.log} ref={logRef}>
            {messages.map((message) => (
              <li
                key={message.id}
                className={message.role === 'user' ? styles.userTurn : styles.aiTurn}
              >
                <p className={styles.turnLabel}>{message.role === 'user' ? 'You' : 'Planner'}</p>
                <p className={styles.turnText}>
                  {message.text}
                  {message.pending && !message.text ? (
                    <span className={styles.typing} aria-label="Thinking">
                      ···
                    </span>
                  ) : null}
                </p>
                {message.standard && !message.pending ? (
                  <p className={styles.standardNote}>
                    Standard answer — the model was unavailable.
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>

      {error ? (
        <Callout tone="warn" live="polite">
          {error}
        </Callout>
      ) : null}

      <Rule />

      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <label className="srOnly" htmlFor="chat-input">
          Your question
        </label>
        <textarea
          id="chat-input"
          className={styles.input}
          rows={2}
          maxLength={1000}
          placeholder="e.g. Where can I save money without hurting the guest experience?"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send(draft);
            }
          }}
        />
        <Button type="submit" variant="primary" busy={busy} disabled={draft.trim().length === 0}>
          Send
        </Button>
      </form>

      <p className={styles.privacy}>
        Your question and a summary of the plan are sent to the configured model. Nothing is stored
        on a server.
      </p>
    </Sheet>
  );
}

export default ChatPanel;
