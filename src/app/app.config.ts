import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { HabitStore } from './habit.store';
import { HABIT_STORAGE } from './storage/habit-storage';
import { IndexedDbHabitStorage } from './storage/indexed-db-habit-storage';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    IndexedDbHabitStorage,
    { provide: HABIT_STORAGE, useExisting: IndexedDbHabitStorage },
    provideAppInitializer(() => inject(HabitStore).initialize()),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
