import { withDefaultHabitFrequency } from './indexed-db-habit-storage';

describe('IndexedDbHabitStorage migration', () => {
  it('migrates a legacy habit to daily without losing fields', () => {
    const legacyHabit = {
      id: 'habit-1',
      name: 'Beber agua',
      createdAt: '2026-08-17T08:00:00.000Z',
    };

    expect(withDefaultHabitFrequency(legacyHabit)).toEqual({
      ...legacyHabit,
      frequency: { type: 'daily' },
    });
  });

  it('preserves an existing specific-days frequency', () => {
    const habit = {
      id: 'habit-2',
      name: 'Entrenar',
      createdAt: '2026-08-17T08:00:00.000Z',
      frequency: { type: 'specific-days' as const, days: [1, 3, 5] as [1, 3, 5] },
    };

    expect(withDefaultHabitFrequency(habit)).toEqual(habit);
  });
});
