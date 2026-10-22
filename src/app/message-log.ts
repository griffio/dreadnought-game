export type MessageTone = 'info' | 'good' | 'warn' | 'alert' | 'critical';

export interface LogMessage {
  tone: MessageTone;
  text: string;
  /** Simulation time it was posted, seconds. */
  at: number;
}

/**
 * The ship's log of what is happening: the spotter's calls, damage reports, the enemy's moves. Messages fade by
 * simulation time, so a paused game keeps them on the screen.
 */
export class MessageLog {
  private readonly items: LogMessage[] = [];
  /** Seconds a message stays up. */
  ttl = 14;

  push(tone: MessageTone, text: string, at: number): void {
    // The same call twice running is noise, not news.
    const last = this.items[this.items.length - 1];
    if (last && last.text === text && at - last.at < 4) {
      last.at = at;
      return;
    }
    this.items.push({ tone, text, at });
    if (this.items.length > 40) this.items.shift();
  }

  /** The messages still showing, oldest first, at most `limit` of them. */
  recent(now: number, limit = 7): LogMessage[] {
    return this.items.filter((m) => now - m.at < this.ttl).slice(-limit);
  }

  all(): readonly LogMessage[] {
    return this.items;
  }
}
