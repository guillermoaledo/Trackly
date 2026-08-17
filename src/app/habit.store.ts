import { inject, Injectable, signal } from '@angular/core';

import { HabitCompletion } from './models/habit-completion.model';
import { Habit, HabitFrequency, IsoWeekday } from './models/habit.model';
import { HABIT_STORAGE } from './storage/habit-storage';

const STORAGE_ERROR_MESSAGE = 'No se han podido guardar los cambios. Inténtalo de nuevo.';
const WEEKDAY_LABELS: Record<IsoWeekday, string> = {
  1: 'lun',
  2: 'mar',
  3: 'mié',
  4: 'jue',
  5: 'vie',
  6: 'sáb',
  7: 'dom',
};

@Injectable({ providedIn: 'root' })
export class HabitStore {
  private readonly storage = inject(HABIT_STORAGE);
  private readonly habitState = signal<Habit[]>([]);
  private readonly completionState = signal<HabitCompletion[]>([]);
  private readonly initializedState = signal(false);
  private readonly initializingState = signal(false);
  private readonly initializationErrorState = signal<string | null>(null);
  private readonly operationErrorState = signal<string | null>(null);
  private readonly pendingCompletionState = signal<ReadonlySet<string>>(new Set());
  private initializationPromise: Promise<void> | null = null;

  readonly habits = this.habitState.asReadonly();
  readonly completions = this.completionState.asReadonly();
  readonly isInitialized = this.initializedState.asReadonly();
  readonly isInitializing = this.initializingState.asReadonly();
  readonly initializationError = this.initializationErrorState.asReadonly();
  readonly operationError = this.operationErrorState.asReadonly();

  initialize(): Promise<void> {
    if (this.initializedState()) {
      return Promise.resolve();
    }

    if (!this.initializationPromise) {
      this.initializationPromise = this.loadInitialData().finally(() => {
        this.initializationPromise = null;
      });
    }

    return this.initializationPromise;
  }

  async createHabit(
    name: string,
    frequency: HabitFrequency = { type: 'daily' },
  ): Promise<Habit | null> {
    const normalizedName = this.normalizeName(name);
    const normalizedFrequency = this.normalizeFrequency(frequency);

    if (!normalizedName || !normalizedFrequency || !this.canWrite()) {
      return null;
    }

    const habit: Habit = {
      id: crypto.randomUUID(),
      name: normalizedName,
      createdAt: new Date().toISOString(),
      frequency: normalizedFrequency,
    };

    try {
      await this.storage.saveHabit(habit);
      this.habitState.update((habits) => [...habits, habit]);
      return habit;
    } catch {
      this.setOperationError();
      return null;
    }
  }

  async updateHabit(
    habitId: string,
    name: string,
    frequency?: HabitFrequency,
  ): Promise<Habit | null> {
    const normalizedName = this.normalizeName(name);
    const currentHabit = this.habitState().find((habit) => habit.id === habitId);
    const normalizedFrequency = currentHabit
      ? this.normalizeFrequency(frequency ?? currentHabit.frequency)
      : null;

    if (!normalizedName || !normalizedFrequency || !currentHabit || !this.canWrite()) {
      return null;
    }

    const updatedHabit: Habit = {
      ...currentHabit,
      name: normalizedName,
      frequency: normalizedFrequency,
    };

    try {
      await this.storage.saveHabit(updatedHabit);
      this.habitState.update((habits) =>
        habits.map((habit) => (habit.id === habitId ? updatedHabit : habit)),
      );
      return updatedHabit;
    } catch {
      this.setOperationError();
      return null;
    }
  }

  async deleteHabit(habitId: string): Promise<boolean> {
    if (!this.canWrite()) {
      return false;
    }

    try {
      await this.storage.deleteHabit(habitId);
      this.habitState.update((habits) => habits.filter((habit) => habit.id !== habitId));
      this.completionState.update((completions) =>
        completions.filter((completion) => completion.habitId !== habitId),
      );
      return true;
    } catch {
      this.setOperationError();
      return false;
    }
  }

  isCompletedToday(habitId: string): boolean {
    const today = this.getLocalDate();
    return this.completionState().some(
      (completion) => completion.habitId === habitId && completion.date === today,
    );
  }

  isCompletionPending(habitId: string): boolean {
    return this.pendingCompletionState().has(habitId);
  }

