import { TestBed } from '@angular/core/testing';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { vi } from 'vitest';

import { App } from './app';
import { HabitStore } from './habit.store';
import { HabitStorage, HABIT_STORAGE } from './storage/habit-storage';

const storageStub: HabitStorage = {
  loadHabits: vi.fn(() => Promise.resolve([])),
  loadCompletions: vi.fn(() => Promise.resolve([])),
  saveHabit: vi.fn(() => Promise.resolve()),
  deleteHabit: vi.fn(() => Promise.resolve()),
  saveCompletion: vi.fn(() => Promise.resolve(true)),
  deleteCompletion: vi.fn(() => Promise.resolve()),
};

describe('App', () => {
  let versionUpdates: Subject<VersionReadyEvent>;

  beforeEach(async () => {
    vi.clearAllMocks();
    versionUpdates = new Subject<VersionReadyEvent>();
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value(this: HTMLDialogElement): void {
        this.setAttribute('open', '');
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value(this: HTMLDialogElement): void {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      },
    });

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: HABIT_STORAGE, useValue: storageStub },
        {
          provide: SwUpdate,
          useValue: { isEnabled: true, versionUpdates: versionUpdates.asObservable() },
        },
      ],
    }).compileComponents();
  });

  it('creates the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('shows a discreet notice when a service worker update is ready', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.update-notice')).toBeNull();

    versionUpdates.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'current' },
      latestVersion: { hash: 'latest' },
    });
    fixture.detectChanges();

    const notice = fixture.nativeElement.querySelector('.update-notice') as HTMLElement;
    expect(notice.textContent).toContain('nueva versión');
    expect(notice.querySelector('button')?.textContent).toContain('Actualizar');
  });

  it('cancels deletion with Escape and restores focus to its trigger', async () => {
    const fixture = TestBed.createComponent(App);
    const store = TestBed.inject(HabitStore);
    await store.initialize();
    await store.createHabit('Caminar');
    fixture.detectChanges();

    const deleteButton = fixture.nativeElement.querySelector(
      '.habit__action--delete',
    ) as HTMLButtonElement;
    deleteButton.focus();
    deleteButton.click();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.getAttribute('aria-labelledby')).toBe('delete-title');

    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    fixture.detectChanges();

    expect(dialog.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(deleteButton);
    expect(storageStub.deleteHabit).not.toHaveBeenCalled();
  });

  it('confirms an accessible habit deletion', async () => {
    const fixture = TestBed.createComponent(App);
    const store = TestBed.inject(HabitStore);
    await store.initialize();
    await store.createHabit('Caminar');
    fixture.detectChanges();

    const deleteButton = fixture.nativeElement.querySelector(
      '.habit__action--delete',
    ) as HTMLButtonElement;
    deleteButton.click();
    fixture.detectChanges();

    const confirmButton = fixture.nativeElement.querySelector(
      '.confirmation__delete',
    ) as HTMLButtonElement;
    expect(confirmButton.textContent).toContain('Eliminar hábito');
    confirmButton.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(storageStub.deleteHabit).toHaveBeenCalledOnce();
    expect(store.habits()).toHaveLength(0);
  });
});
