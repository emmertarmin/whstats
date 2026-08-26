export interface DateRange {
  readonly from: string;
  readonly to: string;
}

export type PresenceClockValue = 0 | 1;

export interface RawPresenceEvent {
  readonly eventTime: string;
  readonly clock: PresenceClockValue;
}

export type PresenceAnomalyKind =
  | "duplicate-start"
  | "duplicate-stop"
  | "orphan-stop"
  | "boundary-open"
  | "inferred-close";

export interface PresenceAnomaly {
  readonly kind: PresenceAnomalyKind;
  readonly at: string;
  readonly message: string;
}

export interface PresenceSession {
  readonly startedAt: string;
  readonly endedAt: string;
  readonly startInstant: string;
  readonly endInstant: string;
  readonly runningAtNow: boolean;
  readonly inferredEnd: boolean;
}

export interface PresenceDay {
  readonly date: string;
  readonly hours: number;
  readonly inProgress: boolean;
  readonly sessions: readonly PresenceSession[];
  readonly anomalies: readonly PresenceAnomaly[];
}

export interface PresenceResult {
  readonly days: readonly PresenceDay[];
  readonly serverNow: string;
  readonly currentDate: string;
  readonly running: boolean;
  readonly anomalies: readonly PresenceAnomaly[];
}

export interface PresenceGateway {
  listPresence(range: DateRange): Promise<PresenceResult>;
}