  isScheduledToday(habit: Habit): boolean {
    return this.isScheduledForDate(habit, new Date());
  }

  isScheduledForDate(habit: Habit, date: Date): boolean {
    if (habit.frequency.type === 'daily') {
      return true;
    }

    const isoWeekday = (((date.getDay() + 6) % 7) + 1) as IsoWeekday;
    return habit.frequency.days.includes(isoWeekday);
  }

  canToggleToday(habit: Habit): boolean {
    return this.isCompletedToday(habit.id) || this.isScheduledToday(habit);
  }

  getFrequencyLabel(habit: Habit): string {
    if (habit.frequency.type === 'daily') {
      return 'Todos los días';
    }

    const labels = habit.frequency.days.map((day) => WEEKDAY_LABELS[day]);

    if (labels.length === 1) {
      return labels[0];
    }

    return `${labels.slice(0, -1).join(', ')} y ${labels.at(-1)}`;
  }

  async toggleCompletedToday(habitId: string): Promise<void> {
    if (
      !this.canWrite() ||
      this.isCompletionPending(habitId) ||
      !this.habitState().some((habit) => habit.id === habitId)
    ) {
      return;
    }

    this.setCompletionPending(habitId, true);

    try {
      const habit = this.habitState().find((item) => item.id === habitId)!;

      if (this.isCompletedToday(habitId)) {
        await this.unmarkCompletedToday(habitId);
      } else if (this.isScheduledToday(habit)) {
        await this.markCompletedToday(habitId);
      }
    } catch {
      this.setOperationError();
    } finally {
      this.setCompletionPending(habitId, false);
    }
  }

  clearOperationError(): void {
    this.operationErrorState.set(null);
  }

  private async markCompletedToday(habitId: string): Promise<void> {
    const completion: HabitCompletion = {
      id: crypto.randomUUID(),
      habitId,
      date: this.getLocalDate(),
      completedAt: new Date().toISOString(),
    };
    const saved = await this.storage.saveCompletion(completion);

    if (saved) {
      this.completionState.update((completions) => [...completions, completion]);
    }
  }

  private async unmarkCompletedToday(habitId: string): Promise<void> {
    const today = this.getLocalDate();
    await this.storage.deleteCompletion(habitId, today);
    this.completionState.update((completions) =>
      completions.filter(
        (completion) => completion.habitId !== habitId || completion.date !== today,
      ),
    );
  }

  private async loadInitialData(): Promise<void> {
    this.initializingState.set(true);
    this.initializationErrorState.set(null);
    this.operationErrorState.set(null);

    try {
      const [habits, completions] = await Promise.all([
        this.storage.loadHabits(),
        this.storage.loadCompletions(),
      ]);
      const habitIds = new Set(habits.map((habit) => habit.id));

      this.habitState.set(habits);
      this.completionState.set(
        completions.filter((completion) => habitIds.has(completion.habitId)),
      );
      this.initializedState.set(true);
    } catch {
      this.initializedState.set(false);
      this.initializationErrorState.set(
        'No se ha podido acceder al almacenamiento local de Trackly.',
      );
    } finally {
      this.initializingState.set(false);
    }
  }

  private canWrite(): boolean {
    if (!this.initializedState()) {
      return false;
    }

    this.operationErrorState.set(null);
    return true;
  }

  private setOperationError(): void {
    this.operationErrorState.set(STORAGE_ERROR_MESSAGE);
  }

  private setCompletionPending(habitId: string, pending: boolean): void {
    this.pendingCompletionState.update((current) => {
      const next = new Set(current);
      pending ? next.add(habitId) : next.delete(habitId);
      return next;
    });
  }

  private getLocalDate(date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private normalizeName(name: string): string | null {
    const normalizedName = name.trim();
    return normalizedName && normalizedName.length <= 100 ? normalizedName : null;
  }

  private normalizeFrequency(frequency: HabitFrequency): HabitFrequency | null {
    if (frequency.type === 'daily') {
      return { type: 'daily' };
    }

    const days = [...new Set(frequency.days)]
      .filter((day): day is IsoWeekday => Number.isInteger(day) && day >= 1 && day <= 7)
      .sort((first, second) => first - second);

    return days.length > 0 ? { type: 'specific-days', days } : null;
  }
}
