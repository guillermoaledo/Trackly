import { DOCUMENT } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, inject, signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';

import { HabitStore } from './habit.store';
import { Habit, HabitFrequency, IsoWeekday } from './models/habit.model';

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  @ViewChild('deleteDialog') private deleteDialog?: ElementRef<HTMLDialogElement>;

  protected readonly habitStore = inject(HabitStore);
  protected readonly weekdayOptions: ReadonlyArray<{
    value: IsoWeekday;
    shortLabel: string;
    label: string;
  }> = [
    { value: 1, shortLabel: 'L', label: 'Lunes' },
    { value: 2, shortLabel: 'M', label: 'Martes' },
    { value: 3, shortLabel: 'X', label: 'Miércoles' },
    { value: 4, shortLabel: 'J', label: 'Jueves' },
    { value: 5, shortLabel: 'V', label: 'Viernes' },
    { value: 6, shortLabel: 'S', label: 'Sábado' },
    { value: 7, shortLabel: 'D', label: 'Domingo' },
  ];
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly document = inject(DOCUMENT);
  private readonly swUpdate = inject(SwUpdate);
  private deletionTrigger: HTMLElement | null = null;
  protected readonly updateAvailable = signal(false);
  protected habitName = '';
  protected habitFrequencyType: HabitFrequency['type'] = 'daily';
  protected selectedHabitDays: IsoWeekday[] = [];
  protected showValidationError = false;
  protected showFrequencyValidationError = false;
  protected editingHabitId: string | null = null;
  protected editHabitName = '';
  protected editFrequencyType: HabitFrequency['type'] = 'daily';
  protected selectedEditDays: IsoWeekday[] = [];
  protected showEditValidationError = false;
  protected showEditFrequencyValidationError = false;
  protected habitPendingDeletion: Habit | null = null;
  protected isDeletingHabit = false;

  constructor() {
    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates
        .pipe(
          filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'),
          takeUntilDestroyed(),
        )
        .subscribe(() => {
          this.updateAvailable.set(true);
        });
    }
  }

  protected applyUpdate(): void {
    this.document.location.reload();
  }

  protected async createHabit(): Promise<void> {
    const habit = await this.habitStore.createHabit(
      this.habitName,
      this.buildFrequency(this.habitFrequencyType, this.selectedHabitDays),
    );

    if (!habit && !this.habitStore.operationError()) {
      const normalizedName = this.habitName.trim();
      this.showValidationError = !normalizedName || normalizedName.length > 100;
      this.showFrequencyValidationError =
        this.habitFrequencyType === 'specific-days' && this.selectedHabitDays.length === 0;
      return;
    }

    if (!habit) {
      return;
    }

    this.habitName = '';
    this.habitFrequencyType = 'daily';
    this.selectedHabitDays = [];
    this.showValidationError = false;
    this.showFrequencyValidationError = false;
  }

  protected onHabitNameChange(): void {
    if (this.showValidationError) {
      this.showValidationError = false;
    }
  }

  protected onCreateFrequencyTypeChange(): void {
    this.showFrequencyValidationError = false;
  }

  protected toggleCreateDay(day: IsoWeekday): void {
    this.selectedHabitDays = this.toggleDay(this.selectedHabitDays, day);
    this.showFrequencyValidationError = false;
  }

  protected async toggleHabit(habitId: string): Promise<void> {
    await this.habitStore.toggleCompletedToday(habitId);
  }

  protected startHabitEdit(habit: Habit): void {
    this.editingHabitId = habit.id;
    this.editHabitName = habit.name;
    this.editFrequencyType = habit.frequency.type;
    this.selectedEditDays =
      habit.frequency.type === 'specific-days' ? [...habit.frequency.days] : [];
    this.showEditValidationError = false;
    this.showEditFrequencyValidationError = false;
    this.changeDetector.detectChanges();

    const input = this.document.getElementById(`edit-habit-${habit.id}`) as HTMLInputElement | null;
    input?.focus();
    input?.select();
  }

  protected cancelHabitEdit(): void {
    this.editingHabitId = null;
    this.editHabitName = '';
    this.editFrequencyType = 'daily';
    this.selectedEditDays = [];
    this.showEditValidationError = false;
    this.showEditFrequencyValidationError = false;
  }

  protected async saveHabitEdit(habitId: string): Promise<void> {
    const habit = await this.habitStore.updateHabit(
      habitId,
      this.editHabitName,
      this.buildFrequency(this.editFrequencyType, this.selectedEditDays),
    );

    if (!habit && !this.habitStore.operationError()) {
      const normalizedName = this.editHabitName.trim();
      this.showEditValidationError = !normalizedName || normalizedName.length > 100;
      this.showEditFrequencyValidationError =
        this.editFrequencyType === 'specific-days' && this.selectedEditDays.length === 0;
      return;
    }

    if (!habit) {
      return;
    }

    this.cancelHabitEdit();
  }

  protected onEditNameChange(): void {
    if (this.showEditValidationError) {
      this.showEditValidationError = false;
    }
  }

  protected onEditFrequencyTypeChange(): void {
    this.showEditFrequencyValidationError = false;
  }

  protected toggleEditDay(day: IsoWeekday): void {
    this.selectedEditDays = this.toggleDay(this.selectedEditDays, day);
    this.showEditFrequencyValidationError = false;
  }

  protected requestHabitDeletion(habit: Habit): void {
    this.deletionTrigger = this.document.activeElement as HTMLElement | null;
    this.habitPendingDeletion = habit;
    this.changeDetector.detectChanges();
    this.deleteDialog?.nativeElement.showModal();
  }

  protected cancelHabitDeletion(event?: Event): void {
    event?.preventDefault();
    this.deleteDialog?.nativeElement.close();
  }

  protected async confirmHabitDeletion(): Promise<void> {
    const habit = this.habitPendingDeletion;

    if (!habit) {
      return;
    }

    this.isDeletingHabit = true;
    const deleted = await this.habitStore.deleteHabit(habit.id);
    this.isDeletingHabit = false;

    if (deleted) {
      this.deleteDialog?.nativeElement.close();
    }
  }

  protected onDeletionDialogClosed(): void {
    this.habitPendingDeletion = null;
    this.isDeletingHabit = false;
    this.deletionTrigger?.focus();
    this.deletionTrigger = null;
  }

  protected async retryInitialization(): Promise<void> {
    await this.habitStore.initialize();
  }

  private buildFrequency(type: HabitFrequency['type'], days: IsoWeekday[]): HabitFrequency {
    return type === 'daily' ? { type: 'daily' } : { type: 'specific-days', days };
  }

  private toggleDay(days: IsoWeekday[], day: IsoWeekday): IsoWeekday[] {
    return days.includes(day) ? days.filter((item) => item !== day) : [...days, day];
  }
}
