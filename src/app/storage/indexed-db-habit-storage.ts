import { Injectable } from '@angular/core';

import { HabitCompletion } from '../models/habit-completion.model';
import { Habit, HabitFrequency } from '../models/habit.model';
import { HabitStorage } from './habit-storage';

const DATABASE_NAME = 'trackly';
const DATABASE_VERSION = 3;
const HABIT_STORE = 'habits';
const COMPLETION_STORE = 'habit-completions';
const HABIT_DATE_INDEX = 'by-habit-date';
const HABIT_INDEX = 'by-habit';

type StoredHabit = Omit<Habit, 'frequency'> & { frequency?: HabitFrequency };

export function withDefaultHabitFrequency(habit: StoredHabit): Habit {
  return {
    ...habit,
    frequency: habit.frequency ?? { type: 'daily' },
  };
}

@Injectable()
export class IndexedDbHabitStorage implements HabitStorage {
  private databasePromise: Promise<IDBDatabase> | null = null;

  async loadHabits(): Promise<Habit[]> {
    const database = await this.getDatabase();
    const transaction = database.transaction(HABIT_STORE, 'readonly');
    const habits = await this.requestToPromise<StoredHabit[]>(
      transaction.objectStore(HABIT_STORE).getAll(),
    );
    return habits.map(withDefaultHabitFrequency);
  }

  async loadCompletions(): Promise<HabitCompletion[]> {
    const database = await this.getDatabase();
    const transaction = database.transaction(COMPLETION_STORE, 'readonly');
    return this.requestToPromise<HabitCompletion[]>(
      transaction.objectStore(COMPLETION_STORE).getAll(),
    );
  }

  async saveHabit(habit: Habit): Promise<void> {
    const database = await this.getDatabase();
    const transaction = database.transaction(HABIT_STORE, 'readwrite');
    const completed = this.transactionToPromise(transaction);
    transaction.objectStore(HABIT_STORE).put(habit);
    await completed;
  }

  async deleteHabit(habitId: string): Promise<void> {
    const database = await this.getDatabase();
    const transaction = database.transaction([HABIT_STORE, COMPLETION_STORE], 'readwrite');
    const completed = this.transactionToPromise(transaction);
    transaction.objectStore(HABIT_STORE).delete(habitId);

    const completionStore = transaction.objectStore(COMPLETION_STORE);
    const cursorRequest = completionStore.index(HABIT_INDEX).openKeyCursor(habitId);
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;

      if (cursor) {
        completionStore.delete(cursor.primaryKey);
        cursor.continue();
      }
    };

    await completed;
  }

  async saveCompletion(completion: HabitCompletion): Promise<boolean> {
    const database = await this.getDatabase();
    const transaction = database.transaction([HABIT_STORE, COMPLETION_STORE], 'readwrite');
    const completed = this.transactionToPromise(transaction);
    const habitExists = await this.requestToPromise<IDBValidKey | undefined>(
      transaction.objectStore(HABIT_STORE).getKey(completion.habitId),
    );

    if (habitExists === undefined) {
      await completed;
      return false;
    }

    const completionStore = transaction.objectStore(COMPLETION_STORE);
    const existingId = await this.requestToPromise<IDBValidKey | undefined>(
      completionStore.index(HABIT_DATE_INDEX).getKey([completion.habitId, completion.date]),
    );

    if (existingId !== undefined && existingId !== completion.id) {
      await completed;
      return false;
    }

    completionStore.put(completion);
    await completed;
    return true;
  }

  async deleteCompletion(habitId: string, date: string): Promise<void> {
    const database = await this.getDatabase();
    const transaction = database.transaction(COMPLETION_STORE, 'readwrite');
    const completed = this.transactionToPromise(transaction);
    const store = transaction.objectStore(COMPLETION_STORE);
    const completionId = await this.requestToPromise<IDBValidKey | undefined>(
      store.index(HABIT_DATE_INDEX).getKey([habitId, date]),
    );

    if (completionId !== undefined) {
      store.delete(completionId);
    }

    await completed;
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

      request.onupgradeneeded = (event) => {
        const database = request.result;
        const upgradeTransaction = request.transaction!;

        if (!database.objectStoreNames.contains(HABIT_STORE)) {
          database.createObjectStore(HABIT_STORE, { keyPath: 'id' });
        }

        if ((event as IDBVersionChangeEvent).oldVersion < 3) {
          const habitStore = upgradeTransaction.objectStore(HABIT_STORE);
          const cursorRequest = habitStore.openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;

            if (cursor) {
              const habit = cursor.value as StoredHabit;

              if (!habit.frequency) {
                cursor.update(withDefaultHabitFrequency(habit));
              }

              cursor.continue();
            }
          };
        }

        let completionStore: IDBObjectStore;

        if (!database.objectStoreNames.contains(COMPLETION_STORE)) {
          completionStore = database.createObjectStore(COMPLETION_STORE, {
            keyPath: 'id',
          });
        } else {
          completionStore = upgradeTransaction.objectStore(COMPLETION_STORE);
        }

        if (!completionStore.indexNames.contains(HABIT_DATE_INDEX)) {
          completionStore.createIndex(HABIT_DATE_INDEX, ['habitId', 'date'], { unique: true });
        }

        if (!completionStore.indexNames.contains(HABIT_INDEX)) {
          completionStore.createIndex(HABIT_INDEX, 'habitId');
        }
      };

      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('No se pudo actualizar la base de datos de Trackly.'));
    });
  }

  private getDatabase(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = this.openDatabase().catch((error: unknown) => {
        this.databasePromise = null;
        throw error;
      });
    }

    return this.databasePromise;
  }

  private requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private transactionToPromise(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
}
