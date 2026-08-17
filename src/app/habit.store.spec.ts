import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { HabitStore } from './habit.store';
import { HabitCompletion } from './models/habit-completion.model';
import { Habit } from './models/habit.model';
import { HabitStorage, HABIT_STORAGE } from './storage/habit-storage';

class FakeHabitStorage implements HabitStorage {
  habits: Habit[] = [];
  completions: HabitCompletion[] = [];
  failLoading = false;
  failSavingHabit = false;

  loadHabits(): Promise<Habit[]> {
    return this.failLoading
      ? Promise.reject(new Error('load failed'))
      : Promise.resolve([...this.habits]);
  }

  loadCompletions(): Promise<HabitCompletion[]> {
    return this.failLoading
      ? Promise.reject(new Error('load failed'))
      : Promise.resolve([...this.completions]);
  }

  saveHabit(habit: Habit): Promise<void> {
    if (this.failSavingHabit) {
      return Promise.reject(new Error('save failed'));
    }

    const existingIndex = this.habits.findIndex((item) => item.id === habit.id);
    existingIndex === -1 ? this.habits.push(habit) : (this.habits[existingIndex] = habit);
    return Promise.resolve();
  }

  deleteHabit(habitId: string): Promise<void> {
    this.habits = this.habits.filter((habit) => habit.id !== habitId);
    this.completions = this.completions.filter(
      (completion) => completion.habitId !== habitId,
    );
    return Promise.resolve();
  }

  saveCompletion(completion: HabitCompletion): Promise<boolean> {
    if (!this.habits.some((habit) => habit.id === completion.habitId)) {
      return Promise.resolve(false);
    }

    this.completions.push(completion);
    return Promise.resolve(true);
  }

  deleteCompletion(habitId: string, date: string): Promise<void> {
    this.completions = this.completions.filter(
      (completion) => completion.habitId !== habitId || completion.date !== date,
    );
    return Promise.resolve();
  }
}

