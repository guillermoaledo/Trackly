import { InjectionToken } from '@angular/core';

import { HabitCompletion } from '../models/habit-completion.model';
import { Habit } from '../models/habit.model';

export interface HabitStorage {
  loadHabits(): Promise<Habit[]>;
  loadCompletions(): Promise<HabitCompletion[]>;
  saveHabit(habit: Habit): Promise<void>;
  deleteHabit(habitId: string): Promise<void>;
  saveCompletion(completion: HabitCompletion): Promise<boolean>;
  deleteCompletion(habitId: string, date: string): Promise<void>;
}

export const HABIT_STORAGE = new InjectionToken<HabitStorage>('HABIT_STORAGE');
