export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type HabitFrequency =
  | { type: 'daily' }
  | { type: 'specific-days'; days: IsoWeekday[] };

export interface Habit {
  id: string;
  name: string;
  createdAt: string;
  frequency: HabitFrequency;
}