describe('HabitStore', () => {
  let storage: FakeHabitStorage;
  let store: HabitStore;

  beforeEach(() => {
    storage = new FakeHabitStorage();
    TestBed.configureTestingModule({
      providers: [{ provide: HABIT_STORAGE, useValue: storage }],
    });
    store = TestBed.inject(HabitStore);
  });

  it('loads stored habits and completions during initialization', async () => {
    const habit: Habit = {
      id: 'habit-1',
      name: 'Beber agua',
      createdAt: '2026-08-17T08:00:00.000Z',
      frequency: { type: 'daily' },
    };
    const completion: HabitCompletion = {
      id: 'completion-1',
      habitId: habit.id,
      date: '2026-08-17',
      completedAt: '2026-08-17T09:00:00.000Z',
    };
    storage.habits = [habit];
    storage.completions = [completion];

    await store.initialize();

    expect(store.habits()).toEqual([habit]);
    expect(store.completions()).toEqual([completion]);
    expect(store.isInitialized()).toBe(true);
  });

  it('keeps initialization errors recoverable and supports retrying', async () => {
    storage.failLoading = true;

    await expect(store.initialize()).resolves.toBeUndefined();
    expect(store.isInitialized()).toBe(false);
    expect(store.initializationError()).toBeTruthy();

    storage.failLoading = false;
    await store.initialize();

    expect(store.isInitialized()).toBe(true);
    expect(store.initializationError()).toBeNull();
  });

  it('does not change state when saving a habit fails', async () => {
    await store.initialize();
    storage.failSavingHabit = true;

    expect(await store.createHabit('Caminar')).toBeNull();
    expect(store.habits()).toHaveLength(0);
    expect(store.operationError()).toBeTruthy();
  });

  it('creates, trims and persists a habit', async () => {
    await store.initialize();

    const habit = await store.createHabit('  Beber agua  ');

    expect(habit?.name).toBe('Beber agua');
    expect(storage.habits).toEqual([habit]);
    expect(store.habits()).toEqual([habit]);
  });

  it('creates daily habits and schedules them every day', async () => {
    await store.initialize();
    const habit = await store.createHabit('Leer', { type: 'daily' });

    expect(habit?.frequency).toEqual({ type: 'daily' });
    expect(store.isScheduledForDate(habit!, new Date(2026, 7, 17))).toBe(true);
    expect(store.isScheduledForDate(habit!, new Date(2026, 7, 23))).toBe(true);
  });

  it('normalizes specific weekdays and schedules only selected local days', async () => {
    await store.initialize();
    const habit = await store.createHabit('Entrenar', {
      type: 'specific-days',
      days: [5, 1, 3, 1],
    });

    expect(habit?.frequency).toEqual({ type: 'specific-days', days: [1, 3, 5] });
    expect(store.isScheduledForDate(habit!, new Date(2026, 7, 17))).toBe(true);
    expect(store.isScheduledForDate(habit!, new Date(2026, 7, 18))).toBe(false);
  });

  it('rejects a specific-days frequency without selected days', async () => {
    await store.initialize();
    const saveHabit = vi.spyOn(storage, 'saveHabit');

    expect(
      await store.createHabit('Entrenar', { type: 'specific-days', days: [] }),
    ).toBeNull();
    expect(saveHabit).not.toHaveBeenCalled();
  });

  it('rejects invalid habit names', async () => {
    await store.initialize();
    const saveHabit = vi.spyOn(storage, 'saveHabit');

    expect(await store.createHabit('   ')).toBeNull();
    expect(await store.createHabit('a'.repeat(101))).toBeNull();
    expect(saveHabit).not.toHaveBeenCalled();
  });

  it('edits a habit while preserving its identity and creation date', async () => {
    await store.initialize();
    const original = await store.createHabit('Caminar');

    const updated = await store.updateHabit(original!.id, '  Caminar 30 minutos  ', {
      type: 'specific-days',
      days: [5, 3, 3],
    });

    expect(updated).toEqual({
      id: original!.id,
      name: 'Caminar 30 minutos',
      createdAt: original!.createdAt,
      frequency: { type: 'specific-days', days: [3, 5] },
    });
    expect(storage.habits).toEqual([updated]);
  });

  it('allows only one pending toggle per habit', async () => {
    await store.initialize();
    const habit = await store.createHabit('Caminar');
    let resolveSave!: (saved: boolean) => void;
    const pendingSave = new Promise<boolean>((resolve) => (resolveSave = resolve));
    const saveCompletion = vi.spyOn(storage, 'saveCompletion').mockReturnValue(pendingSave);

    const firstToggle = store.toggleCompletedToday(habit!.id);
    const secondToggle = store.toggleCompletedToday(habit!.id);

    expect(store.isCompletionPending(habit!.id)).toBe(true);
    expect(saveCompletion).toHaveBeenCalledOnce();

    resolveSave(true);
    await Promise.all([firstToggle, secondToggle]);

    expect(store.completions()).toHaveLength(1);
    expect(store.isCompletionPending(habit!.id)).toBe(false);
  });

  it('does not persist a completion for a missing habit', async () => {
    await store.initialize();
    const saveCompletion = vi.spyOn(storage, 'saveCompletion');

    await store.toggleCompletedToday('missing-habit');

    expect(saveCompletion).not.toHaveBeenCalled();
    expect(store.completions()).toHaveLength(0);
  });

  it('does not complete a habit outside its scheduled day', async () => {
    await store.initialize();
    const today = (((new Date().getDay() + 6) % 7) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
    const otherDay = (today === 1 ? 2 : 1) as 1 | 2;
    const habit = await store.createHabit('Entrenar', {
      type: 'specific-days',
      days: [otherDay],
    });
    const saveCompletion = vi.spyOn(storage, 'saveCompletion');

    await store.toggleCompletedToday(habit!.id);

    expect(saveCompletion).not.toHaveBeenCalled();
    expect(store.isCompletedToday(habit!.id)).toBe(false);
  });

  it('allows unmarking after today is removed from the frequency', async () => {
    await store.initialize();
    const habit = await store.createHabit('Leer');
    await store.toggleCompletedToday(habit!.id);
    const today = (((new Date().getDay() + 6) % 7) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
    const otherDay = (today === 1 ? 2 : 1) as 1 | 2;

    const updated = await store.updateHabit(habit!.id, habit!.name, {
      type: 'specific-days',
      days: [otherDay],
    });
    expect(store.isScheduledToday(updated!)).toBe(false);

    await store.toggleCompletedToday(habit!.id);
    expect(store.isCompletedToday(habit!.id)).toBe(false);
  });

  it('toggles today completion on and off', async () => {
    await store.initialize();
    const habit = await store.createHabit('Leer');

    await store.toggleCompletedToday(habit!.id);
    expect(store.isCompletedToday(habit!.id)).toBe(true);

    await store.toggleCompletedToday(habit!.id);
    expect(store.isCompletedToday(habit!.id)).toBe(false);
  });

  it('deletes a habit and all its completions', async () => {
    await store.initialize();
    const habit = await store.createHabit('Leer');
    await store.toggleCompletedToday(habit!.id);

    expect(await store.deleteHabit(habit!.id)).toBe(true);
    expect(storage.habits).toHaveLength(0);
    expect(storage.completions).toHaveLength(0);
    expect(store.habits()).toHaveLength(0);
    expect(store.completions()).toHaveLength(0);
  });
});
